'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus, ChevronRight, GripVertical, Folder, FolderPlus, Lock, Rocket, ChevronDown } from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import { triggerAutoDispatch, shouldTriggerAutoDispatch } from '@/lib/auto-dispatch';
import type { Task, TaskStatus, TaskGroup } from '@/lib/types';
import { TaskModal } from './TaskModal';
import { TaskGroupModal } from './TaskGroupModal';
import { formatDistanceToNow } from 'date-fns';

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
  const { tasks, updateTaskStatus, addEvent, taskGroups, setTaskGroups, addTaskGroup, updateTaskGroup, removeTaskGroup } = useMissionControl();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<TaskGroup | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [showGroupDropdown, setShowGroupDropdown] = useState(false);
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load task groups on mount
  useEffect(() => {
    const loadTaskGroups = async () => {
      try {
        const workspaceFilter = workspaceId ? `?workspace_id=${workspaceId}` : '';
        const res = await fetch(`/api/task-groups${workspaceFilter}`);
        if (res.ok) {
          const groups = await res.json();
          setTaskGroups(groups);
        }
      } catch (error) {
        console.error('Failed to load task groups:', error);
      }
    };
    loadTaskGroups();
  }, [workspaceId, setTaskGroups]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowGroupDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter tasks by selected group
  const filteredTasks = selectedGroupFilter
    ? tasks.filter(t => t.group_id === selectedGroupFilter)
    : tasks;

  const handleSaveGroup = async (groupData: Partial<TaskGroup>) => {
    try {
      if (editingGroup) {
        const res = await fetch(`/api/task-groups/${editingGroup.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(groupData),
        });
        if (res.ok) {
          const updated = await res.json();
          updateTaskGroup(updated);
        }
      } else {
        const res = await fetch('/api/task-groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(groupData),
        });
        if (res.ok) {
          const created = await res.json();
          addTaskGroup(created);
        }
      }
    } catch (error) {
      console.error('Failed to save group:', error);
    }
  };

  const handleDeleteGroup = async () => {
    if (!editingGroup) return;
    try {
      const res = await fetch(`/api/task-groups/${editingGroup.id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        removeTaskGroup(editingGroup.id);
      }
    } catch (error) {
      console.error('Failed to delete group:', error);
    }
  };

  const handleBulkDispatch = async (groupId: string) => {
    try {
      const res = await fetch('/api/tasks/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_id: groupId }),
      });
      
      if (res.ok) {
        const data = await res.json();
        alert(`Dispatched ${data.success_count} task(s)${data.fail_count > 0 ? `, ${data.fail_count} failed` : ''}`);
        // Refresh tasks to show updated status
        const tasksRes = await fetch('/api/tasks');
        if (tasksRes.ok) {
          const updatedTasks = await tasksRes.json();
          const { setTasks } = useMissionControl.getState();
          setTasks(updatedTasks);
        }
      } else {
        const error = await res.json();
        alert(`Dispatch failed: ${error.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to bulk dispatch:', error);
      alert('Failed to dispatch tasks');
    }
  };

  const getTasksByStatus = (status: TaskStatus) =>
    filteredTasks.filter((task) => task.status === status);

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

    // Check if task is blocked by dependencies before allowing move to certain statuses
    const statusesRequiringCheck = ['in_progress', 'assigned', 'testing', 'review'];
    if (statusesRequiringCheck.includes(targetStatus)) {
      try {
        const checkRes = await fetch(`/api/tasks/${draggedTask.id}/dependencies/blockers`);
        if (checkRes.ok) {
          const data = await checkRes.json();
          if (data.is_blocked) {
            const blockerNames = data.blockers.map((b: { taskTitle: string }) => b.taskTitle).join(', ');
            alert(`Cannot move to ${targetStatus}: Blocked by incomplete task(s): ${blockerNames}`);
            setDraggedTask(null);
            return;
          }
        }
      } catch (err) {
        console.error('Failed to check blockers:', err);
      }
    }

    // Optimistic update
    updateTaskStatus(draggedTask.id, targetStatus);

    // Persist to API
    try {
      const res = await fetch(`/api/tasks/${draggedTask.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: targetStatus }),
      });

      if (res.ok) {
        // Add event
        addEvent({
          id: crypto.randomUUID(),
          type: targetStatus === 'done' ? 'task_completed' : 'task_status_changed',
          task_id: draggedTask.id,
          message: `Task "${draggedTask.title}" moved to ${targetStatus}`,
          created_at: new Date().toISOString(),
        });

        // Check if auto-dispatch should be triggered and execute it
        if (shouldTriggerAutoDispatch(draggedTask.status, targetStatus, draggedTask.assigned_agent_id)) {
          const result = await triggerAutoDispatch({
            taskId: draggedTask.id,
            taskTitle: draggedTask.title,
            agentId: draggedTask.assigned_agent_id,
            agentName: draggedTask.assigned_agent?.name || 'Unknown Agent',
            workspaceId: draggedTask.workspace_id
          });

          if (!result.success) {
            console.error('Auto-dispatch failed:', result.error);
            // Optionally show error to user here if needed
          }
        }
      }
    } catch (error) {
      console.error('Failed to update task status:', error);
      // Revert on error
      updateTaskStatus(draggedTask.id, draggedTask.status);
    }

    setDraggedTask(null);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-mc-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ChevronRight className="w-4 h-4 text-mc-text-secondary" />
          <span className="text-sm font-medium uppercase tracking-wider">Mission Queue</span>
          
          {/* Group Filter Dropdown */}
          {taskGroups.length > 0 && (
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setShowGroupDropdown(!showGroupDropdown)}
                className="flex items-center gap-1.5 px-2 py-1 border border-mc-border rounded text-xs hover:bg-mc-bg-tertiary"
              >
                <Folder className="w-3 h-3" />
                {selectedGroupFilter 
                  ? taskGroups.find(g => g.id === selectedGroupFilter)?.name || 'All'
                  : 'All Groups'}
                <ChevronDown className="w-3 h-3" />
              </button>
              
              {showGroupDropdown && (
                <div className="absolute top-full left-0 mt-1 w-56 bg-mc-bg border border-mc-border rounded-lg shadow-lg z-50">
                  <button
                    onClick={() => {
                      setSelectedGroupFilter(null);
                      setShowGroupDropdown(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-mc-bg-tertiary ${
                      !selectedGroupFilter ? 'bg-mc-accent/10 text-mc-accent' : ''
                    }`}
                  >
                    All Groups ({tasks.length})
                  </button>
                  {taskGroups.map(group => {
                    const groupTaskCount = tasks.filter(t => t.group_id === group.id).length;
                    const dispatchableCount = tasks.filter(t => 
                      t.group_id === group.id && 
                      t.assigned_agent_id && 
                      !['done', 'in_progress', 'planning'].includes(t.status)
                    ).length;
                    return (
                      <div key={group.id} className="border-t border-mc-border/50">
                        <button
                          onClick={() => {
                            setSelectedGroupFilter(group.id);
                            setShowGroupDropdown(false);
                          }}
                          className={`w-full text-left px-3 py-2 text-xs hover:bg-mc-bg-tertiary flex items-center justify-between ${
                            selectedGroupFilter === group.id ? 'bg-mc-accent/10 text-mc-accent' : ''
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: group.color }} />
                            {group.name}
                          </span>
                          <span className="text-mc-text-secondary">{groupTaskCount}</span>
                        </button>
                        {dispatchableCount > 0 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleBulkDispatch(group.id);
                            }}
                            className="w-full text-left px-3 py-1.5 text-xs text-mc-accent-green hover:bg-mc-accent-green/10 flex items-center gap-1"
                          >
                            <Rocket className="w-3 h-3" />
                            Dispatch All ({dispatchableCount})
                          </button>
                        )}
                      </div>
                    );
                  })}
                  <div className="border-t border-mc-border/50">
                    <button
                      onClick={() => {
                        setEditingGroup(null);
                        setShowGroupModal(true);
                        setShowGroupDropdown(false);
                      }}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-mc-bg-tertiary flex items-center gap-2 text-mc-accent"
                    >
                      <FolderPlus className="w-3 h-3" />
                      Manage Groups
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setEditingGroup(null);
              setShowGroupModal(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-mc-border rounded text-sm hover:bg-mc-bg-tertiary"
            title="Manage Task Groups"
          >
            <Folder className="w-4 h-4" />
            Groups
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-mc-accent-pink text-mc-bg rounded text-sm font-medium hover:bg-mc-accent-pink/90"
          >
            <Plus className="w-4 h-4" />
            New Task
          </button>
        </div>
      </div>

      {/* Kanban Columns */}
      <div className="flex-1 flex gap-3 p-3 overflow-x-auto">
        {COLUMNS.map((column) => {
          const columnTasks = getTasksByStatus(column.id);
          return (
            <div
              key={column.id}
              className={`flex-1 min-w-[220px] max-w-[300px] flex flex-col bg-mc-bg rounded-lg border border-mc-border/50 border-t-2 ${column.color}`}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, column.id)}
            >
              {/* Column Header */}
              <div className="p-2 border-b border-mc-border flex items-center justify-between">
                <span className="text-xs font-medium uppercase text-mc-text-secondary">
                  {column.label}
                </span>
                <span className="text-xs bg-mc-bg-tertiary px-2 py-0.5 rounded text-mc-text-secondary">
                  {columnTasks.length}
                </span>
              </div>

              {/* Tasks */}
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
              </div>
            </div>
          );
        })}
      </div>

      {/* Modals */}
      {showCreateModal && (
        <TaskModal onClose={() => setShowCreateModal(false)} workspaceId={workspaceId} />
      )}
      {editingTask && (
        <TaskModal task={editingTask} onClose={() => setEditingTask(null)} workspaceId={workspaceId} />
      )}
      {showGroupModal && (
        <TaskGroupModal
          group={editingGroup || undefined}
          workspaceId={workspaceId || 'default'}
          tasks={tasks}
          onClose={() => {
            setShowGroupModal(false);
            setEditingGroup(null);
          }}
          onSave={handleSaveGroup}
          onDelete={editingGroup ? handleDeleteGroup : undefined}
          onDispatch={editingGroup ? handleBulkDispatch : undefined}
        />
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
  const { taskGroups } = useMissionControl();
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
  
  // Get the task's group
  const taskGroup = task.group_id ? taskGroups.find(g => g.id === task.group_id) : undefined;

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, task)}
      onClick={onClick}
      className={`group bg-mc-bg-secondary border rounded-lg cursor-pointer transition-all hover:shadow-lg hover:shadow-black/20 ${
        isDragging ? 'opacity-50 scale-95' : ''
      } ${isPlanning ? 'border-purple-500/40 hover:border-purple-500' : 'border-mc-border/50 hover:border-mc-accent/40'}`}
    >
      {/* Drag handle bar */}
      <div className="flex items-center justify-center py-1.5 border-b border-mc-border/30 opacity-0 group-hover:opacity-100 transition-opacity">
        <GripVertical className="w-4 h-4 text-mc-text-secondary/50 cursor-grab" />
      </div>

      {/* Card content */}
      <div className="p-4">
        {/* Title */}
        <h4 className="text-sm font-medium leading-snug line-clamp-2 mb-3">
          {task.title}
        </h4>

        {/* Task Group Badge */}
        {taskGroup && (
          <div 
            className="flex items-center gap-1.5 mb-3 py-1 px-2 rounded text-xs font-medium"
            style={{ 
              backgroundColor: `${taskGroup.color}20`,
              color: taskGroup.color,
              border: `1px solid ${taskGroup.color}40`
            }}
          >
            <Folder className="w-3 h-3" />
            {taskGroup.name}
          </div>
        )}
        
        {/* Planning mode indicator */}
        {isPlanning && (
          <div className="flex items-center gap-2 mb-3 py-2 px-3 bg-purple-500/10 rounded-md border border-purple-500/20">
            <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse flex-shrink-0" />
            <span className="text-xs text-purple-400 font-medium">Continue planning</span>
          </div>
        )}

        {/* Blocked indicator */}
        {task.is_blocked && (
          <div className="flex items-center gap-2 mb-3 py-2 px-3 bg-mc-accent-red/10 rounded-md border border-mc-accent-red/20">
            <Lock className="w-3 h-3 text-mc-accent-red flex-shrink-0" />
            <div className="flex flex-col">
              <span className="text-xs text-mc-accent-red font-medium">Blocked</span>
              {task.blocking_tasks && task.blocking_tasks.length > 0 && (
                <span className="text-[10px] text-mc-accent-red/70 truncate">
                  by: {task.blocking_tasks.map(b => b.taskTitle).join(', ')}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Assigned agent */}
        {task.assigned_agent && (
          <div className="flex items-center gap-2 mb-3 py-1.5 px-2 bg-mc-bg-tertiary/50 rounded">
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
