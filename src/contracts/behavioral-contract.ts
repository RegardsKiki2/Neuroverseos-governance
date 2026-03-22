/**
 * Behavioral Contract — Types for the Behavioral Analysis Engine
 *
 * Extracted from behavioral-engine.ts so other modules (CLI, API, tests)
 * can depend on the contract without pulling in implementation.
 *
 * Types:
 *   ActionCategory  — Categories of agent actions for behavioral shift tracking
 *   Adaptation      — A classified behavioral adaptation (what an agent did instead)
 *   BehavioralPattern — An emergent behavioral pattern detected across agents
 *   NetworkContext  — Network-level context for narrative generation
 */

import type { GuardStatus } from './guard-contract';

// ─── Action Categories ──────────────────────────────────────────────────────

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

// ─── Adaptation ─────────────────────────────────────────────────────────────

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

// ─── Behavioral Pattern ─────────────────────────────────────────────────────

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

// ─── Network Context ────────────────────────────────────────────────────────

/** Network-level context for narrative generation */
export interface NetworkContext {
  mood?: string;
  misinfoLevel?: number;
  totalAgents?: number;
  totalActions?: number;
  [key: string]: unknown;
}
