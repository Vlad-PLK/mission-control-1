import { NextResponse } from 'next/server';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { queryOne } from '@/lib/db';
import type { OpenClawSession } from '@/lib/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/openclaw/sessions/[id]/history - Get conversation history
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const client = getOpenClawClient();

    if (!client.isConnected()) {
      try {
        await client.connect();
      } catch {
        return NextResponse.json(
          { error: 'Failed to connect to OpenClaw Gateway' },
          { status: 503 }
        );
      }
    }

    // Get the actual OpenClaw session ID from our DB
    const session = queryOne<OpenClawSession>(
      'SELECT openclaw_session_id FROM openclaw_sessions WHERE id = ?',
      [id]
    );

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Use chat.history with sessionKey (not sessions.history)
    const result = await client.call<{ messages?: Array<{ role: string; content: string; timestamp?: string }> }>('chat.history', {
      sessionKey: `agent:main:${session.openclaw_session_id}`,
      limit: 50,
    });

    return NextResponse.json({ history: result?.messages || [] });
  } catch (error) {
    console.error('Failed to get OpenClaw session history:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
