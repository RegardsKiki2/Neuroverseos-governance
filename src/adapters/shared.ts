/**
 * Shared Adapter Utilities
 *
 * Consolidates duplicated logic across adapters:
 *   - Plan progress tracking (was in openai, langchain, openclaw, deep-agents)
 *   - GovernanceBlockedError base class (was duplicated 4x)
 *   - Scope extraction from tool args (was in 3+ adapters)
 *   - Engine options initialization
 */

import type { GuardEvent, GuardVerdict, GuardEngineOptions } from '../contracts/guard-contract';
import type { PlanDefinition, PlanProgress } from '../contracts/plan-contract';
import { evaluatePlan, advancePlan, getPlanProgress } from '../engine/plan-engine';

// ─── GovernanceBlockedError (base) ──────────────────────────────────────────

/**
 * Base error thrown when governance blocks an action.
 * Each adapter extends this with framework-specific context fields.
 */
export class GovernanceBlockedError extends Error {
  public readonly verdict: GuardVerdict;

  constructor(verdict: GuardVerdict, message?: string) {
    super(message ?? `[NeuroVerse] BLOCKED: ${verdict.reason ?? verdict.ruleId ?? 'governance rule'}`);
    this.name = 'GovernanceBlockedError';
    this.verdict = verdict;
  }
}

// ─── Plan Progress Tracking ─────────────────────────────────────────────────

export interface PlanTrackingCallbacks {
  onPlanProgress?: (progress: PlanProgress) => void;
  onPlanComplete?: () => void;
}

export interface PlanTrackingState {
  activePlan?: PlanDefinition;
  engineOptions: GuardEngineOptions;
}

/**
 * Track plan progress after a successful (ALLOW) evaluation.
 * Mutates the plan tracking state in-place.
 *
 * Previously duplicated identically in:
 *   - deep-agents.ts:429-445
 *   - openai.ts:150-164
 *   - langchain.ts:152-166
 *   - openclaw.ts:147-161
 */
export function trackPlanProgress(
  event: GuardEvent,
  state: PlanTrackingState,
  callbacks: PlanTrackingCallbacks,
): void {
  if (!state.activePlan) return;

  const planVerdict = evaluatePlan(event, state.activePlan);
  if (planVerdict.matchedStep) {
    const advResult = advancePlan(state.activePlan, planVerdict.matchedStep);
    if (advResult.success && advResult.plan) {
      state.activePlan = advResult.plan;
      state.engineOptions.plan = state.activePlan;
    }
    const progress = getPlanProgress(state.activePlan);
    callbacks.onPlanProgress?.(progress);
    if (progress.completed === progress.total) {
      callbacks.onPlanComplete?.();
    }
  }
}

// ─── Scope Extraction ───────────────────────────────────────────────────────

/**
 * Extract the most relevant "scope" (file path, URL, or command)
 * from tool arguments.
 *
 * Previously duplicated in deep-agents.ts:189-195, langchain.ts:75-79,
 * openclaw.ts:85-89, openai.ts:90-94.
 */
export function extractScope(args: Record<string, unknown>): string | undefined {
  if (typeof args.path === 'string') return args.path;
  if (typeof args.file_path === 'string') return args.file_path;
  if (typeof args.filename === 'string') return args.filename;
  if (typeof args.url === 'string') return args.url;
  if (typeof args.command === 'string') return args.command;
  return undefined;
}

// ─── Engine Options Builder ─────────────────────────────────────────────────

export interface BaseAdapterOptions {
  trace?: boolean;
  level?: 'basic' | 'standard' | 'strict';
  plan?: PlanDefinition;
}

/**
 * Build GuardEngineOptions from common adapter options.
 * Previously duplicated in every adapter constructor.
 */
export function buildEngineOptions(options: BaseAdapterOptions, plan?: PlanDefinition): GuardEngineOptions {
  return {
    trace: options.trace ?? false,
    level: options.level,
    plan: plan ?? options.plan,
  };
}

// ─── Default Block Message ──────────────────────────────────────────────────

export function defaultBlockMessage(verdict: GuardVerdict): string {
  return `Action blocked by governance policy: ${verdict.reason ?? 'rule violation'}. Rule: ${verdict.ruleId ?? 'unknown'}.`;
}
