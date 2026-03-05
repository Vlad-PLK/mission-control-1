import { NextResponse } from 'next/server';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const checks: Record<string, string> = {
    status: 'ok',
  };

  try {
    checks.timestamp = new Date().toISOString();
    checks.uptime = process.uptime().toString();
    checks.version = '1.2.1';
  } catch (e) {
    checks.system = 'error';
    checks.status = 'degraded';
  }

  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
    checks.database = 'ok';
  } catch (e) {
    checks.database = 'error';
    checks.status = 'degraded';
  }

  try {
    const client = getOpenClawClient();
    if (client.isConnected()) {
      checks.gateway = 'connected';
    } else {
      try {
        await client.connect();
        checks.gateway = 'connected';
      } catch {
        checks.gateway = 'disconnected';
        checks.status = 'degraded';
      }
    }
  } catch (e) {
    checks.gateway = 'error';
    checks.status = 'degraded';
  }

  const statusCode = checks.status === 'ok' ? 200 : 503;
  return NextResponse.json(checks, { status: statusCode });
}
