/**
 * World Composition Engine — composeWorld()
 *
 * Deterministic merging of a base WorldDefinition and a WorldModule
 * into a single resolved WorldDefinition.
 *
 * RULES (v1 — Strict Additive Model):
 * 1. ID collision on any item → critical conflict, merge blocked
 * 2. Module items are appended to base arrays (base order preserved)
 * 3. Missing module sections treated as empty (no changes)
 * 4. No deletions, no modifications, no overrides
 * 5. Function is pure — base world never mutated
 * 6. Deterministic — same inputs = same output, always
 *
 * The runtime always consumes a fully resolved world.
 * Layering is conceptual. Execution sees only one artifact.
 */

import type { WorldDefinition, Invariant, Rule, Guard, WorldRoleDefinition } from '../types';
import type {
  WorldModule,
  CompositionResult,
  CompositionConflict,
  CompositionDiff,
  CompositionSeverity,
  ComposableCategory,
} from './types';
import { computeIntegrityHash } from '../compiler';

// ─── ID Extraction ──────────────────────────────────────────────────────────

/** Extract the `id` field from any composable item. */
function getId(item: { id: string }): string {
  return item.id;
}

// ─── Category Merge ─────────────────────────────────────────────────────────

interface MergeResult<T extends { id: string }> {
  merged: T[];
  conflicts: CompositionConflict[];
  addedIds: string[];
  unchangedIds: string[];
}

/**
 * Merge a single category array (invariants, guards, rules, or roles).
 *
 * Base order is preserved. Module items are appended in module order.
 * ID collisions produce conflict entries and the colliding items are
 * NOT added to the merged array.
 */
function mergeCategory<T extends { id: string }>(
  baseItems: T[],
  moduleItems: T[],
  category: ComposableCategory,
): MergeResult<T> {
  const conflicts: CompositionConflict[] = [];
  const addedIds: string[] = [];
  const unchangedIds: string[] = baseItems.map(getId);

  // Build an ID set from the base for O(1) collision detection
  const baseIdSet = new Set(baseItems.map(getId));

  // Check each module item for ID collision
  const nonConflicting: T[] = [];
  for (const moduleItem of moduleItems) {
    if (baseIdSet.has(moduleItem.id)) {
      const baseItem = baseItems.find(b => b.id === moduleItem.id)!;
      conflicts.push({
        type: 'id_collision',
        category,
        id: moduleItem.id,
        baseItem: baseItem as any,
        moduleItem: moduleItem as any,
      });
    } else {
      nonConflicting.push(moduleItem);
      addedIds.push(moduleItem.id);
    }
  }

  // Preserve base order, append non-conflicting module items
  const merged = [...baseItems, ...nonConflicting];

  return { merged, conflicts, addedIds, unchangedIds };
}

// ─── Severity Computation ───────────────────────────────────────────────────

/**
 * Compute the overall severity of a composition.
 *
 * Severity escalates to the highest level encountered:
 * - critical: any ID collision
 * - medium: invariants or guards added (governance surface expanded)
 * - low: only rules or roles added, or nothing changed
 */
function computeSeverity(
  diff: CompositionDiff,
  conflicts: CompositionConflict[],
): CompositionSeverity {
  if (conflicts.length > 0) return 'critical';

  const hasInvariantAdditions = diff.added.invariants.length > 0;
  const hasGuardAdditions = diff.added.guards.length > 0;

  if (hasInvariantAdditions || hasGuardAdditions) return 'medium';

  const hasRuleAdditions = diff.added.rules.length > 0;
  const hasRoleAdditions = diff.added.roles.length > 0;

  if (hasRuleAdditions || hasRoleAdditions) return 'low';

  // Nothing changed at all
  return 'low';
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Compose a base world with a module, producing a merged world.
 *
 * This is a pure function. It never mutates the base world.
 * The result contains the merged world, a structured diff,
 * any conflicts detected, and the overall severity.
 *
 * If conflicts exist (severity = 'critical'), the mergedWorld
 * contains only non-conflicting additions. The caller MUST NOT
 * activate it until all conflicts are resolved.
 */
export function composeWorld(
  baseWorld: WorldDefinition,
  module: WorldModule,
): CompositionResult {
  // Deep clone the base world — we never mutate the original
  const base = structuredClone(baseWorld);

  // ── Merge each category ──────────────────────────────────────

  // Invariants
  const invariantResult = mergeCategory<Invariant>(
    base.invariants ?? [],
    module.invariants ?? [],
    'invariants',
  );

  // Guards (nested inside GuardsConfig)
  const baseGuards = base.guards?.guards ?? [];
  const guardResult = mergeCategory<Guard>(
    baseGuards,
    module.guards ?? [],
    'guards',
  );

  // Rules
  const ruleResult = mergeCategory<Rule>(
    base.rules ?? [],
    module.rules ?? [],
    'rules',
  );

  // Roles (nested inside RolesConfig)
  const baseRoles = base.roles?.roles ?? [];
  const roleResult = mergeCategory<WorldRoleDefinition>(
    baseRoles,
    module.roles ?? [],
    'roles',
  );

  // ── Collect all conflicts ────────────────────────────────────

  const conflicts: CompositionConflict[] = [
    ...invariantResult.conflicts,
    ...guardResult.conflicts,
    ...ruleResult.conflicts,
    ...roleResult.conflicts,
  ];

  // ── Build diff ───────────────────────────────────────────────

  const diff: CompositionDiff = {
    added: {
      invariants: invariantResult.addedIds,
      guards: guardResult.addedIds,
      rules: ruleResult.addedIds,
      roles: roleResult.addedIds,
    },
    unchanged: {
      invariants: invariantResult.unchangedIds,
      guards: guardResult.unchangedIds,
      rules: ruleResult.unchangedIds,
      roles: roleResult.unchangedIds,
    },
  };

  // ── Compute severity ─────────────────────────────────────────

  const severity = computeSeverity(diff, conflicts);

  // ── Assemble merged world ────────────────────────────────────

  const mergedWorld: WorldDefinition = {
    ...base,
    invariants: invariantResult.merged,
    rules: ruleResult.merged,
  };

  // Guards: preserve existing GuardsConfig structure, update guards array
  if (guardResult.merged.length > 0) {
    mergedWorld.guards = {
      guards: guardResult.merged,
      intent_vocabulary: base.guards?.intent_vocabulary ?? {},
    };
  }

  // Roles: preserve existing RolesConfig structure, update roles array
  if (roleResult.merged.length > 0) {
    mergedWorld.roles = {
      assignment: base.roles?.assignment ?? 'dynamic',
      roles: roleResult.merged,
      transitions: base.roles?.transitions,
    };
  }

  // ── Compute integrity hash ───────────────────────────────────

  const worldHash = computeIntegrityHash(mergedWorld);

  return {
    mergedWorld,
    diff,
    conflicts,
    severity,
    moduleName: module.name,
    worldHash,
  };
}

/**
 * Compose a base world with multiple modules in sequence.
 *
 * Modules are applied in array order. Each module sees the result
 * of all previous compositions. This means order matters —
 * Module B sees Module A's additions.
 *
 * Stops on first critical conflict unless continueOnConflict is true.
 */
export function composeWorldMulti(
  baseWorld: WorldDefinition,
  modules: WorldModule[],
  options?: { continueOnConflict?: boolean },
): CompositionResult {
  if (modules.length === 0) {
    return {
      mergedWorld: structuredClone(baseWorld),
      diff: {
        added: { invariants: [], guards: [], rules: [], roles: [] },
        unchanged: {
          invariants: (baseWorld.invariants ?? []).map(i => i.id),
          guards: (baseWorld.guards?.guards ?? []).map(g => g.id),
          rules: (baseWorld.rules ?? []).map(r => r.id),
          roles: (baseWorld.roles?.roles ?? []).map(r => r.id),
        },
      },
      conflicts: [],
      severity: 'low',
      moduleName: '(none)',
      worldHash: computeIntegrityHash(baseWorld),
    };
  }

  let currentWorld = baseWorld;
  const allConflicts: CompositionConflict[] = [];
  const aggregateDiff: CompositionDiff = {
    added: { invariants: [], guards: [], rules: [], roles: [] },
    unchanged: {
      invariants: (baseWorld.invariants ?? []).map(i => i.id),
      guards: (baseWorld.guards?.guards ?? []).map(g => g.id),
      rules: (baseWorld.rules ?? []).map(r => r.id),
      roles: (baseWorld.roles?.roles ?? []).map(r => r.id),
    },
  };
  const moduleNames: string[] = [];

  for (const module of modules) {
    const result = composeWorld(currentWorld, module);
    moduleNames.push(module.name);

    // Accumulate diff
    aggregateDiff.added.invariants.push(...result.diff.added.invariants);
    aggregateDiff.added.guards.push(...result.diff.added.guards);
    aggregateDiff.added.rules.push(...result.diff.added.rules);
    aggregateDiff.added.roles.push(...result.diff.added.roles);

    // Accumulate conflicts
    allConflicts.push(...result.conflicts);

    // Stop on conflict unless told to continue
    if (result.conflicts.length > 0 && !options?.continueOnConflict) {
      return {
        mergedWorld: result.mergedWorld,
        diff: aggregateDiff,
        conflicts: allConflicts,
        severity: 'critical',
        moduleName: moduleNames.join(' + '),
        worldHash: result.worldHash,
      };
    }

    currentWorld = result.mergedWorld;
  }

  const finalHash = computeIntegrityHash(currentWorld);
  const severity = computeSeverity(aggregateDiff, allConflicts);

  return {
    mergedWorld: currentWorld,
    diff: aggregateDiff,
    conflicts: allConflicts,
    severity,
    moduleName: moduleNames.join(' + '),
    worldHash: finalHash,
  };
}
