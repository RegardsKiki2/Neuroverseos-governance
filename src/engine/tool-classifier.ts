/**
 * Centralized Tool Classification & Risk Pattern Detection
 *
 * Extracted from deep-agents.ts where it was the only adapter
 * with comprehensive tool classification and dangerous command
 * detection. Now available to all adapters and the core engine.
 */

// ─── Tool Categories ────────────────────────────────────────────────────────

export type ToolCategory =
  | 'file_read'
  | 'file_write'
  | 'file_delete'
  | 'shell'
  | 'git'
  | 'network'
  | 'sub_agent'
  | 'context'
  | 'unknown';

/** Known tool names mapped to categories. */
const TOOL_CATEGORY_MAP: Record<string, ToolCategory> = {
  // File operations
  read_file: 'file_read',
  read: 'file_read',
  glob: 'file_read',
  grep: 'file_read',
  list_files: 'file_read',
  write_file: 'file_write',
  write: 'file_write',
  create_file: 'file_write',
  edit_file: 'file_write',
  edit: 'file_write',
  patch: 'file_write',
  delete_file: 'file_delete',
  remove_file: 'file_delete',
  // Shell
  shell: 'shell',
  bash: 'shell',
  execute: 'shell',
  run_command: 'shell',
  terminal: 'shell',
  // Git
  git: 'git',
  git_commit: 'git',
  git_push: 'git',
  git_checkout: 'git',
  // Network
  http: 'network',
  fetch: 'network',
  curl: 'network',
  web_search: 'network',
  // Sub-agents
  sub_agent: 'sub_agent',
  spawn_agent: 'sub_agent',
  delegate: 'sub_agent',
  // Context management
  summarize: 'context',
  compress_context: 'context',
};

/**
 * Classify a tool name into a category.
 * Normalizes dashes/spaces to underscores and lowercases.
 */
export function classifyTool(toolName: string): ToolCategory {
  const normalized = toolName.toLowerCase().replace(/[-\s]/g, '_');
  return TOOL_CATEGORY_MAP[normalized] ?? 'unknown';
}

// ─── Dangerous Command Patterns ─────────────────────────────────────────────

interface DangerousPattern {
  pattern: RegExp;
  label: string;
}

export const DANGEROUS_SHELL_PATTERNS: DangerousPattern[] = [
  { pattern: /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|.*-rf\s+|.*--force)/, label: 'force-delete' },
  { pattern: /rm\s+-[a-zA-Z]*r/, label: 'recursive-delete' },
  { pattern: />\s*\/dev\/sd/, label: 'disk-overwrite' },
  { pattern: /mkfs\./, label: 'format-disk' },
  { pattern: /dd\s+if=/, label: 'disk-dump' },
  { pattern: /chmod\s+(-R\s+)?777/, label: 'world-writable' },
  { pattern: /curl\s+.*\|\s*(bash|sh|zsh)/, label: 'pipe-to-shell' },
  { pattern: /wget\s+.*\|\s*(bash|sh|zsh)/, label: 'pipe-to-shell' },
  { pattern: /:(){ :\|:& };:/, label: 'fork-bomb' },
  { pattern: />\s*\/etc\//, label: 'system-config-overwrite' },
  { pattern: /shutdown|reboot|halt|poweroff/, label: 'system-shutdown' },
  { pattern: /kill\s+-9\s+1\b/, label: 'kill-init' },
];

export const DANGEROUS_GIT_PATTERNS: DangerousPattern[] = [
  { pattern: /push\s+.*--force/, label: 'force-push' },
  { pattern: /push\s+.*-f\b/, label: 'force-push' },
  { pattern: /push\s+(origin\s+)?main\b/, label: 'push-main' },
  { pattern: /push\s+(origin\s+)?master\b/, label: 'push-master' },
  { pattern: /reset\s+--hard/, label: 'hard-reset' },
  { pattern: /clean\s+-fd/, label: 'clean-force' },
  { pattern: /branch\s+-D/, label: 'force-delete-branch' },
];

/**
 * Check if a shell command contains dangerous patterns.
 */
export function isDangerousCommand(command: string): { dangerous: boolean; labels: string[] } {
  const matched = DANGEROUS_SHELL_PATTERNS
    .filter(p => p.pattern.test(command))
    .map(p => p.label);
  return { dangerous: matched.length > 0, labels: matched };
}

/**
 * Check if a git command contains dangerous patterns.
 */
export function isDangerousGitCommand(command: string): { dangerous: boolean; labels: string[] } {
  const matched = DANGEROUS_GIT_PATTERNS
    .filter(p => p.pattern.test(command))
    .map(p => p.label);
  return { dangerous: matched.length > 0, labels: matched };
}

// ─── Risk Level Assessment ──────────────────────────────────────────────────

/**
 * Determine risk level based on tool category.
 */
export function assessRiskLevel(category: ToolCategory): 'low' | 'medium' | 'high' | undefined {
  if (category === 'file_read' || category === 'context') return 'low';
  if (category === 'file_write' || category === 'sub_agent') return 'medium';
  if (category === 'shell' || category === 'file_delete' || category === 'git' || category === 'network') return 'high';
  return undefined;
}

/**
 * Map tool category to an action category string for GuardEvent.
 */
export function categoryToActionCategory(
  category: ToolCategory,
): 'read' | 'write' | 'delete' | 'shell' | 'network' | 'other' {
  if (category === 'file_read' || category === 'context') return 'read';
  if (category === 'file_write') return 'write';
  if (category === 'file_delete') return 'delete';
  if (category === 'shell') return 'shell';
  if (category === 'network') return 'network';
  return 'other';
}
