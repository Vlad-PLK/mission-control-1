import { NextRequest, NextResponse } from 'next/server';
import { getBlockingDependencies, canMoveTask } from '@/lib/dependency-automation';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/tasks/[id]/dependencies/blockers - Get blocking dependencies for a task
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id: taskId } = await params;

    const { isBlocked, blockers } = getBlockingDependencies(taskId);

    return NextResponse.json({
      task_id: taskId,
      is_blocked: isBlocked,
      blockers
    });
  } catch (error) {
    console.error('Failed to get blocking dependencies:', error);
    return NextResponse.json({ error: 'Failed to get blocking dependencies' }, { status: 500 });
  }
}

// POST /api/tasks/[id]/dependencies/can-move - Check if task can move to target status
export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id: taskId } = await params;
    const body = await request.json();
    const { target_status } = body;

    if (!target_status) {
      return NextResponse.json(
        { error: 'target_status is required' },
        { status: 400 }
      );
    }

    const { canMove, reason } = canMoveTask(taskId, target_status);

    return NextResponse.json({
      task_id: taskId,
      target_status,
      can_move: canMove,
      reason: reason || null
    });
  } catch (error) {
    console.error('Failed to check can-move:', error);
    return NextResponse.json({ error: 'Failed to check can-move' }, { status: 500 });
  }
}
