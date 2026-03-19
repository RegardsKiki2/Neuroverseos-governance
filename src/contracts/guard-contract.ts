/**
 * Guard Contract — CLI Governance Evaluation Types
 *
 * Defines the input/output contract for `neuroverse guard`.
 *
 * GuardEvent comes in (stdin JSON).
 * GuardVerdict goes out (stdout JSON).
 * Exit code encodes status: 0=ALLOW, 1=BLOCK, 2=PAUSE.
 *
 * The EvaluationTrace is the internal debugging structure that records
 * every check performed, whether it matched, and how precedence resolved.
 * Included in the verdict when trace mode is enabled. Powers:
 *   - OS debugging UI
 *   - Explainability features
 *   - Evidence generation for enterprise compliance
 *   - CI/CD audit trails
 *
 * INVARIANTS:
 *   - Deterministic: same event + same world → same verdict, always.
 *   - Zero network calls. All evaluation is local pattern matching.
 *   - Single event in, single verdict out.
 *   - Trace records every check, not just the deciding one.
 */

// ─── Guard Event (Input) ─────────────────────────────────────────────────────

/**
 * A governance event to evaluate.
 * This is the CLI-facing contract — simpler than ExecutionEvent,
 * focused on what the guard engine actually needs.
 */
export interface GuardEvent {
  /** Human-readable intent description. REQUIRED. */
  intent: string;

  /** Tool being invoked (e.g., "shell", "browser", "fs", "http") */
  tool?: string;

  /** Scope of the action (file path, domain, resource identifier) */
  scope?: string;

  /** Role ID of the actor (for multi-agent worlds) */
  roleId?: string;

  /**
   * Direction of the event.
   * - 'input': user/agent → system (pre-check)
   * - 'output': system → user/agent (post-check)
   *
   * When set, enables direction-specific safety checks:
   * - direction='input': execution intent detection
   * - direction='output': execution claim detection
   *
   * When absent, direction-specific checks are skipped.
   */
  direction?: 'input' | 'output';

  /** Action category for quick classification */
  actionCategory?: 'read' | 'write' | 'delete' | 'network' | 'shell' | 'browser' | 'other';

  /** Risk level hint from the caller */
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';

  /** Whether the action is irreversible (advisory hint) */
  irreversible?: boolean;

  /** Raw payload data (used for injection detection) */
  payload?: unknown;

  /** Tool arguments — supports dot-notation field resolution (e.g. args.file_path) */
  args?: Record<string, unknown>;

  /** Environment context (e.g. "development", "production") */
  environment?: string;
}

// ─── Guard Verdict (Output) ──────────────────────────────────────────────────

export type GuardStatus = 'ALLOW' | 'BLOCK' | 'PAUSE' | 'MODIFY' | 'PENALIZE' | 'REWARD' | 'NEUTRAL';

// ─── Consequence & Reward Definitions ────────────────────────────────────────

/**
 * Consequence applied when an agent is PENALIZED.
 * The governance engine blocks the action AND imposes a behavioral cost.
 */
export interface Consequence {
  /** Type of penalty */
  type: 'freeze' | 'reduce_influence' | 'increase_risk' | 'cooldown' | 'custom';

  /** Duration in rounds (for freeze/cooldown) */
  rounds?: number;

  /** Magnitude of effect (e.g., influence reduction percentage 0-1) */
  magnitude?: number;

  /** Human-readable description of what happens */
  description: string;
}

/**
 * Reward applied when an agent's action is REWARDED.
 * The action proceeds AND the agent receives a behavioral boost.
 */
export interface Reward {
  /** Type of reward */
  type: 'boost_influence' | 'priority' | 'faster_execution' | 'weight_increase' | 'custom';

  /** Duration in rounds (for temporary boosts) */
  rounds?: number;

  /** Magnitude of effect (e.g., influence boost percentage 0-1) */
  magnitude?: number;

  /** Human-readable description of what happens */
  description: string;
}

/**
 * Tracks the behavioral state of an agent across governance evaluations.
 * This is what makes governance a behavior-shaping system, not just a filter.
 */
export interface AgentBehaviorState {
  /** Agent/role identifier */
  agentId: string;

  /** Rounds remaining in cooldown (0 = active) */
  cooldownRemaining: number;

  /** Current influence multiplier (1.0 = normal) */
  influence: number;

  /** Accumulated reward multiplier (1.0 = normal) */
  rewardMultiplier: number;

  /** Total penalties received */
  totalPenalties: number;

  /** Total rewards received */
  totalRewards: number;

  /** History of consequences applied */
  consequenceHistory: Array<{ ruleId: string; consequence: Consequence; appliedAt: number }>;

  /** History of rewards applied */
  rewardHistory: Array<{ ruleId: string; reward: Reward; appliedAt: number }>;
}

// ─── Intent Tracking ─────────────────────────────────────────────────────────

/**
 * Tracks what an agent WANTED to do vs what governance MADE it do.
 * This is the core of the Decision Flow visualization.
 *
 * The gap between intent and outcome = governance value.
 */
export interface IntentRecord {
  /** Original action the agent attempted */
  originalIntent: string;

  /** What actually happened after governance */
  finalAction: string;

  /** The rule that caused the interception */
  ruleApplied?: string;

  /** How the intent was transformed */
  enforcement: GuardStatus;

  /** If MODIFY, what the action was changed to */
  modifiedTo?: string;

  /** If PENALIZE, the consequence applied */
  consequence?: Consequence;

  /** If REWARD, the reward applied */
  reward?: Reward;
}

/**
 * Evidence attached to every verdict for audit purposes.
 * Always present, regardless of trace mode.
 */
export interface VerdictEvidence {
  /** World identity */
  worldId: string;
  worldName: string;
  worldVersion: string;

  /** Evaluation timestamp */
  evaluatedAt: number;

  /** Invariant coverage summary */
  invariantsSatisfied: number;
  invariantsTotal: number;

  /** IDs of guards that matched the event */
  guardsMatched: string[];

  /** IDs of kernel rules that matched the event */
  rulesMatched: string[];

  /** Enforcement level used for evaluation */
  enforcementLevel: string;
}

/**
 * The verdict — what goes to stdout.
 *
 * Exit codes:
 *   0 = ALLOW  (proceed)
 *   1 = BLOCK  (denied, do not proceed)
 *   2 = PAUSE  (needs human decision)
 *   3 = ERROR  (invalid input, missing world, etc.)
 */
export interface GuardVerdict {
  /** The governance decision */
  status: GuardStatus;

  /** Human-readable reason (for BLOCK/PAUSE) */
  reason?: string;

  /** ID of the rule/guard that produced this verdict */
  ruleId?: string;

  /** Advisory warning (for ALLOW with warn-mode guards) */
  warning?: string;

  /** Consequence applied (for PENALIZE verdicts) */
  consequence?: Consequence;

  /** Reward applied (for REWARD verdicts) */
  reward?: Reward;

  /** Intent tracking — what the agent wanted vs what happened */
  intentRecord?: IntentRecord;

  /** Audit evidence — always present */
  evidence: VerdictEvidence;

  /** Evaluation trace — present when trace mode is enabled */
  trace?: EvaluationTrace;
}

// ─── Evaluation Trace (Internal Debugging) ───────────────────────────────────

/**
 * The evaluation trace records every check the engine performed.
 * Not just the deciding check — ALL of them. This is what powers
 * the debugging UI, explainability, and enterprise audit.
 *
 * Internal by default. Exposed via --trace flag or programmatic option.
 */
export interface EvaluationTrace {
  /** Every invariant coverage check */
  invariantChecks: InvariantCheck[];

  /** Safety checks (injection, scope escape) */
  safetyChecks: SafetyCheck[];

  /** Plan enforcement check (Phase 1.5) — present when a plan is active */
  planCheck?: import('./plan-contract').PlanCheck;

  /** Every role rule checked */
  roleChecks: RoleCheck[];

  /** Every declarative guard checked */
  guardChecks: GuardCheck[];

  /** Every kernel rule checked */
  kernelRuleChecks: KernelRuleCheck[];

  /** Level constraint checks */
  levelChecks: LevelCheck[];

  /** How the final verdict was determined */
  precedenceResolution: PrecedenceResolution;

  /** Wall-clock duration */
  durationMs: number;
}

/**
 * Invariant coverage check.
 * Verifies that the world's invariants are properly backed by guards.
 */
export interface InvariantCheck {
  invariantId: string;
  label: string;
  /** Whether a structural guard references this invariant */
  hasGuardCoverage: boolean;
  /** ID of the guard that covers this invariant (if any) */
  coveringGuardId?: string;
}

/**
 * Safety check result (injection detection, scope escape).
 */
export interface SafetyCheck {
  checkType: 'prompt-injection' | 'scope-escape' | 'execution-claim' | 'execution-intent';
  triggered: boolean;
  /** Which pattern matched (if triggered) */
  matchedPattern?: string;
}

/**
 * Role rule evaluation result.
 */
export interface RoleCheck {
  roleId: string;
  roleName: string;
  rule: string;
  ruleType: 'canDo' | 'cannotDo' | 'requiresApproval';
  matched: boolean;
}

/**
 * Declarative guard evaluation result.
 */
export interface GuardCheck {
  guardId: string;
  label: string;
  category: 'structural' | 'operational' | 'advisory';
  enabled: boolean;
  matched: boolean;
  enforcement: 'block' | 'pause' | 'warn' | 'modify' | 'penalize' | 'reward' | 'neutral';
  /** Which intent patterns matched (if any) */
  matchedPatterns: string[];
  /** Whether the guard was skipped due to role gating */
  roleGated: boolean;
}

/**
 * Kernel rule evaluation result.
 */
export interface KernelRuleCheck {
  ruleId: string;
  text: string;
  category: 'allowed' | 'forbidden';
  matched: boolean;
  /** How the match was performed */
  matchMethod: 'pattern' | 'keyword' | 'none';
}

/**
 * Level constraint check result.
 */
export interface LevelCheck {
  checkType: 'delete' | 'write-external' | 'network-mutate' | 'credential-access' | 'irreversible';
  level: string;
  triggered: boolean;
  reason?: string;
}

/**
 * How the engine resolved precedence to produce the final verdict.
 */
export interface PrecedenceResolution {
  /** Which check category produced the final verdict */
  decidingLayer:
    | 'session-allowlist'
    | 'safety'
    | 'plan-enforcement'
    | 'role'
    | 'guard'
    | 'kernel-rule'
    | 'level-constraint'
    | 'default-allow';

  /** Specific ID of the deciding check (guard ID, rule ID, etc.) */
  decidingId?: string;

  /** Resolution strategy used */
  strategy: 'first-match-wins';

  /** The full evaluation chain in order */
  chainOrder: string[];
}

// ─── Engine Options ──────────────────────────────────────────────────────────

/**
 * Options for the guard engine evaluation.
 */
export interface GuardEngineOptions {
  /** Include full evaluation trace in verdict. Default: false. */
  trace?: boolean;

  /** Enforcement level override. If not set, uses world default or 'standard'. */
  level?: 'basic' | 'standard' | 'strict';

  /**
   * Session allowlist — set of pre-approved event keys.
   * Use `eventToAllowlistKey(event)` to build keys.
   *
   * If the event's key is in this set, the engine returns ALLOW
   * immediately (before safety checks).
   *
   * The engine reads but never mutates this set.
   * The caller owns persistence (allow-once, allow-always, etc.).
   */
  sessionAllowlist?: Set<string>;

  /**
   * Active plan overlay — temporary task-scoped governance.
   * When set, plan enforcement runs at Phase 1.5 (after safety, before roles).
   * Plans can only restrict, never expand.
   */
  plan?: import('./plan-contract').PlanDefinition;

  /**
   * Agent behavior states — tracks cooldowns, influence, rewards per agent.
   * The engine reads this to check if an agent is penalized (frozen).
   * The caller owns mutation (applying consequences/rewards after verdict).
   */
  agentStates?: Map<string, AgentBehaviorState>;
}

// ─── Exit Codes ──────────────────────────────────────────────────────────────

export const GUARD_EXIT_CODES = {
  ALLOW: 0,
  BLOCK: 1,
  PAUSE: 2,
  ERROR: 3,
  MODIFY: 4,
  PENALIZE: 5,
  REWARD: 6,
  NEUTRAL: 7,
} as const;

export type GuardExitCode = (typeof GUARD_EXIT_CODES)[keyof typeof GUARD_EXIT_CODES];
