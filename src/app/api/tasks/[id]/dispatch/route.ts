import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { queryOne, queryAll, run } from '@/lib/db';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { broadcast } from '@/lib/events';
import { getProjectsPath, getMissionControlUrl } from '@/lib/config';
import { buildDispatchPrompt, fetchDispatchContext } from '@/lib/prompt-templates';
import type { Task, Agent, OpenClawSession } from '@/lib/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/tasks/[id]/dispatch
 * 
 * Dispatches a task to its assigned agent's OpenClaw session.
 * Creates session if needed, sends task details to agent.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    // Get task with agent info and workspace folder_path
    const task = queryOne<Task & { assigned_agent_name?: string; workspace_id: string; workspace_folder_path?: string }>(
      `SELECT t.*, a.name as assigned_agent_name, a.is_master, w.folder_path as workspace_folder_path
       FROM tasks t
       LEFT JOIN agents a ON t.assigned_agent_id = a.id
       LEFT JOIN workspaces w ON t.workspace_id = w.id
       WHERE t.id = ?`,
      [id]
    );

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (!task.assigned_agent_id) {
      return NextResponse.json(
        { error: 'Task has no assigned agent' },
        { status: 400 }
      );
    }

    // Get agent details
    const agent = queryOne<Agent>(
      'SELECT * FROM agents WHERE id = ?',
      [task.assigned_agent_id]
    );

    if (!agent) {
      return NextResponse.json({ error: 'Assigned agent not found' }, { status: 404 });
    }

    // Check if dispatching to the master agent while there are other orchestrators available
    if (agent.is_master) {
      // Check for other master agents in the same workspace (excluding this one)
      const otherOrchestrators = queryAll<{
        id: string;
        name: string;
        role: string;
      }>(
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
        return NextResponse.json({
          success: false,
          warning: 'Other orchestrators available',
          message: `There ${otherOrchestrators.length === 1 ? 'is' : 'are'} ${otherOrchestrators.length} other orchestrator${otherOrchestrators.length === 1 ? '' : 's'} available in this workspace: ${otherOrchestrators.map(o => o.name).join(', ')}. Consider assigning this task to them instead.`,
          otherOrchestrators,
        }, { status: 409 }); // 409 Conflict - indicating there's an alternative
      }
    }

    // Connect to OpenClaw Gateway
    const client = getOpenClawClient();
    if (!client.isConnected()) {
      try {
        await client.connect();
      } catch (err) {
        console.error('Failed to connect to OpenClaw Gateway:', err);
        return NextResponse.json(
          { error: 'Failed to connect to OpenClaw Gateway' },
          { status: 503 }
        );
      }
    }

    // Get or create OpenClaw session for this agent
    // Per-task session isolation: one OpenClaw session per (task, agent)
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

    const now = new Date().toISOString();

    if (!session) {
      // Create session record
      const sessionId = uuidv4();
      const agentSlug = agent.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      // Keep the existing Mission Control naming pattern, but make it per-task:
      // mission-control-<taskId>-<agentSlug>
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

      // Log session creation
      run(
        `INSERT INTO events (id, type, agent_id, message, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [uuidv4(), 'agent_status_changed', agent.id, `${agent.name} session created`, now]
      );
    }

    if (!session) {
      return NextResponse.json(
        { error: 'Failed to create agent session' },
        { status: 500 }
      );
    }

    // Build enhanced task message using prompt template builder
    const dispatchContext = fetchDispatchContext(id);
    
    if (!dispatchContext) {
      return NextResponse.json({ error: 'Failed to build task context' }, { status: 500 });
    }

    const taskMessage = buildDispatchPrompt(dispatchContext);

    // Send message to agent's session using chat.send
    try {
      // Use sessionKey for routing to the agent's session
      // Format: agent:main:{openclaw_session_id}
      const sessionKey = `agent:main:${session.openclaw_session_id}`;
      await client.call('chat.send', {
        sessionKey,
        message: taskMessage,
        idempotencyKey: `dispatch-${task.id}-${Date.now()}`
      });

      // Update task status to in_progress
      run(
        'UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?',
        ['in_progress', now, id]
      );

      // Broadcast task update
      const updatedTask = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [id]);
      if (updatedTask) {
        broadcast({
          type: 'task_updated',
          payload: updatedTask,
        });
      }

      // Update agent status to working
      run(
        'UPDATE agents SET status = ?, updated_at = ? WHERE id = ?',
        ['working', now, agent.id]
      );

      // Log dispatch event to events table
      const eventId = uuidv4();
      run(
        `INSERT INTO events (id, type, agent_id, task_id, message, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [eventId, 'task_dispatched', agent.id, task.id, `Task "${task.title}" dispatched to ${agent.name}`, now]
      );

      // Log dispatch activity to task_activities table (for Activity tab)
      // Check for recent duplicate dispatch activity (idempotency)
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

      return NextResponse.json({
        success: true,
        task_id: task.id,
        agent_id: agent.id,
        session_id: session.openclaw_session_id,
        message: 'Task dispatched to agent'
      });
    } catch (err) {
      console.error('Failed to send message to agent:', err);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Failed to dispatch task:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
