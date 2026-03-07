/**
 * NeuroVerse Adapter — OpenClaw
 *
 * Integrates NeuroVerse governance as an OpenClaw plugin.
 * Provides pre-action and post-action governance hooks that
 * evaluate agent actions against a world definition.
 *
 * Usage:
 *   import { createNeuroVersePlugin } from 'neuroverse-governance/adapters/openclaw';
 *
 *   const plugin = await createNeuroVersePlugin('./world/');
 *   agent.use(plugin);
 */

import type { GuardEvent, GuardVerdict, GuardEngineOptions } from '../contracts/guard-contract';
import type { PlanDefinition, PlanProgress } from '../contracts/plan-contract';
import type { WorldDefinition } from '../types';
import { evaluateGuard } from '../engine/guard-engine';
import { evaluatePlan, advancePlan, getPlanProgress } from '../engine/plan-engine';
import { loadWorld } from '../loader/world-loader';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Generic agent action shape (OpenClaw-compatible). */
export interface AgentAction {
  type: string;
  tool?: string;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/** Plugin hook result. */
export interface HookResult {
  allowed: boolean;
  verdict: GuardVerdict;
  action: AgentAction;
}

export interface NeuroVersePluginOptions {
  /** Include full evaluation trace. Default: false. */
  trace?: boolean;

  /** Enforcement level override. */
  level?: 'basic' | 'standard' | 'strict';

  /** Called for every evaluation. */
  onEvaluate?: (result: HookResult) => void;

  /** Custom action → GuardEvent mapping. */
  mapAction?: (action: AgentAction, direction: 'input' | 'output') => GuardEvent;

  /** Whether to evaluate output actions (post-action). Default: false. */
  evaluateOutputs?: boolean;

  /** Active plan overlay for task-scoped governance. */
  plan?: PlanDefinition;

  /** Called when plan progress changes. */
  onPlanProgress?: (progress: PlanProgress) => void;

  /** Called when all plan steps are completed. */
  onPlanComplete?: () => void;
}

export class GovernanceBlockedError extends Error {
  public readonly verdict: GuardVerdict;
  public readonly action: AgentAction;

  constructor(verdict: GuardVerdict, action: AgentAction) {
    super(`[NeuroVerse] BLOCKED: ${verdict.reason ?? verdict.ruleId ?? 'governance rule'}`);
    this.name = 'GovernanceBlockedError';
    this.verdict = verdict;
    this.action = action;
  }
}

// ─── Default Mapping ────────────────────────────────────────────────────────

function defaultMapAction(action: AgentAction, direction: 'input' | 'output'): GuardEvent {
  return {
    intent: action.type,
    tool: action.tool ?? action.type,
    args: action.input,
    direction,
    scope: typeof action.input?.path === 'string'
      ? action.input.path
      : typeof action.input?.url === 'string'
        ? action.input.url
        : undefined,
  };
}

// ─── Plugin ─────────────────────────────────────────────────────────────────

/**
 * NeuroVerse governance plugin for OpenClaw agents.
 *
 * Provides two hooks:
 * - beforeAction: evaluates before the agent executes an action
 * - afterAction: optionally evaluates outputs for post-action governance
 */
export class NeuroVersePlugin {
  public readonly name = 'neuroverse-governance';

  private world: WorldDefinition;
  private options: NeuroVersePluginOptions;
  private engineOptions: GuardEngineOptions;
  private mapAction: (action: AgentAction, direction: 'input' | 'output') => GuardEvent;
  private activePlan?: PlanDefinition;

  constructor(world: WorldDefinition, options: NeuroVersePluginOptions = {}) {
    this.world = world;
    this.options = options;
    this.activePlan = options.plan;
    this.engineOptions = {
      trace: options.trace ?? false,
      level: options.level,
      plan: this.activePlan,
    };
    this.mapAction = options.mapAction ?? defaultMapAction;
  }

  /**
   * Evaluate an action before execution.
   *
   * @throws GovernanceBlockedError if BLOCKED
   * @returns HookResult with verdict details
   */
  beforeAction(action: AgentAction): HookResult {
    const event = this.mapAction(action, 'input');
    this.engineOptions.plan = this.activePlan;
    const verdict = evaluateGuard(event, this.world, this.engineOptions);

    const result: HookResult = {
      allowed: verdict.status === 'ALLOW',
      verdict,
      action,
    };

    this.options.onEvaluate?.(result);

    if (verdict.status === 'BLOCK') {
      throw new GovernanceBlockedError(verdict, action);
    }

    // Track plan progress on ALLOW
    if (verdict.status === 'ALLOW' && this.activePlan) {
      const planVerdict = evaluatePlan(event, this.activePlan);
      if (planVerdict.matchedStep) {
        this.activePlan = advancePlan(this.activePlan, planVerdict.matchedStep);
        this.engineOptions.plan = this.activePlan;
        const progress = getPlanProgress(this.activePlan);
        this.options.onPlanProgress?.(progress);
        if (progress.completed === progress.total) {
          this.options.onPlanComplete?.();
        }
      }
    }

    return result;
  }

  /**
   * Evaluate an action's output (post-execution governance).
   * Only runs if evaluateOutputs is enabled.
   *
   * @returns HookResult or null if output evaluation is disabled
   */
  afterAction(action: AgentAction, _output?: unknown): HookResult | null {
    if (!this.options.evaluateOutputs) return null;

    const event = this.mapAction(action, 'output');
    const verdict = evaluateGuard(event, this.world, this.engineOptions);

    const result: HookResult = {
      allowed: verdict.status === 'ALLOW',
      verdict,
      action,
    };

    this.options.onEvaluate?.(result);

    if (verdict.status === 'BLOCK') {
      throw new GovernanceBlockedError(verdict, action);
    }

    return result;
  }

  /**
   * Get the plugin hooks object for agent.use().
   */
  hooks() {
    return {
      beforeAction: (action: AgentAction) => this.beforeAction(action),
      afterAction: (action: AgentAction, output?: unknown) => this.afterAction(action, output),
    };
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a NeuroVerse plugin from a world path.
 */
export async function createNeuroVersePlugin(
  worldPath: string,
  options?: NeuroVersePluginOptions,
): Promise<NeuroVersePlugin> {
  const world = await loadWorld(worldPath);
  return new NeuroVersePlugin(world, options);
}

/**
 * Create a NeuroVerse plugin from a pre-loaded world.
 */
export function createNeuroVersePluginFromWorld(
  world: WorldDefinition,
  options?: NeuroVersePluginOptions,
): NeuroVersePlugin {
  return new NeuroVersePlugin(world, options);
}
