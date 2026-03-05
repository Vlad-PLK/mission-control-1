import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';

export interface OpenCodeResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number | null;
  duration: number;
}

export interface OpenCodeOptions {
  workspaceDir: string;
  prompt: string;
  model?: string;
  timeout?: number;
}

const DEFAULT_TIMEOUT = 300000;

const CODING_KEYWORDS = [
  'code', 'implement', 'fix', 'bug', 'refactor', 'create', 'build',
  'add', 'update', 'modify', 'remove', 'delete', 'change', 'rewrite',
  'function', 'class', 'component', 'api', 'endpoint', 'database', 'schema',
  'file', 'script', 'test', 'feature', 'integration', 'config', 'setup',
  'deploy', 'migration', 'render', 'style', 'css', 'html', 'javascript',
  'typescript', 'react', 'next', 'node', 'python', 'api', 'backend', 'frontend'
];

export function isCodingTask(title: string, description?: string): boolean {
  const text = `${title} ${description || ''}`.toLowerCase();
  
  const matchCount = CODING_KEYWORDS.filter(keyword => text.includes(keyword)).length;
  
  return matchCount >= 1;
}

export function detectTaskType(title: string, description?: string): 'coding' | 'research' | 'general' {
  const text = `${title} ${description || ''}`.toLowerCase();
  
  const codingKeywords = CODING_KEYWORDS;
  const researchKeywords = ['research', 'analyze', 'investigate', 'review', 'audit', 'find', 'search', 'report', 'document', 'survey'];
  const generalKeywords = ['update', 'change', 'set', 'configure', 'enable', 'disable'];
  
  const codingScore = codingKeywords.filter(k => text.includes(k)).length;
  const researchScore = researchKeywords.filter(k => text.includes(k)).length;
  
  if (codingScore > 0 && codingScore >= researchScore) {
    return 'coding';
  }
  if (researchScore > 0 && researchScore > codingScore) {
    return 'research';
  }
  
  return 'general';
}

export async function runOpenCode(options: OpenCodeOptions): Promise<OpenCodeResult> {
  const { workspaceDir, prompt, model, timeout = DEFAULT_TIMEOUT } = options;
  const startTime = Date.now();
  
  return new Promise((resolve) => {
    const args = [
      'run',
      '--dir', workspaceDir,
      '--prompt', prompt,
      '--print-logs',
      '--thinking'
    ];
    
    if (model) {
      args.push('--model', model);
    }
    
    const opencode = spawn('opencode', args, {
      cwd: workspaceDir,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    opencode.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    opencode.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    const timeoutId = setTimeout(() => {
      opencode.kill('SIGTERM');
      resolve({
        success: false,
        output: stdout,
        error: `OpenCode timed out after ${timeout / 1000} seconds`,
        exitCode: null,
        duration: Date.now() - startTime
      });
    }, timeout);
    
    opencode.on('close', (code) => {
      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      
      if (code === 0) {
        resolve({
          success: true,
          output: stdout,
          exitCode: code,
          duration
        });
      } else {
        resolve({
          success: false,
          output: stdout,
          error: stderr || `OpenCode exited with code ${code}`,
          exitCode: code,
          duration
        });
      }
    });
    
    opencode.on('error', (err) => {
      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      resolve({
        success: false,
        output: '',
        error: `Failed to spawn opencode: ${err.message}`,
        exitCode: null,
        duration
      });
    });
  });
}

export async function runOpenCodePlanning(workspaceDir: string, taskContext: string, timeout?: number): Promise<OpenCodeResult> {
  const planningPrompt = `You are in PLANNING MODE for the following task:

${taskContext}

Think step by step about how to approach this task. Consider:
1. What files need to be modified or created?
2. What is the best approach to implement this?
3. Are there any dependencies or prerequisites?
4. What could go wrong?

Provide a detailed execution plan. Be specific about file paths and implementation details.`;

  return runOpenCode({
    workspaceDir,
    prompt: planningPrompt,
    timeout
  });
}

export async function runOpenCodeBuild(workspaceDir: string, taskContext: string, timeout?: number): Promise<OpenCodeResult> {
  const buildPrompt = `You are in BUILD MODE. Execute the following task:

${taskContext}

IMPORTANT:
- Work in the current directory: ${workspaceDir}
- Make actual code changes using the write and edit tools
- Run tests if available
- Verify your changes work correctly
- When complete, summarize what was done`;

  return runOpenCode({
    workspaceDir,
    prompt: buildPrompt,
    timeout
  });
}

export function buildOpenCodePrompt(
  title: string,
  description: string,
  workspaceDir: string,
  options?: {
    planningSpec?: { success_criteria?: string[]; deliverables?: string[] };
    groupContext?: string;
    blockingTasks?: Array<{ title: string; status: string }>;
  }
): string {
  const parts: string[] = [];
  
  parts.push(`# TASK: ${title}`);
  parts.push(`\n## Description\n${description}`);
  parts.push(`\n## Working Directory\n${workspaceDir}`);
  
  if (options?.planningSpec) {
    if (options.planningSpec.success_criteria?.length) {
      parts.push(`\n## Success Criteria\n${options.planningSpec.success_criteria.map(c => `- ${c}`).join('\n')}`);
    }
    if (options.planningSpec.deliverables?.length) {
      parts.push(`\n## Expected Deliverables\n${options.planningSpec.deliverables.map(d => `- ${d}`).join('\n')}`);
    }
  }
  
  if (options?.groupContext) {
    parts.push(`\n## Context\n${options.groupContext}`);
  }
  
  if (options?.blockingTasks?.length) {
    parts.push(`\n## Prerequisites\nThese tasks must be completed first:\n${options.blockingTasks.map(t => `- ${t.title} [${t.status}]`).join('\n')}`);
  }
  
  parts.push(`\n\n## Your Approach\nThink through this step by step, then execute.`);
  
  return parts.join('');
}
