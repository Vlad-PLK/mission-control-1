import { queryOne, queryAll, run } from '@/lib/db';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { broadcast } from '@/lib/events';
import { v4 as uuidv4 } from 'uuid';
import type { Task, Agent } from '@/lib/types';

const AUTO_DISPATCH_DELAY_MS = 3000;
const MAX_RETRIES = 3;

export async function autoDispatchNextTask(completedTaskId: string): Promise<void> {
  const currentTask = queryOne<{ id: string; group_id: string | null; order_index: number }>(
    'SELECT id, group_id, order_index FROM tasks WHERE id = ?',
    [completedTaskId]
  );

  if (!currentTask?.group_id) {
    return;
  }

  const nextTask = queryOne<Task & { assigned_agent_name?: string; workspace_id: string; workspace_folder_path?: string }>(
    `SELECT t.*, a.name as assigned_agent_name, w.folder_path as workspace_folder_path
     FROM tasks t
     LEFT JOIN agents a ON t.assigned_agent_id = a.id
     LEFT JOIN workspaces w ON t.workspace_id = w.id
     WHERE t.group_id = ?
       AND t.order_index > ?
       AND t.status = 'inbox'
       AND t.assigned_agent_id IS NOT NULL
     ORDER BY t.order_index ASC
     LIMIT 1`,
    [currentTask.group_id, currentTask.order_index]
  );

  if (!nextTask) {
    return;
  }

  const delayMs = AUTO_DISPATCH_DELAY_MS;
  
  setTimeout(async () => {
    try {
      await dispatchTaskToAgent(nextTask);
    } catch (error) {
      console.error(`Auto-dispatch failed for task ${nextTask.id}:`, error);
      
      for (let retry = 1; retry <= MAX_RETRIES; retry++) {
        try {
          await new Promise(resolve => setTimeout(resolve, 2000 * retry));
          await dispatchTaskToAgent(nextTask);
          break;
        } catch (retryError) {
          console.error(`Auto-dispatch retry ${retry} failed for task ${nextTask.id}:`, retryError);
        }
      }
    }
  }, delayMs);
}

async function dispatchTaskToAgent(task: Task & { assigned_agent_name?: string; workspace_id: string; workspace_folder_path?: string }): Promise<void> {
  const agent = queryOne<Agent>('SELECT * FROM agents WHERE id = ?', [task.assigned_agent_id]);
  if (!agent) {
    console.error(`No agent found for task ${task.id}`);
    return;
  }

  const client = getOpenClawClient();
  if (!client.isConnected()) {
    try {
      await client.connect();
    } catch (error) {
      console.error('Failed to connect to OpenClaw:', error);
      throw error;
    }
  }

  const now = new Date().toISOString();
  const sessionKey = `agent:main:mission-control-${task.id}-${agent.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

  const session = queryOne<{ id: string }>(
    `SELECT id FROM openclaw_sessions WHERE task_id = ? AND status = 'active' LIMIT 1`,
    [task.id]
  );

  if (!session) {
    const { v4: uuidv4 } = await import('uuid');
    const sessionId = uuidv4();
    const openclawSessionId = `mission-control-${task.id}-${agent.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

    run(
      `INSERT INTO openclaw_sessions (id, agent_id, openclaw_session_id, channel, status, session_type, task_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [sessionId, agent.id, openclawSessionId, 'mission-control', 'active', 'task', task.id, now, now]
    );
  }

  const taskMessage = buildDispatchMessage(task);

  try {
    await client.call('chat.send', {
      sessionKey,
      message: taskMessage,
      idempotencyKey: `auto-dispatch-${task.id}-${Date.now()}`
    });

    run(
      'UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?',
      ['in_progress', now, task.id]
    );

    const updatedTask = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [task.id]);
    if (updatedTask) {
      broadcast({ type: 'task_updated', payload: updatedTask });
    }

    run(
      `INSERT INTO task_activities (id, task_id, agent_id, activity_type, message, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), task.id, agent.id, 'status_changed', `Task auto-dispatched to ${agent.name}`, now]
    );

  } catch (error) {
    console.error('Failed to send task to agent:', error);
    throw error;
  }
}

function buildDispatchMessage(task: Task): string {
  const priorityEmoji: Record<string, string> = {
    low: '🔵',
    normal: '⚪',
    high: '🟡',
    urgent: '🔴'
  };

  const emoji = priorityEmoji[task.priority] || '⚪';
  
  let message = `${emoji} **NEW TASK ASSIGNED** (Auto-Dispatched)\n\n`;
  message += `**Title:** ${task.title}\n`;
  
  if (task.description) {
    message += `**Description:** ${task.description}\n`;
  }
  
  message += `**Priority:** ${task.priority.toUpperCase()}\n`;
  
  if (task.due_date) {
    message += `**Due:** ${task.due_date}\n`;
  }
  
  message += `\nThis task was automatically dispatched from the previous task in the group.`;
  
  return message;
}
