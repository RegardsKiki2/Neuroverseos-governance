/**
 * Decision Flow Engine — Intent → Rule → Outcome Visualization
 *
 * This is the core of the behavioral governance visualization.
 * It transforms audit events into a flow structure that shows:
 *
 *   LEFT (Intent Pool)    →    CENTER (Rules)    →    RIGHT (Outcome Pool)
 *   What agents wanted          What intercepted        What actually happened
 *
 * The gap between intent and outcome = governance value.
 *
 * Key metric: "X% of agent intent was redirected by governance"
 *
 * INVARIANTS:
 *   - Pure function: audit events in, flow structure out.
 *   - No speculation — only reports on actual evaluated actions.
 *   - Every flow path is traceable to a specific audit event.
 */

import type { AuditEvent } from './audit-logger';
import type {
  Consequence,
  Reward,
  AgentBehaviorState,
  GuardStatus,
} from '../contracts/guard-contract';

// ─── Decision Flow Types ─────────────────────────────────────────────────────

/**
 * A cluster of agents with the same intent.
 */
export interface IntentCluster {
  /** The original intent (e.g., "sell", "publish", "attack") */
  intent: string;

  /** Number of agents with this intent */
  agentCount: number;

  /** Intensity score (0-1) based on volume and risk */
  intensity: number;

  /** Individual agent IDs in this cluster */
  agents: string[];
}

/**
 * A rule that intercepted actions in the flow.
 */
export interface RuleObstacle {
  /** Rule/guard ID */
  ruleId: string;

  /** Human-readable label */
  label: string;

  /** How many actions this rule intercepted */
  interceptCount: number;

  /** Breakdown by enforcement type */
  enforcements: {
    blocked: number;
    modified: number;
    penalized: number;
    paused: number;
    rewarded: number;
  };
}

/**
 * An outcome cluster — what agents ended up doing.
 */
export interface OutcomeCluster {
  /** The enforcement type that produced this outcome */
  enforcement: GuardStatus;

  /** Number of agents with this outcome */
  agentCount: number;

  /** For MODIFY: what they were changed to */
  modifiedTo?: string;

  /** Agent IDs in this cluster */
  agents: string[];

  /** Visual style hint */
  style: 'green' | 'yellow' | 'red' | 'gray' | 'blue' | 'white';
}

/**
 * A single flow path from intent → rule → outcome.
 */
export interface FlowPath {
  /** Source intent */
  intent: string;

  /** Rule that intercepted (if any) */
  ruleId?: string;

  /** Resulting enforcement */
  enforcement: GuardStatus;

  /** Agent ID */
  agentId: string;

  /** Original action */
  originalAction: string;

  /** Final action */
  finalAction: string;

  /** Consequence applied (if PENALIZE) */
  consequence?: Consequence;

  /** Reward applied (if REWARD) */
  reward?: Reward;
}

/**
 * The complete Decision Flow — the visualization data structure.
 *
 * LEFT → CENTER → RIGHT
 * Intents → Rules → Outcomes
 */
export interface DecisionFlow {
  /** Left column: intent clusters */
  intents: IntentCluster[];

  /** Center column: rule obstacles */
  rules: RuleObstacle[];

  /** Right column: outcome clusters */
  outcomes: OutcomeCluster[];

  /** Every individual flow path */
  paths: FlowPath[];

  /** Key metrics */
  metrics: DecisionFlowMetrics;

  /** Time window */
  periodStart: string;
  periodEnd: string;
  worldName: string;
}

/**
 * The headline metrics for the Decision Flow.
 */
export interface DecisionFlowMetrics {
  /** Total intents evaluated */
  totalIntents: number;

  /** How many were redirected (not ALLOW) */
  totalRedirected: number;

  /** Headline: "X% of agent intent was redirected by governance" */
  redirectionRate: number;

  /** Breakdown by enforcement type */
  byEnforcement: Record<string, number>;

  /** Total penalties applied */
  totalPenalties: number;

  /** Total rewards applied */
  totalRewards: number;

  /** Net behavioral pressure (rewards - penalties) */
  netBehavioralPressure: number;
}

// ─── Flow Generation ─────────────────────────────────────────────────────────

/**
 * Generate a Decision Flow from audit events.
 *
 * This is the primary entry point — takes raw audit data and produces
 * the complete visualization structure.
 */
export function generateDecisionFlow(events: AuditEvent[]): DecisionFlow {
  if (events.length === 0) {
    return emptyFlow();
  }

  // ─── Build intent clusters (LEFT) ──────────────────────────────────
  const intentMap = new Map<string, { agents: Set<string>; count: number }>();
  for (const e of events) {
    const intentKey = normalizeIntent(e.intent);
    const entry = intentMap.get(intentKey) ?? { agents: new Set<string>(), count: 0 };
    entry.count++;
    entry.agents.add(e.actor ?? 'unknown');
    intentMap.set(intentKey, entry);
  }

  const maxCount = Math.max(...[...intentMap.values()].map(v => v.count), 1);
  const intents: IntentCluster[] = [...intentMap.entries()]
    .map(([intent, data]) => ({
      intent,
      agentCount: data.count,
      intensity: data.count / maxCount,
      agents: [...data.agents],
    }))
    .sort((a, b) => b.agentCount - a.agentCount);

  // ─── Build rule obstacles (CENTER) ─────────────────────────────────
  const ruleMap = new Map<string, RuleObstacle>();
  for (const e of events) {
    if (!e.ruleId && e.guardsMatched.length === 0) continue;

    const ruleIds = [e.ruleId, ...e.guardsMatched].filter(Boolean) as string[];
    for (const rId of new Set(ruleIds)) {
      const existing = ruleMap.get(rId) ?? {
        ruleId: rId,
        label: rId,
        interceptCount: 0,
        enforcements: { blocked: 0, modified: 0, penalized: 0, paused: 0, rewarded: 0 },
      };
      existing.interceptCount++;

      switch (e.decision) {
        case 'BLOCK': existing.enforcements.blocked++; break;
        case 'PAUSE': existing.enforcements.paused++; break;
        case 'MODIFY': existing.enforcements.modified++; break;
        case 'PENALIZE': existing.enforcements.penalized++; break;
        case 'REWARD': existing.enforcements.rewarded++; break;
      }

      ruleMap.set(rId, existing);
    }
  }

  const rules = [...ruleMap.values()].sort((a, b) => b.interceptCount - a.interceptCount);

  // ─── Build outcome clusters (RIGHT) ────────────────────────────────
  const outcomeMap = new Map<string, { agents: Set<string>; count: number; modifiedTo?: string }>();
  for (const e of events) {
    const key = e.decision;
    const entry = outcomeMap.get(key) ?? { agents: new Set<string>(), count: 0 };
    entry.count++;
    entry.agents.add(e.actor ?? 'unknown');
    outcomeMap.set(key, entry);
  }

  const outcomes: OutcomeCluster[] = [...outcomeMap.entries()]
    .map(([enforcement, data]) => ({
      enforcement: enforcement as GuardStatus,
      agentCount: data.count,
      agents: [...data.agents],
      style: enforcementToStyle(enforcement),
    }))
    .sort((a, b) => b.agentCount - a.agentCount);

  // ─── Build flow paths ──────────────────────────────────────────────
  const paths: FlowPath[] = events.map(e => ({
    intent: normalizeIntent(e.intent),
    ruleId: e.ruleId ?? e.guardsMatched[0],
    enforcement: e.decision as GuardStatus,
    agentId: e.actor ?? 'unknown',
    originalAction: e.intent,
    finalAction: e.decision === 'ALLOW' ? e.intent :
                 e.decision === 'BLOCK' ? 'blocked' :
                 e.decision === 'PENALIZE' ? 'blocked + penalized' :
                 e.decision === 'REWARD' ? e.intent + ' (rewarded)' :
                 e.decision === 'MODIFY' ? 'modified' :
                 e.decision === 'NEUTRAL' ? e.intent :
                 'paused',
  }));

  // ─── Compute metrics ──────────────────────────────────────────────
  const totalIntents = events.length;
  const allowed = events.filter(e => e.decision === 'ALLOW' || e.decision === 'REWARD' || e.decision === 'NEUTRAL').length;
  const totalRedirected = totalIntents - allowed;
  const totalPenalties = events.filter(e => e.decision === 'PENALIZE').length;
  const totalRewards = events.filter(e => e.decision === 'REWARD').length;

  const byEnforcement: Record<string, number> = {};
  for (const e of events) {
    byEnforcement[e.decision] = (byEnforcement[e.decision] ?? 0) + 1;
  }

  const metrics: DecisionFlowMetrics = {
    totalIntents,
    totalRedirected,
    redirectionRate: totalIntents > 0 ? totalRedirected / totalIntents : 0,
    byEnforcement,
    totalPenalties,
    totalRewards,
    netBehavioralPressure: totalRewards - totalPenalties,
  };

  return {
    intents,
    rules,
    outcomes,
    paths,
    metrics,
    periodStart: events[0]?.timestamp ?? '',
    periodEnd: events[events.length - 1]?.timestamp ?? '',
    worldName: events[0]?.worldName ?? 'unknown',
  };
}

// ─── Agent Behavior State Management ─────────────────────────────────────────

/**
 * Create a fresh agent behavior state.
 */
export function createAgentState(agentId: string): AgentBehaviorState {
  return {
    agentId,
    cooldownRemaining: 0,
    influence: 1.0,
    rewardMultiplier: 1.0,
    totalPenalties: 0,
    totalRewards: 0,
    consequenceHistory: [],
    rewardHistory: [],
  };
}

/**
 * Apply a consequence to an agent's behavior state.
 * Returns the updated state (immutable — creates a new object).
 */
export function applyConsequence(
  state: AgentBehaviorState,
  consequence: Consequence,
  ruleId: string,
): AgentBehaviorState {
  const updated = { ...state };
  updated.totalPenalties++;
  updated.consequenceHistory = [
    ...state.consequenceHistory,
    { ruleId, consequence, appliedAt: Date.now() },
  ];

  switch (consequence.type) {
    case 'freeze':
    case 'cooldown':
      updated.cooldownRemaining = Math.max(
        state.cooldownRemaining,
        consequence.rounds ?? 1,
      );
      break;
    case 'reduce_influence':
      updated.influence = Math.max(0, state.influence - (consequence.magnitude ?? 0.1));
      break;
    case 'increase_risk':
      // Tracked in consequence history — interpreters use this
      break;
    case 'custom':
      // Custom consequences are tracked in history for external interpretation
      break;
  }

  return updated;
}

/**
 * Apply a reward to an agent's behavior state.
 * Returns the updated state (immutable).
 */
export function applyReward(
  state: AgentBehaviorState,
  reward: Reward,
  ruleId: string,
): AgentBehaviorState {
  const updated = { ...state };
  updated.totalRewards++;
  updated.rewardHistory = [
    ...state.rewardHistory,
    { ruleId, reward, appliedAt: Date.now() },
  ];

  switch (reward.type) {
    case 'boost_influence':
      updated.influence = Math.min(2.0, state.influence + (reward.magnitude ?? 0.1));
      break;
    case 'weight_increase':
      updated.rewardMultiplier = Math.min(3.0, state.rewardMultiplier + (reward.magnitude ?? 0.1));
      break;
    case 'priority':
    case 'faster_execution':
      // Tracked in reward history for external interpretation
      break;
    case 'custom':
      break;
  }

  return updated;
}

/**
 * Advance all agent states by one round.
 * Decrements cooldowns, applies time-based effects.
 */
export function tickAgentStates(
  states: Map<string, AgentBehaviorState>,
): Map<string, AgentBehaviorState> {
  const updated = new Map<string, AgentBehaviorState>();

  for (const [id, state] of states) {
    updated.set(id, {
      ...state,
      cooldownRemaining: Math.max(0, state.cooldownRemaining - 1),
    });
  }

  return updated;
}

// ─── Flow Renderer ───────────────────────────────────────────────────────────

/**
 * Render a Decision Flow as human-readable text.
 * This is what `neuroverse decision-flow` prints.
 */
export function renderDecisionFlow(flow: DecisionFlow): string {
  const lines: string[] = [];

  lines.push('DECISION FLOW — Intent → Rule → Outcome');
  lines.push('═'.repeat(60));
  lines.push('');
  lines.push(`  World: ${flow.worldName}`);
  lines.push(`  Period: ${flow.periodStart.split('T')[0] ?? '—'} → ${flow.periodEnd.split('T')[0] ?? '—'}`);
  lines.push('');

  // ─── Headline metric ──────────────────────────────────────────────
  lines.push(`  "${(flow.metrics.redirectionRate * 100).toFixed(1)}% of agent intent was redirected by governance"`);
  lines.push('');

  // ─── LEFT: Intent Pool ────────────────────────────────────────────
  lines.push('INTENT POOL (what agents wanted)');
  lines.push('─'.repeat(60));
  for (const cluster of flow.intents.slice(0, 15)) {
    const bar = '█'.repeat(Math.max(1, Math.round(cluster.intensity * 20)));
    lines.push(`  ${cluster.intent.padEnd(25)} ${String(cluster.agentCount).padStart(5)} agents  ${bar}`);
  }
  lines.push('');

  // ─── CENTER: Rule Obstacles ───────────────────────────────────────
  lines.push('RULE OBSTACLES (what intercepted)');
  lines.push('─'.repeat(60));
  for (const rule of flow.rules.slice(0, 10)) {
    const parts: string[] = [];
    if (rule.enforcements.blocked > 0) parts.push(`${rule.enforcements.blocked} blocked`);
    if (rule.enforcements.modified > 0) parts.push(`${rule.enforcements.modified} modified`);
    if (rule.enforcements.penalized > 0) parts.push(`${rule.enforcements.penalized} penalized`);
    if (rule.enforcements.paused > 0) parts.push(`${rule.enforcements.paused} paused`);
    if (rule.enforcements.rewarded > 0) parts.push(`${rule.enforcements.rewarded} rewarded`);
    lines.push(`  ${rule.ruleId.padEnd(30)} ${String(rule.interceptCount).padStart(5)} intercepts  (${parts.join(', ')})`);
  }
  lines.push('');

  // ─── RIGHT: Outcome Pool ──────────────────────────────────────────
  lines.push('OUTCOME POOL (what actually happened)');
  lines.push('─'.repeat(60));
  for (const outcome of flow.outcomes) {
    const icon = outcomeIcon(outcome.enforcement);
    lines.push(`  ${icon} ${outcome.enforcement.padEnd(12)} ${String(outcome.agentCount).padStart(5)} agents`);
  }
  lines.push('');

  // ─── Behavioral Economy ───────────────────────────────────────────
  if (flow.metrics.totalPenalties > 0 || flow.metrics.totalRewards > 0) {
    lines.push('BEHAVIORAL ECONOMY');
    lines.push('─'.repeat(60));
    lines.push(`  Penalties applied:       ${flow.metrics.totalPenalties}`);
    lines.push(`  Rewards applied:         ${flow.metrics.totalRewards}`);
    lines.push(`  Net behavioral pressure: ${flow.metrics.netBehavioralPressure > 0 ? '+' : ''}${flow.metrics.netBehavioralPressure}`);
    lines.push('');
  }

  // ─── Enforcement Breakdown ────────────────────────────────────────
  lines.push('ENFORCEMENT BREAKDOWN');
  lines.push('─'.repeat(60));
  for (const [enforcement, count] of Object.entries(flow.metrics.byEnforcement)) {
    const pct = ((count / flow.metrics.totalIntents) * 100).toFixed(1);
    lines.push(`  ${enforcement.padEnd(12)} ${String(count).padStart(5)} (${pct}%)`);
  }
  lines.push('');

  return lines.join('\n');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeIntent(intent: string): string {
  // Extract the primary verb from the intent
  const lower = intent.toLowerCase().trim();
  const verbs = ['sell', 'buy', 'trade', 'publish', 'delete', 'create', 'modify', 'send',
                 'withdraw', 'transfer', 'attack', 'deploy', 'execute', 'read', 'write',
                 'hold', 'stake', 'approve', 'reject', 'escalate'];
  for (const verb of verbs) {
    if (lower.startsWith(verb) || lower.includes(verb)) {
      return verb;
    }
  }
  // Return first word as fallback
  return lower.split(/\s+/)[0] ?? lower;
}

function enforcementToStyle(enforcement: string): 'green' | 'yellow' | 'red' | 'gray' | 'blue' | 'white' {
  switch (enforcement) {
    case 'ALLOW': return 'green';
    case 'MODIFY': return 'yellow';
    case 'BLOCK': return 'red';
    case 'PENALIZE': return 'gray';
    case 'REWARD': return 'blue';
    case 'NEUTRAL': return 'white';
    case 'PAUSE': return 'yellow';
    default: return 'white';
  }
}

function outcomeIcon(enforcement: GuardStatus): string {
  switch (enforcement) {
    case 'ALLOW': return '●';
    case 'MODIFY': return '◐';
    case 'BLOCK': return '○';
    case 'PENALIZE': return '◌';
    case 'REWARD': return '◉';
    case 'NEUTRAL': return '◯';
    case 'PAUSE': return '◑';
    default: return '·';
  }
}

function emptyFlow(): DecisionFlow {
  return {
    intents: [],
    rules: [],
    outcomes: [],
    paths: [],
    metrics: {
      totalIntents: 0,
      totalRedirected: 0,
      redirectionRate: 0,
      byEnforcement: {},
      totalPenalties: 0,
      totalRewards: 0,
      netBehavioralPressure: 0,
    },
    periodStart: '',
    periodEnd: '',
    worldName: 'unknown',
  };
}
