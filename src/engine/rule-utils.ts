/**
 * Shared Rule Utilities for Engine Layer
 *
 * Consolidates duplicated rule-processing logic:
 *   - Effect collection (was in explain-engine, validate-engine)
 */

import type { Effect, Rule } from '../types';

/**
 * Collect all effects from a rule, including conditional effects.
 *
 * Previously duplicated in:
 *   - explain-engine.ts:129-135 (collectAllEffects)
 *   - validate-engine.ts (inline effect collection)
 */
export function collectAllEffects(rule: Rule): Effect[] {
  const effects: Effect[] = [...(rule.effects ?? [])];
  for (const ce of rule.effects_conditional ?? []) {
    effects.push(...ce.effects);
  }
  return effects;
}
