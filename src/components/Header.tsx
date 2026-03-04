'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Zap, Settings, ChevronLeft, LayoutGrid, FolderOpen, X } from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import { format } from 'date-fns';
import type { Workspace } from '@/lib/types';

interface HeaderProps {
  workspace?: Workspace;
  onWorkspaceUpdated?: (workspace: Workspace) => void;
}

function truncatePath(input: string, max = 42): string {
  if (!input) return '';
  if (input.length <= max) return input;
  const head = Math.max(10, Math.floor(max * 0.6));
  const tail = Math.max(10, max - head - 1);
  return `${input.slice(0, head)}…${input.slice(-tail)}`;
}

export function Header({ workspace, onWorkspaceUpdated }: HeaderProps) {
  const router = useRouter();
  const { agents, tasks, isOnline } = useMissionControl();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [activeSubAgents, setActiveSubAgents] = useState(0);

  const [showFolderModal, setShowFolderModal] = useState(false);
  const [folderPath, setFolderPath] = useState('');
  const [folderSaving, setFolderSaving] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);

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

  useEffect(() => {
    setFolderPath(workspace?.folder_path || '');
  }, [workspace]);

  const saveFolderPath = async () => {
    if (!workspace) return;

    setFolderSaving(true);
    setFolderError(null);

    try {
      const res = await fetch(`/api/workspaces/${workspace.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder_path: folderPath.trim() ? folderPath.trim() : null,
        }),
      });

      if (res.ok) {
        const updated = (await res.json()) as Workspace;
        onWorkspaceUpdated?.(updated);
        setShowFolderModal(false);
      } else {
        const data = await res.json();
        setFolderError(data.error || 'Failed to update folder path');
      }
    } catch {
      setFolderError('Failed to update folder path');
    } finally {
      setFolderSaving(false);
    }
  };

  const workingAgents = agents.filter((a) => a.status === 'working').length;
  const activeAgents = workingAgents + activeSubAgents;
  const tasksInQueue = tasks.filter((t) => t.status !== 'done' && t.status !== 'review').length;

  return (
    <>
      <header className="h-14 bg-mc-bg-secondary border-b border-mc-border flex items-center justify-between px-4">
      {/* Left: Logo & Title */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-mc-accent-cyan" />
          <span className="font-semibold text-mc-text uppercase tracking-wider text-sm">
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
            <span className="text-mc-text-secondary">/</span>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 px-3 py-1 bg-mc-bg-tertiary rounded">
                <span className="text-lg">{workspace.icon}</span>
                <span className="font-medium">{workspace.name}</span>
              </div>

              <button
                onClick={() => {
                  setFolderError(null);
                  setShowFolderModal(true);
                }}
                className="hidden lg:flex items-center gap-2 px-3 py-1 bg-mc-bg-tertiary rounded border border-mc-border hover:border-mc-accent/50 text-mc-text-secondary hover:text-mc-text transition-colors"
                title="Workspace code folder"
                type="button"
              >
                <FolderOpen className="w-4 h-4" />
                <span className="text-xs font-mono">
                  {workspace.folder_path ? truncatePath(workspace.folder_path, 44) : 'Set code folder'}
                </span>
              </button>

              <button
                onClick={() => {
                  setFolderError(null);
                  setShowFolderModal(true);
                }}
                className="lg:hidden p-2 bg-mc-bg-tertiary rounded border border-mc-border hover:border-mc-accent/50 text-mc-text-secondary hover:text-mc-text transition-colors"
                title="Workspace code folder"
                type="button"
              >
                <FolderOpen className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <Link
            href="/"
            className="flex items-center gap-2 px-3 py-1 bg-mc-bg-tertiary rounded hover:bg-mc-bg transition-colors"
          >
            <LayoutGrid className="w-4 h-4" />
            <span className="text-sm">All Workspaces</span>
          </Link>
        )}
      </div>

      {/* Center: Stats - only show in workspace view */}
      {workspace && (
        <div className="flex items-center gap-8">
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
      <div className="flex items-center gap-4">
        <span className="text-mc-text-secondary text-sm font-mono">
          {format(currentTime, 'HH:mm:ss')}
        </span>
        <div
          className={`flex items-center gap-2 px-3 py-1 rounded border text-sm font-medium ${
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
          {isOnline ? 'ONLINE' : 'OFFLINE'}
        </div>
        <button
          onClick={() => router.push('/settings')}
          className="p-2 hover:bg-mc-bg-tertiary rounded text-mc-text-secondary"
          title="Settings"
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>
    </header>

      {workspace && showFolderModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowFolderModal(false)}
        >
          <div
            className="bg-mc-bg-secondary border border-mc-border rounded-xl w-full max-w-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-mc-border flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Workspace Code Folder</h2>
                <p className="text-sm text-mc-text-secondary mt-1">
                  If set, agents will work directly inside this folder (your real codebase). If empty, Mission Control will create a new per-task folder.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowFolderModal(false)}
                className="p-2 hover:bg-mc-bg-tertiary rounded text-mc-text-secondary"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Folder path</label>
                <input
                  type="text"
                  value={folderPath}
                  onChange={(e) => setFolderPath(e.target.value)}
                  placeholder="e.g., /home/vlad-plk/clients/cafe-fino/CODE/ or ~/clients/project/CODE/"
                  className="w-full bg-mc-bg border border-mc-border rounded-lg px-4 py-2 focus:outline-none focus:border-mc-accent font-mono text-sm"
                  autoFocus
                />
                <p className="text-xs text-mc-text-secondary mt-2">
                  Tip: most projects live under a <span className="font-mono">CODE/</span> folder (e.g. <span className="font-mono">/home/vlad-plk/clients/&lt;project&gt;/CODE/</span>).
                </p>
              </div>

              {folderError && (
                <div className="text-mc-accent-red text-sm">{folderError}</div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setFolderPath('');
                    setFolderError(null);
                  }}
                  className="px-4 py-2 text-mc-text-secondary hover:text-mc-text"
                  disabled={folderSaving}
                  title="Clear the saved path"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => setShowFolderModal(false)}
                  className="px-4 py-2 text-mc-text-secondary hover:text-mc-text"
                  disabled={folderSaving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveFolderPath}
                  className="px-6 py-2 bg-mc-accent text-mc-bg rounded-lg font-medium hover:bg-mc-accent/90 disabled:opacity-50"
                  disabled={folderSaving}
                >
                  {folderSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
