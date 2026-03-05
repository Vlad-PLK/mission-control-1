import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { TaskDependency } from '@/lib/types';
import { v4 as uuidv4 } from 'uuid';

// GET /api/tasks/[id]/dependencies - Get dependencies for a task
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;
    const db = getDb();

    // Get dependencies where this task is the dependent (tasks it depends on)
    const dependencies = db.prepare(`
      SELECT * FROM task_dependencies 
      WHERE task_id = ? 
      ORDER BY created_at
    `).all(taskId) as TaskDependency[];

    // Get dependents (tasks that depend on this task)
    const dependents = db.prepare(`
      SELECT * FROM task_dependencies 
      WHERE depends_on_task_id = ? 
      ORDER BY created_at
    `).all(taskId) as TaskDependency[];

    return NextResponse.json({
      dependencies,
      dependents
    });
  } catch (error) {
    console.error('Failed to get task dependencies:', error);
    return NextResponse.json({ error: 'Failed to get task dependencies' }, { status: 500 });
  }
}

// POST /api/tasks/[id]/dependencies - Add a dependency
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;
    const db = getDb();
    const body = await request.json();

    const { depends_on_task_id, dependency_type = 'blocks' } = body;

    // Validation
    if (!depends_on_task_id) {
      return NextResponse.json(
        { error: 'depends_on_task_id is required' },
        { status: 400 }
      );
    }

    // Check if both tasks exist
    const task1 = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
    const task2 = db.prepare('SELECT id FROM tasks WHERE id = ?').get(depends_on_task_id);

    if (!task1 || !task2) {
      return NextResponse.json(
        { error: 'One or both tasks not found' },
        { status: 404 }
      );
    }

    // Check for circular dependency
    const existingReverse = db.prepare(`
      SELECT id FROM task_dependencies 
      WHERE task_id = ? AND depends_on_task_id = ?
    `).get(depends_on_task_id, taskId);

    if (existingReverse) {
      return NextResponse.json(
        { error: 'Circular dependency detected' },
        { status: 400 }
      );
    }

    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO task_dependencies (id, task_id, depends_on_task_id, dependency_type, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, taskId, depends_on_task_id, dependency_type, now);

    const dependency = db.prepare('SELECT * FROM task_dependencies WHERE id = ?').get(id) as TaskDependency;

    return NextResponse.json(dependency, { status: 201 });
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return NextResponse.json(
        { error: 'Dependency already exists' },
        { status: 400 }
      );
    }
    console.error('Failed to create task dependency:', error);
    return NextResponse.json({ error: 'Failed to create task dependency' }, { status: 500 });
  }
}
