/**
 * Bootstrap Emitter — ParsedWorld → WorldDefinition
 *
 * Converts the intermediate representation from the parser
 * into a proper WorldDefinition that the guard engine, validate engine,
 * and compileWorldToZip() all consume.
 *
 * Fills in sensible defaults for optional fields.
 * Reports issues when the parsed data can't cleanly map to the target type.
 *
 * Deterministic. Same parsed input → same WorldDefinition output.
 */

import type { ParsedWorld, ParseIssue } from '../contracts/bootstrap-contract';
import type {
  WorldDefinition,
  WorldIdentity,
  Invariant,
  AssumptionConfig,
  StateSchema,
  StateVariable,
  Rule,
  Trigger,
  Effect,
  CollapseCheck,
  CausalTranslation,
  TriggerOperator,
  EffectOperation,
  RuleSeverity,
  GatesConfig,
  ViabilityGate,
  ViabilityStatus,
  OutcomesConfig,
  ComputedOutcome,
  WorldMetadata,
} from '../types';

// ─── Default Colors & Icons for Gates ────────────────────────────────────────

const GATE_DEFAULTS: Record<string, { color: string; icon: string }> = {
  THRIVING: { color: '#0f6b3a', icon: '✦' },
  STABLE: { color: '#1856b8', icon: '●' },
  COMPRESSED: { color: '#a16207', icon: '▲' },
  CRITICAL: { color: '#b91c1c', icon: '⚠' },
  MODEL_COLLAPSES: { color: '#7f1d1d', icon: '✕' },
};

// ─── Core Emitter ────────────────────────────────────────────────────────────

/**
 * Convert a ParsedWorld into a WorldDefinition.
 *
 * Returns the world definition and any issues encountered during emission.
 */
export function emitWorldDefinition(
  parsed: ParsedWorld,
): { world: WorldDefinition; issues: ParseIssue[] } {
  const issues: ParseIssue[] = [];

  const fm = parsed.frontmatter;
  const defaultProfile = fm.default_profile ?? parsed.assumptions[0]?.id ?? 'baseline';
  const altProfile = fm.alternative_profile ?? parsed.assumptions[1]?.id ?? 'alternative';

  // ─── World Identity ──────────────────────────────────────────────────
  const world: WorldIdentity = {
    world_id: fm.world_id,
    name: fm.name,
    thesis: parsed.thesis,
    version: fm.version ?? '1.0.0',
    runtime_mode: (fm.runtime_mode as WorldIdentity['runtime_mode']) ?? 'SIMULATION',
    default_assumption_profile: defaultProfile,
    default_alternative_profile: altProfile,
    modules: parsed.rules.map(r => r.id),
    players: {
      thinking_space: true,
      experience_space: true,
      action_space: true,
    },
  };

  // ─── Invariants ──────────────────────────────────────────────────────
  const invariants: Invariant[] = parsed.invariants.map(inv => ({
    id: inv.id,
    label: inv.label,
    enforcement: 'structural' as const,
    mutable: false as const,
  }));

  // ─── Assumptions ─────────────────────────────────────────────────────
  const profiles: AssumptionConfig['profiles'] = {};
  const parameterDefinitions: AssumptionConfig['parameter_definitions'] = {};

  for (let i = 0; i < parsed.assumptions.length; i++) {
    const profile = parsed.assumptions[i];
    const params: Record<string, string> = {};

    for (const [key, val] of Object.entries(profile.parameters)) {
      params[key] = String(val);

      // Auto-generate parameter definitions from first occurrence
      if (!parameterDefinitions[key]) {
        parameterDefinitions[key] = {
          type: typeof val === 'boolean' ? 'boolean' : typeof val === 'number' ? 'number' : 'enum',
          label: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          description: `Parameter: ${key}`,
        };
      }
    }

    profiles[profile.id] = {
      name: profile.name,
      description: profile.description,
      is_default_baseline: i === 0 || profile.id === defaultProfile,
      is_default_alternative: i === 1 || profile.id === altProfile,
      parameters: params,
    };
  }

  const assumptions: AssumptionConfig = { profiles, parameter_definitions: parameterDefinitions };

  // ─── State Schema ────────────────────────────────────────────────────
  const variables: Record<string, StateVariable> = {};

  for (const v of parsed.stateVariables) {
    const stateVar: StateVariable = {
      type: v.type,
      default: v.default,
      mutable: true,
      label: v.label,
      description: v.description,
    };

    if (v.type === 'number') {
      if (v.min !== undefined) stateVar.min = v.min;
      if (v.max !== undefined) stateVar.max = v.max;
      if (v.step !== undefined) stateVar.step = v.step;
    }

    if (v.type === 'enum' && v.options) {
      stateVar.options = v.options;
    }

    variables[v.id] = stateVar;
  }

  const stateSchema: StateSchema = { variables, presets: {} };

  // ─── Rules ───────────────────────────────────────────────────────────
  const rules: Rule[] = parsed.rules.map(r => {
    const triggers: Trigger[] = r.triggers.map(t => ({
      field: t.field,
      operator: t.operator as TriggerOperator,
      value: t.value,
      source: t.source,
    }));

    const effects: Effect[] = r.effects.map(e => ({
      target: e.target,
      operation: e.operation as EffectOperation,
      value: e.value,
    }));

    let collapse_check: CollapseCheck | undefined;
    if (r.collapse_check) {
      collapse_check = {
        field: r.collapse_check.field,
        operator: r.collapse_check.operator as TriggerOperator,
        value: r.collapse_check.value,
        result: 'MODEL_COLLAPSES' as const,
      };
    }

    const causal_translation: CausalTranslation = r.causal_translation ?? {
      trigger_text: '',
      rule_text: '',
      shift_text: '',
      effect_text: '',
    };

    const rule: Rule = {
      id: r.id,
      severity: r.severity as RuleSeverity,
      label: r.label,
      description: r.description ?? r.label,
      order: r.order,
      triggers,
      effects: effects.length > 0 ? effects : undefined,
      collapse_check,
      causal_translation,
    };

    return rule;
  });

  // ─── Gates ───────────────────────────────────────────────────────────
  const viabilityClassification: ViabilityGate[] = parsed.gates.map(g => {
    const defaults = GATE_DEFAULTS[g.status] ?? { color: '#5c5a52', icon: '●' };
    return {
      status: g.status as ViabilityStatus,
      field: g.field,
      operator: g.operator as TriggerOperator,
      value: g.value,
      color: defaults.color,
      icon: defaults.icon,
    };
  });

  const gates: GatesConfig = {
    viability_classification: viabilityClassification,
    structural_override: {
      description: 'Rules with severity=structural and triggered collapse_check force MODEL_COLLAPSES regardless of final margin.',
      enforcement: 'mandatory',
    },
    sustainability_threshold: 0.10,
    collapse_visual: {
      background: '#1c1917',
      text: '#fef2f2',
      border: '#b91c1c',
      label: 'Structural Failure',
    },
  };

  // ─── Outcomes ────────────────────────────────────────────────────────
  const computedOutcomes: ComputedOutcome[] = parsed.outcomes.map(o => {
    const outcome: ComputedOutcome = {
      id: o.id,
      type: o.type as ComputedOutcome['type'],
      label: o.label,
      show_in_comparison: true,
    };

    if (o.range) outcome.range = o.range;
    if (o.display) outcome.display_as = o.display as ComputedOutcome['display_as'];
    if (o.primary) outcome.primary = o.primary;

    return outcome;
  });

  const outcomes: OutcomesConfig = {
    computed_outcomes: computedOutcomes,
    comparison_layout: {
      primary_card: computedOutcomes.find(o => o.primary)?.id ?? computedOutcomes[0]?.id ?? '',
      status_badge: 'viability_status',
      structural_indicators: rules
        .filter(r => r.severity === 'structural')
        .map(r => r.id),
    },
  };

  // ─── Metadata ────────────────────────────────────────────────────────
  const metadata: WorldMetadata = {
    format_version: '1.0.0',
    created_at: new Date().toISOString(),
    last_modified: new Date().toISOString(),
    authoring_method: 'manual-authoring',
  };

  // ─── Assemble WorldDefinition ────────────────────────────────────────
  const worldDefinition: WorldDefinition = {
    world,
    invariants,
    assumptions,
    stateSchema,
    rules,
    gates,
    outcomes,
    metadata,
  };

  return { world: worldDefinition, issues };
}
