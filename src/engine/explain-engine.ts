/**
 * Explain Engine — Generates human-readable narrative summaries from compiled worlds.
 *
 * No AI calls. Pure template-based rendering from WorldDefinition data.
 *
 * Sections:
 *   1. Core thesis and identity
 *   2. Key dynamics (rules with causal_translation)
 *   3. State variables (what can change)
 *   4. Invariants (what cannot change)
 *   5. Viability gates (health thresholds)
 *   6. Dramatic tensions (opposing rule effects)
 *   7. Outcomes (what gets measured)
 */

import type { WorldDefinition, Rule, Effect } from '../types';
import { collectAllEffects } from './rule-utils';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExplainOutput {
  worldName: string;
  worldId: string;
  thesis: string;
  dynamics: DynamicSummary[];
  stateVariables: VariableSummary[];
  invariants: InvariantSummary[];
  gates: GateSummary[];
  tensions: TensionSummary[];
  outcomes: OutcomeSummary[];
  stats: WorldStats;
}

export interface DynamicSummary {
  ruleId: string;
  label: string;
  severity: string;
  triggerDescription: string;
  effectDescription: string;
  targets: string[];
}

export interface VariableSummary {
  name: string;
  label: string;
  type: string;
  defaultValue: string | number | boolean;
  range?: string;
}

export interface InvariantSummary {
  id: string;
  label: string;
  enforcement: string;
}

export interface GateSummary {
  status: string;
  field: string;
  threshold: string;
}

export interface TensionSummary {
  variable: string;
  increasedBy: string[];
  decreasedBy: string[];
}

export interface OutcomeSummary {
  id: string;
  label: string;
  type: string;
  primary: boolean;
}

export interface WorldStats {
  invariants: number;
  stateVariables: number;
  rules: number;
  gates: number;
  outcomes: number;
  assumptions: number;
}

// ─── Analysis ────────────────────────────────────────────────────────────────

/**
 * Detect semantic tensions: variables that have both increasing and
 * decreasing effects from different rules.
 */
function detectTensions(rules: Rule[]): TensionSummary[] {
  const increases = new Map<string, string[]>();
  const decreases = new Map<string, string[]>();

  for (const rule of rules) {
    const allEffects = collectAllEffects(rule);
    for (const effect of allEffects) {
      const target = effect.target;
      const isIncrease = effect.operation === 'add' ||
        (effect.operation === 'multiply' && typeof effect.value === 'number' && effect.value > 1);
      const isDecrease = effect.operation === 'subtract' ||
        (effect.operation === 'multiply' && typeof effect.value === 'number' && effect.value < 1);

      if (isIncrease) {
        if (!increases.has(target)) increases.set(target, []);
        increases.get(target)!.push(rule.label);
      }
      if (isDecrease) {
        if (!decreases.has(target)) decreases.set(target, []);
        decreases.get(target)!.push(rule.label);
      }
    }
  }

  const tensions: TensionSummary[] = [];
  for (const [variable, incRules] of increases) {
    const decRules = decreases.get(variable);
    if (decRules && decRules.length > 0) {
      tensions.push({
        variable,
        increasedBy: incRules,
        decreasedBy: decRules,
      });
    }
  }

  return tensions;
}

// collectAllEffects is now imported from rule-utils.ts

// ─── Main ────────────────────────────────────────────────────────────────────

export function explainWorld(world: WorldDefinition): ExplainOutput {
  // Dynamics from rules
  const dynamics: DynamicSummary[] = [...world.rules]
    .sort((a, b) => a.order - b.order)
    .map(rule => {
      const allEffects = collectAllEffects(rule);
      return {
        ruleId: rule.id,
        label: rule.label,
        severity: rule.severity,
        triggerDescription: rule.causal_translation?.trigger_text ?? describeTriggers(rule),
        effectDescription: rule.causal_translation?.effect_text ?? describeEffects(allEffects),
        targets: [...new Set(allEffects.map(e => e.target))],
      };
    });

  // State variables
  const stateVariables: VariableSummary[] = Object.entries(world.stateSchema.variables ?? {}).map(
    ([name, v]) => ({
      name,
      label: v.label || name,
      type: v.type,
      defaultValue: v.default,
      range: v.type === 'number' && v.min !== undefined && v.max !== undefined
        ? `${v.min}–${v.max}`
        : v.type === 'enum' && v.options
          ? v.options.join(', ')
          : undefined,
    }),
  );

  // Invariants
  const invariants: InvariantSummary[] = world.invariants.map(inv => ({
    id: inv.id,
    label: inv.label,
    enforcement: inv.enforcement,
  }));

  // Gates
  const gates: GateSummary[] = (world.gates.viability_classification ?? []).map(g => ({
    status: g.status,
    field: g.field,
    threshold: `${g.operator} ${g.value}`,
  }));

  // Tensions
  const tensions = detectTensions(world.rules);

  // Outcomes
  const outcomes: OutcomeSummary[] = (world.outcomes.computed_outcomes ?? []).map(o => ({
    id: o.id,
    label: o.label,
    type: o.type,
    primary: o.primary ?? false,
  }));

  // Stats
  const stats: WorldStats = {
    invariants: world.invariants.length,
    stateVariables: Object.keys(world.stateSchema.variables ?? {}).length,
    rules: world.rules.length,
    gates: (world.gates.viability_classification ?? []).length,
    outcomes: (world.outcomes.computed_outcomes ?? []).length,
    assumptions: Object.keys(world.assumptions.profiles ?? {}).length,
  };

  return {
    worldName: world.world.name,
    worldId: world.world.world_id,
    thesis: world.world.thesis,
    dynamics,
    stateVariables,
    invariants,
    gates,
    tensions,
    outcomes,
    stats,
  };
}

// ─── Fallback Describers ─────────────────────────────────────────────────────

function describeTriggers(rule: Rule): string {
  if (!rule.triggers || rule.triggers.length === 0) return 'Always active';
  return rule.triggers
    .map(t => `${t.field} ${t.operator} ${t.value}`)
    .join(' AND ');
}

function describeEffects(effects: Effect[]): string {
  if (effects.length === 0) return 'No direct effects';
  return effects
    .map(e => {
      switch (e.operation) {
        case 'multiply': return `${e.target} scaled by ${e.value}`;
        case 'add': return `${e.target} increased by ${e.value}`;
        case 'subtract': return `${e.target} decreased by ${e.value}`;
        case 'set': return `${e.target} set to ${e.value}`;
        case 'set_boolean': return `${e.target} set to ${e.value}`;
        default: return `${e.target} ${e.operation} ${e.value}`;
      }
    })
    .join('; ');
}

// ─── Text Renderer ───────────────────────────────────────────────────────────

export function renderExplainText(output: ExplainOutput): string {
  const lines: string[] = [];

  // Header
  lines.push(`WORLD: ${output.worldName}`);
  lines.push(`ID: ${output.worldId}`);
  lines.push('');

  // Thesis
  if (output.thesis) {
    lines.push('THESIS');
    lines.push(`  ${output.thesis}`);
    lines.push('');
  }

  // Stats
  lines.push('STRUCTURE');
  lines.push(`  ${output.stats.invariants} invariants, ${output.stats.stateVariables} state variables, ${output.stats.rules} rules`);
  lines.push(`  ${output.stats.gates} viability gates, ${output.stats.outcomes} outcomes, ${output.stats.assumptions} assumption profiles`);
  lines.push('');

  // Key dynamics
  if (output.dynamics.length > 0) {
    lines.push('KEY DYNAMICS');
    for (const d of output.dynamics) {
      const severity = d.severity === 'structural' ? '[structural]'
        : d.severity === 'advantage' ? '[advantage]'
          : '[degradation]';
      lines.push(`  ${d.label} ${severity}`);
      lines.push(`    When: ${d.triggerDescription}`);
      lines.push(`    Then: ${d.effectDescription}`);
    }
    lines.push('');
  }

  // Tensions
  if (output.tensions.length > 0) {
    lines.push('DRAMATIC TENSIONS');
    for (const t of output.tensions) {
      lines.push(`  ${t.variable}:`);
      lines.push(`    Increased by: ${t.increasedBy.join(', ')}`);
      lines.push(`    Decreased by: ${t.decreasedBy.join(', ')}`);
    }
    lines.push('');
  }

  // State variables
  if (output.stateVariables.length > 0) {
    lines.push('STATE VARIABLES');
    for (const v of output.stateVariables) {
      const range = v.range ? ` (${v.range})` : '';
      lines.push(`  ${v.label}: ${v.type}, default ${v.defaultValue}${range}`);
    }
    lines.push('');
  }

  // Invariants
  if (output.invariants.length > 0) {
    lines.push('INVARIANTS (cannot change)');
    for (const inv of output.invariants) {
      lines.push(`  ${inv.label} [${inv.enforcement}]`);
    }
    lines.push('');
  }

  // Gates
  if (output.gates.length > 0) {
    lines.push('VIABILITY GATES');
    for (const g of output.gates) {
      lines.push(`  ${g.status}: ${g.field} ${g.threshold}`);
    }
    lines.push('');
  }

  // Outcomes
  if (output.outcomes.length > 0) {
    lines.push('OUTCOMES');
    for (const o of output.outcomes) {
      const primary = o.primary ? ' [primary]' : '';
      lines.push(`  ${o.label} (${o.type})${primary}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
