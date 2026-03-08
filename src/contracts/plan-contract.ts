/**
 * Plan Contract — Plan Enforcement Types
 *
 * Defines the input/output contract for plan-based governance.
 *
 * Plans are temporary guard overlays — "mom's rules for this trip."
 * They define what an agent should do (steps) and what it must not
 * exceed (constraints). Plans layer on top of worlds, narrowing
 * behavior without overriding safety or world-level governance.
 *
 * INVARIANTS:
 *   - Plans can only restrict, never expand. A plan cannot override a world BLOCK.
 *   - Plan enforcement is deterministic: same event + same plan → same verdict.
 *   - No AI in the evaluation loop. Parsing and evaluation are pure functions.
 */

// ─── Plan Step ──────────────────────────────────────────────────────────────

export interface PlanStep {
  /** Auto-generated slug from label (e.g., "write_announcement_blog_post"). */
  id: string;

  /** Human-readable step name. */
  label: string;

  /** Optional detail about the step. */
  description?: string;

  /** Restrict this step to specific tools (optional). */
  tools?: string[];

  /** Step IDs that must complete first (optional). */
  requires?: string[];

  /** Semantic tags for action mapping (e.g., ["deploy", "marketing"]). */
  tags?: string[];

  /** Completion condition name (optional). */
  verify?: string;

  /** Current step status. */
  status: 'pending' | 'active' | 'completed' | 'skipped';
}

// ─── Plan Constraint ────────────────────────────────────────────────────────

export interface PlanConstraint {
  /** Auto-generated constraint ID. */
  id: string;

  /** Constraint type. 'approval' always returns PAUSE until human confirms. */
  type: 'budget' | 'time' | 'scope' | 'approval' | 'custom';

  /** Human-readable description. */
  description: string;

  /** Enforcement mode. */
  enforcement: 'block' | 'pause';

  /** Numeric limit (for budget/time). */
  limit?: number;

  /** Unit for the limit (e.g., "USD", "minutes"). */
  unit?: string;

  /** Pattern that activates this constraint. */
  trigger?: string;
}

// ─── Completion Mode ───────────────────────────────────────────────────────

/**
 * How step completion is determined:
 *   - 'trust'    — caller asserts completion, plan advances (default)
 *   - 'verified' — steps with a `verify` field require evidence to advance;
 *                   steps without `verify` still advance on trust
 */
export type PlanCompletionMode = 'trust' | 'verified';

/**
 * Evidence provided when advancing a step in verified mode.
 * The verifier checks that evidence.type matches step.verify.
 */
export interface StepEvidence {
  /** Evidence type — must match the step's `verify` field. */
  type: string;

  /** Proof payload (URL, hash, output snippet, etc.). */
  proof: string;

  /** When the evidence was produced. */
  timestamp?: string;
}

/**
 * Result of attempting to advance a step.
 */
export interface AdvanceResult {
  /** Whether the step was successfully advanced. */
  success: boolean;

  /** Updated plan (if success). */
  plan?: PlanDefinition;

  /** Why advancement failed (if !success). */
  reason?: string;

  /** The evidence that was accepted (if verified mode). */
  evidence?: StepEvidence;
}

// ─── Plan Definition ────────────────────────────────────────────────────────

export interface PlanDefinition {
  /** Unique plan identifier. */
  plan_id: string;

  /** Human-readable objective. */
  objective: string;

  /** Whether steps must run in order. */
  sequential: boolean;

  /**
   * How step completion is determined.
   *   - 'trust' (default) — caller asserts "done", plan advances
   *   - 'verified' — steps with `verify` require evidence to advance
   */
  completion: PlanCompletionMode;

  /** The steps in this plan. */
  steps: PlanStep[];

  /** Constraints that apply to this plan. */
  constraints: PlanConstraint[];

  /** Optional parent world ID. */
  world_id?: string;

  /** When this plan was created. */
  created_at: string;

  /** Optional expiry time. */
  expires_at?: string;
}

// ─── Plan Verdict ───────────────────────────────────────────────────────────

export type PlanStatus = 'ON_PLAN' | 'OFF_PLAN' | 'CONSTRAINT_VIOLATED' | 'PLAN_COMPLETE';

export interface PlanVerdict {
  /** Whether the action is allowed by this plan. */
  allowed: boolean;

  /** Plan verdict status. */
  status: PlanStatus;

  /** Why the action was blocked or paused. */
  reason?: string;

  /** Which step this action matched (if any). */
  matchedStep?: string;

  /** Nearest step when OFF_PLAN (for agent self-correction). */
  closestStep?: string;

  /** How close the action was to the nearest step (0-1). */
  similarityScore?: number;

  /** Current plan progress. */
  progress: PlanProgress;
}

// ─── Plan Progress ──────────────────────────────────────────────────────────

export interface PlanProgress {
  /** Number of completed steps. */
  completed: number;

  /** Total number of steps. */
  total: number;

  /** Completion percentage. */
  percentage: number;
}

// ─── Plan Check (for EvaluationTrace) ───────────────────────────────────────

export interface PlanCheck {
  /** The plan being enforced. */
  planId: string;

  /** Whether the action matched a plan step. */
  matched: boolean;

  /** Which step was matched. */
  matchedStepId?: string;

  /** Label of the matched step. */
  matchedStepLabel?: string;

  /** Nearest step when no match (for self-correction). */
  closestStepId?: string;

  /** Label of the nearest step. */
  closestStepLabel?: string;

  /** Similarity score to the nearest step. */
  similarityScore?: number;

  /** Whether step sequence requirements are satisfied. */
  sequenceValid?: boolean;

  /** Results of constraint checks. */
  constraintsChecked: Array<{
    constraintId: string;
    passed: boolean;
    reason?: string;
  }>;

  /** Current progress. */
  progress: { completed: number; total: number };
}

// ─── Exit Codes ─────────────────────────────────────────────────────────────

export const PLAN_EXIT_CODES = {
  ON_PLAN: 0,
  OFF_PLAN: 1,
  CONSTRAINT_VIOLATED: 2,
  ERROR: 3,
  PLAN_COMPLETE: 4,
} as const;

export type PlanExitCode = (typeof PLAN_EXIT_CODES)[keyof typeof PLAN_EXIT_CODES];
