/**
 * Runtime Types — Simple input types for HTTP/demo consumers
 *
 * These types are the "easy API" for code that doesn't load full world files.
 * The govern() bridge converts these into the guard engine's native types.
 */

// ─── Agent Action ───────────────────────────────────────────────────────────

/**
 * A plain-object description of an agent action.
 * This is what HTTP clients and Python simulations send.
 */
export interface AgentAction {
  /** Agent or role identifier */
  agentId: string;

  /** Action type (e.g., "publish", "trade", "share", "cite") */
  type: string;

  /** Human-readable description of what the agent is doing */
  description: string;

  /** Action magnitude/intensity (0-1 scale) */
  magnitude?: number;

  /** Arbitrary context data */
  context?: Record<string, unknown>;
}

// ─── World State ────────────────────────────────────────────────────────────

/**
 * Arbitrary key-value state passed alongside an action.
 * Used by the simulation bridge to provide environmental context.
 */
export type WorldState = Record<string, unknown>;

// ─── Governor Config ────────────────────────────────────────────────────────

/**
 * Configuration for creating a governor instance.
 */
export interface GovernorConfig {
  /** Path to a .nv-world.md or .nv-world.zip file */
  worldPath?: string;

  /** Enable evaluation trace in verdicts */
  trace?: boolean;

  /** Enforcement level override */
  level?: 'basic' | 'standard' | 'strict';
}
