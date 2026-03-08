'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Filter, Search, X } from 'lucide-react';
import type { TaskStatus } from '@/lib/types';

interface FloatingActionBarProps {
  onNewTask: () => void;
  currentFilter: string;
  onFilterChange: (filter: string) => void;
}

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'high_priority', label: 'High Priority' },
  { id: 'my_tasks', label: 'My Tasks' },
];

export function FloatingActionBar({ onNewTask, currentFilter, onFilterChange }: FloatingActionBarProps) {
  const [showFilters, setShowFilters] = useState(false);

  return (
    <>
      {/* Filter Chips - shown above tasks on mobile */}
      <div className="lg:hidden flex items-center gap-2 px-3 py-2 border-b border-mc-border overflow-x-auto scrollbar-hide">
        {FILTERS.map((filter) => (
          <button
            key={filter.id}
            onClick={() => onFilterChange(filter.id)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all min-h-[36px] ${
              currentFilter === filter.id
                ? 'bg-mc-accent-pink text-white'
                : 'bg-mc-bg-tertiary text-mc-text-secondary hover:bg-mc-bg'
            }`}
          >
            {filter.label === 'High Priority' && '🔥 '}
            {filter.label === 'Unassigned' && '👤 '}
            {filter.label}
          </button>
        ))}
        
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="flex-shrink-0 p-2 min-h-[36px] min-w-[36px] bg-mc-bg-tertiary rounded-full"
        >
          <Filter className="w-4 h-4" />
        </button>
      </div>

      {/* FAB - only visible on mobile */}
      <motion.button
        onClick={onNewTask}
        className="fixed bottom-20 right-4 z-40 lg:hidden w-14 h-14 bg-mc-accent-pink rounded-full flex items-center justify-center shadow-lg shadow-pink-500/30 active:scale-95"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        aria-label="Create new task"
      >
        <Plus className="w-6 h-6 text-white" />
      </motion.button>

      {/* Search/Filter Modal (optional expansion) */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed inset-0 bg-mc-bg/95 z-50 lg:hidden flex flex-col"
          >
            <div className="flex items-center justify-between p-4 border-b border-mc-border">
              <h3 className="font-medium">Filters</h3>
              <button 
                onClick={() => setShowFilters(false)}
                className="p-2 min-h-[44px] min-w-[44px]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-4 space-y-4">
              <div>
                <label className="text-sm text-mc-text-secondary mb-2 block">Quick Filters</label>
                <div className="flex flex-wrap gap-2">
                  {FILTERS.map((filter) => (
                    <button
                      key={filter.id}
                      onClick={() => {
                        onFilterChange(filter.id);
                        setShowFilters(false);
                      }}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all min-h-[44px] ${
                        currentFilter === filter.id
                          ? 'bg-mc-accent-pink text-white'
                          : 'bg-mc-bg-secondary text-mc-text-secondary'
                      }`}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
