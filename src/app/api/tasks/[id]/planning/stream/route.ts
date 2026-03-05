/**
 * Server-Sent Events (SSE) endpoint for real-time planning updates
 * Streams planning progress to clients without polling
 */

import { NextRequest } from 'next/server';
import { queryOne } from '@/lib/db';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { extractJSON, getMessagesFromOpenClaw } from '@/lib/planning-utils';
import type { Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

const PLANNING_TIMEOUT_MS = parseInt(process.env.PLANNING_TIMEOUT_MS || '120000', 10);
const PLANNING_POLL_INTERVAL_MS = parseInt(process.env.PLANNING_POLL_INTERVAL_MS || '2000', 10);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;
  const encoder = new TextEncoder();

  const task = queryOne<{
    id: string;
    planning_session_key?: string;
    planning_messages?: string;
    planning_complete?: number;
  }>('SELECT * FROM tasks WHERE id = ?', [taskId]);

  if (!task || !task.planning_session_key) {
    return new Response('Planning session not found', { status: 404 });
  }

  if (task.planning_complete) {
    return new Response(JSON.stringify({ hasUpdates: false, isComplete: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const stream = new ReadableStream({
    start(controller) {
      const sendEvent = (data: object) => {
        const message = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(message));
      };

      sendEvent({ type: 'connected', message: 'Planning stream connected' });

      let running = true;
      const startTime = Date.now();

      const pollInterval = setInterval(async () => {
        if (!running) {
          clearInterval(pollInterval);
          return;
        }

        if (Date.now() - startTime > PLANNING_TIMEOUT_MS) {
          sendEvent({ type: 'timeout', message: 'Planning timeout reached' });
          clearInterval(pollInterval);
          try {
            controller.close();
          } catch {}
          return;
        }

        try {
          const currentTask = queryOne<{
            planning_messages?: string;
            planning_complete?: number;
            planning_dispatch_error?: string;
          }>('SELECT planning_messages, planning_complete, planning_dispatch_error FROM tasks WHERE id = ?', [taskId]);

          if (!currentTask) {
            sendEvent({ type: 'error', message: 'Task not found' });
            clearInterval(pollInterval);
            try {
              controller.close();
            } catch {}
            return;
          }

          if (currentTask.planning_complete) {
            sendEvent({ type: 'complete', message: 'Planning complete' });
            clearInterval(pollInterval);
            try {
              controller.close();
            } catch {}
            return;
          }

          const messages = currentTask.planning_messages ? JSON.parse(currentTask.planning_messages) : [];
          const initialAssistantCount = messages.filter((m: any) => m.role === 'assistant').length;

          const openclawMessages = await getMessagesFromOpenClaw(task.planning_session_key!);

          if (openclawMessages.length > initialAssistantCount) {
            const newMessages = openclawMessages.slice(initialAssistantCount);

            for (const msg of newMessages) {
              if (msg.role === 'assistant') {
                const parsed = extractJSON(msg.content) as {
                  status?: string;
                  question?: string;
                  options?: Array<{ id: string; label: string }>;
                  spec?: object;
                  agents?: Array<object>;
                } | null;

                sendEvent({
                  type: 'message',
                  role: msg.role,
                  content: msg.content,
                  parsed,
                });

                if (parsed && parsed.status === 'complete') {
                  sendEvent({
                    type: 'complete',
                    spec: parsed.spec,
                    agents: parsed.agents,
                  });
                  clearInterval(pollInterval);
                  try {
                    controller.close();
                  } catch {}
                  return;
                }

                if (parsed && parsed.question && parsed.options) {
                  sendEvent({
                    type: 'question',
                    question: parsed.question,
                    options: parsed.options,
                  });
                }
              }
            }
          }
        } catch (error) {
          console.error('[Planning Stream] Error:', error);
          sendEvent({ type: 'error', message: String(error) });
        }
      }, PLANNING_POLL_INTERVAL_MS);

      request.signal.addEventListener('abort', () => {
        running = false;
        clearInterval(pollInterval);
        try {
          controller.close();
        } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
