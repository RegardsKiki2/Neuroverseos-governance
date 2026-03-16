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
import { loadWorld } from '../loader/world-loader';
import {
  GovernanceBlockedError as BaseGovernanceBlockedError,
  trackPlanProgress,
  extractScope,
  buildEngineOptions,
} from './shared';
import type { PlanTrackingState, PlanTrackingCallbacks } from './shared';
import {
  classifyTool,
  DANGEROUS_SHELL_PATTERNS,
  DANGEROUS_GIT_PATTERNS,
  isDangerousCommand,
  isDangerousGitCommand,
  assessRiskLevel,
  categoryToActionCategory,
} from '../engine/tool-classifier';
import type { ToolCategory } from '../engine/tool-classifier';

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

/** Categorized tool types recognized by the adapter (re-exported from tool-classifier). */
export type DeepAgentsToolCategory = ToolCategory;

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

export class GovernanceBlockedError extends BaseGovernanceBlockedError {
  public readonly toolCall: DeepAgentsToolCall;
  public readonly category: DeepAgentsToolCategory;

  constructor(verdict: GuardVerdict, toolCall: DeepAgentsToolCall, category: DeepAgentsToolCategory) {
    super(verdict);
    this.toolCall = toolCall;
    this.category = category;
  }
}

// Tool classification and dangerous patterns are now centralized in engine/tool-classifier.ts

// ─── Default Tool → GuardEvent Mapping ──────────────────────────────────────

function defaultMapToolCall(toolCall: DeepAgentsToolCall): GuardEvent {
  const category = classifyTool(toolCall.tool);
  const args = toolCall.args;

  // Extract scope (file path, URL, or command)
  const scope = extractScope(args);

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
  const riskLevel = assessRiskLevel(category);

  // Check for dangerous patterns
  let irreversible = false;
  if (category === 'shell' && typeof args.command === 'string') {
    irreversible = DANGEROUS_SHELL_PATTERNS.some(p => p.pattern.test(args.command as string));
  } else if ((category === 'git') && typeof args.command === 'string') {
    irreversible = DANGEROUS_GIT_PATTERNS.some(p => p.pattern.test(args.command as string));
  } else if (category === 'file_delete') {
    irreversible = true;
  }

  return {
    intent,
    tool: toolCall.tool,
    scope,
    args,
    direction: 'input',
    actionCategory: categoryToActionCategory(category),
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
    this.engineOptions = buildEngineOptions(options, this.activePlan);
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
      this.trackPlanProgressInternal(event);
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
    return isDangerousCommand(command);
  }

  /**
   * Check if a git command contains dangerous patterns.
   */
  static isDangerousGitCommand(command: string): { dangerous: boolean; labels: string[] } {
    return isDangerousGitCommand(command);
  }

  /**
   * Classify a tool name into a category.
   */
  static classifyTool(toolName: string): DeepAgentsToolCategory {
    return classifyTool(toolName);
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private trackPlanProgressInternal(event: GuardEvent): void {
    trackPlanProgress(event, this, this.options);
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
