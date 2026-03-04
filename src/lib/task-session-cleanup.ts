import { getDb } from '@/lib/db';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { toGatewaySessionKey } from '@/lib/openclaw/sessionKeys';

/**
 * Best-effort cleanup for OpenClaw sessions created for a task.
 *
 * Goal: prevent Gateway session buildup (and transcripts) once a task is DONE.
 *
 * We only target non-persistent sessions (task/subagent).
 */
export async function cleanupTaskSessions(taskId: string, opts?: { deleteTranscript?: boolean }) {
  const db = getDb();

  const sessions = db
    .prepare(
      `SELECT *
       FROM openclaw_sessions
       WHERE task_id = ?
         AND session_type IN ('task', 'subagent')`
    )
    .all(taskId) as Array<{
    id: string;
    openclaw_session_id: string;
    session_type: string;
    status: string;
  }>;

  if (sessions.length === 0) return { deleted: 0, failed: 0 };

  // Mark ended in DB up front regardless of Gateway connectivity,
  // to remove from any "active" counts.
  for (const s of sessions) {
    db.prepare(
      `UPDATE openclaw_sessions
       SET status = 'ended',
           ended_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(s.id);
  }

  const client = getOpenClawClient();
  if (!client.isConnected()) {
    await client.connect();
  }

  let deleted = 0;
  let failed = 0;

  for (const s of sessions) {
    const key = toGatewaySessionKey(s.openclaw_session_id);

    try {
      await client.deleteSession(key, {
        deleteTranscript: opts?.deleteTranscript ?? true,
        emitLifecycleHooks: true,
      });

      // Remove from DB on success
      db.prepare('DELETE FROM openclaw_sessions WHERE id = ?').run(s.id);
      deleted++;
    } catch (err) {
      console.error('[cleanupTaskSessions] Failed to delete gateway session', { key, err });
      // Keep DB row for audit / manual retry, but mark as cleanup_failed
      db.prepare(
        `UPDATE openclaw_sessions
         SET status = 'cleanup_failed',
             updated_at = datetime('now')
         WHERE id = ?`
      ).run(s.id);
      failed++;
    }
  }

  return { deleted, failed };
}
