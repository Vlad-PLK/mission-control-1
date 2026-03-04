import { NextRequest, NextResponse } from 'next/server';
import { queryOne, run } from '@/lib/db';

// DELETE /api/workspaces/:id/agents/:agentId
// Unlink an agent from a workspace (does not delete the canonical agent)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; agentId: string }> }
) {
  const { id: workspaceId, agentId } = await params;

  try {
    // Ensure workspace exists (id or slug)
    const ws = queryOne<{ id: string }>('SELECT id FROM workspaces WHERE id = ? OR slug = ?', [workspaceId, workspaceId]);
    if (!ws) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    // Delete link
    const res = run(
      `DELETE FROM workspace_agents WHERE workspace_id = ? AND agent_id = ?`,
      [ws.id, agentId]
    );

    return NextResponse.json({
      success: true,
      workspace_id: ws.id,
      agent_id: agentId,
      unlinked: res.changes > 0,
    });
  } catch (error) {
    console.error('Failed to unlink agent from workspace:', error);
    return NextResponse.json(
      { error: 'Failed to unlink agent from workspace' },
      { status: 500 }
    );
  }
}
