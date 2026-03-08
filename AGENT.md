# Mission Control - Agent Instructions

## System Overview

**Mission Control** is an AI Agent Orchestration Dashboard that allows you to create tasks, plan with AI, dispatch to agents, and watch them work.

- **Framework**: Next.js 14 + TypeScript
- **Database**: SQLite (better-sqlite3)
- **Runtime**: OpenClaw Gateway (WebSocket)
- **Port**: 4000
- **OpenCode Model**: `minimax-coding-plan/MiniMax-M2.5-highspeed`

---

## Core Concepts

### 1. Workspaces
- Each workspace has a `folder_path` where agent work gets saved
- Workspaces contain agents and tasks
- Agents can belong to multiple workspaces via `workspace_agents` table

### 2. Agents
- **Master Agents**: Can approve tasks (move from review → done)
- **Specialized Agents**: Assigned to specific tasks
- Agent context defined by: `soul_md`, `user_md`, `agents_md`
- Imported from OpenClaw Gateway or created locally

### 3. Tasks (Mission Queue)
Seven-status workflow:
```
planning → inbox → assigned → in_progress → testing → review → done
```

### 4. Task Groups
- Tasks grouped for sequential execution
- When task reaches **review**, next task in group is **auto-dispatched**
- Group has shared context, requirements, and instructions

### 5. Task Dependencies
- `blocks` / `blocked_by` relationships
- When blocking task completes → dependent tasks auto-unblocked
- Blocked tasks cannot move to in_progress/assigned/testing/review

---

## Automation Rules

### Auto-Dispatch (Task Groups)
- **Trigger**: Task moves to `review` status
- **Action**: Next task in same group (higher `order_index`, status `inbox`, has assigned agent) is dispatched
- **Delay**: 3 seconds before dispatch
- **Retry**: Up to 3 retries on failure

**Location**: `src/lib/task-automation.ts`

### Auto-Unblock (Dependencies)
- **Trigger**: Task marked as `done`
- **Action**: All tasks that depend on it (dependency_type = 'blocks') are moved to `assigned` (if has agent) or `inbox`

**Location**: `src/lib/dependency-automation.ts`

### Session Cleanup
- **Trigger**: Task marked as `done`
- **Action**: OpenClaw sessions for task are marked as 'ended' and deleted from Gateway
- **Transcript**: Deleted by default

**Location**: `src/lib/task-session-cleanup.ts`

---

## Coding Tasks

When a task involves coding, agents **must use OpenCode**.

### Required Model
```
minimax-coding-plan/MiniMax-M2.5-highspeed
```

### Execution Pattern

**Phase 1 - PLANNING (always start here)**:
```bash
cd {workspace_dir} && opencode run -m minimax-coding-plan/MiniMax-M2.5-highspeed --dir . "Planning mode: {task details}"
```

**Phase 2 - BUILD (after planning)**:
```bash
cd {workspace_dir} && opencode run -m minimax-coding-plan/MiniMax-M2.5-highspeed --dir . "Build mode: {task details}"
```

### Strict Prohibitions
- ❌ DO NOT run `npm run dev`, `npm start`, `npm run build`
- ❌ DO NOT execute code (no `node`, `python`, `cargo run`)
- ❌ DO NOT deploy or push to production
- ❌ DO NOT run test suites unless explicitly requested
- ❌ DO NOT install packages
- ❌ DO NOT start development servers or containers

### Completion Protocol
After completing work, you **MUST** follow this exact sequence:

1. **Validate your work**
2. **Log activity**:
   ```bash
   POST {missionControlUrl}/api/tasks/{taskId}/activities
   Body: {"activity_type": "completed", "message": "Description of what was done"}
   ```
3. **Register deliverables**:
   ```bash
   POST {missionControlUrl}/api/tasks/{taskId}/deliverables
   Body: {"deliverable_type": "file", "title": "File name", "path": "/path/to/file"}
   ```
4. **Update status**:
   ```bash
   PATCH {missionControlUrl}/api/tasks/{taskId}
   Body: {"status": "review"}
   ```

---

## API Usage

### Core Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/tasks` | List all tasks |
| GET | `/api/tasks/[id]` | Get single task |
| POST | `/api/tasks` | Create task |
| PATCH | `/api/tasks/[id]` | Update task (triggers automation) |
| DELETE | `/api/tasks/[id]` | Delete task |
| POST | `/api/tasks/[id]/dispatch` | Dispatch task to agent |
| POST | `/api/tasks/[id]/activities` | Log activity |
| POST | `/api/tasks/[id]/deliverables` | Register deliverable |
| POST | `/api/tasks/[id]/subagent` | Register sub-agent session |
| POST | `/api/tasks/[id]/dependencies` | Add dependency |
| GET | `/api/workspaces` | List workspaces |
| GET | `/api/agents` | List agents |

### Orchestration Helpers

Import from `src/lib/orchestration.ts`:

```typescript
import * as orchestrator from '@/lib/orchestration';

// When spawning a sub-agent
await orchestrator.onSubAgentSpawned({
  taskId: 'task-123',
  sessionId: 'agent:main:subagent:abc',
  agentName: 'my-subagent',
});

// Log progress
await orchestrator.logActivity({
  taskId: 'task-123',
  activityType: 'updated',
  message: 'Fixed the integration issue'
});

// When complete
await orchestrator.onSubAgentCompleted({
  taskId: 'task-123',
  sessionId: 'agent:main:subagent:abc',
  agentName: 'my-subagent',
  summary: 'All done',
  deliverables: [{ type: 'file', title: 'Fixed file', path: 'src/...' }]
});

// Verify before approval
const hasDeliverables = await orchestrator.verifyTaskHasDeliverables('task-123');
if (!hasDeliverables) {
  console.log('Cannot approve - no deliverables');
}
```

---

## Safety Rules

### Workflow Enforcement
1. **Master Agent Approval Only**: Only agents with `is_master = true` can move tasks from `review` → `done`
2. **Dependency Blocking**: Blocked tasks cannot move forward until blockers complete
3. **Deliverable Requirement**: Tasks should have deliverables before approval

### Best Practices
- Always log activities as work progresses
- Register deliverables immediately when created
- Use proper session management for sub-agents
- Verify deliverables exist before attempting approval

### Error Handling
- If APIs fail: retry up to 3 times with exponential backoff (1s, 2s, 4s)
- If persistent failure: log activity with error details and continue
- Never abandon tasks due to API errors

---

## File Structure

```
src/
├── app/
│   ├── api/
│   │   ├── tasks/           # Task CRUD + dispatch
│   │   ├── agents/          # Agent management
│   │   ├── workspaces/      # Workspace management
│   │   └── openclaw/        # Gateway proxy
│   └── workspace/[slug]/    # Workspace dashboard
├── components/
│   ├── MissionQueue.tsx     # Kanban board
│   ├── PlanningTab.tsx      # AI planning
│   ├── AgentsSidebar.tsx    # Agent panel
│   └── LiveFeed.tsx         # Real-time events
└── lib/
    ├── db/                  # SQLite + migrations
    ├── openclaw/            # Gateway client
    ├── task-automation.ts   # Auto-dispatch
    ├── dependency-automation.ts # Auto-unblock
    ├── orchestration.ts     # Helper functions
    ├── opencode.ts          # OpenCode integration
    └── types.ts             # TypeScript types
```

---

## Key Configuration

### Environment Variables
| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCLAW_GATEWAY_URL` | `ws://127.0.0.1:18789` | WebSocket to Gateway |
| `OPENCLAW_GATEWAY_TOKEN` | - | Authentication token |
| `MISSION_CONTROL_URL` | `http://localhost:4000` | API base URL |
| `WORKSPACE_BASE_PATH` | `~/Documents/Shared` | Base workspace directory |
| `PROJECTS_PATH` | `~/Documents/Shared/projects` | Projects directory |

---

## Important Notes

1. **Never commit secrets**: Use `.env` files, never hardcode tokens/keys
2. **Database migrations**: When adding tables/columns, add to `schema.ts` and create migration in `migrations.ts`
3. **SSE events**: Use `broadcast()` from `@/lib/events` to push real-time updates
4. **Task cleanup**: Always clean up OpenClaw sessions when tasks are deleted or completed
