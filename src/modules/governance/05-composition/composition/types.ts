/**
 * World Composition Engine — Type Definitions
 *
 * Types for deterministic merging of a base World and one or more
 * Module Worlds into a single resolved WorldDefinition.
 *
 * Design principles:
 * - Strict additive only (v1) — no overrides, no deletions
 * - ID collision = critical failure, never auto-resolved
 * - Deterministic output — same inputs = same result, always
 * - Pure function — base world never mutated in memory
 */

import type { WorldDefinition, Invariant, Rule, Guard, WorldRoleDefinition } from '../types';

// ─── Module ─────────────────────────────────────────────────────────────────

/**
 * A module is a partial world intended for composition.
 *
 * Modules are additive by design — they can only add invariants,
 * guards, rules, and roles. They cannot remove or modify existing items.
 *
 * Any top-level array may be omitted (treated as empty).
 */
export interface WorldModule {
  type: 'module';
  name: string;
  metadata?: {
    moduleVersion?: string;
    description?: string;
    author?: string;
  };

  /** Invariants to add (non-overridable governance constraints) */
  invariants?: Invariant[];

  /** Guards to add (enforcement primitives) */
  guards?: Guard[];

  /** Rules to add (contextual evaluation logic) */
  rules?: Rule[];

  /** Roles to add (authority definitions) */
  roles?: WorldRoleDefinition[];
}

// ─── Conflict ───────────────────────────────────────────────────────────────

/** Categories that can contain composable items */
export type ComposableCategory = 'invariants' | 'guards' | 'rules' | 'roles';

/**
 * A conflict detected during composition.
 *
 * In v1, the only conflict type is ID collision — a module item
 * shares an ID with a base world item. This is always critical
 * and blocks the merge.
 */
export interface CompositionConflict {
  type: 'id_collision';
  category: ComposableCategory;
  id: string;
  baseItem: Invariant | Guard | Rule | WorldRoleDefinition;
  moduleItem: Invariant | Guard | Rule | WorldRoleDefinition;
}

// ─── Diff ───────────────────────────────────────────────────────────────────

/**
 * Structured diff of what the composition changed.
 *
 * No removals exist in v1 — governance growth is monotonic.
 */
export interface CompositionDiff {
  added: {
    invariants: string[];
    guards: string[];
    rules: string[];
    roles: string[];
  };
  unchanged: {
    invariants: string[];
    guards: string[];
    rules: string[];
    roles: string[];
  };
}

// ─── Severity ───────────────────────────────────────────────────────────────

/**
 * Composition severity levels.
 *
 * Severity escalates to the highest level encountered:
 * - low: pure additive, no governance surface change (empty module, role-only)
 * - medium: governance surface expanded (invariants or guards added)
 * - high: reserved for future use (modifications, not in v1)
 * - critical: ID collision detected, merge blocked
 */
export type CompositionSeverity = 'low' | 'medium' | 'high' | 'critical';

// ─── Result ─────────────────────────────────────────────────────────────────

/**
 * The complete result of a composition operation.
 *
 * If conflicts exist, mergedWorld still contains the non-conflicting
 * additions — but the caller MUST NOT use it until conflicts are resolved.
 * The severity will be 'critical' whenever conflicts.length > 0.
 */
export interface CompositionResult {
  /** The merged world definition (only valid when conflicts.length === 0) */
  mergedWorld: WorldDefinition;

  /** Structured diff showing what was added/unchanged */
  diff: CompositionDiff;

  /** Any conflicts detected during composition */
  conflicts: CompositionConflict[];

  /** Overall severity of the composition */
  severity: CompositionSeverity;

  /** Module name for display */
  moduleName: string;

  /** Integrity hash of the merged world */
  worldHash: string;
}
