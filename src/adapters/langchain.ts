/**
 * NeuroVerse Adapter — LangChain
 *
 * Wraps the governance engine as a LangChain tool-calling middleware.
 * Intercepts tool invocations and evaluates them against a world definition
 * before allowing execution to proceed.
 *
 * Usage:
 *   import { createNeuroVerseCallbackHandler } from 'neuroverse-governance/adapters/langchain';
 *
 *   const handler = await createNeuroVerseCallbackHandler('./world/', {
 *     onBlock: (verdict) => console.log('Blocked:', verdict.reason),
 *     onPause: (verdict) => requestHumanApproval(verdict),
 *   });
 *
 *   const agent = new AgentExecutor({ ..., callbacks: [handler] });
 */

import type { GuardEvent, GuardVerdict, GuardEngineOptions } from '../contracts/guard-contract';
import type { PlanDefinition, PlanProgress } from '../contracts/plan-contract';
import type { WorldDefinition } from '../types';
import { evaluateGuard } from '../engine/guard-engine';
import { evaluatePlan, advancePlan, getPlanProgress } from '../engine/plan-engine';
import { loadWorld } from '../loader/world-loader';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface NeuroVerseHandlerOptions {
  /** Include full evaluation trace in verdicts. Default: false. */
  trace?: boolean;

  /** Enforcement level override. */
  level?: 'basic' | 'standard' | 'strict';

  /** Called when an action is blocked. */
  onBlock?: (verdict: GuardVerdict, event: GuardEvent) => void;

  /** Called when an action requires approval. Return true to allow. */
  onPause?: (verdict: GuardVerdict, event: GuardEvent) => Promise<boolean> | boolean;

  /** Called for every evaluation (logging hook). */
  onEvaluate?: (verdict: GuardVerdict, event: GuardEvent) => void;

  /** Map a tool call to a GuardEvent. Override for custom tool shapes. */
  mapToolCall?: (toolName: string, toolInput: Record<string, unknown>) => GuardEvent;

  /** Active plan overlay for task-scoped governance. */
  plan?: PlanDefinition;

  /** Called when plan progress changes. */
  onPlanProgress?: (progress: PlanProgress) => void;

  /** Called when all plan steps are completed. */
  onPlanComplete?: () => void;
}

export class GovernanceBlockedError extends Error {
  public readonly verdict: GuardVerdict;
  public readonly event: GuardEvent;

  constructor(verdict: GuardVerdict, event: GuardEvent) {
    super(`[NeuroVerse] BLOCKED: ${verdict.reason ?? verdict.ruleId ?? 'governance rule'}`);
    this.name = 'GovernanceBlockedError';
    this.verdict = verdict;
    this.event = event;
  }
}

// ─── Default Tool → GuardEvent Mapping ──────────────────────────────────────

function defaultMapToolCall(toolName: string, toolInput: Record<string, unknown>): GuardEvent {
  return {
    intent: toolName,
    tool: toolName,
    scope: typeof toolInput.path === 'string'
      ? toolInput.path
      : typeof toolInput.url === 'string'
        ? toolInput.url
        : undefined,
    args: toolInput,
    direction: 'input',
  };
}

// ─── Callback Handler ───────────────────────────────────────────────────────

/**
 * A LangChain-compatible callback handler that evaluates tool calls
 * against a NeuroVerse world definition.
 *
 * Implements the BaseCallbackHandler interface shape so it can be
 * passed directly into LangChain's callbacks array.
 */
export class NeuroVerseCallbackHandler {
  public readonly name = 'NeuroVerseGovernance';

  private world: WorldDefinition;
  private options: NeuroVerseHandlerOptions;
  private engineOptions: GuardEngineOptions;
  private mapToolCall: (toolName: string, toolInput: Record<string, unknown>) => GuardEvent;
  private activePlan?: PlanDefinition;

  constructor(world: WorldDefinition, options: NeuroVerseHandlerOptions = {}) {
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
   * Called before a tool is executed.
   * Evaluates the tool call against the governance world.
   *
   * @throws GovernanceBlockedError if the action is BLOCKED
   * @throws GovernanceBlockedError if the action is PAUSED and onPause returns false
   */
  async handleToolStart(
    tool: { name: string },
    input: string,
  ): Promise<void> {
    let parsedInput: Record<string, unknown>;
    try {
      parsedInput = typeof input === 'string' ? JSON.parse(input) : input;
    } catch {
      parsedInput = { raw: input };
    }

    const event = this.mapToolCall(tool.name, parsedInput);
    this.engineOptions.plan = this.activePlan;
    const verdict = evaluateGuard(event, this.world, this.engineOptions);

    this.options.onEvaluate?.(verdict, event);

    if (verdict.status === 'BLOCK') {
      this.options.onBlock?.(verdict, event);
      throw new GovernanceBlockedError(verdict, event);
    }

    if (verdict.status === 'PAUSE') {
      const approved = await this.options.onPause?.(verdict, event);
      if (!approved) {
        throw new GovernanceBlockedError(verdict, event);
      }
    }

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
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a NeuroVerse callback handler from a world path.
 *
 * @param worldPath - Path to world directory or .nv-world.zip
 * @param options - Handler configuration
 * @returns A callback handler ready to plug into LangChain
 */
export async function createNeuroVerseCallbackHandler(
  worldPath: string,
  options?: NeuroVerseHandlerOptions,
): Promise<NeuroVerseCallbackHandler> {
  const world = await loadWorld(worldPath);
  return new NeuroVerseCallbackHandler(world, options);
}

/**
 * Create a NeuroVerse callback handler from a pre-loaded world.
 *
 * @param world - A loaded WorldDefinition
 * @param options - Handler configuration
 * @returns A callback handler ready to plug into LangChain
 */
export function createNeuroVerseCallbackHandlerFromWorld(
  world: WorldDefinition,
  options?: NeuroVerseHandlerOptions,
): NeuroVerseCallbackHandler {
  return new NeuroVerseCallbackHandler(world, options);
}
