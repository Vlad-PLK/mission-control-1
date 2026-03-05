# Mission Control Enhancement Plan v1.2.1

**Version:** 1.2.1  
**Target:** Mission Control + Gateway Integration  
**Created:** 2026-03-05  
**Status:** Ready for Implementation

---

## Executive Summary

This plan addresses all identified bugs and performance issues to reduce latency and communication failures between Mission Control and the OpenClaw Gateway.

---

## Issues Summary (Priority Order)

| # | Issue | Severity | Category |
|---|-------|----------|----------|
| 1 | Planning approve route doesn't set `planning_complete = 1` | **Critical** | Bug |
| 2 | Gateway status endpoint returns false negative | **High** | Bug |
| 3 | No dispatch failure retry mechanism | **High** | Gap |
| 4 | Planning timeout too short (30s) | **Medium** | Config |
| 5 | Duplicate dispatch activity logs | **Low** | Bug |
| 6 | Token tracking not implemented | **Medium** | Feature |
| 7 | Session history API broken | **Low** | Bug |
| 8 | Status endpoint uses wrong client instance | **Low** | Bug |

---

## Phase 1: Critical Bug Fixes

### 1.1 Fix Planning Approve Route

**File:** `src/app/api/tasks/[id]/planning/approve/route.ts`

**Problem:** Manual approve endpoint never sets `planning_complete = 1`, leaving tasks in incomplete planning state.

**Current Code (lines ~115-120):**
```typescript
// Update task description with spec and move to inbox
db.prepare(`
  UPDATE tasks 
  SET description = ?, status = 'inbox', updated_at = datetime('now')
  WHERE id = ?
`).run(specMarkdown, taskId);
```

**Fix Required:** Add `planning_complete = 1` to the UPDATE statement:

```typescript
// Update task description with spec, mark complete, and move to inbox
db.prepare(`
  UPDATE tasks 
  SET description = ?, 
      status = 'inbox', 
      planning_complete = 1,
      updated_at = datetime('now')
  WHERE id = ?
`).run(specMarkdown, taskId);
```

**Test:** After approve, query task should show `planning_complete = 1`.

---

### 1.2 Fix Gateway Status Endpoint

**File:** `src/app/api/openclaw/status/route.ts`

**Problem:** Status endpoint creates new OpenClawClient instance instead of using singleton, showing false "disconnected" status.

**Current Code (line ~8):**
```typescript
const client = new OpenClawClient();
```

**Fix Required:** Import and use singleton:

```typescript
import { getOpenClawClient } from '@/lib/openclaw/client';

// Later in the function:
const client = getOpenClawClient();
```

**Test:** Call `/api/openclaw/status` - should show `connected: true` when Gateway is running.

---

## Phase 2: Reliability Improvements

### 2.1 Add Dispatch Failure Retry

**File:** `src/app/api/tasks/[id]/dispatch/route.ts` (modify to be idempotent)

**Problem:** Failed dispatch leaves task stuck without clear recovery path.

**Option A - Make dispatch idempotent:**
Add at start of POST function:
```typescript
// Check if already dispatched - return existing session
const existingSession = queryOne<OpenClawSession>(
  `SELECT * FROM openclaw_sessions 
   WHERE task_id = ? AND session_type = 'task' AND status = 'active'`,
  [id]
);

if (existingSession) {
  return NextResponse.json({
    success: true,
    task_id: id,
    session_id: existingSession.openclaw_session_id,
    message: 'Task already dispatched'
  });
}
```

**Option B - Add retry-dispatch endpoint:**
Verify `src/app/api/tasks/[id]/retry-dispatch/route.ts` exists and works. If not, create it.

**Test:** Call dispatch twice - second call should return "already dispatched" instead of creating duplicate.

---

### 2.2 Add Planning Timeout Configuration

**Files:** 
- `src/app/api/tasks/[id]/planning/poll/route.ts`
- `.env` (or docker-compose.yml)

**Current:** Hardcoded 30 second timeout (line ~12):
```typescript
const PLANNING_TIMEOUT_MS = parseInt(process.env.PLANNING_TIMEOUT_MS || '30000', 10);
```

**Fix Required:**

1. Add to `.env`:
```bash
PLANNNING_TIMEOUT_MS=120000
PLANNING_POLL_INTERVAL_MS=3000
```

2. Update validation (line ~18-20):
```typescript
if (isNaN(PLANNING_TIMEOUT_MS) || PLANNING_TIMEOUT_MS < 1000) {
  throw new Error('PLANNING_TIMEOUT_MS must be a valid number >= 1000ms');
}
```

**Test:** Start planning on complex task - should not timeout for 2 minutes.

---

### 2.3 Prevent Duplicate Dispatch Activities

**File:** `src/app/api/tasks/[id]/dispatch/route.ts`

**Problem:** Multiple dispatch calls create duplicate "Task dispatched" activity logs.

**Current Code (lines ~210-220):**
```typescript
// Insert activity (always runs)
run(`
  INSERT INTO task_activities (id, task_id, agent_id, activity_type, message, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`, [activityId, task.id, agent.id, 'status_changed', `Task dispatched to ${agent.name} - Agent is now working on this task`, now]);
```

**Fix Required:** Add idempotency check before insert:
```typescript
// Check for recent duplicate dispatch activity (idempotency)
const recentDispatch = queryOne(`
  SELECT id FROM task_activities 
  WHERE task_id = ? 
    AND activity_type = 'status_changed'
    AND message LIKE 'Task dispatched%'
    AND created_at > datetime('now', '-5 minutes')
`, [task.id]);

if (!recentDispatch) {
  run(`
    INSERT INTO task_activities (id, task_id, agent_id, activity_type, message, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [activityId, task.id, agent.id, 'status_changed', `Task dispatched to ${agent.name} - Agent is now working on this task`, now]);
}
```

**Test:** Call dispatch twice - should only see ONE activity log entry.

---

## Phase 3: Feature Enhancements

### 3.1 Add Token Tracking Columns

**File:** `src/lib/db/schema.ts`

**Problem:** No token usage tracking for sessions.

**Fix Required:**

1. Add columns to schema (around line ~170):
```sql
-- Add after status column in openclaw_sessions table:
ALTER TABLE openclaw_sessions ADD COLUMN input_tokens INTEGER DEFAULT 0;
ALTER TABLE openclaw_sessions ADD COLUMN output_tokens INTEGER DEFAULT 0;
ALTER TABLE openclaw_sessions ADD COLUMN total_tokens INTEGER DEFAULT 0;
ALTER TABLE openclaw_sessions ADD COLUMN last_token_update TEXT;
```

2. Update `src/lib/db/migrations.ts` to handle existing databases.

**Test:** After migration, query `PRAGMA table_info(openclaw_sessions)` should show new columns.

---

### 3.2 Fix Session History API

**File:** `src/app/api/openclaw/sessions/[id]/history/route.ts`

**Problem:** Calls `sessions.history` method which doesn't exist in Gateway.

**Current Code (line ~25):**
```typescript
const history = await client.getSessionHistory(id);
```

**Fix Required:** Use `chat.history` instead:
```typescript
// Get session info first to find the actual session ID
const session = queryOne<OpenClawSession>(
  'SELECT openclaw_session_id FROM openclaw_sessions WHERE id = ?',
  [id]
);

if (!session) {
  return NextResponse.json({ error: 'Session not found' }, { status: 404 });
}

// Use chat.history with sessionKey
const result = await client.call('chat.history', {
  sessionKey: `agent:main:${session.openclaw_session_id}`,
  limit: 50,
});

return NextResponse.json({ history: result.messages || [] });
```

**Test:** Call `/api/openclaw/sessions/[id]/history` - should return message history.

---

### 3.3 Add Health Check Endpoint

**File:** `src/app/api/health/route.ts` (new)

**Problem:** No single endpoint to check overall system health.

**Implementation:**
```typescript
import { NextResponse } from 'next/server';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { getDb } from '@/lib/db';

export async function GET() {
  const checks = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.2.1',
  };

  // Check database
  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
    checks.database = 'ok';
  } catch (e) {
    checks.database = 'error';
    checks.status = 'degraded';
  }

  // Check Gateway
  try {
    const client = getOpenClawClient();
    if (client.isConnected()) {
      checks.gateway = 'connected';
    } else {
      checks.gateway = 'disconnected';
      checks.status = 'degraded';
    }
  } catch (e) {
    checks.gateway = 'error';
    checks.status = 'degraded';
  }

  return NextResponse.json(checks);
}
```

**Test:** Call `/api/health` - should return all system checks.

---

## Phase 4: Performance Optimizations (Optional)

### 4.1 Add SSE for Planning Updates

Replace polling with Server-Sent Events for real-time planning updates.

**File:** `src/app/api/tasks/[id]/planning/stream/route.ts` (new)

```typescript
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    start(controller) {
      // Stream planning updates to client
      // Subscribe to planning events and forward via SSE
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

---

### 4.2 Periodic Token Sync Cron

**File:** `scripts/sync-tokens.ts` (new)

Add a cron job to periodically fetch token counts from Gateway:
```typescript
// Fetch all active sessions from Gateway
// Update token counts in openclaw_sessions table
// Run every 5 minutes
```

---

## Implementation Checklist

```
Phase 1: Critical (Immediate)
├── ☐ 1.1 Fix planning approve route (planning_complete = 1)
│   └── Edit: src/app/api/tasks/[id]/planning/approve/route.ts
├── ☐ 1.2 Fix gateway status endpoint (use singleton)
│   └── Edit: src/app/api/openclaw/status/route.ts
└── ☐ 1.3 Test both fixes

Phase 2: Reliability (This Week)
├── ☐ 2.1 Make dispatch idempotent
│   └── Edit: src/app/api/tasks/[id]/dispatch/route.ts
├── ☐ 2.2 Increase planning timeout to 2min
│   └── Edit: src/app/api/tasks/[id]/planning/poll/route.ts + .env
├── ☐ 2.3 Prevent duplicate dispatch activities
│   └── Edit: src/app/api/tasks/[id]/dispatch/route.ts
└── ☐ 2.4 Test reliability improvements

Phase 3: Features (Next Week)
├── ☐ 3.1 Add token tracking columns to schema
│   └── Edit: src/lib/db/schema.ts + migrations.ts
├── ☐ 3.2 Fix session history API
│   └── Edit: src/app/api/openclaw/sessions/[id]/history/route.ts
├── ☐ 3.3 Add health check endpoint
│   └── Create: src/app/api/health/route.ts
└── ☐ 3.4 Test new features

Phase 4: Optimizations (Backlog)
├── ☐ 4.1 Add SSE for planning updates
├── ☐ 4.2 Add token sync cron job
└── ☐ 4.3 Version bump to 1.2.1
```

---

## Time Estimate

| Phase | Tasks | Estimated Time |
|-------|-------|-----------------|
| Phase 1 | 2 | 15 min |
| Phase 2 | 3 | 30 min |
| Phase 3 | 3 | 1 hour |
| Phase 4 | 3 | 1 hour |
| **Total** | **11** | **~2.5 hours** |

---

## Rollback Plan

All changes are backward-compatible:
- Database migrations add columns only (no data loss)
- API changes are additive (old calls still work)
- No breaking changes to existing workflows

To rollback: Revert code changes, database schema additions are harmless.

---

## Related Documentation

- **Mission Control API:** `/api/tasks`, `/api/openclaw/*`
- **Gateway Connection:** `src/lib/openclaw/client.ts`
- **Database Schema:** `src/lib/db/schema.ts`
- **Current Issues:** See analysis from 2026-03-05 session

---

*End of Enhancement Plan*
