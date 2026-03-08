/**
 * NeuroVerse Adapter — OpenAI
 *
 * Wraps the governance engine as middleware for OpenAI function calling.
 * Evaluates function/tool calls against a world definition before execution.
 *
 * Usage:
 *   import { createGovernedToolExecutor } from 'neuroverse-governance/adapters/openai';
 *
 *   const executor = await createGovernedToolExecutor('./world/');
 *
 *   // In your tool execution loop:
 *   for (const toolCall of message.tool_calls) {
 *     const result = await executor.execute(toolCall, myToolRunner);
 *   }
 */

import type { GuardEvent, GuardVerdict, GuardEngineOptions } from '../contracts/guard-contract';
import type { PlanDefinition, PlanProgress } from '../contracts/plan-contract';
import type { WorldDefinition } from '../types';
import { evaluateGuard } from '../engine/guard-engine';
import { evaluatePlan, advancePlan, getPlanProgress } from '../engine/plan-engine';
import { loadWorld } from '../loader/world-loader';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Shape of an OpenAI tool call (from chat completions response). */
export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/** Result of a governed tool execution. */
export interface GovernedToolResult {
  tool_call_id: string;
  role: 'tool';
  content: string;
  /** The governance verdict for this tool call. */
  _verdict: GuardVerdict;
}

export interface GovernedExecutorOptions {
  /** Include full evaluation trace in verdicts. Default: false. */
  trace?: boolean;

  /** Enforcement level override. */
  level?: 'basic' | 'standard' | 'strict';

  /** Called for every evaluation (logging hook). */
  onEvaluate?: (verdict: GuardVerdict, event: GuardEvent) => void;

  /** Custom mapping from function call to GuardEvent. */
  mapFunctionCall?: (name: string, args: Record<string, unknown>) => GuardEvent;

  /** Message returned to the model when a tool call is blocked. */
  blockMessage?: (verdict: GuardVerdict) => string;

  /** Active plan overlay for task-scoped governance. */
  plan?: PlanDefinition;

  /** Called when plan progress changes. */
  onPlanProgress?: (progress: PlanProgress) => void;

  /** Called when all plan steps are completed. */
  onPlanComplete?: () => void;
}

export class GovernanceBlockedError extends Error {
  public readonly verdict: GuardVerdict;
  public readonly toolCallId: string;

  constructor(verdict: GuardVerdict, toolCallId: string) {
    super(`[NeuroVerse] BLOCKED: ${verdict.reason ?? verdict.ruleId ?? 'governance rule'}`);
    this.name = 'GovernanceBlockedError';
    this.verdict = verdict;
    this.toolCallId = toolCallId;
  }
}

// ─── Default Mapping ────────────────────────────────────────────────────────

function defaultMapFunctionCall(name: string, args: Record<string, unknown>): GuardEvent {
  return {
    intent: name,
    tool: name,
    scope: typeof args.path === 'string'
      ? args.path
      : typeof args.url === 'string'
        ? args.url
        : undefined,
    args,
    direction: 'input',
  };
}

function defaultBlockMessage(verdict: GuardVerdict): string {
  return `Action blocked by governance policy: ${verdict.reason ?? 'rule violation'}. Rule: ${verdict.ruleId ?? 'unknown'}.`;
}

// ─── Governed Tool Executor ─────────────────────────────────────────────────

/**
 * Wraps tool execution with NeuroVerse governance.
 * Evaluates each function call before allowing the tool runner to execute.
 */
export class GovernedToolExecutor {
  private world: WorldDefinition;
  private options: GovernedExecutorOptions;
  private engineOptions: GuardEngineOptions;
  private mapFn: (name: string, args: Record<string, unknown>) => GuardEvent;
  private blockMsg: (verdict: GuardVerdict) => string;
  private activePlan?: PlanDefinition;

  constructor(world: WorldDefinition, options: GovernedExecutorOptions = {}) {
    this.world = world;
    this.options = options;
    this.activePlan = options.plan;
    this.engineOptions = {
      trace: options.trace ?? false,
      level: options.level,
      plan: this.activePlan,
    };
    this.mapFn = options.mapFunctionCall ?? defaultMapFunctionCall;
    this.blockMsg = options.blockMessage ?? defaultBlockMessage;
  }

  /**
   * Evaluate a single tool call against governance rules.
   * Returns the verdict without executing the tool.
   */
  evaluate(toolCall: OpenAIToolCall): GuardVerdict {
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch {
      args = { raw: toolCall.function.arguments };
    }

    const event = this.mapFn(toolCall.function.name, args);
    this.engineOptions.plan = this.activePlan;
    const verdict = evaluateGuard(event, this.world, this.engineOptions);

    this.options.onEvaluate?.(verdict, event);

    // Track plan progress on ALLOW
    if (verdict.status === 'ALLOW' && this.activePlan) {
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

    return verdict;
  }

  /**
   * Execute a tool call with governance enforcement.
   *
   * If ALLOW: runs the tool and returns the result.
   * If BLOCK: returns a blocked message (no execution).
   * If PAUSE: throws — caller must handle approval flow.
   *
   * @param toolCall - The OpenAI tool call to evaluate
   * @param runner - The actual tool execution function
   * @returns A tool result message ready for the OpenAI API
   */
  async execute(
    toolCall: OpenAIToolCall,
    runner: (name: string, args: Record<string, unknown>) => Promise<string>,
  ): Promise<GovernedToolResult> {
    const verdict = this.evaluate(toolCall);

    if (verdict.status === 'BLOCK') {
      return {
        tool_call_id: toolCall.id,
        role: 'tool',
        content: this.blockMsg(verdict),
        _verdict: verdict,
      };
    }

    if (verdict.status === 'PAUSE') {
      throw new GovernanceBlockedError(verdict, toolCall.id);
    }

    // ALLOW — execute the tool
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch {
      args = { raw: toolCall.function.arguments };
    }

    const content = await runner(toolCall.function.name, args);

    return {
      tool_call_id: toolCall.id,
      role: 'tool',
      content,
      _verdict: verdict,
    };
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a governed tool executor from a world path.
 */
export async function createGovernedToolExecutor(
  worldPath: string,
  options?: GovernedExecutorOptions,
): Promise<GovernedToolExecutor> {
  const world = await loadWorld(worldPath);
  return new GovernedToolExecutor(world, options);
}

/**
 * Create a governed tool executor from a pre-loaded world.
 */
export function createGovernedToolExecutorFromWorld(
  world: WorldDefinition,
  options?: GovernedExecutorOptions,
): GovernedToolExecutor {
  return new GovernedToolExecutor(world, options);
}
