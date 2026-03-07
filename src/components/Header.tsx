'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Zap, Settings, ChevronLeft, LayoutGrid, Menu, X } from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import { format } from 'date-fns';
import type { Workspace } from '@/lib/types';

interface HeaderProps {
  workspace?: Workspace;
}

export function Header({ workspace }: HeaderProps) {
  const router = useRouter();
  const { agents, tasks, isOnline } = useMissionControl();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [activeSubAgents, setActiveSubAgents] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Load active sub-agent count
  useEffect(() => {
    const loadSubAgentCount = async () => {
      try {
        const res = await fetch('/api/openclaw/sessions?session_type=subagent&status=active');
        if (res.ok) {
          const sessions = await res.json();
          setActiveSubAgents(sessions.length);
        }
      } catch (error) {
        console.error('Failed to load sub-agent count:', error);
      }
    };

    loadSubAgentCount();

    // Poll every 30 seconds (reduced from 10s to reduce load)
    const interval = setInterval(loadSubAgentCount, 30000);
    return () => clearInterval(interval);
  }, []);

  const workingAgents = agents.filter((a) => a.status === 'working').length;
  const activeAgents = workingAgents + activeSubAgents;
  const tasksInQueue = tasks.filter((t) => t.status !== 'done' && t.status !== 'review').length;

  return (
    <header className="h-14 bg-mc-bg-secondary border-b border-mc-border flex items-center justify-between px-4 lg:px-6">
      {/* Left: Logo & Title */}
      <div className="flex items-center gap-2 lg:gap-4">
        {/* Mobile hamburger menu */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="lg:hidden p-2 min-h-[44px] min-w-[44px] flex items-center justify-center hover:bg-mc-bg-tertiary rounded"
          aria-label="Toggle menu"
        >
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>

        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-mc-accent-cyan" />
          <span className="font-semibold text-mc-text uppercase tracking-wider text-sm hidden sm:block">
            Mission Control
          </span>
        </div>

        {/* Workspace indicator or back to dashboard */}
        {workspace ? (
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="flex items-center gap-1 text-mc-text-secondary hover:text-mc-accent transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              <LayoutGrid className="w-4 h-4" />
            </Link>
            <span className="text-mc-text-secondary hidden sm:inline">/</span>
            <div className="flex items-center gap-2 px-2 lg:px-3 py-1 bg-mc-bg-tertiary rounded">
              <span className="text-lg">{workspace.icon}</span>
              <span className="font-medium text-sm lg:text-base truncate max-w-[100px] lg:max-w-none">
                {workspace.name}
              </span>
            </div>
          </div>
        ) : (
          <Link
            href="/"
            className="flex items-center gap-2 px-2 lg:px-3 py-1 bg-mc-bg-tertiary rounded hover:bg-mc-bg transition-colors"
          >
            <LayoutGrid className="w-4 h-4" />
            <span className="text-sm hidden sm:inline">All Workspaces</span>
          </Link>
        )}
      </div>

      {/* Center: Stats - only show in workspace view on larger screens */}
      {workspace && (
        <div className="hidden md:flex items-center gap-8">
          <div className="text-center">
            <div className="text-2xl font-bold text-mc-accent-cyan">{activeAgents}</div>
            <div className="text-xs text-mc-text-secondary uppercase">Agents Active</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-mc-accent-purple">{tasksInQueue}</div>
            <div className="text-xs text-mc-text-secondary uppercase">Tasks in Queue</div>
          </div>
        </div>
      )}

      {/* Right: Time & Status */}
      <div className="flex items-center gap-2 lg:gap-4">
        <span className="text-mc-text-secondary text-sm font-mono hidden sm:inline">
          {format(currentTime, 'HH:mm:ss')}
        </span>
        <div
          className={`flex items-center gap-2 px-2 lg:px-3 py-1 rounded border text-xs lg:text-sm font-medium ${
            isOnline
              ? 'bg-mc-accent-green/20 border-mc-accent-green text-mc-accent-green'
              : 'bg-mc-accent-red/20 border-mc-accent-red text-mc-accent-red'
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              isOnline ? 'bg-mc-accent-green animate-pulse' : 'bg-mc-accent-red'
            }`}
          />
          <span className="hidden sm:inline">{isOnline ? 'ONLINE' : 'OFFLINE'}</span>
        </div>
        <button
          onClick={() => router.push('/settings')}
          className="p-2 min-h-[44px] min-w-[44px] hover:bg-mc-bg-tertiary rounded text-mc-text-secondary flex items-center justify-center"
          title="Settings"
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 top-14 bg-mc-bg/95 z-40 lg:hidden" onClick={() => setMobileMenuOpen(false)}>
          <div className="p-4 space-y-4" onClick={e => e.stopPropagation()}>
            {/* Mobile Stats */}
            {workspace && (
              <div className="flex justify-around py-4 border-b border-mc-border">
                <div className="text-center">
                  <div className="text-xl font-bold text-mc-accent-cyan">{activeAgents}</div>
                  <div className="text-xs text-mc-text-secondary uppercase">Agents</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-mc-accent-purple">{tasksInQueue}</div>
                  <div className="text-xs text-mc-text-secondary uppercase">Queue</div>
                </div>
              </div>
            )}
            
            {/* Quick Links */}
            <Link
              href="/"
              className="flex items-center gap-3 p-3 min-h-[44px] bg-mc-bg-secondary rounded-lg"
              onClick={() => setMobileMenuOpen(false)}
            >
              <LayoutGrid className="w-5 h-5" />
              <span>All Workspaces</span>
            </Link>
            <Link
              href="/settings"
              className="flex items-center gap-3 p-3 min-h-[44px] bg-mc-bg-secondary rounded-lg"
              onClick={() => setMobileMenuOpen(false)}
            >
              <Settings className="w-5 h-5" />
              <span>Settings</span>
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
