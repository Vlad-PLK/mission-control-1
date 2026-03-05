import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { TaskGroup } from '@/lib/types';
import { v4 as uuidv4 } from 'uuid';

// GET /api/task-groups - List all task groups
export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get('workspace_id');

  try {
    const db = getDb();
    
    let groups: TaskGroup[];
    if (workspaceId) {
      groups = db.prepare(`
        SELECT * FROM task_groups 
        WHERE workspace_id = ? 
        ORDER BY order_index, name
      `).all(workspaceId) as TaskGroup[];
    } else {
      groups = db.prepare(`
        SELECT * FROM task_groups 
        ORDER BY order_index, name
      `).all() as TaskGroup[];
    }

    return NextResponse.json(groups);
  } catch (error) {
    console.error('Failed to list task groups:', error);
    return NextResponse.json({ error: 'Failed to list task groups' }, { status: 500 });
  }
}

// POST /api/task-groups - Create a new task group
export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    const { 
      workspace_id, 
      name, 
      description, 
      shared_context, 
      shared_requirements, 
      shared_instructions,
      assigned_agent_id,
      color = '#6366f1',
      order_index = 0
    } = body;

    // Validation
    if (!workspace_id || !name) {
      return NextResponse.json(
        { error: 'workspace_id and name are required' },
        { status: 400 }
      );
    }

    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO task_groups (
        id, workspace_id, name, description, shared_context, shared_requirements,
        shared_instructions, assigned_agent_id, color, order_index, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, workspace_id, name, description || null, shared_context || null,
      shared_requirements || null, shared_instructions || null, assigned_agent_id || null,
      color, order_index, now, now
    );

    const group = db.prepare('SELECT * FROM task_groups WHERE id = ?').get(id) as TaskGroup;

    return NextResponse.json(group, { status: 201 });
  } catch (error) {
    console.error('Failed to create task group:', error);
    return NextResponse.json({ error: 'Failed to create task group' }, { status: 500 });
  }
}
