/**
 * Behavioral Analysis Engine — What Governance UNLOCKS
 *
 * This is the differentiator. Every governance system can tell you
 * what it blocked. Only NeuroVerse tells you:
 *   - What agents did INSTEAD (adaptation classification)
 *   - What patterns emerged COLLECTIVELY (behavioral detection)
 *   - WHY it matters IN PROSE (narrative generation)
 *
 * "Governance is the engine — but we also always want to show people
 *  the knowledge that constraining unlocks."
 *
 * Architecture:
 *   GuardVerdict[] → classifyAdaptation() → Adaptation[]
 *   Adaptation[]   → detectBehavioralPatterns() → BehavioralPattern[]
 *   Pattern[]      → generateAdaptationNarrative() → string
 *
 * Pure functions. No network. No LLM. Deterministic.
 */

import type { GuardVerdict, GuardStatus, IntentRecord } from '../contracts/guard-contract';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Categories of agent actions for behavioral shift tracking */
export type ActionCategory =
  | 'amplifying'   // share, post, retweet, broadcast
  | 'passive'      // scroll, idle, observe
  | 'engaging'     // reply, comment, discuss
  | 'corrective'   // report, fact-check, flag
  | 'transactional' // buy, sell, trade
  | 'creative'     // generate, compose, draft
  | 'analytical'   // analyze, research, investigate
  | 'unknown';

/** A classified behavioral adaptation — what an agent did instead */
export interface Adaptation {
  /** Agent identifier */
  agentId: string;

  /** What the agent intended to do */
  intendedAction: string;

  /** What the agent actually did (after governance) */
  executedAction: string;

  /** Named behavioral shift category */
  shiftType: string;

  /** Governance status that caused the shift */
  verdict: GuardStatus;

  /** Rule that caused the shift */
  ruleId?: string;

  /** Human-readable reason */
  reason?: string;
}

/** An emergent behavioral pattern detected across multiple agents */
export interface BehavioralPattern {
  /** Pattern type identifier */
  type: string;

  /** Human-readable description */
  description: string;

  /** Pattern strength (0-1), based on fraction of agents affected */
  strength: number;

  /** Number of agents exhibiting this pattern */
  agentsAffected: number;
}

/** Network-level context for narrative generation */
export interface NetworkContext {
  mood?: string;
  misinfoLevel?: number;
  totalAgents?: number;
  totalActions?: number;
  [key: string]: unknown;
}

// ─── Action Category Classification ─────────────────────────────────────────

const ACTION_CATEGORY_MAP: Record<string, ActionCategory> = {
  // Amplifying
  share: 'amplifying',
  post: 'amplifying',
  create_post: 'amplifying',
  retweet: 'amplifying',
  quote_tweet: 'amplifying',
  broadcast: 'amplifying',
  publish: 'amplifying',
  // Passive
  scroll: 'passive',
  idle: 'passive',
  observe: 'passive',
  like: 'passive',
  // Engaging
  reply: 'engaging',
  comment: 'engaging',
  discuss: 'engaging',
  // Corrective
  report: 'corrective',
  fact_check: 'corrective',
  flag: 'corrective',
  debunk: 'corrective',
  // Transactional
  buy: 'transactional',
  sell: 'transactional',
  trade: 'transactional',
  short: 'transactional',
  // Creative
  generate: 'creative',
  compose: 'creative',
  draft: 'creative',
  write: 'creative',
  // Analytical
  analyze: 'analytical',
  research: 'analytical',
  investigate: 'analytical',
  review: 'analytical',
};

/** Named shifts for category transitions */
const SHIFT_LABELS: Record<string, string> = {
  'amplifying→passive': 'amplification_suppressed',
  'amplifying→corrective': 'redirected_to_reporting',
  'amplifying→engaging': 'shifted_to_engagement',
  'amplifying→analytical': 'redirected_to_analysis',
  'transactional→passive': 'trading_halted',
  'transactional→analytical': 'redirected_to_analysis',
  'creative→passive': 'creation_blocked',
  'creative→analytical': 'redirected_to_research',
  'engaging→passive': 'engagement_dampened',
  'passive→passive': 'unchanged',
};

function categorizeAction(action: string): ActionCategory {
  return ACTION_CATEGORY_MAP[action] ?? 'unknown';
}

// ─── Classify Adaptation ────────────────────────────────────────────────────

/**
 * Classify what behavioral shift governance caused for a single agent action.
 *
 * Takes the original intent and the actual execution, returns a named shift.
 * Pure function. No side effects.
 */
export function classifyAdaptation(
  intendedAction: string,
  executedAction: string,
): string {
  if (intendedAction === executedAction) return 'unchanged';

  const intendedCat = categorizeAction(intendedAction);
  const executedCat = categorizeAction(executedAction);

  if (intendedCat === executedCat) return 'unchanged';

  const key = `${intendedCat}→${executedCat}`;
  return SHIFT_LABELS[key] ?? `${intendedAction}_to_${executedAction}`;
}

/**
 * Build an Adaptation from a GuardVerdict with intent tracking.
 * Uses the IntentRecord attached to the verdict (if present).
 */
export function adaptationFromVerdict(
  agentId: string,
  intendedAction: string,
  executedAction: string,
  verdict: GuardVerdict,
): Adaptation {
  return {
    agentId,
    intendedAction,
    executedAction,
    shiftType: classifyAdaptation(intendedAction, executedAction),
    verdict: verdict.status,
    ruleId: verdict.ruleId,
    reason: verdict.reason,
  };
}

// ─── Detect Behavioral Patterns ─────────────────────────────────────────────

/**
 * Detect emergent collective patterns from a batch of adaptations.
 *
 * This is NOT just counting. It detects:
 *   - Coordinated silence (many agents forced idle)
 *   - Misinformation suppression (amplification specifically blocked)
 *   - Constructive redirection (agents shifted to positive actions)
 *   - High governance impact (large fraction of agents affected)
 *   - Trading halt (transactional agents stopped)
 *
 * Pure function. Deterministic. Same inputs → same patterns.
 */
export function detectBehavioralPatterns(
  adaptations: Adaptation[],
  totalAgents: number,
): BehavioralPattern[] {
  const patterns: BehavioralPattern[] = [];
  if (adaptations.length === 0) return patterns;

  const n = Math.max(totalAgents, 1);

  // Count shift types
  const shiftCounts: Record<string, number> = {};
  for (const a of adaptations) {
    shiftCounts[a.shiftType] = (shiftCounts[a.shiftType] ?? 0) + 1;
  }

  // Count verdict categories
  const verdictCounts: Record<string, number> = {};
  for (const a of adaptations) {
    verdictCounts[a.verdict] = (verdictCounts[a.verdict] ?? 0) + 1;
  }

  // Coordinated silence: many agents forced to passive
  const suppressed = (shiftCounts['amplification_suppressed'] ?? 0);
  const dampened = (shiftCounts['engagement_dampened'] ?? 0);
  const silenced = suppressed + dampened;
  if (silenced >= 3) {
    patterns.push({
      type: 'coordinated_silence',
      description: `${silenced} agents blocked from amplifying — network went quiet`,
      strength: round(silenced / n),
      agentsAffected: silenced,
    });
  }

  // Misinformation suppression: amplification specifically blocked
  if (suppressed >= 2) {
    patterns.push({
      type: 'misinfo_suppression',
      description: `${suppressed} amplification attempts blocked before reaching the feed`,
      strength: round(suppressed / n),
      agentsAffected: suppressed,
    });
  }

  // Constructive redirect: agents did something positive instead
  const redirected = (shiftCounts['redirected_to_reporting'] ?? 0)
    + (shiftCounts['redirected_to_analysis'] ?? 0);
  if (redirected >= 1) {
    patterns.push({
      type: 'constructive_redirect',
      description: `${redirected} agents redirected from amplification to reporting or analysis`,
      strength: round(redirected / n),
      agentsAffected: redirected,
    });
  }

  // Trading halt
  const tradingHalted = (shiftCounts['trading_halted'] ?? 0);
  if (tradingHalted >= 2) {
    patterns.push({
      type: 'trading_halt',
      description: `${tradingHalted} trading agents stopped — positions frozen`,
      strength: round(tradingHalted / n),
      agentsAffected: tradingHalted,
    });
  }

  // High governance impact: large fraction of agents affected
  const adaptRate = adaptations.length / n;
  if (adaptRate > 0.3) {
    patterns.push({
      type: 'high_governance_impact',
      description: `${adaptations.length}/${n} agents (${Math.round(adaptRate * 100)}%) had their behavior shaped by governance`,
      strength: round(adaptRate),
      agentsAffected: adaptations.length,
    });
  }

  // Penalty wave: many PENALIZE verdicts
  const penalized = verdictCounts['PENALIZE'] ?? 0;
  if (penalized >= 3) {
    patterns.push({
      type: 'penalty_wave',
      description: `${penalized} agents penalized — behavioral costs applied`,
      strength: round(penalized / n),
      agentsAffected: penalized,
    });
  }

  // Reward cascade: many REWARD verdicts
  const rewarded = verdictCounts['REWARD'] ?? 0;
  if (rewarded >= 3) {
    patterns.push({
      type: 'reward_cascade',
      description: `${rewarded} agents rewarded — constructive behavior amplified`,
      strength: round(rewarded / n),
      agentsAffected: rewarded,
    });
  }

  return patterns;
}

// ─── Generate Narrative ─────────────────────────────────────────────────────

/**
 * Generate a human-readable cause-effect narrative from patterns.
 *
 * This is the "money moment" — the prose explanation of what governance
 * caused to happen. Not a log. Not a report. A story.
 *
 * "5 agents went silent instead of amplifying. 3 redirected to fact-checking.
 *  Network mood: polarized, misinfo level: 45%"
 */
export function generateAdaptationNarrative(
  patterns: BehavioralPattern[],
  context?: NetworkContext,
): string {
  if (patterns.length === 0) return '';

  const parts: string[] = [];
  const patternTypes = new Set(patterns.map(p => p.type));

  // Order matters — most impactful first
  if (patternTypes.has('misinfo_suppression')) {
    const p = patterns.find(p => p.type === 'misinfo_suppression')!;
    parts.push(`Blocked ${p.agentsAffected} misinformation amplification attempts`);
  }

  if (patternTypes.has('coordinated_silence')) {
    const p = patterns.find(p => p.type === 'coordinated_silence')!;
    parts.push(`${p.agentsAffected} agents went silent instead of amplifying`);
  }

  if (patternTypes.has('constructive_redirect')) {
    const p = patterns.find(p => p.type === 'constructive_redirect')!;
    parts.push(`${p.agentsAffected} shifted from sharing to fact-checking`);
  }

  if (patternTypes.has('trading_halt')) {
    const p = patterns.find(p => p.type === 'trading_halt')!;
    parts.push(`${p.agentsAffected} trading agents halted`);
  }

  if (patternTypes.has('penalty_wave')) {
    const p = patterns.find(p => p.type === 'penalty_wave')!;
    parts.push(`${p.agentsAffected} agents received behavioral penalties`);
  }

  if (patternTypes.has('reward_cascade')) {
    const p = patterns.find(p => p.type === 'reward_cascade')!;
    parts.push(`${p.agentsAffected} agents rewarded for constructive behavior`);
  }

  if (patternTypes.has('high_governance_impact')) {
    const p = patterns.find(p => p.type === 'high_governance_impact')!;
    parts.push(`${Math.round(p.strength * 100)}% of agents had behavior shaped by governance`);
  }

  // Add network context if available
  if (context) {
    const contextParts: string[] = [];
    if (context.mood) contextParts.push(`mood: ${context.mood}`);
    if (context.misinfoLevel !== undefined) {
      contextParts.push(`misinfo level: ${Math.round(context.misinfoLevel * 100)}%`);
    }
    if (contextParts.length > 0) {
      parts.push(`Network ${contextParts.join(', ')}`);
    }
  }

  return parts.join('. ') + (parts.length > 0 ? '.' : '');
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function round(n: number, decimals = 3): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}
