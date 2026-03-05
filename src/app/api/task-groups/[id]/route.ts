import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { TaskGroup } from '@/lib/types';

// GET /api/task-groups/[id] - Get a single task group
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();

    const group = db.prepare('SELECT * FROM task_groups WHERE id = ?').get(id) as TaskGroup | undefined;

    if (!group) {
      return NextResponse.json({ error: 'Task group not found' }, { status: 404 });
    }

    return NextResponse.json(group);
  } catch (error) {
    console.error('Failed to get task group:', error);
    return NextResponse.json({ error: 'Failed to get task group' }, { status: 500 });
  }
}

// PATCH /api/task-groups/[id] - Update a task group
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const body = await request.json();

    // Check if group exists
    const existing = db.prepare('SELECT * FROM task_groups WHERE id = ?').get(id) as TaskGroup | undefined;
    if (!existing) {
      return NextResponse.json({ error: 'Task group not found' }, { status: 404 });
    }

    const {
      name,
      description,
      shared_context,
      shared_requirements,
      shared_instructions,
      assigned_agent_id,
      color,
      order_index
    } = body;

    const now = new Date().toISOString();

    db.prepare(`
      UPDATE task_groups SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        shared_context = COALESCE(?, shared_context),
        shared_requirements = COALESCE(?, shared_requirements),
        shared_instructions = COALESCE(?, shared_instructions),
        assigned_agent_id = COALESCE(?, assigned_agent_id),
        color = COALESCE(?, color),
        order_index = COALESCE(?, order_index),
        updated_at = ?
      WHERE id = ?
    `).run(
      name, description, shared_context, shared_requirements, shared_instructions,
      assigned_agent_id, color, order_index, now, id
    );

    const group = db.prepare('SELECT * FROM task_groups WHERE id = ?').get(id) as TaskGroup;

    return NextResponse.json(group);
  } catch (error) {
    console.error('Failed to update task group:', error);
    return NextResponse.json({ error: 'Failed to update task group' }, { status: 500 });
  }
}

// DELETE /api/task-groups/[id] - Delete a task group
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();

    // Check if group exists
    const existing = db.prepare('SELECT * FROM task_groups WHERE id = ?').get(id);
    if (!existing) {
      return NextResponse.json({ error: 'Task group not found' }, { status: 404 });
    }

    // Remove group_id from tasks in this group
    db.prepare('UPDATE tasks SET group_id = NULL WHERE group_id = ?').run(id);

    // Delete the group
    db.prepare('DELETE FROM task_groups WHERE id = ?').run(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete task group:', error);
    return NextResponse.json({ error: 'Failed to delete task group' }, { status: 500 });
  }
}
