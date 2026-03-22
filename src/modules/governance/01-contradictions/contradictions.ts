/**
 * Contradiction Detector
 *
 * Finds structural conflicts in a world definition:
 * - Rules referencing non-existent state variables
 * - Rules referencing non-existent assumption parameters
 * - Circular exclusive_with chains
 * - Orphaned outcomes (computed but never affected by rules)
 * - Semantic tensions (rules with opposing effects on same target)
 * - Conflicting set operations (rules setting same target to different values)
 *
 * Deterministic — no AI calls.
 */

import type { WorldDefinition, StructuralConflict, Rule, Effect } from './types';

// ─── Effect Direction Classification ────────────────────────────────────────

type EffectDirection = 'increase' | 'decrease' | 'neutral';

/**
 * Classify the direction an effect pushes its target.
 *
 * - multiply > 1 = increase, multiply < 1 = decrease
 * - add positive = increase, add negative = decrease
 * - subtract positive = decrease, subtract negative = increase
 * - set/set_boolean = neutral (can't determine direction without current value)
 *
 * Returns 'neutral' for operations that can't be directionally classified.
 */
function classifyDirection(effect: Effect): EffectDirection {
  const { operation, value } = effect;

  if (typeof value === 'boolean' || typeof value === 'string') return 'neutral';

  const num = value as number;

  switch (operation) {
    case 'multiply':
    case 'multiply_dynamic':
      if (num > 1) return 'increase';
      if (num < 1) return 'decrease'; // includes 0 and negatives
      return 'neutral'; // exactly 1 = no change
    case 'add':
    case 'add_dynamic':
      if (num > 0) return 'increase';
      if (num < 0) return 'decrease';
      return 'neutral';
    case 'subtract':
    case 'subtract_dynamic':
      if (num > 0) return 'decrease';
      if (num < 0) return 'increase';
      return 'neutral';
    default:
      return 'neutral';
  }
}

/**
 * Describe an effect's operation in human-readable form.
 */
function describeEffect(effect: Effect): string {
  switch (effect.operation) {
    case 'multiply':
    case 'multiply_dynamic':
      return `multiplies by ${effect.value}`;
    case 'add':
    case 'add_dynamic':
      return `adds ${effect.value}`;
    case 'subtract':
    case 'subtract_dynamic':
      return `subtracts ${effect.value}`;
    case 'set':
    case 'set_dynamic':
    case 'set_boolean':
      return `sets to ${effect.value}`;
    default:
      return `${effect.operation} ${effect.value}`;
  }
}

// ─── Semantic Tension Detection ─────────────────────────────────────────────

interface TargetEffect {
  ruleId: string;
  ruleLabel: string;
  direction: EffectDirection;
  effect: Effect;
}

/**
 * Detect semantic tensions between rules.
 *
 * A semantic tension exists when:
 * 1. Two rules affect the same target in opposing directions
 *    (one increases, the other decreases)
 * 2. Two rules set the same target to different values
 *
 * Rules declared as exclusive_with each other are excluded
 * (they can't both fire, so no real tension).
 *
 * Returns warnings, not errors — tensions are not structural failures,
 * they are governance transparency signals.
 */
export function detectSemanticTensions(rules: Rule[]): StructuralConflict[] {
  const conflicts: StructuralConflict[] = [];
  if (rules.length < 2) return conflicts;

  // Build exclusive_with lookup for O(1) pair checking
  const exclusivePairs = new Set<string>();
  for (const rule of rules) {
    if (rule.exclusive_with) {
      exclusivePairs.add(`${rule.id}:${rule.exclusive_with}`);
      exclusivePairs.add(`${rule.exclusive_with}:${rule.id}`);
    }
  }

  const isExclusive = (a: string, b: string) => exclusivePairs.has(`${a}:${b}`);

  // ── Phase 1: Opposing numeric directions on same target ───────────

  const targetEffects = new Map<string, TargetEffect[]>();

  for (const rule of rules) {
    const allEffects = [
      ...(rule.effects || []),
      ...(rule.effects_conditional || []).flatMap(c => c.effects),
    ];

    for (const effect of allEffects) {
      const direction = classifyDirection(effect);
      if (direction === 'neutral') continue;

      const entries = targetEffects.get(effect.target) ?? [];
      entries.push({
        ruleId: rule.id,
        ruleLabel: rule.label,
        direction,
        effect,
      });
      targetEffects.set(effect.target, entries);
    }
  }

  for (const [target, effects] of targetEffects) {
    const increasing = effects.filter(e => e.direction === 'increase');
    const decreasing = effects.filter(e => e.direction === 'decrease');

    if (increasing.length === 0 || decreasing.length === 0) continue;

    // Collect non-exclusive opposing rules
    const incRuleIds = new Set<string>();
    const decRuleIds = new Set<string>();

    for (const inc of increasing) {
      for (const dec of decreasing) {
        if (inc.ruleId === dec.ruleId) continue;
        if (isExclusive(inc.ruleId, dec.ruleId)) continue;
        incRuleIds.add(inc.ruleId);
        decRuleIds.add(dec.ruleId);
      }
    }

    if (incRuleIds.size === 0 || decRuleIds.size === 0) continue;

    const incLabels = [...incRuleIds].map(id => {
      const e = increasing.find(e => e.ruleId === id)!;
      return `"${e.ruleLabel}" (${describeEffect(e.effect)})`;
    });
    const decLabels = [...decRuleIds].map(id => {
      const e = decreasing.find(e => e.ruleId === id)!;
      return `"${e.ruleLabel}" (${describeEffect(e.effect)})`;
    });

    conflicts.push({
      type: 'semantic_tension',
      severity: 'warning',
      message: `Opposing effects on "${target}": ${incLabels.join(', ')} increase it while ${decLabels.join(', ')} decrease it`,
      affectedBlocks: ['rules'],
    });
  }

  // ── Phase 2: Conflicting set operations on same target ────────────

  const setEffects = new Map<string, Array<{
    ruleId: string;
    ruleLabel: string;
    value: number | boolean | string;
  }>>();

  for (const rule of rules) {
    const allEffects = [
      ...(rule.effects || []),
      ...(rule.effects_conditional || []).flatMap(c => c.effects),
    ];

    for (const effect of allEffects) {
      if (effect.operation !== 'set' && effect.operation !== 'set_boolean' && effect.operation !== 'set_dynamic') continue;

      const entries = setEffects.get(effect.target) ?? [];
      entries.push({
        ruleId: rule.id,
        ruleLabel: rule.label,
        value: effect.value,
      });
      setEffects.set(effect.target, entries);
    }
  }

  for (const [target, effects] of setEffects) {
    if (effects.length < 2) continue;

    // Group by value
    const byValue = new Map<string, typeof effects>();
    for (const e of effects) {
      const key = String(e.value);
      const existing = byValue.get(key) ?? [];
      existing.push(e);
      byValue.set(key, existing);
    }

    if (byValue.size < 2) continue; // All set to same value — no tension

    // Check for non-exclusive pairs across different values
    const valueGroups = [...byValue.entries()];
    const involvedRules: string[] = [];

    for (let i = 0; i < valueGroups.length; i++) {
      for (let j = i + 1; j < valueGroups.length; j++) {
        for (const a of valueGroups[i][1]) {
          for (const b of valueGroups[j][1]) {
            if (a.ruleId === b.ruleId) continue;
            if (isExclusive(a.ruleId, b.ruleId)) continue;
            if (!involvedRules.includes(a.ruleId)) involvedRules.push(a.ruleId);
            if (!involvedRules.includes(b.ruleId)) involvedRules.push(b.ruleId);
          }
        }
      }
    }

    if (involvedRules.length === 0) continue;

    const descriptions = involvedRules.map(id => {
      const e = effects.find(e => e.ruleId === id)!;
      return `"${e.ruleLabel}" sets to ${e.value}`;
    });

    conflicts.push({
      type: 'semantic_tension',
      severity: 'warning',
      message: `Conflicting set operations on "${target}": ${descriptions.join(', ')}`,
      affectedBlocks: ['rules'],
    });
  }

  return conflicts;
}

// ─── Main Contradiction Detector ────────────────────────────────────────────

export function detectContradictions(world: WorldDefinition): StructuralConflict[] {
  const conflicts: StructuralConflict[] = [];

  // Semantic tension detection — only needs rules, no schema/assumption dependency
  if (world.rules && world.rules.length >= 2) {
    conflicts.push(...detectSemanticTensions(world.rules));
  }

  // Structural reference checks require rules + schema + assumptions
  if (!world.rules?.length || !world.stateSchema || !world.assumptions) {
    return conflicts;
  }

  const stateVars = new Set(Object.keys(world.stateSchema.variables));
  const assumptionParams = new Set(Object.keys(world.assumptions.parameter_definitions || {}));
  const outcomeIds = new Set((world.outcomes?.computed_outcomes || []).map(o => o.id));
  const ruleIds = new Set(world.rules.map(r => r.id));

  // All valid fields = state vars + outcome IDs (outcomes are computed state)
  const allValidFields = new Set([...stateVars, ...outcomeIds]);

  for (const rule of world.rules) {
    if (!rule || !rule.triggers) continue;

    // Check triggers reference valid fields
    for (const trigger of rule.triggers) {
      if (trigger.source === 'state' && !allValidFields.has(trigger.field)) {
        conflicts.push({
          type: 'missing_reference',
          severity: 'error',
          message: `Rule "${rule.id}" trigger references unknown state variable "${trigger.field}"`,
          affectedBlocks: ['rules', 'stateSchema'],
        });
      }
      if (trigger.source === 'assumption' && !assumptionParams.has(trigger.field)) {
        conflicts.push({
          type: 'missing_reference',
          severity: 'error',
          message: `Rule "${rule.id}" trigger references unknown assumption parameter "${trigger.field}"`,
          affectedBlocks: ['rules', 'assumptions'],
        });
      }
    }

    // Check effects reference valid targets
    const allEffects = [
      ...(rule.effects || []),
      ...(rule.effects_conditional || []).flatMap(c => c.effects),
    ];
    for (const effect of allEffects) {
      if (!allValidFields.has(effect.target)) {
        conflicts.push({
          type: 'missing_reference',
          severity: 'error',
          message: `Rule "${rule.id}" effect targets unknown field "${effect.target}"`,
          affectedBlocks: ['rules', 'outcomes'],
        });
      }
    }

    // Check exclusive_with references valid rule
    if (rule.exclusive_with && !ruleIds.has(rule.exclusive_with)) {
      conflicts.push({
        type: 'missing_reference',
        severity: 'warning',
        message: `Rule "${rule.id}" exclusive_with references unknown rule "${rule.exclusive_with}"`,
        affectedBlocks: ['rules'],
      });
    }

    // Check conditional effects reference valid fields
    for (const cond of rule.effects_conditional || []) {
      if (cond.condition.source === 'assumption' && !assumptionParams.has(cond.condition.field)) {
        conflicts.push({
          type: 'missing_reference',
          severity: 'error',
          message: `Rule "${rule.id}" conditional references unknown assumption "${cond.condition.field}"`,
          affectedBlocks: ['rules', 'assumptions'],
        });
      }
      if (cond.and?.source === 'assumption' && !assumptionParams.has(cond.and.field)) {
        conflicts.push({
          type: 'missing_reference',
          severity: 'error',
          message: `Rule "${rule.id}" conditional AND references unknown assumption "${cond.and.field}"`,
          affectedBlocks: ['rules', 'assumptions'],
        });
      }
    }
  }

  // Check for circular exclusive_with
  for (const rule of world.rules) {
    if (rule.exclusive_with) {
      const target = world.rules.find(r => r.id === rule.exclusive_with);
      if (target?.exclusive_with === rule.id) {
        conflicts.push({
          type: 'circular_dependency',
          severity: 'warning',
          message: `Rules "${rule.id}" and "${target.id}" are mutually exclusive with each other — only the first (by order) can ever fire`,
          affectedBlocks: ['rules'],
        });
      }
    }
  }

  // Check gates reference valid fields
  if (world.gates) {
    for (const gate of world.gates.viability_classification) {
      if (!allValidFields.has(gate.field)) {
        conflicts.push({
          type: 'missing_reference',
          severity: 'error',
          message: `Viability gate "${gate.status}" references unknown field "${gate.field}"`,
          affectedBlocks: ['gates', 'outcomes'],
        });
      }
    }
  }

  // Check for outcomes that no rule ever affects
  const affectedTargets = new Set<string>();
  for (const rule of world.rules) {
    for (const effect of rule.effects || []) {
      affectedTargets.add(effect.target);
    }
    for (const cond of rule.effects_conditional || []) {
      for (const effect of cond.effects) {
        affectedTargets.add(effect.target);
      }
    }
  }

  for (const outcome of world.outcomes?.computed_outcomes || []) {
    if (
      !outcome.derived_from &&
      !outcome.initial_value &&
      outcome.default === undefined &&
      !affectedTargets.has(outcome.id)
    ) {
      conflicts.push({
        type: 'orphaned_rule',
        severity: 'warning',
        message: `Outcome "${outcome.id}" is never computed by any rule and has no default`,
        affectedBlocks: ['outcomes', 'rules'],
      });
    }
  }

  return conflicts;
}
