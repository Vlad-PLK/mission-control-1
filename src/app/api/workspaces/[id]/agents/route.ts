import { NextRequest, NextResponse } from 'next/server';
import { queryOne, run } from '@/lib/db';
import type { Agent } from '@/lib/types';

// POST /api/workspaces/:id/agents
// Link an existing canonical agent into a workspace (many-to-many)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: workspaceId } = await params;

  try {
    const body = await request.json();
    const { agent_id, gateway_agent_id } = body as { agent_id?: string; gateway_agent_id?: string };

    if (!agent_id && !gateway_agent_id) {
      return NextResponse.json(
        { error: 'agent_id or gateway_agent_id is required' },
        { status: 400 }
      );
    }

    // Ensure workspace exists
    const ws = queryOne<{ id: string }>('SELECT id FROM workspaces WHERE id = ? OR slug = ?', [workspaceId, workspaceId]);
    if (!ws) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    let agent: Agent | undefined;
    if (agent_id) {
      agent = queryOne<Agent>('SELECT * FROM agents WHERE id = ?', [agent_id]);
    } else if (gateway_agent_id) {
      agent = queryOne<Agent>('SELECT * FROM agents WHERE gateway_agent_id = ?', [gateway_agent_id]);
    }

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const res = run(
      `INSERT OR IGNORE INTO workspace_agents (workspace_id, agent_id) VALUES (?, ?)`,
      [ws.id, agent.id]
    );

    return NextResponse.json({
      success: true,
      workspace_id: ws.id,
      agent_id: agent.id,
      linked: res.changes > 0,
    });
  } catch (error) {
    console.error('Failed to link agent to workspace:', error);
    return NextResponse.json(
      { error: 'Failed to link agent to workspace' },
      { status: 500 }
    );
  }
}
