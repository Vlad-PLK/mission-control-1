import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { queryOne, queryAll, run } from '@/lib/db';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { broadcast } from '@/lib/events';
import { getProjectsPath, getMissionControlUrl } from '@/lib/config';
import type { Task, Agent, OpenClawSession } from '@/lib/types';

interface BulkDispatchRequest {
  task_ids?: string[];
  group_id?: string;
}

interface DispatchResult {
  task_id: string;
  success: boolean;
  message: string;
  session_id?: string;
  error?: string;
}

async function dispatchSingleTask(task: Task & { assigned_agent_name?: string; workspace_id: string; workspace_folder_path?: string }, agent: Agent): Promise<DispatchResult> {
  const now = new Date().toISOString();
  
  const client = getOpenClawClient();
  if (!client.isConnected()) {
    try {
      await client.connect();
    } catch (err) {
      console.error('Failed to connect to OpenClaw Gateway:', err);
      return { task_id: task.id, success: false, message: 'Failed to connect to Gateway', error: String(err) };
    }
  }

  let session = queryOne<OpenClawSession>(
    `SELECT *
     FROM openclaw_sessions
     WHERE agent_id = ?
       AND task_id = ?
       AND session_type = 'task'
       AND status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`,
    [agent.id, task.id]
  );

  if (!session) {
    const sessionId = uuidv4();
    const agentSlug = agent.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const openclawSessionId = `mission-control-${task.id}-${agentSlug}`;

    run(
      `INSERT INTO openclaw_sessions (id, agent_id, openclaw_session_id, channel, status, session_type, task_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [sessionId, agent.id, openclawSessionId, 'mission-control', 'active', 'task', task.id, now, now]
    );

    session = queryOne<OpenClawSession>(
      'SELECT * FROM openclaw_sessions WHERE id = ?',
      [sessionId]
    );

    if (!session) {
      return { task_id: task.id, success: false, message: 'Failed to create session', error: 'Session creation failed' };
    }

    run(
      `INSERT INTO events (id, type, agent_id, message, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [uuidv4(), 'agent_status_changed', agent.id, `${agent.name} session created`, now]
    );
  }

  const priorityEmoji = {
    low: '🔵',
    normal: '⚪',
    high: '🟡',
    urgent: '🔴'
  }[task.priority] || '⚪';

  const resolveTilde = (input: string): string => {
    if (!input) return input;
    if (!input.startsWith('~')) return input;
    return input.replace(/^~/, process.env.HOME || process.env.USERPROFILE || '');
  };

  const codebaseDir = task.workspace_folder_path ? resolveTilde(task.workspace_folder_path.trim()) : null;
  const projectsBaseDir = resolveTilde(getProjectsPath());
  const projectDir = task.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const taskWorkingDir = codebaseDir ? codebaseDir : `${projectsBaseDir}/${projectDir}`;
  const missionControlUrl = getMissionControlUrl();

  const workDirBlock = codebaseDir
    ? `**CODEBASE_DIR:** ${codebaseDir}
Work directly inside this directory. Do NOT create a new subfolder for this task.`
    : `**OUTPUT DIRECTORY:** ${taskWorkingDir}
Create this directory and save all deliverables there.`;

  const deliverableExamplePath = codebaseDir
    ? `${codebaseDir}/path/inside/repo.ext`
    : `${taskWorkingDir}/filename.html`;

  const taskMessage = `${priorityEmoji} **NEW TASK ASSIGNED**

**Title:** ${task.title}
${task.description ? `**Description:** ${task.description}\n` : ''}
**Priority:** ${task.priority.toUpperCase()}
${task.due_date ? `**Due:** ${task.due_date}\n` : ''}
**Task ID:** ${task.id}

${workDirBlock}

**IMPORTANT:** After completing work, you MUST call these APIs:
1. Log activity: POST ${missionControlUrl}/api/tasks/${task.id}/activities
   Body: {"activity_type": "completed", "message": "Description of what was done"}
2. Register deliverable: POST ${missionControlUrl}/api/tasks/${task.id}/deliverables
   Body: {"deliverable_type": "file", "title": "File name", "path": "${deliverableExamplePath}"}
3. Update status: PATCH ${missionControlUrl}/api/tasks/${task.id}
   Body: {"status": "review"}

When complete, reply with:
\`TASK_COMPLETE: [brief summary of what you did]\`

If you need help or clarification, ask the orchestrator.`;

  try {
    const sessionKey = `agent:main:${session.openclaw_session_id}`;
    await client.call('chat.send', {
      sessionKey,
      message: taskMessage,
      idempotencyKey: `dispatch-${task.id}-${Date.now()}`
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
      'UPDATE agents SET status = ?, updated_at = ? WHERE id = ?',
      ['working', now, agent.id]
    );

    const recentDispatch = queryOne<{ id: string }>(
      `SELECT id FROM task_activities 
       WHERE task_id = ? 
         AND activity_type = 'status_changed'
         AND message LIKE 'Task dispatched%'
         AND created_at > datetime('now', '-5 minutes')`,
      [task.id]
    );

    if (!recentDispatch) {
      const activityId = crypto.randomUUID();
      run(
        `INSERT INTO task_activities (id, task_id, agent_id, activity_type, message, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [activityId, task.id, agent.id, 'status_changed', `Task dispatched to ${agent.name} - Agent is now working on this task`, now]
      );
    }

    return { task_id: task.id, success: true, message: 'Task dispatched', session_id: session.openclaw_session_id };
  } catch (err) {
    console.error('Failed to dispatch task:', err);
    return { task_id: task.id, success: false, message: 'Failed to send message', error: String(err) };
  }
}

/**
 * POST /api/tasks/dispatch
 * 
 * Bulk dispatch tasks to their assigned agents.
 * Accepts either a list of task_ids or a group_id to dispatch all tasks in a group.
 */
export async function POST(request: NextRequest) {
  try {
    const body: BulkDispatchRequest = await request.json();
    const { task_ids, group_id } = body;

    let tasksToDispatch: Array<Task & { assigned_agent_name?: string; workspace_id: string; workspace_folder_path?: string }> = [];

    if (task_ids && task_ids.length > 0) {
      const placeholders = task_ids.map(() => '?').join(',');
      tasksToDispatch = queryAll<Task & { assigned_agent_name?: string; workspace_id: string; workspace_folder_path?: string }>(
        `SELECT t.*, a.name as assigned_agent_name, a.is_master, w.folder_path as workspace_folder_path
         FROM tasks t
         LEFT JOIN agents a ON t.assigned_agent_id = a.id
         LEFT JOIN workspaces w ON t.workspace_id = w.id
         WHERE t.id IN (${placeholders})
           AND t.status NOT IN ('done', 'in_progress', 'planning')
           AND t.assigned_agent_id IS NOT NULL`,
        task_ids
      );
    } else if (group_id) {
      tasksToDispatch = queryAll<Task & { assigned_agent_name?: string; workspace_id: string; workspace_folder_path?: string }>(
        `SELECT t.*, a.name as assigned_agent_name, a.is_master, w.folder_path as workspace_folder_path
         FROM tasks t
         LEFT JOIN agents a ON t.assigned_agent_id = a.id
         LEFT JOIN workspaces w ON t.workspace_id = w.id
         WHERE t.group_id = ?
           AND t.status NOT IN ('done', 'in_progress', 'planning')
           AND t.assigned_agent_id IS NOT NULL`,
        [group_id]
      );
    } else {
      return NextResponse.json({ error: 'Either task_ids or group_id must be provided' }, { status: 400 });
    }

    if (tasksToDispatch.length === 0) {
      return NextResponse.json({ 
        success: true, 
        message: 'No tasks to dispatch',
        results: [] 
      });
    }

    const results: DispatchResult[] = [];

    for (const task of tasksToDispatch) {
      const agent = queryOne<Agent>('SELECT * FROM agents WHERE id = ?', [task.assigned_agent_id]);
      
      if (!agent) {
        results.push({ task_id: task.id, success: false, message: 'Assigned agent not found', error: 'Agent not found' });
        continue;
      }

      // Check for other orchestrators (same logic as single dispatch)
      if (agent.is_master) {
        const otherOrchestrators = queryAll<{ id: string; name: string; role: string }>(
          `SELECT a.id, a.name, a.role
           FROM agents a
           JOIN workspace_agents wa ON wa.agent_id = a.id
           WHERE a.is_master = 1
           AND a.id != ?
           AND wa.workspace_id = ?
           AND a.status != 'offline'`,
          [agent.id, task.workspace_id]
        );

        if (otherOrchestrators.length > 0) {
          results.push({ 
            task_id: task.id, 
            success: false, 
            message: `Other orchestrators available: ${otherOrchestrators.map(o => o.name).join(', ')}`,
            error: 'Other orchestrators available'
          });
          continue;
        }
      }

      const result = await dispatchSingleTask(task, agent);
      results.push(result);
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    return NextResponse.json({
      success: failCount === 0,
      message: `Dispatched ${successCount} task(s), ${failCount} failed`,
      total: tasksToDispatch.length,
      success_count: successCount,
      fail_count: failCount,
      results
    });
  } catch (error) {
    console.error('Bulk dispatch failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
