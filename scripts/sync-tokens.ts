/**
 * Token Sync Script
 * 
 * Periodically fetches token usage from OpenClaw Gateway and updates
 * the openclaw_sessions table with token counts.
 */

import { getDb } from '../src/lib/db';
import { getOpenClawClient } from '../src/lib/openclaw/client';

interface OpenClawSession {
  id: string;
  openclaw_session_id: string;
  status: string;
}

async function syncTokens() {
  console.log('[Token Sync] Starting token sync...');

  const db = getDb();
  const client = getOpenClawClient();

  if (!client.isConnected()) {
    try {
      await client.connect();
    } catch (err) {
      console.error('[Token Sync] Failed to connect to Gateway:', err);
      process.exit(1);
    }
  }

  const sessions = db.prepare(`
    SELECT id, openclaw_session_id, status 
    FROM openclaw_sessions 
    WHERE status = 'active'
  `).all() as OpenClawSession[];

  console.log(`[Token Sync] Found ${sessions.length} active sessions`);

  let updated = 0;
  const now = new Date().toISOString();

  for (const session of sessions) {
    try {
      const result = await client.call<{
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
      }>('chat.usage', {
        sessionKey: `agent:main:${session.openclaw_session_id}`,
      });

      if (result && (result.input_tokens || result.output_tokens || result.total_tokens)) {
        const inputTokens = result.input_tokens || 0;
        const outputTokens = result.output_tokens || 0;
        const totalTokens = result.total_tokens || (inputTokens + outputTokens);

        db.prepare(`
          UPDATE openclaw_sessions 
          SET input_tokens = ?, 
              output_tokens = ?, 
              total_tokens = ?,
              last_token_update = ?
          WHERE id = ?
        `).run(inputTokens, outputTokens, totalTokens, now, session.id);

        console.log(`[Token Sync] Updated session ${session.openclaw_session_id}: in=${inputTokens}, out=${outputTokens}, total=${totalTokens}`);
        updated++;
      }
    } catch (err) {
      console.warn(`[Token Sync] Failed to get usage for session ${session.openclaw_session_id}:`, err);
    }
  }

  console.log(`[Token Sync] Completed. Updated ${updated}/${sessions.length} sessions`);
}

syncTokens().catch(console.error);
