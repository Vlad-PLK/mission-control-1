import { NextResponse } from 'next/server';
import { getOpenClawClient } from '@/lib/openclaw/client';

// GET /api/openclaw/status - Check OpenClaw connection status
export async function GET() {
  try {
    const client = getOpenClawClient();
    console.log('[status] Client URL:', client['url']); // Debug log

    if (!client.isConnected()) {
      console.log('[status] Not connected, attempting connect...'); // Debug log
      try {
        await client.connect();
        console.log('[status] Connect succeeded'); // Debug log
      } catch (err) {
        console.log('[status] Connect failed:', err); // Debug log
        return NextResponse.json({
          connected: false,
          error: 'Failed to connect to OpenClaw Gateway',
          gateway_url: process.env.NEXT_PUBLIC_OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789',
        });
      }
    }

    // Try to list sessions to verify connection
    try {
      const sessions = await client.listSessions();
      return NextResponse.json({
        connected: true,
        sessions_count: sessions.length,
        sessions: sessions,
        gateway_url: process.env.NEXT_PUBLIC_OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789',
      });
    } catch (err) {
      return NextResponse.json({
        connected: true,
        error: 'Connected but failed to list sessions',
        gateway_url: process.env.NEXT_PUBLIC_OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789',
      });
    }
  } catch (error) {
    console.error('OpenClaw status check failed:', error);
    return NextResponse.json(
      {
        connected: false,
        error: 'Internal server error',
      },
      { status: 500 }
    );
  }
}
