'use client';

import { useState } from 'react';
import { X, Save, Trash2, Folder, Palette } from 'lucide-react';
import type { TaskGroup } from '@/lib/types';

interface TaskGroupModalProps {
  group?: TaskGroup;
  workspaceId: string;
  onClose: () => void;
  onSave: (group: Partial<TaskGroup>) => Promise<void>;
  onDelete?: () => Promise<void>;
}

const COLOR_OPTIONS = [
  { value: '#6366f1', label: 'Indigo' },
  { value: '#8b5cf6', label: 'Purple' },
  { value: '#ec4899', label: 'Pink' },
  { value: '#ef4444', label: 'Red' },
  { value: '#f97316', label: 'Orange' },
  { value: '#eab308', label: 'Yellow' },
  { value: '#22c55e', label: 'Green' },
  { value: '#14b8a6', label: 'Teal' },
  { value: '#3b82f6', label: 'Blue' },
  { value: '#6b7280', label: 'Gray' },
];

export function TaskGroupModal({ group, workspaceId, onClose, onSave, onDelete }: TaskGroupModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: group?.name || '',
    description: group?.description || '',
    shared_context: group?.shared_context || '',
    shared_requirements: group?.shared_requirements || '',
    shared_instructions: group?.shared_instructions || '',
    color: group?.color || '#6366f1',
    order_index: group?.order_index || 0,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;

    setIsSubmitting(true);
    try {
      await onSave({
        ...form,
        workspace_id: workspaceId,
      });
      onClose();
    } catch (error) {
      console.error('Failed to save group:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this group? Tasks will be unassigned but not deleted.')) {
      return;
    }
    setIsSubmitting(true);
    try {
      await onDelete?.();
      onClose();
    } catch (error) {
      console.error('Failed to delete group:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-mc-bg border border-mc-border rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-mc-border">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Folder className="w-5 h-5" />
            {group ? 'Edit Task Group' : 'Create Task Group'}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-mc-border rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 bg-mc-surface border border-mc-border rounded focus:outline-none focus:border-mc-accent"
              placeholder="e.g., Feature Development"
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full px-3 py-2 bg-mc-surface border border-mc-border rounded focus:outline-none focus:border-mc-accent"
              placeholder="Brief description of this group"
            />
          </div>

          {/* Color */}
          <div>
            <label className="block text-sm font-medium mb-1 flex items-center gap-2">
              <Palette className="w-4 h-4" /> Color
            </label>
            <div className="flex flex-wrap gap-2">
              {COLOR_OPTIONS.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  onClick={() => setForm({ ...form, color: color.value })}
                  className={`w-8 h-8 rounded-full transition-transform ${
                    form.color === color.value ? 'ring-2 ring-white ring-offset-2 ring-offset-mc-bg scale-110' : ''
                  }`}
                  style={{ backgroundColor: color.value }}
                  title={color.label}
                />
              ))}
            </div>
          </div>

          {/* Shared Context */}
          <div>
            <label className="block text-sm font-medium mb-1">Shared Context</label>
            <textarea
              value={form.shared_context}
              onChange={(e) => setForm({ ...form, shared_context: e.target.value })}
              className="w-full px-3 py-2 bg-mc-surface border border-mc-border rounded focus:outline-none focus:border-mc-accent text-sm"
              placeholder="Background info shared by all tasks in this group..."
              rows={3}
            />
          </div>

          {/* Shared Requirements */}
          <div>
            <label className="block text-sm font-medium mb-1">Shared Requirements</label>
            <textarea
              value={form.shared_requirements}
              onChange={(e) => setForm({ ...form, shared_requirements: e.target.value })}
              className="w-full px-3 py-2 bg-mc-surface border border-mc-border rounded focus:outline-none focus:border-mc-accent text-sm"
              placeholder="Requirements common to all tasks..."
              rows={3}
            />
          </div>

          {/* Shared Instructions */}
          <div>
            <label className="block text-sm font-medium mb-1">Shared Instructions</label>
            <textarea
              value={form.shared_instructions}
              onChange={(e) => setForm({ ...form, shared_instructions: e.target.value })}
              className="w-full px-3 py-2 bg-mc-surface border border-mc-border rounded focus:outline-none focus:border-mc-accent text-sm"
              placeholder="Instructions for the agent..."
              rows={3}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-between pt-4 border-t border-mc-border">
            <div>
              {group && onDelete && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-white flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-mc-border rounded hover:bg-mc-border"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !form.name.trim()}
                className="px-4 py-2 bg-mc-accent hover:bg-mc-accent/80 rounded text-white flex items-center gap-2 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {isSubmitting ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
