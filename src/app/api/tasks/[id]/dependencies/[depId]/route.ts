import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// DELETE /api/tasks/[id]/dependencies/[depId] - Remove a dependency
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; depId: string }> }
) {
  try {
    const { id: taskId, depId } = await params;
    const db = getDb();

    // Check if dependency exists
    const existing = db.prepare(`
      SELECT * FROM task_dependencies 
      WHERE id = ? AND task_id = ?
    `).get(depId, taskId);

    if (!existing) {
      return NextResponse.json({ error: 'Dependency not found' }, { status: 404 });
    }

    // Delete the dependency
    db.prepare('DELETE FROM task_dependencies WHERE id = ?').run(depId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete task dependency:', error);
    return NextResponse.json({ error: 'Failed to delete task dependency' }, { status: 500 });
  }
}
