/**
 * Structural Completeness Checker
 *
 * Determines whether a world definition is complete enough to export.
 * Binary gate: required blocks must be 100% defined. No soft exports.
 *
 * Deterministic — no AI calls, no async, no randomness.
 */

import type {
  WorldDefinition,
  BlockCompleteness,
  BlockStatus,
  StructuralCompleteness,
} from './types';

function checkWorldIdentity(world: WorldDefinition): BlockCompleteness {
  const issues: string[] = [];
  const w = world.world;

  if (!w) return { id: 'world', label: 'World Identity', status: 'undefined', required: true, issues: ['World identity not defined'] };
  if (!w.world_id?.trim()) issues.push('World ID is empty');
  if (!w.name?.trim()) issues.push('World name is empty');
  if (!w.thesis?.trim()) issues.push('World thesis is empty');
  if (!w.modules?.length) issues.push('No modules declared');

  const status: BlockStatus = issues.length === 0 ? 'defined' : (!w.world_id && !w.name ? 'undefined' : 'partial');
  return { id: 'world', label: 'World Identity', status, required: true, issues };
}

function checkInvariants(world: WorldDefinition): BlockCompleteness {
  const issues: string[] = [];
  const inv = world.invariants;

  if (!inv || inv.length === 0) {
    return { id: 'invariants', label: 'Invariants', status: 'undefined', required: true, issues: ['No invariants defined — what cannot change in this world?'] };
  }

  for (const i of inv) {
    if (!i.id?.trim()) issues.push('Invariant missing ID');
    if (!i.label?.trim()) issues.push(`Invariant ${i.id || '?'} missing label`);
  }

  const status: BlockStatus = issues.length === 0 ? 'defined' : 'partial';
  return { id: 'invariants', label: 'Invariants', status, required: true, issues };
}

function checkAssumptions(world: WorldDefinition): BlockCompleteness {
  const issues: string[] = [];
  const a = world.assumptions;

  if (!a || !a.profiles || Object.keys(a.profiles).length === 0) {
    return { id: 'assumptions', label: 'Assumption Profiles', status: 'undefined', required: true, issues: ['No assumption profiles defined — what conditions are we comparing?'] };
  }

  const profiles = Object.entries(a.profiles);
  const hasBaseline = profiles.some(([, p]) => p.is_default_baseline);
  if (!hasBaseline) issues.push('No baseline profile marked');

  for (const [key, profile] of profiles) {
    if (!profile.name?.trim()) issues.push(`Profile "${key}" missing name`);
    if (!profile.description?.trim()) issues.push(`Profile "${key}" missing description`);
    if (!profile.parameters || Object.keys(profile.parameters).length === 0) {
      issues.push(`Profile "${key}" has no parameters`);
    }
  }

  if (!a.parameter_definitions || Object.keys(a.parameter_definitions).length === 0) {
    issues.push('No parameter definitions — profiles reference undefined parameters');
  }

  const status: BlockStatus = issues.length === 0 ? 'defined' : 'partial';
  return { id: 'assumptions', label: 'Assumption Profiles', status, required: true, issues };
}

function checkStateSchema(world: WorldDefinition): BlockCompleteness {
  const issues: string[] = [];
  const s = world.stateSchema;

  if (!s || !s.variables || Object.keys(s.variables).length === 0) {
    return { id: 'stateSchema', label: 'State Variables', status: 'undefined', required: true, issues: ['No state variables defined — what can be adjusted?'] };
  }

  for (const [key, variable] of Object.entries(s.variables)) {
    if (!variable.label?.trim()) issues.push(`Variable "${key}" missing label`);
    if (!variable.type) issues.push(`Variable "${key}" missing type`);
    if (variable.type === 'enum' && (!variable.options || variable.options.length === 0)) {
      issues.push(`Enum variable "${key}" has no options`);
    }
    if (variable.type === 'number' && (variable.min === undefined || variable.max === undefined)) {
      issues.push(`Number variable "${key}" missing min/max range`);
    }
  }

  const status: BlockStatus = issues.length === 0 ? 'defined' : 'partial';
  return { id: 'stateSchema', label: 'State Variables', status, required: true, issues };
}

function checkRules(world: WorldDefinition): BlockCompleteness {
  const issues: string[] = [];
  const rules = world.rules;

  if (!rules || rules.length === 0) {
    return { id: 'rules', label: 'Evaluation Rules', status: 'undefined', required: true, issues: ['No rules defined — what causes change in this world?'] };
  }

  for (const rule of rules) {
    if (!rule.id?.trim()) issues.push('Rule missing ID');
    if (!rule.label?.trim()) issues.push(`Rule "${rule.id || '?'}" missing label`);
    if (!rule.triggers || rule.triggers.length === 0) {
      issues.push(`Rule "${rule.id || '?'}" has no triggers`);
    }
    if ((!rule.effects || rule.effects.length === 0) && (!rule.effects_conditional || rule.effects_conditional.length === 0)) {
      issues.push(`Rule "${rule.id || '?'}" has no effects`);
    }
    if (!rule.causal_translation) {
      issues.push(`Rule "${rule.id || '?'}" missing causal translation`);
    }
  }

  const status: BlockStatus = issues.length === 0 ? 'defined' : 'partial';
  return { id: 'rules', label: 'Evaluation Rules', status, required: true, issues };
}

function checkGates(world: WorldDefinition): BlockCompleteness {
  const issues: string[] = [];
  const g = world.gates;

  if (!g || !g.viability_classification || g.viability_classification.length === 0) {
    return { id: 'gates', label: 'Viability Gates', status: 'undefined', required: true, issues: ['No viability gates defined — what counts as failure?'] };
  }

  const hasCollapse = g.viability_classification.some(vc => vc.status === 'MODEL_COLLAPSES');
  if (!hasCollapse) issues.push('No MODEL_COLLAPSES gate — failure must be defined');

  if (g.sustainability_threshold === undefined) {
    issues.push('No sustainability threshold defined');
  }

  const status: BlockStatus = issues.length === 0 ? 'defined' : 'partial';
  return { id: 'gates', label: 'Viability Gates', status, required: true, issues };
}

function checkOutcomes(world: WorldDefinition): BlockCompleteness {
  const issues: string[] = [];
  const o = world.outcomes;

  if (!o || !o.computed_outcomes || o.computed_outcomes.length === 0) {
    return { id: 'outcomes', label: 'Computed Outcomes', status: 'undefined', required: true, issues: ['No outcomes defined — what gets computed and displayed?'] };
  }

  const hasPrimary = o.computed_outcomes.some(c => c.primary);
  if (!hasPrimary) issues.push('No primary outcome designated');

  if (!o.comparison_layout) {
    issues.push('No comparison layout defined');
  }

  const status: BlockStatus = issues.length === 0 ? 'defined' : 'partial';
  return { id: 'outcomes', label: 'Computed Outcomes', status, required: true, issues };
}

/**
 * Run full structural completeness check.
 *
 * Returns binary gate: canExport is true only if ALL required blocks are 'defined'.
 */
export function checkCompleteness(world: WorldDefinition): StructuralCompleteness {
  const blocks: BlockCompleteness[] = [
    checkWorldIdentity(world),
    checkInvariants(world),
    checkAssumptions(world),
    checkStateSchema(world),
    checkRules(world),
    checkGates(world),
    checkOutcomes(world),
  ];

  const requiredBlocks = blocks.filter(b => b.required);
  const definedRequired = requiredBlocks.filter(b => b.status === 'defined');
  const requiredComplete = definedRequired.length === requiredBlocks.length;

  const totalBlocks = blocks.length;
  const definedCount = blocks.filter(b => b.status === 'defined').length;
  const partialCount = blocks.filter(b => b.status === 'partial').length;
  const score = Math.round(((definedCount + partialCount * 0.5) / totalBlocks) * 100);

  // Runtime package only has the 7 core blocks — coreComplete mirrors requiredComplete
  return {
    blocks,
    requiredComplete,
    coreComplete: requiredComplete,
    score,
    canExport: requiredComplete,
  };
}

/**
 * Get a human-readable summary of what's missing.
 * Used by the AI configurator to guide conversation.
 */
export function getMissingConceptualAreas(world: WorldDefinition): string[] {
  const completeness = checkCompleteness(world);
  const missing: string[] = [];

  for (const block of completeness.blocks) {
    if (block.status === 'undefined') {
      missing.push(block.issues[0] || `${block.label} is not defined`);
    } else if (block.status === 'partial') {
      for (const issue of block.issues) {
        missing.push(issue);
      }
    }
  }

  return missing;
}
