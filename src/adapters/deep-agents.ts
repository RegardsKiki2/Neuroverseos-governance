/**
 * NeuroVerse Adapter — Deep Agents (LangChain)
 *
 * Intercepts tool execution in LangChain's Deep Agents framework
 * and evaluates every action against a NeuroVerse world definition
 * before allowing it to proceed.
 *
 * Deep Agents exposes a coding-agent loop with tools for file I/O,
 * shell execution, sub-agent spawning, and context management.
 * This adapter sits between the agent and those tools, enforcing
 * governance rules deterministically.
 *
 * Usage:
 *   import { createDeepAgentsGuard } from '@neuroverseos/governance/adapters/deep-agents';
 *
 *   const guard = await createDeepAgentsGuard('./world/');
 *
 *   // Wrap the agent's tool executor:
 *   agent.use(guard.middleware());
 *
 *   // Or evaluate manually:
 *   const verdict = guard.evaluate({ tool: 'shell', command: 'rm -rf /' });
 */

import type { GuardEvent, GuardVerdict, GuardEngineOptions } from '../contracts/guard-contract';
import type { PlanDefinition, PlanProgress } from '../contracts/plan-contract';
import type { WorldDefinition } from '../types';
import { evaluateGuard } from '../engine/guard-engine';
import { evaluatePlan, advancePlan, getPlanProgress } from '../engine/plan-engine';
import { loadWorld } from '../loader/world-loader';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Shape of a Deep Agents tool invocation. */
export interface DeepAgentsToolCall {
  /** Tool name: read_file, write_file, shell, edit_file, sub_agent, etc. */
  tool: string;
  /** Tool arguments as passed by the agent. */
  args: Record<string, unknown>;
  /** Optional run/session identifier. */
  runId?: string;
}

/** Categorized tool types recognized by the adapter. */
export type DeepAgentsToolCategory =
  | 'file_read'
  | 'file_write'
  | 'file_delete'
  | 'shell'
  | 'git'
  | 'network'
  | 'sub_agent'
  | 'context'
  | 'unknown';

/** Result of a governed evaluation. */
export interface DeepAgentsGuardResult {
  allowed: boolean;
  verdict: GuardVerdict;
  toolCall: DeepAgentsToolCall;
  category: DeepAgentsToolCategory;
}

export interface DeepAgentsGuardOptions {
  /** Include full evaluation trace in verdicts. Default: false. */
  trace?: boolean;

  /** Enforcement level override. */
  level?: 'basic' | 'standard' | 'strict';

  /** Called when an action is blocked. */
  onBlock?: (result: DeepAgentsGuardResult) => void;

  /** Called when an action requires approval. Return true to allow. */
  onPause?: (result: DeepAgentsGuardResult) => Promise<boolean> | boolean;

  /** Called for every evaluation (logging hook). */
  onEvaluate?: (result: DeepAgentsGuardResult) => void;

  /** Custom mapping from Deep Agents tool call to GuardEvent. */
  mapToolCall?: (toolCall: DeepAgentsToolCall) => GuardEvent;

  /** Active plan overlay for task-scoped governance. */
  plan?: PlanDefinition;

  /** Called when plan progress changes. */
  onPlanProgress?: (progress: PlanProgress) => void;

  /** Called when all plan steps are completed. */
  onPlanComplete?: () => void;
}

export class GovernanceBlockedError extends Error {
  public readonly verdict: GuardVerdict;
  public readonly toolCall: DeepAgentsToolCall;
  public readonly category: DeepAgentsToolCategory;

  constructor(verdict: GuardVerdict, toolCall: DeepAgentsToolCall, category: DeepAgentsToolCategory) {
    super(`[NeuroVerse] BLOCKED: ${verdict.reason ?? verdict.ruleId ?? 'governance rule'}`);
    this.name = 'GovernanceBlockedError';
    this.verdict = verdict;
    this.toolCall = toolCall;
    this.category = category;
  }
}

// ─── Tool Classification ────────────────────────────────────────────────────

/** Known tool names in the Deep Agents framework mapped to categories. */
const TOOL_CATEGORY_MAP: Record<string, DeepAgentsToolCategory> = {
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

function classifyTool(toolName: string): DeepAgentsToolCategory {
  const normalized = toolName.toLowerCase().replace(/[-\s]/g, '_');
  return TOOL_CATEGORY_MAP[normalized] ?? 'unknown';
}

// ─── Dangerous Command Patterns ─────────────────────────────────────────────

const DANGEROUS_SHELL_PATTERNS: { pattern: RegExp; label: string }[] = [
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

const DANGEROUS_GIT_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /push\s+.*--force/, label: 'force-push' },
  { pattern: /push\s+.*-f\b/, label: 'force-push' },
  { pattern: /push\s+(origin\s+)?main\b/, label: 'push-main' },
  { pattern: /push\s+(origin\s+)?master\b/, label: 'push-master' },
  { pattern: /reset\s+--hard/, label: 'hard-reset' },
  { pattern: /clean\s+-fd/, label: 'clean-force' },
  { pattern: /branch\s+-D/, label: 'force-delete-branch' },
];

// ─── Default Tool → GuardEvent Mapping ──────────────────────────────────────

function defaultMapToolCall(toolCall: DeepAgentsToolCall): GuardEvent {
  const category = classifyTool(toolCall.tool);
  const args = toolCall.args;

  // Extract scope (file path, URL, or command)
  let scope: string | undefined;
  if (typeof args.path === 'string') scope = args.path;
  else if (typeof args.file_path === 'string') scope = args.file_path;
  else if (typeof args.filename === 'string') scope = args.filename;
  else if (typeof args.url === 'string') scope = args.url;
  else if (typeof args.command === 'string') scope = args.command;

  // Build intent string that the guard engine can match against
  let intent = toolCall.tool;
  if (category === 'shell' && typeof args.command === 'string') {
    intent = `shell: ${args.command}`;
  } else if (category === 'git' && typeof args.command === 'string') {
    intent = `git ${args.command}`;
  } else if (category === 'file_write' && scope) {
    intent = `write ${scope}`;
  } else if (category === 'file_delete' && scope) {
    intent = `delete ${scope}`;
  }

  // Determine risk level
  let riskLevel: 'low' | 'medium' | 'high' | undefined;
  if (category === 'file_read' || category === 'context') {
    riskLevel = 'low';
  } else if (category === 'file_write' || category === 'sub_agent') {
    riskLevel = 'medium';
  } else if (category === 'shell' || category === 'file_delete' || category === 'git' || category === 'network') {
    riskLevel = 'high';
  }

  // Check for dangerous patterns
  let irreversible = false;
  if (category === 'shell' && typeof args.command === 'string') {
    irreversible = DANGEROUS_SHELL_PATTERNS.some(p => p.test(args.command as string));
  } else if ((category === 'git') && typeof args.command === 'string') {
    irreversible = DANGEROUS_GIT_PATTERNS.some(p => p.test(args.command as string));
  } else if (category === 'file_delete') {
    irreversible = true;
  }

  return {
    intent,
    tool: toolCall.tool,
    scope,
    args,
    direction: 'input',
    actionCategory: category,
    riskLevel,
    irreversible,
  };
}

// ─── Deep Agents Guard ──────────────────────────────────────────────────────

/**
 * NeuroVerse governance guard for LangChain Deep Agents.
 *
 * Evaluates every tool invocation against a world definition before
 * allowing execution. Supports blocking, pausing (approval required),
 * and plan-scoped governance.
 */
export class DeepAgentsGuard {
  public readonly name = 'neuroverse-deep-agents-guard';

  private world: WorldDefinition;
  private options: DeepAgentsGuardOptions;
  private engineOptions: GuardEngineOptions;
  private mapToolCall: (toolCall: DeepAgentsToolCall) => GuardEvent;
  private activePlan?: PlanDefinition;

  constructor(world: WorldDefinition, options: DeepAgentsGuardOptions = {}) {
    this.world = world;
    this.options = options;
    this.activePlan = options.plan;
    this.engineOptions = {
      trace: options.trace ?? false,
      level: options.level,
      plan: this.activePlan,
    };
    this.mapToolCall = options.mapToolCall ?? defaultMapToolCall;
  }

  /**
   * Evaluate a tool call against governance rules.
   * Returns the result without side effects.
   */
  evaluate(toolCall: DeepAgentsToolCall): DeepAgentsGuardResult {
    const event = this.mapToolCall(toolCall);
    this.engineOptions.plan = this.activePlan;
    const verdict = evaluateGuard(event, this.world, this.engineOptions);
    const category = classifyTool(toolCall.tool);

    const result: DeepAgentsGuardResult = {
      allowed: verdict.status === 'ALLOW',
      verdict,
      toolCall,
      category,
    };

    this.options.onEvaluate?.(result);

    // Track plan progress on ALLOW
    if (verdict.status === 'ALLOW' && this.activePlan) {
      this.trackPlanProgress(event);
    }

    return result;
  }

  /**
   * Evaluate and enforce governance on a tool call.
   *
   * @throws GovernanceBlockedError if BLOCKED
   * @throws GovernanceBlockedError if PAUSED and onPause returns false
   * @returns DeepAgentsGuardResult on ALLOW
   */
  async enforce(toolCall: DeepAgentsToolCall): Promise<DeepAgentsGuardResult> {
    const result = this.evaluate(toolCall);

    if (result.verdict.status === 'BLOCK') {
      this.options.onBlock?.(result);
      throw new GovernanceBlockedError(result.verdict, toolCall, result.category);
    }

    if (result.verdict.status === 'PAUSE') {
      const approved = await this.options.onPause?.(result);
      if (!approved) {
        throw new GovernanceBlockedError(result.verdict, toolCall, result.category);
      }
    }

    return result;
  }

  /**
   * Evaluate and execute a tool call with governance enforcement.
   *
   * If ALLOW: runs the executor and returns its result.
   * If BLOCK: returns a governance-blocked message.
   * If PAUSE: calls onPause; blocks if not approved.
   *
   * @param toolCall - The Deep Agents tool call to evaluate
   * @param executor - The actual tool execution function
   * @returns The tool execution result or a blocked message
   */
  async execute<T>(
    toolCall: DeepAgentsToolCall,
    executor: (toolCall: DeepAgentsToolCall) => Promise<T>,
  ): Promise<{ result: T; verdict: GuardVerdict } | { blocked: true; verdict: GuardVerdict; reason: string }> {
    const guardResult = this.evaluate(toolCall);

    if (guardResult.verdict.status === 'BLOCK') {
      this.options.onBlock?.(guardResult);
      return {
        blocked: true,
        verdict: guardResult.verdict,
        reason: guardResult.verdict.reason ?? 'Action blocked by governance policy.',
      };
    }

    if (guardResult.verdict.status === 'PAUSE') {
      const approved = await this.options.onPause?.(guardResult);
      if (!approved) {
        return {
          blocked: true,
          verdict: guardResult.verdict,
          reason: guardResult.verdict.reason ?? 'Action requires approval.',
        };
      }
    }

    const result = await executor(toolCall);
    return { result, verdict: guardResult.verdict };
  }

  /**
   * Returns a middleware function compatible with Deep Agents' tool pipeline.
   *
   * The middleware intercepts tool calls before execution:
   *   agent.use(guard.middleware());
   */
  middleware(): (toolCall: DeepAgentsToolCall, next: () => Promise<unknown>) => Promise<unknown> {
    return async (toolCall: DeepAgentsToolCall, next: () => Promise<unknown>) => {
      await this.enforce(toolCall);
      return next();
    };
  }

  /**
   * Returns a callback-handler-style object for LangChain integration.
   * Compatible with Deep Agents' callback system.
   */
  callbacks() {
    return {
      handleToolStart: async (tool: { name: string }, input: string) => {
        let parsedInput: Record<string, unknown>;
        try {
          parsedInput = typeof input === 'string' ? JSON.parse(input) : input;
        } catch {
          parsedInput = { raw: input };
        }
        await this.enforce({ tool: tool.name, args: parsedInput });
      },
    };
  }

  /**
   * Check if a shell command contains dangerous patterns.
   * Useful for pre-screening before full governance evaluation.
   */
  static isDangerousCommand(command: string): { dangerous: boolean; labels: string[] } {
    const matched = DANGEROUS_SHELL_PATTERNS
      .filter(p => p.pattern.test(command))
      .map(p => p.label);
    return { dangerous: matched.length > 0, labels: matched };
  }

  /**
   * Check if a git command contains dangerous patterns.
   */
  static isDangerousGitCommand(command: string): { dangerous: boolean; labels: string[] } {
    const matched = DANGEROUS_GIT_PATTERNS
      .filter(p => p.pattern.test(command))
      .map(p => p.label);
    return { dangerous: matched.length > 0, labels: matched };
  }

  /**
   * Classify a tool name into a category.
   */
  static classifyTool(toolName: string): DeepAgentsToolCategory {
    return classifyTool(toolName);
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private trackPlanProgress(event: GuardEvent): void {
    if (!this.activePlan) return;

    const planVerdict = evaluatePlan(event, this.activePlan);
    if (planVerdict.matchedStep) {
      const advResult = advancePlan(this.activePlan, planVerdict.matchedStep);
      if (advResult.success && advResult.plan) {
        this.activePlan = advResult.plan;
        this.engineOptions.plan = this.activePlan;
      }
      const progress = getPlanProgress(this.activePlan);
      this.options.onPlanProgress?.(progress);
      if (progress.completed === progress.total) {
        this.options.onPlanComplete?.();
      }
    }
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a Deep Agents guard from a world path.
 *
 * @param worldPath - Path to world directory, .nv-world.md, or .nv-world.zip
 * @param options - Guard configuration
 * @returns A guard ready to plug into Deep Agents
 */
export async function createDeepAgentsGuard(
  worldPath: string,
  options?: DeepAgentsGuardOptions,
): Promise<DeepAgentsGuard> {
  const world = await loadWorld(worldPath);
  return new DeepAgentsGuard(world, options);
}

/**
 * Create a Deep Agents guard from a pre-loaded world.
 *
 * @param world - A loaded WorldDefinition
 * @param options - Guard configuration
 * @returns A guard ready to plug into Deep Agents
 */
export function createDeepAgentsGuardFromWorld(
  world: WorldDefinition,
  options?: DeepAgentsGuardOptions,
): DeepAgentsGuard {
  return new DeepAgentsGuard(world, options);
}
