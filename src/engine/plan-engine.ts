/**
 * Plan Engine — Deterministic Plan Enforcement Evaluator
 *
 * Pure function: (event, plan) → PlanVerdict
 *
 * Evaluates a GuardEvent against a PlanDefinition to determine
 * whether the action is on-plan, off-plan, or violates constraints.
 *
 * Uses two-tier matching:
 *   Tier 1: Keyword + tag matching (fast, deterministic)
 *   Tier 2: Intent similarity scoring (precomputed vectors, no LLM)
 *
 * INVARIANTS:
 *   - Deterministic: same event + same plan → same verdict.
 *   - No LLM calls. No network calls.
 *   - Plans can only restrict, never expand.
 *   - OFF_PLAN always includes closest step for self-correction.
 */

import type { GuardEvent } from '../contracts/guard-contract';
import type {
  PlanDefinition,
  PlanStep,
  PlanVerdict,
  PlanProgress,
  PlanCheck,
  StepEvidence,
  AdvanceResult,
} from '../contracts/plan-contract';
import {
  normalizeEventText,
  extractKeywords,
  matchesKeywordThreshold,
  tokenSimilarity as computeTokenSimilarity,
} from './text-utils';

// ─── Keyword Matching ───────────────────────────────────────────────────────

/**
 * Match event text against a step using keywords and tags.
 * Requires at least half of significant keywords (>3 chars) to match.
 */
function keywordMatch(eventText: string, step: PlanStep): boolean {
  const stepText = [
    step.label,
    step.description ?? '',
    ...(step.tags ?? []),
  ].join(' ');

  return matchesKeywordThreshold(eventText, stepText, 0.5);
}

// ─── Similarity Scoring ─────────────────────────────────────────────────────

/**
 * Compute Jaccard token-overlap similarity between two strings.
 * Delegates to shared text-utils.
 */
function tokenSimilarity(a: string, b: string): number {
  return computeTokenSimilarity(a, b);
}

/**
 * Find the best matching step for an event.
 * Returns the matched step (if above threshold) and the closest step.
 */
function findMatchingStep(
  eventText: string,
  event: GuardEvent,
  steps: PlanStep[],
): { matched: PlanStep | null; closest: PlanStep | null; closestScore: number } {
  const pendingOrActive = steps.filter(s => s.status === 'pending' || s.status === 'active');
  if (pendingOrActive.length === 0) {
    return { matched: null, closest: null, closestScore: 0 };
  }

  // Tier 1: Keyword + tag matching
  for (const step of pendingOrActive) {
    if (keywordMatch(eventText, step)) {
      // Also check tool restriction
      if (step.tools && event.tool && !step.tools.includes(event.tool)) {
        continue;
      }
      return { matched: step, closest: step, closestScore: 1.0 };
    }
  }

  // Tier 2: Intent similarity scoring
  const intentText = [event.intent, event.tool ?? '', event.scope ?? ''].join(' ');
  let bestStep: PlanStep | null = null;
  let bestScore = 0;

  for (const step of pendingOrActive) {
    const stepText = [step.label, step.description ?? '', ...(step.tags ?? [])].join(' ');
    const score = tokenSimilarity(intentText, stepText);
    if (score > bestScore) {
      bestScore = score;
      bestStep = step;
    }
  }

  // Threshold for similarity match
  const SIMILARITY_THRESHOLD = 0.35;

  if (bestScore >= SIMILARITY_THRESHOLD && bestStep) {
    // Check tool restriction
    if (bestStep.tools && event.tool && !bestStep.tools.includes(event.tool)) {
      return { matched: null, closest: bestStep, closestScore: bestScore };
    }
    return { matched: bestStep, closest: bestStep, closestScore: bestScore };
  }

  return { matched: null, closest: bestStep, closestScore: bestScore };
}

// ─── Sequence Validation ────────────────────────────────────────────────────

function isSequenceValid(step: PlanStep, plan: PlanDefinition): boolean {
  if (!plan.sequential) return true;
  if (!step.requires || step.requires.length === 0) return true;

  return step.requires.every(reqId => {
    const reqStep = plan.steps.find(s => s.id === reqId);
    return reqStep?.status === 'completed';
  });
}

// ─── Constraint Checking ────────────────────────────────────────────────────

function checkConstraints(
  event: GuardEvent,
  eventText: string,
  constraints: PlanConstraint[],
): { violated: PlanConstraint | null; checks: PlanCheck['constraintsChecked'] } {
  const checks: PlanCheck['constraintsChecked'] = [];

  for (const constraint of constraints) {
    // Approval constraints always trigger PAUSE
    if (constraint.type === 'approval') {
      // Check if the constraint's trigger pattern is relevant
      if (constraint.trigger && eventText.includes(constraint.trigger.substring(0, 10).toLowerCase())) {
        checks.push({ constraintId: constraint.id, passed: false, reason: constraint.description });
        return { violated: constraint, checks };
      }
      // Match by keywords in the constraint description
      const keywords = constraint.description.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const relevant = keywords.some(kw => eventText.includes(kw));
      if (relevant) {
        checks.push({ constraintId: constraint.id, passed: false, reason: constraint.description });
        return { violated: constraint, checks };
      }
      checks.push({ constraintId: constraint.id, passed: true });
      continue;
    }

    // Scope constraints — check if action touches restricted areas
    if (constraint.type === 'scope' && constraint.trigger) {
      const keywords = extractKeywords(constraint.trigger);
      const violated = keywords.length > 0 && keywords.every(kw => eventText.includes(kw));
      checks.push({
        constraintId: constraint.id,
        passed: !violated,
        reason: violated ? constraint.description : undefined,
      });
      if (violated) {
        return { violated: constraint, checks };
      }
      continue;
    }

    // Budget/time constraints are informational at evaluation time
    // (actual enforcement requires external state tracking)
    checks.push({ constraintId: constraint.id, passed: true });
  }

  return { violated: null, checks };
}

// ─── Progress Calculation ───────────────────────────────────────────────────

/**
 * Get the current progress of a plan.
 */
export function getPlanProgress(plan: PlanDefinition): PlanProgress {
  const completed = plan.steps.filter(s => s.status === 'completed').length;
  const total = plan.steps.length;
  return {
    completed,
    total,
    percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
}

// ─── Plan Advancement ───────────────────────────────────────────────────────

/**
 * Mark a step as completed and return a new plan.
 * Does not mutate the original plan.
 *
 * Behavior depends on the plan's completion mode:
 *
 *   completion: 'trust' (default)
 *     Caller says "done", step advances. No evidence needed.
 *
 *   completion: 'verified'
 *     Steps with a `verify` field require evidence to advance.
 *     The evidence type must match the step's verify field.
 *     Steps without `verify` still advance on trust.
 *
 * @param plan     - The current plan (not mutated)
 * @param stepId   - Which step to advance
 * @param evidence - Proof of completion (required in verified mode for steps with verify)
 * @returns AdvanceResult with success flag and updated plan or reason
 */
export function advancePlan(
  plan: PlanDefinition,
  stepId: string,
  evidence?: StepEvidence,
): AdvanceResult {
  const step = plan.steps.find(s => s.id === stepId);

  if (!step) {
    return { success: false, reason: `Step "${stepId}" not found in plan.` };
  }

  if (step.status === 'completed') {
    return { success: false, reason: `Step "${stepId}" is already completed.` };
  }

  // In verified mode, steps with a `verify` field require evidence
  const mode = plan.completion ?? 'trust';

  if (mode === 'verified' && step.verify) {
    if (!evidence) {
      return {
        success: false,
        reason: `Step "${step.label}" requires evidence (verify: ${step.verify}). Provide evidence to advance.`,
      };
    }

    if (evidence.type !== step.verify) {
      return {
        success: false,
        reason: `Evidence type "${evidence.type}" does not match required verification "${step.verify}".`,
      };
    }
  }

  const updatedPlan: PlanDefinition = {
    ...plan,
    steps: plan.steps.map(s =>
      s.id === stepId ? { ...s, status: 'completed' as const } : s,
    ),
  };

  return {
    success: true,
    plan: updatedPlan,
    evidence: evidence ?? undefined,
  };
}

// ─── Core Evaluator ─────────────────────────────────────────────────────────

/**
 * Evaluate an event against a plan.
 *
 * Returns a PlanVerdict indicating whether the action is on-plan,
 * off-plan, violates constraints, or the plan is complete.
 */
export function evaluatePlan(
  event: GuardEvent,
  plan: PlanDefinition,
): PlanVerdict {
  const progress = getPlanProgress(plan);

  // Check plan expiry
  if (plan.expires_at) {
    const expiresAt = new Date(plan.expires_at).getTime();
    if (Date.now() > expiresAt) {
      return {
        allowed: true,
        status: 'PLAN_COMPLETE',
        reason: 'Plan has expired.',
        progress,
      };
    }
  }

  // Check if all steps complete
  if (progress.completed === progress.total) {
    return {
      allowed: true,
      status: 'PLAN_COMPLETE',
      reason: 'All plan steps are completed.',
      progress,
    };
  }

  // Normalize event text
  const eventText = normalizeEventText(event);

  // Match action to step
  const { matched, closest, closestScore } = findMatchingStep(eventText, event, plan.steps);

  if (!matched) {
    // OFF_PLAN — include closest step for self-correction
    return {
      allowed: false,
      status: 'OFF_PLAN',
      reason: 'Action does not match any plan step.',
      closestStep: closest?.label,
      similarityScore: closestScore,
      progress,
    };
  }

  // Check sequence
  if (!isSequenceValid(matched, plan)) {
    const pendingDeps = (matched.requires ?? [])
      .filter(reqId => plan.steps.find(s => s.id === reqId)?.status !== 'completed')
      .join(', ');
    return {
      allowed: false,
      status: 'OFF_PLAN',
      reason: `Step "${matched.label}" requires completion of: ${pendingDeps}`,
      matchedStep: matched.id,
      progress,
    };
  }

  // Check constraints
  const { violated } = checkConstraints(event, eventText, plan.constraints);
  if (violated) {
    return {
      allowed: false,
      status: 'CONSTRAINT_VIOLATED',
      reason: violated.description,
      matchedStep: matched.id,
      progress,
    };
  }

  // ON_PLAN
  return {
    allowed: true,
    status: 'ON_PLAN',
    reason: `Matches step: ${matched.label}`,
    matchedStep: matched.id,
    progress,
  };
}

// ─── Plan Check Builder (for EvaluationTrace) ───────────────────────────────

/**
 * Build a PlanCheck for inclusion in the guard engine's EvaluationTrace.
 */
export function buildPlanCheck(
  event: GuardEvent,
  plan: PlanDefinition,
  verdict: PlanVerdict,
): PlanCheck {
  const eventText = normalizeEventText(event);
  const { matched, closest, closestScore } = findMatchingStep(eventText, event, plan.steps);
  const { checks: constraintChecks } = checkConstraints(event, eventText, plan.constraints);
  const progress = getPlanProgress(plan);

  return {
    planId: plan.plan_id,
    matched: !!matched,
    matchedStepId: matched?.id,
    matchedStepLabel: matched?.label,
    closestStepId: !matched ? closest?.id : undefined,
    closestStepLabel: !matched ? closest?.label : undefined,
    similarityScore: !matched ? closestScore : undefined,
    sequenceValid: matched ? isSequenceValid(matched, plan) : undefined,
    constraintsChecked: constraintChecks,
    progress: { completed: progress.completed, total: progress.total },
  };
}

// Re-export PlanConstraint type used in this module's internal function signatures
import type { PlanConstraint } from '../contracts/plan-contract';
