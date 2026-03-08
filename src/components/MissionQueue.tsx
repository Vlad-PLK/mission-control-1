'use client';

import { useState, useRef, useEffect } from 'react';
import { Plus, ChevronRight, GripVertical } from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import { triggerAutoDispatch, shouldTriggerAutoDispatch } from '@/lib/auto-dispatch';
import type { Task, TaskStatus } from '@/lib/types';
import { TaskModal } from './TaskModal';
import { formatDistanceToNow } from 'date-fns';
import { ColumnQuickSwitcher, SwipeableTaskCard } from './MobileColumnNav';
import { FloatingActionBar } from './FloatingActionBar';
import { toast } from 'sonner';

interface MissionQueueProps {
  workspaceId?: string;
}

const COLUMNS: { id: TaskStatus; label: string; color: string }[] = [
  { id: 'planning', label: '📋 PLANNING', color: 'border-t-mc-accent-purple' },
  { id: 'inbox', label: 'INBOX', color: 'border-t-mc-accent-pink' },
  { id: 'assigned', label: 'ASSIGNED', color: 'border-t-mc-accent-yellow' },
  { id: 'in_progress', label: 'IN PROGRESS', color: 'border-t-mc-accent' },
  { id: 'testing', label: 'TESTING', color: 'border-t-mc-accent-cyan' },
  { id: 'review', label: 'REVIEW', color: 'border-t-mc-accent-purple' },
  { id: 'done', label: 'DONE', color: 'border-t-mc-accent-green' },
];

export function MissionQueue({ workspaceId }: MissionQueueProps) {
  const { tasks, updateTaskStatus, addEvent } = useMissionControl();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [currentColumn, setCurrentColumn] = useState<TaskStatus>('inbox');
  const [currentFilter, setCurrentFilter] = useState<string>('all');
  const columnsRef = useRef<HTMLDivElement>(null);

  const currentColumnIndex = COLUMNS.findIndex(c => c.id === currentColumn);

  // Scroll to column when changed from quick switcher
  useEffect(() => {
    if (columnsRef.current) {
      const columnEl = columnsRef.current.children[currentColumnIndex] as HTMLElement;
      if (columnEl) {
        columnEl.scrollIntoView({ behavior: 'smooth', inline: 'start' });
      }
    }
  }, [currentColumn, currentColumnIndex]);

  // Filter tasks based on current filter
  const getFilteredTasks = (status: TaskStatus) => {
    let filtered = tasks.filter((task) => task.status === status);
    
    switch (currentFilter) {
      case 'unassigned':
        filtered = filtered.filter(t => !t.assigned_agent_id);
        break;
      case 'high_priority':
        filtered = filtered.filter(t => t.priority === 'high' || t.priority === 'urgent');
        break;
      case 'my_tasks':
        // For now, show tasks that have any assignment
        filtered = filtered.filter(t => t.assigned_agent_id);
        break;
    }
    
    return filtered;
  };

  const getTasksByStatus = (status: TaskStatus) => getFilteredTasks(status);

  // Handle swipe to move task
  const handleMoveTask = async (taskId: string, newStatus: TaskStatus) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.status === newStatus) return;

    const oldStatus = task.status;
    
    // Optimistic update
    updateTaskStatus(taskId, newStatus);

    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (res.ok) {
        addEvent({
          id: crypto.randomUUID(),
          type: newStatus === 'done' ? 'task_completed' : 'task_status_changed',
          task_id: taskId,
          message: `Task "${task.title}" moved to ${newStatus}`,
          created_at: new Date().toISOString(),
        });

        // Check auto-dispatch
        if (shouldTriggerAutoDispatch(oldStatus, newStatus, task.assigned_agent_id)) {
          await triggerAutoDispatch({
            taskId: task.id,
            taskTitle: task.title,
            agentId: task.assigned_agent_id,
            agentName: task.assigned_agent?.name || 'Unknown Agent',
            workspaceId: task.workspace_id
          });
        }
      }
    } catch (error) {
      console.error('Failed to update task status:', error);
      updateTaskStatus(taskId, oldStatus);
      toast.error('Failed to move task');
    }
  };

  // Handle scroll to update current column
  const handleScroll = () => {
    if (columnsRef.current) {
      const scrollLeft = columnsRef.current.scrollLeft;
      const columnWidth = columnsRef.current.children[0]?.clientWidth || 250;
      const newIndex = Math.round(scrollLeft / (columnWidth + 12)); // 12 is gap
      const clampedIndex = Math.max(0, Math.min(newIndex, COLUMNS.length - 1));
      setCurrentColumn(COLUMNS[clampedIndex].id);
    }
  };

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
    <div className="flex-1 flex flex-col overflow-hidden pb-20 lg:pb-0">
      {/* Header */}
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
          <span className="hidden sm:inline">New Task</span>
        </button>
      </div>

      {/* Floating Filter Bar - Mobile Only */}
      <FloatingActionBar 
        onNewTask={() => setShowCreateModal(true)}
        currentFilter={currentFilter}
        onFilterChange={setCurrentFilter}
      />

      {/* Kanban Columns - horizontal scroll with snap on mobile */}
      <div 
        ref={columnsRef}
        onScroll={handleScroll}
        className="flex-1 flex gap-2 lg:gap-3 p-2 lg:p-3 overflow-x-auto snap-x snap-mandatory lg:snap-none scroll-smooth"
        style={{ scrollBehavior: 'smooth' }}
      >
        {COLUMNS.map((column, idx) => {
          const columnTasks = getTasksByStatus(column.id);
          const isCurrentColumn = column.id === currentColumn;
          
          return (
            <div
              key={column.id}
              snap-start
              className={`flex-1 min-w-[85vw] sm:min-w-[200px] md:min-w-[220px] max-w-[260px] lg:max-w-[300px] flex flex-col bg-mc-bg rounded-lg border border-mc-border/50 border-t-2 ${column.color} snap-start lg:snap-none ${
                isCurrentColumn ? 'ring-2 ring-mc-accent-cyan/30' : ''
              }`}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, column.id)}
            >
              {/* Column Header */}
              <div className="p-2 border-b border-mc-border flex items-center justify-between">
                <span className="text-xs font-medium uppercase text-mc-text-secondary truncate">
                  {column.label}
                </span>
                <span className="text-xs bg-mc-bg-tertiary px-2 py-0.5 rounded text-mc-text-secondary flex-shrink-0">
                  {columnTasks.length}
                </span>
              </div>

              {/* Tasks */}
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {columnTasks.map((task) => (
                  <SwipeableTaskCard
                    key={task.id}
                    task={task}
                    columns={COLUMNS}
                    onMoveTask={handleMoveTask}
                  >
                    <TaskCard
                      task={task}
                      onDragStart={handleDragStart}
                      onClick={() => setEditingTask(task)}
                      isDragging={draggedTask?.id === task.id}
                    />
                  </SwipeableTaskCard>
                ))}
                {columnTasks.length === 0 && (
                  <div className="text-center py-8 text-mc-text-secondary/50 text-sm">
                    No tasks
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Column Quick Switcher - Mobile Only */}
      <ColumnQuickSwitcher 
        columns={COLUMNS}
        currentColumn={currentColumn}
        onColumnChange={setCurrentColumn}
      />

      {/* Modals */}
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
      {/* Drag handle bar - visible on hover, always visible on touch devices */}
      <div className="flex items-center justify-center py-1 border-b border-mc-border/30 opacity-0 group-hover:opacity-100 lg:opacity-0 transition-opacity">
        <GripVertical className="w-4 h-4 text-mc-text-secondary/50 cursor-grab" />
      </div>

      {/* Card content */}
      <div className="p-3 lg:p-4">
        {/* Title */}
        <h4 className="text-sm font-medium leading-snug line-clamp-2 mb-2 lg:mb-3">
          {task.title}
        </h4>
        
        {/* Planning mode indicator */}
        {isPlanning && (
          <div className="flex items-center gap-2 mb-2 lg:mb-3 py-2 px-3 bg-purple-500/10 rounded-md border border-purple-500/20">
            <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse flex-shrink-0" />
            <span className="text-xs text-purple-400 font-medium">Continue planning</span>
          </div>
        )}

        {/* Assigned agent */}
        {task.assigned_agent && (
          <div className="flex items-center gap-2 mb-2 lg:mb-3 py-1.5 px-2 bg-mc-bg-tertiary/50 rounded">
            <span className="text-base">{(task.assigned_agent as unknown as { avatar_emoji: string }).avatar_emoji}</span>
            <span className="text-xs text-mc-text-secondary truncate">
              {(task.assigned_agent as unknown as { name: string }).name}
            </span>
          </div>
        )}

        {/* Footer: priority + timestamp */}
        <div className="flex items-center justify-between pt-2 border-t border-mc-border/20">
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${priorityDots[task.priority]}`} />
            <span className={`text-xs capitalize ${priorityStyles[task.priority]}`}>
              {task.priority}
            </span>
          </div>
          <span className="text-[10px] text-mc-text-secondary/60">
            {formatDistanceToNow(new Date(task.created_at), { addSuffix: true })}
          </span>
        </div>
      </div>
    </div>
  );
}
