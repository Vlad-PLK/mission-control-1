'use client';

import { useState, useRef, useEffect } from 'react';
import { useGesture } from '@use-gesture/react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { 
  ChevronLeft, ChevronRight, GripVertical, 
  ArrowLeft, ArrowRight, MoreHorizontal 
} from 'lucide-react';
import type { Task, TaskStatus } from '@/lib/types';

interface ColumnQuickSwitcherProps {
  columns: { id: TaskStatus; label: string; color: string }[];
  currentColumn: TaskStatus;
  onColumnChange: (column: TaskStatus) => void;
}

export function ColumnQuickSwitcher({ columns, currentColumn, onColumnChange }: ColumnQuickSwitcherProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-mc-bg-secondary border-t border-mc-border z-30 lg:hidden">
      {/* Progress indicator */}
      <div className="flex justify-center py-1.5 px-2 gap-1">
        {columns.map((col, idx) => {
          const isActive = col.id === currentColumn;
          const currentIdx = columns.findIndex(c => c.id === currentColumn);
          return (
            <button
              key={col.id}
              onClick={() => onColumnChange(col.id)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                isActive 
                  ? 'w-6 bg-mc-accent-cyan' 
                  : 'w-1.5 bg-mc-text-secondary/30'
              }`}
              style={{
                opacity: isActive ? 1 : Math.abs(idx - currentIdx) <= 2 ? 0.5 : 0.3
              }}
            />
          );
        })}
      </div>
      
      {/* Column pills */}
      <div 
        ref={scrollRef}
        className="flex gap-1.5 px-2 pb-2 overflow-x-auto scrollbar-hide touch-pan-x"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {columns.map((col) => (
          <button
            key={col.id}
            onClick={() => onColumnChange(col.id)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all min-h-[36px] ${
              col.id === currentColumn
                ? 'bg-mc-accent text-mc-bg'
                : 'bg-mc-bg-tertiary text-mc-text-secondary hover:bg-mc-bg'
            }`}
          >
            {col.label.replace(/[📋🔔📝🚀🐛🔍✅]/g, '').trim()}
          </button>
        ))}
      </div>
    </div>
  );
}

interface SwipeableTaskCardProps {
  task: Task;
  children: React.ReactNode;
  columns: { id: TaskStatus; label: string; color: string }[];
  onMoveTask: (taskId: string, newStatus: TaskStatus) => void;
}

export function SwipeableTaskCard({ task, children, columns, onMoveTask }: SwipeableTaskCardProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragX, setDragX] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  
  // Find current column index
  const currentIdx = columns.findIndex(c => c.id === task.status);
  const canGoLeft = currentIdx > 0;
  const canGoRight = currentIdx < columns.length - 1;
  
  const getTargetColumn = (direction: 'left' | 'right'): TaskStatus | null => {
    if (direction === 'left' && canGoLeft) {
      return columns[currentIdx - 1].id;
    }
    if (direction === 'right' && canGoRight) {
      return columns[currentIdx + 1].id;
    }
    return null;
  };

  const targetLeft = getTargetColumn('left');
  const targetRight = getTargetColumn('right');
  
  const getMoveLabel = (direction: 'left' | 'right'): string => {
    const target = direction === 'left' ? targetLeft : targetRight;
    if (!target) return '';
    const col = columns.find(c => c.id === target);
    return col?.label.replace(/[📋🔔📝🚀🐛🔍✅]/g, '').trim() || '';
  };

  useGesture(
    {
      onDrag: ({ event, delta: [dx], first, last }) => {
        if (first) {
          // Only start drag if horizontal, not vertical scroll
          setIsDragging(true);
        }
        
        if (isDragging) {
          // Limit drag distance
          const maxDrag = 120;
          const clampedDx = Math.max(-maxDrag, Math.min(maxDrag, dx * 1.5));
          setDragX(clampedDx);
        }
        
        if (last && isDragging) {
          // Determine swipe direction and trigger move
          const threshold = 60;
          if (dragX < -threshold && canGoLeft && targetLeft) {
            onMoveTask(task.id, targetLeft);
            toast.success(`Moved to ${getMoveLabel('left')}`);
          } else if (dragX > threshold && canGoRight && targetRight) {
            onMoveTask(task.id, targetRight);
            toast.success(`Moved to ${getMoveLabel('right')}`);
          }
          
          // Reset
          setDragX(0);
          setIsDragging(false);
        }
      },
    },
    {
      target: cardRef,
      drag: { 
        filterTaps: true,
        threshold: 10,
      },
      pointer: {
        touch: true,
      }
    }
  );

  return (
    <div className="relative overflow-hidden">
      {/* Background indicators */}
      {canGoLeft && (
        <div 
          className="absolute inset-y-0 left-0 w-20 bg-mc-accent-yellow/20 flex items-center justify-start pl-3 pointer-events-none"
          style={{ opacity: dragX < -20 ? 1 : 0 }}
        >
          <ArrowLeft className="w-5 h-5 text-mc-accent-yellow" />
          <span className="text-xs text-mc-accent-yellow ml-1 font-medium">
            {getMoveLabel('left')}
          </span>
        </div>
      )}
      {canGoRight && (
        <div 
          className="absolute inset-y-0 right-0 w-20 bg-mc-accent-green/20 flex items-center justify-end pr-3 pointer-events-none"
          style={{ opacity: dragX > 20 ? 1 : 0 }}
        >
          <span className="text-xs text-mc-accent-green mr-1 font-medium">
            {getMoveLabel('right')}
          </span>
          <ArrowRight className="w-5 h-5 text-mc-accent-green" />
        </div>
      )}
      
      {/* The actual card */}
      <motion.div
        ref={cardRef}
        animate={{ 
          x: dragX,
          scale: isDragging ? 1.02 : 1,
        }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="relative z-10"
        style={{ touchAction: 'none' }}
      >
        {children}
      </motion.div>
    </div>
  );
}
