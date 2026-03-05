/**
 * Dependency Automation Utilities
 * Handles automatic unblocking of dependent tasks when a task completes
 */

import { queryOne, queryAll, run } from '@/lib/db';
import { broadcast } from '@/lib/events';
import type { Task, TaskDependency } from '@/lib/types';
import { v4 as uuidv4 } from 'uuid';

interface UnblockResult {
  unblockedTasks: string[];
  errors: string[];
}

/**
 * Auto-unblock dependent tasks when a task is completed
 * When Task A completes, all tasks that depend on it (dependency_type = 'blocks')
 * will be automatically moved to 'assigned' status if they have an assigned agent.
 * 
 * @param completedTaskId - The ID of the task that was completed
 * @returns Result with list of unblocked task IDs and any errors
 */
export function autoUnblockDependentTasks(completedTaskId: string): UnblockResult {
  const result: UnblockResult = {
    unblockedTasks: [],
    errors: []
  };

  const now = new Date().toISOString();

  // Find all tasks that depend on the completed task (where completedTask "blocks" them)
  const dependentTasks = queryAll<Task & { agent_name?: string }>(`
    SELECT t.*, a.name as agent_name
    FROM tasks t
    JOIN task_dependencies td ON td.task_id = t.id
    LEFT JOIN agents a ON t.assigned_agent_id = a.id
    WHERE td.depends_on_task_id = ?
      AND td.dependency_type = 'blocks'
      AND t.status NOT IN ('done', 'planning')
  `, [completedTaskId]);

  if (dependentTasks.length === 0) {
    return result;
  }

  console.log(`[Dependency Auto-Unblock] Task ${completedTaskId} completed, found ${dependentTasks.length} dependent task(s)`);

  for (const task of dependentTasks) {
    try {
      // Determine target status based on whether task has an assigned agent
      const targetStatus = task.assigned_agent_id ? 'assigned' : 'inbox';
      
      const previousStatus = task.status;
      
      // Update the task status
      run(
        'UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?',
        [targetStatus, now, task.id]
      );

      result.unblockedTasks.push(task.id);

      // Log the unblock event
      run(
        `INSERT INTO events (id, type, task_id, message, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [uuidv4(), 'task_status_changed', task.id, `Task "${task.title}" unblocked by completed dependency → moved to ${targetStatus}`, now]
      );

      // Log activity
      run(
        `INSERT INTO task_activities (id, task_id, activity_type, message, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [uuidv4(), task.id, 'status_changed', `Unblocked - moved from ${previousStatus} to ${targetStatus}`, now]
      );

      // Broadcast update
      const updatedTask = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [task.id]);
      if (updatedTask) {
        broadcast({
          type: 'task_updated',
          payload: updatedTask,
        });
      }

      console.log(`[Dependency Auto-Unblock] Task "${task.title}" (${task.id}) moved from ${previousStatus} to ${targetStatus}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      result.errors.push(`Failed to unblock task ${task.id}: ${errorMsg}`);
      console.error(`[Dependency Auto-Unblock] Error for task ${task.id}:`, error);
    }
  }

  return result;
}

/**
 * Check if a task is blocked by any incomplete dependencies
 * 
 * @param taskId - The ID of the task to check
 * @returns Object with isBlocked status and list of blocking tasks
 */
export function getBlockingDependencies(taskId: string): { 
  isBlocked: boolean; 
  blockers: Array<{ taskId: string; taskTitle: string; status: string }>;
} {
  // Find tasks that this task depends on (where this task is blocked by them)
  const blockingTasks = queryAll<{ id: string; title: string; status: string }>(`
    SELECT t.id, t.title, t.status
    FROM tasks t
    JOIN task_dependencies td ON td.depends_on_task_id = t.id
    WHERE td.task_id = ?
      AND td.dependency_type = 'blocks'
      AND t.status NOT IN ('done', 'testing', 'review')
  `, [taskId]);

  return {
    isBlocked: blockingTasks.length > 0,
    blockers: blockingTasks.map(t => ({
      taskId: t.id,
      taskTitle: t.title,
      status: t.status
    }))
  };
}

/**
 * Check if a task can be moved to a specific status based on dependencies
 * 
 * @param taskId - The ID of the task to check
 * @param targetStatus - The status to move to
 * @returns Object with canMove status and reason if blocked
 */
export function canMoveTask(taskId: string, targetStatus: string): { 
  canMove: boolean; 
  reason?: string;
} {
  // Allow moving to certain statuses regardless of dependencies
  const allowedStatuses = ['planning', 'inbox', 'done'];
  if (allowedStatuses.includes(targetStatus)) {
    return { canMove: true };
  }

  // Check blocking dependencies for in_progress, assigned, testing, review
  const { isBlocked, blockers } = getBlockingDependencies(taskId);
  
  if (isBlocked && (targetStatus === 'in_progress' || targetStatus === 'assigned' || targetStatus === 'testing' || targetStatus === 'review')) {
    const blockerList = blockers.map(b => `"${b.taskTitle}" (${b.status})`).join(', ');
    return { 
      canMove: false, 
      reason: `Blocked by incomplete task(s): ${blockerList}` 
    };
  }

  return { canMove: true };
}
