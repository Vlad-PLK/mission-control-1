'use client';

import { useMemo, useState } from 'react';
import { ChevronRight, GripVertical, MoreVertical, Plus } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { useMissionControl } from '@/lib/store';
import { triggerAutoDispatch, shouldTriggerAutoDispatch } from '@/lib/auto-dispatch';
import type { Task, TaskPriority, TaskStatus } from '@/lib/types';
import { TaskModal } from './TaskModal';

interface MissionQueueProps {
  workspaceId?: string;
}

type MobileStatusFilter = 'all' | TaskStatus;
type MobileTaskFilter = 'all' | 'unassigned' | 'high_priority' | 'my_tasks';
type MobileSort = 'newest' | 'oldest' | 'priority';

const COLUMNS: { id: TaskStatus; label: string; color: string }[] = [
  { id: 'planning', label: 'PLANNING', color: 'border-t-mc-accent-purple' },
  { id: 'inbox', label: 'INBOX', color: 'border-t-mc-accent-pink' },
  { id: 'assigned', label: 'ASSIGNED', color: 'border-t-mc-accent-yellow' },
  { id: 'in_progress', label: 'IN PROGRESS', color: 'border-t-mc-accent' },
  { id: 'testing', label: 'TESTING', color: 'border-t-mc-accent-cyan' },
  { id: 'review', label: 'REVIEW', color: 'border-t-mc-accent-purple' },
  { id: 'done', label: 'DONE', color: 'border-t-mc-accent-green' },
];

const STATUS_FILTER_OPTIONS: Array<{ id: MobileStatusFilter; label: string }> = [
  { id: 'all', label: 'All Statuses' },
  { id: 'planning', label: 'Planning' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'assigned', label: 'Assigned' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'testing', label: 'Testing' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
];

const TASK_FILTER_OPTIONS: Array<{ id: MobileTaskFilter; label: string }> = [
  { id: 'all', label: 'All Tasks' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'high_priority', label: 'High Priority' },
  { id: 'my_tasks', label: 'Assigned' },
];

const SORT_OPTIONS: Array<{ id: MobileSort; label: string }> = [
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'priority', label: 'Priority' },
];

function applyTaskFilter(list: Task[], filter: MobileTaskFilter): Task[] {
  if (filter === 'unassigned') {
    return list.filter((task) => !task.assigned_agent_id);
  }
  if (filter === 'high_priority') {
    return list.filter((task) => task.priority === 'high' || task.priority === 'urgent');
  }
  if (filter === 'my_tasks') {
    return list.filter((task) => !!task.assigned_agent_id);
  }
  return list;
}

function priorityRank(priority: TaskPriority): number {
  if (priority === 'urgent') return 4;
  if (priority === 'high') return 3;
  if (priority === 'normal') return 2;
  return 1;
}

export function MissionQueue({ workspaceId }: MissionQueueProps) {
  const { tasks, updateTaskStatus, addEvent } = useMissionControl();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [mobileStatusFilter, setMobileStatusFilter] = useState<MobileStatusFilter>('all');
  const [mobileTaskFilter, setMobileTaskFilter] = useState<MobileTaskFilter>('all');
  const [mobileSort, setMobileSort] = useState<MobileSort>('newest');
  const [statusSheetTask, setStatusSheetTask] = useState<Task | null>(null);

  const handleMoveTask = async (taskId: string, newStatus: TaskStatus) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === newStatus) return;

    const oldStatus = task.status;
    updateTaskStatus(taskId, newStatus);

    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.error || `Failed to move task to ${newStatus}`);
      }

      addEvent({
        id: crypto.randomUUID(),
        type: newStatus === 'done' ? 'task_completed' : 'task_status_changed',
        task_id: taskId,
        message: `Task "${task.title}" moved to ${newStatus}`,
        created_at: new Date().toISOString(),
      });

      if (shouldTriggerAutoDispatch(oldStatus, newStatus, task.assigned_agent_id)) {
        const dispatchResult = await triggerAutoDispatch({
          taskId: task.id,
          taskTitle: task.title,
          agentId: task.assigned_agent_id,
          agentName: task.assigned_agent?.name || 'Unknown Agent',
          workspaceId: task.workspace_id,
        });

        if (!dispatchResult.success && dispatchResult.error) {
          toast.error(dispatchResult.error);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to move task';
      updateTaskStatus(taskId, oldStatus);
      toast.error(message);
    }
  };

  const desktopTasksByStatus = (status: TaskStatus) => {
    const byStatus = tasks.filter((task) => task.status === status);
    return applyTaskFilter(byStatus, mobileTaskFilter);
  };

  const mobileTasks = useMemo(() => {
    let filtered = tasks;

    if (mobileStatusFilter !== 'all') {
      filtered = filtered.filter((task) => task.status === mobileStatusFilter);
    }

    filtered = applyTaskFilter(filtered, mobileTaskFilter);

    const sorted = [...filtered];
    if (mobileSort === 'priority') {
      sorted.sort((a, b) => {
        const priorityDiff = priorityRank(b.priority) - priorityRank(a.priority);
        if (priorityDiff !== 0) return priorityDiff;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
    } else if (mobileSort === 'oldest') {
      sorted.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    } else {
      sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }

    return sorted;
  }, [tasks, mobileStatusFilter, mobileTaskFilter, mobileSort]);

  const handleDragStart = (e: React.DragEvent, task: Task) => {
    setDraggedTask(task);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, targetStatus: TaskStatus) => {
    e.preventDefault();
    if (!draggedTask || draggedTask.status === targetStatus) {
      setDraggedTask(null);
      return;
    }
    await handleMoveTask(draggedTask.id, targetStatus);
    setDraggedTask(null);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-3 border-b border-mc-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ChevronRight className="w-4 h-4 text-mc-text-secondary" />
          <span className="text-sm font-medium uppercase tracking-wider">Mission Queue</span>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-3 py-1.5 bg-mc-accent-pink text-mc-bg rounded text-sm font-medium hover:bg-mc-accent-pink/90 min-h-[44px] active:scale-95 transition-transform"
        >
          <Plus className="w-4 h-4" />
          <span>New Task</span>
        </button>
      </div>

      <div className="lg:hidden border-b border-mc-border bg-mc-bg-secondary/80 backdrop-blur supports-[backdrop-filter]:bg-mc-bg-secondary/70">
        <div className="p-3 space-y-2">
          <div className="grid grid-cols-1 gap-2">
            <label className="text-[11px] uppercase tracking-wider text-mc-text-secondary">Status</label>
            <select
              value={mobileStatusFilter}
              onChange={(e) => setMobileStatusFilter(e.target.value as MobileStatusFilter)}
              className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
            >
              {STATUS_FILTER_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wider text-mc-text-secondary">Filter</label>
              <select
                value={mobileTaskFilter}
                onChange={(e) => setMobileTaskFilter(e.target.value as MobileTaskFilter)}
                className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
              >
                {TASK_FILTER_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wider text-mc-text-secondary">Sort</label>
              <select
                value={mobileSort}
                onChange={(e) => setMobileSort(e.target.value as MobileSort)}
                className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:outline-none focus:border-mc-accent"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="text-xs text-mc-text-secondary">
            Showing <span className="text-mc-text font-medium">{mobileTasks.length}</span> tasks
          </div>
        </div>
      </div>

      <div className="lg:hidden flex-1 overflow-y-auto p-3 space-y-2 pb-24">
        {mobileTasks.length === 0 ? (
          <div className="text-center py-10 text-mc-text-secondary text-sm">No tasks match your filters.</div>
        ) : (
          mobileTasks.map((task) => (
            <MobileTaskCard
              key={task.id}
              task={task}
              onOpen={() => setEditingTask(task)}
              onChangeStatus={() => setStatusSheetTask(task)}
            />
          ))
        )}
      </div>

      <div className="hidden lg:flex flex-1 gap-3 p-3 overflow-x-auto">
        {COLUMNS.map((column) => {
          const columnTasks = desktopTasksByStatus(column.id);
          return (
            <div
              key={column.id}
              className={`flex-1 min-w-[220px] max-w-[300px] flex flex-col bg-mc-bg rounded-lg border border-mc-border/50 border-t-2 ${column.color}`}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, column.id)}
            >
              <div className="p-2 border-b border-mc-border flex items-center justify-between">
                <span className="text-xs font-medium uppercase text-mc-text-secondary truncate">{column.label}</span>
                <span className="text-xs bg-mc-bg-tertiary px-2 py-0.5 rounded text-mc-text-secondary flex-shrink-0">
                  {columnTasks.length}
                </span>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {columnTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onDragStart={handleDragStart}
                    onClick={() => setEditingTask(task)}
                    isDragging={draggedTask?.id === task.id}
                  />
                ))}
                {columnTasks.length === 0 && (
                  <div className="text-center py-8 text-mc-text-secondary/50 text-sm">No tasks</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {statusSheetTask && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button
            className="absolute inset-0 bg-black/55"
            onClick={() => setStatusSheetTask(null)}
            aria-label="Close status selector"
          />
          <div className="absolute bottom-0 left-0 right-0 bg-mc-bg-secondary border-t border-mc-border rounded-t-xl p-4 pb-6">
            <div className="w-10 h-1 bg-mc-border rounded-full mx-auto mb-4" />
            <h3 className="text-sm font-semibold mb-1">Move Task To</h3>
            <p className="text-xs text-mc-text-secondary mb-4 truncate">{statusSheetTask.title}</p>

            <div className="grid grid-cols-2 gap-2">
              {COLUMNS.filter((col) => col.id !== statusSheetTask.status).map((col) => (
                <button
                  key={col.id}
                  className="px-3 py-2 rounded border border-mc-border bg-mc-bg text-sm text-left hover:border-mc-accent"
                  onClick={async () => {
                    await handleMoveTask(statusSheetTask.id, col.id);
                    setStatusSheetTask(null);
                  }}
                >
                  {col.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showCreateModal && (
        <TaskModal onClose={() => setShowCreateModal(false)} workspaceId={workspaceId} />
      )}
      {editingTask && (
        <TaskModal task={editingTask} onClose={() => setEditingTask(null)} workspaceId={workspaceId} />
      )}
    </div>
  );
}

interface TaskCardProps {
  task: Task;
  onDragStart: (e: React.DragEvent, task: Task) => void;
  onClick: () => void;
  isDragging: boolean;
}

function TaskCard({ task, onDragStart, onClick, isDragging }: TaskCardProps) {
  const priorityStyles = {
    low: 'text-mc-text-secondary',
    normal: 'text-mc-accent',
    high: 'text-mc-accent-yellow',
    urgent: 'text-mc-accent-red',
  };

  const priorityDots = {
    low: 'bg-mc-text-secondary/40',
    normal: 'bg-mc-accent',
    high: 'bg-mc-accent-yellow',
    urgent: 'bg-mc-accent-red',
  };

  const isPlanning = task.status === 'planning';

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, task)}
      onClick={onClick}
      className={`group bg-mc-bg-secondary border rounded-lg cursor-pointer transition-all hover:shadow-lg hover:shadow-black/20 active:scale-[0.98] min-h-[44px] touch-manipulation ${
        isDragging ? 'opacity-50 scale-95' : ''
      } ${isPlanning ? 'border-purple-500/40 hover:border-purple-500' : 'border-mc-border/50 hover:border-mc-accent/40'}`}
    >
      <div className="flex items-center justify-center py-1 border-b border-mc-border/30 opacity-0 group-hover:opacity-100 transition-opacity">
        <GripVertical className="w-4 h-4 text-mc-text-secondary/50 cursor-grab" />
      </div>

      <div className="p-3 lg:p-4">
        <h4 className="text-sm font-medium leading-snug line-clamp-2 mb-2 lg:mb-3">{task.title}</h4>

        {isPlanning && (
          <div className="flex items-center gap-2 mb-2 lg:mb-3 py-2 px-3 bg-purple-500/10 rounded-md border border-purple-500/20">
            <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse flex-shrink-0" />
            <span className="text-xs text-purple-400 font-medium">Continue planning</span>
          </div>
        )}

        {task.assigned_agent && (
          <div className="flex items-center gap-2 mb-2 lg:mb-3 py-1.5 px-2 bg-mc-bg-tertiary/50 rounded">
            <span className="text-base">{(task.assigned_agent as unknown as { avatar_emoji: string }).avatar_emoji}</span>
            <span className="text-xs text-mc-text-secondary truncate">
              {(task.assigned_agent as unknown as { name: string }).name}
            </span>
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-mc-border/20">
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${priorityDots[task.priority]}`} />
            <span className={`text-xs capitalize ${priorityStyles[task.priority]}`}>{task.priority}</span>
          </div>
          <span className="text-[10px] text-mc-text-secondary/60">
            {formatDistanceToNow(new Date(task.created_at), { addSuffix: true })}
          </span>
        </div>
      </div>
    </div>
  );
}

function MobileTaskCard({
  task,
  onOpen,
  onChangeStatus,
}: {
  task: Task;
  onOpen: () => void;
  onChangeStatus: () => void;
}) {
  const statusStyle: Record<TaskStatus, string> = {
    planning: 'bg-mc-accent-purple/20 text-mc-accent-purple',
    inbox: 'bg-mc-accent-pink/20 text-mc-accent-pink',
    assigned: 'bg-mc-accent-yellow/20 text-mc-accent-yellow',
    in_progress: 'bg-mc-accent/20 text-mc-accent',
    testing: 'bg-mc-accent-cyan/20 text-mc-accent-cyan',
    review: 'bg-mc-accent-purple/20 text-mc-accent-purple',
    done: 'bg-mc-accent-green/20 text-mc-accent-green',
  };

  const priorityStyle: Record<TaskPriority, string> = {
    low: 'text-mc-text-secondary',
    normal: 'text-mc-accent',
    high: 'text-mc-accent-yellow',
    urgent: 'text-mc-accent-red',
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className="w-full text-left bg-mc-bg-secondary border border-mc-border rounded-lg p-3 active:scale-[0.99] transition-transform cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h4 className="text-sm font-medium leading-snug line-clamp-2">{task.title}</h4>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onChangeStatus();
          }}
          className="p-1.5 rounded hover:bg-mc-bg-tertiary text-mc-text-secondary"
          aria-label="Change task status"
        >
          <MoreVertical className="w-4 h-4" />
        </button>
      </div>

      {task.description && (
        <p className="text-xs text-mc-text-secondary line-clamp-2 mb-2">{task.description}</p>
      )}

      <div className="flex items-center justify-between gap-2 mt-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-medium ${statusStyle[task.status]}`}>
            {task.status.replace('_', ' ')}
          </span>
          <span className={`text-xs capitalize ${priorityStyle[task.priority]}`}>{task.priority}</span>
        </div>

        <span className="text-[10px] text-mc-text-secondary whitespace-nowrap">
          {formatDistanceToNow(new Date(task.created_at), { addSuffix: true })}
        </span>
      </div>

      {task.assigned_agent && (
        <div className="mt-2 text-xs text-mc-text-secondary truncate">
          {(task.assigned_agent as unknown as { avatar_emoji: string }).avatar_emoji}{' '}
          {(task.assigned_agent as unknown as { name: string }).name}
        </div>
      )}
    </div>
  );
}
