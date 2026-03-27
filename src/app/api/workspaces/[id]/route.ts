import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
// GET /api/workspaces/[id] - Get a single workspace
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  try {
    const db = getDb();
    
    // Try to find by ID or slug
    const workspace = db.prepare(
      'SELECT * FROM workspaces WHERE id = ? OR slug = ?'
    ).get(id, id);
    
    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }
    
    return NextResponse.json(workspace);
  } catch (error) {
    console.error('Failed to fetch workspace:', error);
    return NextResponse.json({ error: 'Failed to fetch workspace' }, { status: 500 });
  }
}

// PATCH /api/workspaces/[id] - Update a workspace
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  try {
    const body = await request.json();
    const { name, description, icon } = body;
    
    const db = getDb();
    
    // Check workspace exists
    const existing = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
    if (!existing) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }
    
    // Build update query dynamically
    const updates: string[] = [];
    const values: unknown[] = [];
    
    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description);
    }
    if (icon !== undefined) {
      updates.push('icon = ?');
      values.push(icon);
    }
    
    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }
    
    updates.push("updated_at = datetime('now')");
    values.push(id);
    
    db.prepare(`
      UPDATE workspaces SET ${updates.join(', ')} WHERE id = ?
    `).run(...values);
    
    const workspace = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
    return NextResponse.json(workspace);
  } catch (error) {
    console.error('Failed to update workspace:', error);
    return NextResponse.json({ error: 'Failed to update workspace' }, { status: 500 });
  }
}

// DELETE /api/workspaces/[id] - Delete a workspace
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  try {
    const db = getDb();
    
    // Don't allow deleting the default workspace
    if (id === 'default') {
      return NextResponse.json({ error: 'Cannot delete the default workspace' }, { status: 400 });
    }
    
    // Check workspace exists
    const existing = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
    if (!existing) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }
    
    // Get counts for response
    const taskCount = db.prepare(
      'SELECT COUNT(*) as count FROM tasks WHERE workspace_id = ?'
    ).get(id) as { count: number };
    
    const agentCount = db.prepare(
      'SELECT COUNT(*) as count FROM agents WHERE workspace_id = ?'
    ).get(id) as { count: number };
    
    // Cascade delete in proper order (handles all related data)
    
    // Use transaction for atomicity
    const deleteWorkspace = db.transaction(() => {
      // 1. End/cancel OpenClaw sessions for agents in this workspace
      db.prepare(`
        UPDATE openclaw_sessions 
        SET status = 'ended', ended_at = datetime('now') 
        WHERE agent_id IN (SELECT id FROM agents WHERE workspace_id = ?)
      `).run(id);
      
      // 2. Delete events related to tasks and agents in this workspace
      db.prepare('DELETE FROM events WHERE task_id IN (SELECT id FROM tasks WHERE workspace_id = ?)').run(id);
      db.prepare('DELETE FROM events WHERE agent_id IN (SELECT id FROM agents WHERE workspace_id = ?)').run(id);
      
      // 3. Delete task activities
      db.prepare('DELETE FROM task_activities WHERE task_id IN (SELECT id FROM tasks WHERE workspace_id = ?)').run(id);
      
      // 4. Delete task deliverables
      db.prepare('DELETE FROM task_deliverables WHERE task_id IN (SELECT id FROM tasks WHERE workspace_id = ?)').run(id);
      
      // 5. Delete planning questions
      db.prepare('DELETE FROM planning_questions WHERE task_id IN (SELECT id FROM tasks WHERE workspace_id = ?)').run(id);
      
      // 6. Delete planning specs
      db.prepare('DELETE FROM planning_specs WHERE task_id IN (SELECT id FROM tasks WHERE workspace_id = ?)').run(id);
      
      // 7. Delete conversations and their participants
      db.prepare(`
        DELETE FROM conversation_participants 
        WHERE conversation_id IN (SELECT id FROM conversations WHERE task_id IN (SELECT id FROM tasks WHERE workspace_id = ?))
      `).run(id);
      db.prepare('DELETE FROM conversations WHERE task_id IN (SELECT id FROM tasks WHERE workspace_id = ?)').run(id);
      
      // 8. Delete tasks
      db.prepare('DELETE FROM tasks WHERE workspace_id = ?').run(id);
      
      // 9. Delete agents
      db.prepare('DELETE FROM agents WHERE workspace_id = ?').run(id);
      
      // 10. Delete the workspace
      db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
    });
    
    deleteWorkspace();
    
    return NextResponse.json({ 
      success: true,
      deleted: {
        tasks: taskCount.count,
        agents: agentCount.count
      }
    });
  } catch (error) {
    console.error('Failed to delete workspace:', error);
    return NextResponse.json({ error: 'Failed to delete workspace' }, { status: 500 });
  }
}
