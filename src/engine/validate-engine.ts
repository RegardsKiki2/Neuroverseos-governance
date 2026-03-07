/**
 * Validate Engine — World File Static Analysis
 *
 * Pure function: (world) → report
 *
 * Performs comprehensive static analysis on a WorldDefinition:
 *   1. Completeness — are required blocks present and non-empty?
 *   2. Referential integrity — do rules reference declared variables?
 *   3. Guard coverage — do invariants have backing structural guards?
 *   4. Contradiction detection — do rules conflict?
 *   5. Guard shadow detection — do guards shadow or conflict with each other?
 *   6. Orphan detection — unused variables, unreachable rules
 *   7. Schema validation — values within declared ranges
 *
 * INVARIANTS:
 *   - Deterministic: same world → same report, always.
 *   - Zero network calls. Zero LLM calls. Zero async.
 *   - Every finding is traceable to specific world file blocks.
 */

import type { WorldDefinition, Rule, StateVariable, Effect } from '../types';
import type {
  ValidateReport,
  ValidateFinding,
  ValidateSummary,
  FindingSeverity,
  FindingCategory,
} from '../contracts/validate-contract';

// ─── Core Engine ─────────────────────────────────────────────────────────────

/**
 * Validate a world definition and produce a report.
 *
 * This is the entire validate engine. One function. Deterministic.
 */
export function validateWorld(world: WorldDefinition): ValidateReport {
  const startTime = performance.now();
  const findings: ValidateFinding[] = [];

  // Run all checks
  checkCompleteness(world, findings);
  checkReferentialIntegrity(world, findings);
  checkGuardCoverage(world, findings);
  checkContradictions(world, findings);
  checkGuardShadows(world, findings);
  checkOrphans(world, findings);
  checkSchemaViolations(world, findings);

  // Sort findings: errors first, then warnings, then info
  const severityOrder: Record<FindingSeverity, number> = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  // Build summary
  const errors = findings.filter(f => f.severity === 'error').length;
  const warnings = findings.filter(f => f.severity === 'warning').length;
  const info = findings.filter(f => f.severity === 'info').length;

  const completenessScore = computeCompletenessScore(world);
  const invariantCoverage = computeInvariantCoverage(world);

  const summary: ValidateSummary = {
    errors,
    warnings,
    info,
    completenessScore,
    invariantCoverage,
    canRun: errors === 0,
    isHealthy: errors === 0 && warnings === 0,
  };

  return {
    worldId: world.world.world_id,
    worldName: world.world.name,
    worldVersion: world.world.version,
    validatedAt: Date.now(),
    durationMs: performance.now() - startTime,
    summary,
    findings,
  };
}

// ─── Check Implementations ──────────────────────────────────────────────────

/**
 * Check 1: Completeness — are required blocks present and non-empty?
 */
function checkCompleteness(world: WorldDefinition, findings: ValidateFinding[]): void {
  // Required blocks
  if (!world.world?.world_id) {
    findings.push(finding('missing-world-id', 'World identity is missing world_id', 'error', 'completeness', ['world.json']));
  }
  if (!world.world?.name) {
    findings.push(finding('missing-world-name', 'World identity is missing name', 'error', 'completeness', ['world.json']));
  }
  if (!world.world?.thesis) {
    findings.push(finding('missing-thesis', 'World has no thesis — there is nothing to simulate', 'error', 'completeness', ['world.json']));
  }

  if (!world.invariants || world.invariants.length === 0) {
    findings.push(finding('missing-invariants', 'No invariants declared — world has no structural constraints', 'error', 'completeness', ['invariants.json']));
  }

  if (!world.stateSchema?.variables || Object.keys(world.stateSchema.variables).length === 0) {
    findings.push(finding('missing-state-schema', 'No state variables declared — nothing to simulate', 'error', 'completeness', ['state-schema.json']));
  }

  if (!world.rules || world.rules.length === 0) {
    findings.push(finding('missing-rules', 'No rules declared — world has no causal mechanics', 'error', 'completeness', ['rules/']));
  }

  if (!world.gates?.viability_classification || world.gates.viability_classification.length === 0) {
    findings.push(finding('missing-gates', 'No viability gates declared — cannot classify outcomes', 'error', 'completeness', ['gates.json']));
  }

  if (!world.outcomes?.computed_outcomes || world.outcomes.computed_outcomes.length === 0) {
    findings.push(finding('missing-outcomes', 'No computed outcomes declared — nothing to display', 'warning', 'completeness', ['outcomes.json']));
  }

  if (!world.assumptions?.profiles || Object.keys(world.assumptions.profiles).length === 0) {
    findings.push(finding('missing-assumptions', 'No assumption profiles declared — cannot compare scenarios', 'warning', 'completeness', ['assumptions.json']));
  }

  if (!world.metadata) {
    findings.push(finding('missing-metadata', 'No metadata block — world has no version history', 'warning', 'completeness', ['metadata.json']));
  }

  // Optional blocks (informational)
  if (!world.guards) {
    findings.push(finding('no-guards', 'No guards declared — Action Space enforcement unavailable', 'info', 'completeness', ['guards.json']));
  }
  if (!world.roles) {
    findings.push(finding('no-roles', 'No roles declared — multi-agent governance unavailable', 'info', 'completeness', ['roles.json']));
  }
  if (!world.kernel) {
    findings.push(finding('no-kernel', 'No kernel config — Thinking Space governance unavailable', 'info', 'completeness', ['kernel.json']));
  }
}

/**
 * Check 2: Referential integrity — do rules reference declared variables?
 */
function checkReferentialIntegrity(world: WorldDefinition, findings: ValidateFinding[]): void {
  if (!world.rules || !world.stateSchema?.variables) return;

  const declaredVars = new Set(Object.keys(world.stateSchema.variables));
  const declaredOutcomes = new Set(
    (world.outcomes?.computed_outcomes ?? []).map(o => o.id),
  );
  const declaredAssumptionParams = new Set(
    Object.keys(world.assumptions?.parameter_definitions ?? {}),
  );
  const allDeclared = new Set([...declaredVars, ...declaredOutcomes]);

  for (const rule of world.rules) {
    // Check triggers reference declared fields
    for (const trigger of rule.triggers) {
      if (trigger.source === 'state' && !allDeclared.has(trigger.field)) {
        findings.push(finding(
          `undeclared-trigger-${rule.id}-${trigger.field}`,
          `Rule "${rule.id}" trigger references undeclared state variable "${trigger.field}"`,
          'error', 'referential-integrity',
          ['rules/', 'state-schema.json'],
          rule.id,
          `Add "${trigger.field}" to state-schema.json variables`,
        ));
      }
      if (trigger.source === 'assumption' && !declaredAssumptionParams.has(trigger.field)) {
        findings.push(finding(
          `undeclared-assumption-trigger-${rule.id}-${trigger.field}`,
          `Rule "${rule.id}" trigger references undeclared assumption parameter "${trigger.field}"`,
          'error', 'referential-integrity',
          ['rules/', 'assumptions.json'],
          rule.id,
          `Add "${trigger.field}" to assumptions.json parameter_definitions`,
        ));
      }
    }

    // Check effects reference declared targets
    for (const effect of rule.effects ?? []) {
      if (!allDeclared.has(effect.target)) {
        findings.push(finding(
          `undeclared-effect-${rule.id}-${effect.target}`,
          `Rule "${rule.id}" effect targets undeclared variable "${effect.target}"`,
          'error', 'referential-integrity',
          ['rules/', 'state-schema.json', 'outcomes.json'],
          rule.id,
          `Add "${effect.target}" to state-schema.json or outcomes.json`,
        ));
      }
    }

    // Check exclusive_with references existing rules
    if (rule.exclusive_with) {
      const refExists = world.rules.some(r => r.id === rule.exclusive_with);
      if (!refExists) {
        findings.push(finding(
          `broken-exclusive-${rule.id}`,
          `Rule "${rule.id}" has exclusive_with="${rule.exclusive_with}" but that rule does not exist`,
          'error', 'referential-integrity',
          ['rules/'],
          rule.id,
        ));
      }
    }

    // Check collapse_check references declared fields
    if (rule.collapse_check && !allDeclared.has(rule.collapse_check.field)) {
      findings.push(finding(
        `undeclared-collapse-${rule.id}`,
        `Rule "${rule.id}" collapse_check references undeclared field "${rule.collapse_check.field}"`,
        'error', 'referential-integrity',
        ['rules/', 'state-schema.json'],
        rule.id,
      ));
    }
  }

  // Check gates reference declared fields
  for (const gate of world.gates?.viability_classification ?? []) {
    if (!allDeclared.has(gate.field)) {
      findings.push(finding(
        `undeclared-gate-field-${gate.status}`,
        `Gate "${gate.status}" references undeclared field "${gate.field}"`,
        'error', 'referential-integrity',
        ['gates.json', 'state-schema.json', 'outcomes.json'],
      ));
    }
  }
}

/**
 * Check 3: Guard coverage — do invariants have backing structural guards?
 */
function checkGuardCoverage(world: WorldDefinition, findings: ValidateFinding[]): void {
  if (!world.invariants || world.invariants.length === 0) return;

  const guards = world.guards?.guards ?? [];

  for (const invariant of world.invariants) {
    // Prompt-enforced invariants are governed via synthesis prompts, not runtime guards
    if (invariant.enforcement === 'prompt') continue;

    const coveringGuard = guards.find(
      g => g.invariant_ref === invariant.id && g.immutable,
    );
    if (!coveringGuard) {
      findings.push(finding(
        `uncovered-invariant-${invariant.id}`,
        `Invariant "${invariant.id}" has no backing structural guard — it is declared but not enforced at runtime`,
        'warning', 'guard-coverage',
        ['invariants.json', 'guards.json'],
        invariant.id,
        `Add a structural guard with invariant_ref="${invariant.id}" to guards.json`,
      ));
    }
  }

  // Check guards reference valid invariants
  for (const guard of guards) {
    if (guard.invariant_ref) {
      const invariantExists = world.invariants.some(i => i.id === guard.invariant_ref);
      if (!invariantExists) {
        findings.push(finding(
          `broken-guard-invariant-ref-${guard.id}`,
          `Guard "${guard.id}" references invariant "${guard.invariant_ref}" which does not exist`,
          'error', 'referential-integrity',
          ['guards.json', 'invariants.json'],
          guard.id,
        ));
      }
    }
  }

  // Check guards reference valid intent vocabulary
  if (world.guards) {
    const vocabKeys = new Set(Object.keys(world.guards.intent_vocabulary));
    for (const guard of guards) {
      for (const patternKey of guard.intent_patterns) {
        if (!vocabKeys.has(patternKey)) {
          findings.push(finding(
            `broken-guard-pattern-${guard.id}-${patternKey}`,
            `Guard "${guard.id}" references intent pattern "${patternKey}" which is not in intent_vocabulary`,
            'error', 'referential-integrity',
            ['guards.json'],
            guard.id,
          ));
        }
      }
    }
  }
}

/**
 * Check 4: Contradiction detection — do rules conflict?
 *
 * Delegates semantic tension detection to detectSemanticTensions(),
 * then transforms results to ValidateFinding format. Adds circular
 * exclusive_with chain detection (detects chains of 3+).
 */
function checkContradictions(world: WorldDefinition, findings: ValidateFinding[]): void {
  if (!world.rules || world.rules.length < 2) return;

  // ─── Circular exclusive_with detection ──────────────────────────────
  checkCircularExclusiveWith(world.rules, findings);

  // ─── Semantic tensions ──────────────────────────────────────────────
  const tensions = detectSemanticTensions(world.rules);
  for (let i = 0; i < tensions.length; i++) {
    const tension = tensions[i];
    findings.push(finding(
      `semantic-tension-${i}`,
      tension.message,
      tension.severity as FindingSeverity,
      'semantic-tension',
      tension.affectedBlocks,
    ));
  }
}

/**
 * Detect circular exclusive_with chains.
 * Mutual exclusion (A→B, B→A) is informational.
 * Chains of 3+ are warnings (likely authoring errors).
 */
function checkCircularExclusiveWith(rules: Rule[], findings: ValidateFinding[]): void {
  const exclusiveMap = new Map<string, string>();
  for (const rule of rules) {
    if (rule.exclusive_with) {
      exclusiveMap.set(rule.id, rule.exclusive_with);
    }
  }

  const reportedPairs = new Set<string>();

  // Mutual exclusion (A→B and B→A)
  for (const [ruleA, ruleB] of exclusiveMap) {
    if (exclusiveMap.get(ruleB) === ruleA) {
      const pairKey = [ruleA, ruleB].sort().join('::');
      if (!reportedPairs.has(pairKey)) {
        reportedPairs.add(pairKey);
        findings.push(finding(
          `mutual-exclusion-${pairKey.replace('::', '-')}`,
          `Rules "${ruleA}" and "${ruleB}" are mutually exclusive — only one can fire per evaluation`,
          'info', 'semantic-tension',
          ['rules/'],
          `${ruleA}, ${ruleB}`,
        ));
      }
    }
  }

  // Chains of 3+ rules
  const reportedChains = new Set<string>();
  for (const startRule of exclusiveMap.keys()) {
    let current: string | undefined = startRule;
    const visited = new Set<string>();
    const chain: string[] = [];

    while (current && !visited.has(current)) {
      visited.add(current);
      chain.push(current);
      current = exclusiveMap.get(current);
    }

    if (current === startRule && visited.size > 2) {
      const chainKey = [...chain].sort().join('::');
      if (!reportedChains.has(chainKey)) {
        reportedChains.add(chainKey);
        findings.push(finding(
          `circular-exclusive-chain-${startRule}`,
          `Circular exclusive_with chain: ${chain.join(' → ')} → ${startRule} (${chain.length} rules)`,
          'warning', 'contradiction',
          ['rules/'],
          chain.join(', '),
        ));
      }
    }
  }
}

// ─── Semantic Tension Detection ─────────────────────────────────────────────

interface SemanticTensionResult {
  type: string;
  severity: string;
  message: string;
  affectedBlocks: string[];
}

/**
 * Detect semantic tensions between rules.
 * A tension exists when rules affect the same target in opposing directions,
 * or set the same target to different values.
 * Rules declared as exclusive_with each other are excluded.
 */
function detectSemanticTensions(rules: Rule[]): SemanticTensionResult[] {
  const results: SemanticTensionResult[] = [];
  if (rules.length < 2) return results;

  // Build exclusive_with lookup
  const exclusivePairs = new Set<string>();
  for (const rule of rules) {
    if (rule.exclusive_with) {
      exclusivePairs.add(`${rule.id}:${rule.exclusive_with}`);
      exclusivePairs.add(`${rule.exclusive_with}:${rule.id}`);
    }
  }
  const isExclusive = (a: string, b: string) => exclusivePairs.has(`${a}:${b}`);

  // Phase 1: Opposing numeric directions on same target
  const targetEffects = new Map<string, Array<{ ruleId: string; ruleLabel: string; direction: string; effect: Effect }>>();

  for (const rule of rules) {
    const allEffects = [
      ...(rule.effects || []),
      ...(rule.effects_conditional || []).flatMap(c => c.effects),
    ];
    for (const effect of allEffects) {
      const direction = classifyEffectDirection(effect);
      if (direction === 'neutral') continue;
      const entries = targetEffects.get(effect.target) ?? [];
      entries.push({ ruleId: rule.id, ruleLabel: rule.label, direction, effect });
      targetEffects.set(effect.target, entries);
    }
  }

  for (const [target, effects] of targetEffects) {
    const increasing = effects.filter(e => e.direction === 'increase');
    const decreasing = effects.filter(e => e.direction === 'decrease');
    if (increasing.length === 0 || decreasing.length === 0) continue;

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

    results.push({
      type: 'semantic_tension',
      severity: 'warning',
      message: `Opposing effects on "${target}": ${incLabels.join(', ')} increase it while ${decLabels.join(', ')} decrease it`,
      affectedBlocks: ['rules'],
    });
  }

  // Phase 2: Conflicting set operations on same target
  const setEffects = new Map<string, Array<{ ruleId: string; ruleLabel: string; value: number | boolean | string }>>();

  for (const rule of rules) {
    const allEffects = [
      ...(rule.effects || []),
      ...(rule.effects_conditional || []).flatMap(c => c.effects),
    ];
    for (const effect of allEffects) {
      if (effect.operation !== 'set' && effect.operation !== 'set_boolean' && effect.operation !== 'set_dynamic') continue;
      const entries = setEffects.get(effect.target) ?? [];
      entries.push({ ruleId: rule.id, ruleLabel: rule.label, value: effect.value });
      setEffects.set(effect.target, entries);
    }
  }

  for (const [target, effects] of setEffects) {
    if (effects.length < 2) continue;
    const byValue = new Map<string, typeof effects>();
    for (const e of effects) {
      const key = String(e.value);
      const existing = byValue.get(key) ?? [];
      existing.push(e);
      byValue.set(key, existing);
    }
    if (byValue.size < 2) continue;

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

    results.push({
      type: 'semantic_tension',
      severity: 'warning',
      message: `Conflicting set operations on "${target}": ${descriptions.join(', ')}`,
      affectedBlocks: ['rules'],
    });
  }

  return results;
}

function classifyEffectDirection(effect: Effect): 'increase' | 'decrease' | 'neutral' {
  if (effect.operation === 'multiply' || effect.operation === 'multiply_dynamic') {
    const val = typeof effect.value === 'number' ? effect.value : 1;
    return val > 1 ? 'increase' : val < 1 ? 'decrease' : 'neutral';
  }
  if (effect.operation === 'add' || effect.operation === 'add_dynamic') {
    const val = typeof effect.value === 'number' ? effect.value : 0;
    return val > 0 ? 'increase' : val < 0 ? 'decrease' : 'neutral';
  }
  if (effect.operation === 'subtract' || effect.operation === 'subtract_dynamic') {
    const val = typeof effect.value === 'number' ? effect.value : 0;
    return val > 0 ? 'decrease' : val < 0 ? 'increase' : 'neutral';
  }
  return 'neutral';
}

function describeEffect(effect: Effect): string {
  switch (effect.operation) {
    case 'multiply': case 'multiply_dynamic': return `multiplies by ${effect.value}`;
    case 'add': case 'add_dynamic': return `adds ${effect.value}`;
    case 'subtract': case 'subtract_dynamic': return `subtracts ${effect.value}`;
    case 'set': case 'set_dynamic': case 'set_boolean': return `sets to ${effect.value}`;
    default: return `${effect.operation} ${effect.value}`;
  }
}

/**
 * Check 5: Guard shadow detection — do guards shadow or conflict with each other?
 *
 * Detects:
 *   - Shadow: Guard B shares intent_patterns with Guard A, but A is BLOCK/PAUSE
 *     and appears earlier → B can never fire for those patterns.
 *   - Conflict: Two guards match the same patterns but enforce differently
 *     (one BLOCK, one WARN) without role-gating or tool-scoping to differentiate.
 */
function checkGuardShadows(world: WorldDefinition, findings: ValidateFinding[]): void {
  if (!world.guards?.guards || world.guards.guards.length < 2) return;

  const guards = world.guards.guards;

  for (let i = 0; i < guards.length; i++) {
    const guardA = guards[i];
    const enabledA = guardA.immutable || guardA.default_enabled !== false;
    if (!enabledA) continue;
    if (guardA.enforcement !== 'block' && guardA.enforcement !== 'pause') continue;

    for (let j = i + 1; j < guards.length; j++) {
      const guardB = guards[j];
      const enabledB = guardB.immutable || guardB.default_enabled !== false;
      if (!enabledB) continue;

      // Find overlapping intent patterns
      const overlap = guardA.intent_patterns.filter(
        p => guardB.intent_patterns.includes(p),
      );
      if (overlap.length === 0) continue;

      // Check if tool scoping differentiates them
      if (guardA.appliesTo?.length && guardB.appliesTo?.length) {
        const toolsA = new Set(guardA.appliesTo.map(t => t.toLowerCase()));
        const toolsB = new Set(guardB.appliesTo.map(t => t.toLowerCase()));
        const toolOverlap = [...toolsA].some(t => toolsB.has(t));
        if (!toolOverlap) continue; // Different tool scopes — no shadow
      }

      // Check if role gating differentiates them
      if (guardA.required_roles?.length && guardB.required_roles?.length) {
        const rolesA = new Set(guardA.required_roles);
        const rolesB = new Set(guardB.required_roles);
        const roleOverlap = [...rolesA].some(r => rolesB.has(r));
        if (!roleOverlap) continue; // Different role scopes — no shadow
      }

      const patternsStr = overlap.join(', ');

      if (guardB.enforcement === guardA.enforcement) {
        // Full shadow: same enforcement, same patterns, A always wins
        findings.push(finding(
          `guard-shadow-${guardA.id}-${guardB.id}`,
          `Guard "${guardB.label}" (${guardB.id}) is shadowed by "${guardA.label}" (${guardA.id}) — ` +
          `both ${guardA.enforcement.toUpperCase()} on patterns [${patternsStr}] but "${guardA.label}" appears first and will always win`,
          'warning', 'contradiction',
          ['guards/'],
          `${guardA.id}, ${guardB.id}`,
          `Remove "${guardB.label}", merge its patterns into "${guardA.label}", or reorder guards`,
        ));
      } else {
        // Conflict: different enforcement on same patterns
        findings.push(finding(
          `guard-conflict-${guardA.id}-${guardB.id}`,
          `Guards "${guardA.label}" (${guardA.enforcement.toUpperCase()}) and "${guardB.label}" (${guardB.enforcement.toUpperCase()}) ` +
          `share patterns [${patternsStr}] — "${guardA.label}" always wins because it appears first`,
          'warning', 'contradiction',
          ['guards/'],
          `${guardA.id}, ${guardB.id}`,
          `If "${guardB.label}" should take precedence, move it before "${guardA.label}" in guards.json`,
        ));
      }
    }
  }
}

/**
 * Check 6: Orphan detection — unused variables, unreachable rules.
 */
function checkOrphans(world: WorldDefinition, findings: ValidateFinding[]): void {
  if (!world.stateSchema?.variables || !world.rules) return;

  // Find state variables that no rule references
  const referencedVars = new Set<string>();
  for (const rule of world.rules) {
    for (const trigger of rule.triggers) {
      referencedVars.add(trigger.field);
    }
    for (const effect of rule.effects ?? []) {
      referencedVars.add(effect.target);
    }
    if (rule.collapse_check) {
      referencedVars.add(rule.collapse_check.field);
    }
  }
  // Gates also reference variables
  for (const gate of world.gates?.viability_classification ?? []) {
    referencedVars.add(gate.field);
  }

  for (const varId of Object.keys(world.stateSchema.variables)) {
    if (!referencedVars.has(varId)) {
      findings.push(finding(
        `orphan-variable-${varId}`,
        `State variable "${varId}" is declared but never referenced by any rule or gate`,
        'warning', 'orphan',
        ['state-schema.json'],
        varId,
        'Remove this variable or add rules that reference it',
      ));
    }
  }

  // Find computed outcomes that no rule produces
  const effectTargets = new Set<string>();
  for (const rule of world.rules) {
    for (const effect of rule.effects ?? []) {
      effectTargets.add(effect.target);
    }
  }
  for (const outcome of world.outcomes?.computed_outcomes ?? []) {
    // Externally-assigned outcomes are set by the engine, not by rules
    if (outcome.assignment === 'external') continue;

    if (!effectTargets.has(outcome.id) && !outcome.derived_from) {
      findings.push(finding(
        `orphan-outcome-${outcome.id}`,
        `Outcome "${outcome.id}" is declared but no rule produces it`,
        'warning', 'orphan',
        ['outcomes.json', 'rules/'],
        outcome.id,
      ));
    }
  }
}

/**
 * Check 7: Schema violations — values outside declared ranges.
 */
function checkSchemaViolations(world: WorldDefinition, findings: ValidateFinding[]): void {
  if (!world.stateSchema?.variables) return;

  for (const [varId, variable] of Object.entries(world.stateSchema.variables)) {
    // Check default is within range
    if (variable.type === 'number') {
      const def = variable.default as number;
      if (variable.min !== undefined && def < variable.min) {
        findings.push(finding(
          `default-below-min-${varId}`,
          `Variable "${varId}" default (${def}) is below declared min (${variable.min})`,
          'error', 'schema-violation',
          ['state-schema.json'],
          varId,
        ));
      }
      if (variable.max !== undefined && def > variable.max) {
        findings.push(finding(
          `default-above-max-${varId}`,
          `Variable "${varId}" default (${def}) is above declared max (${variable.max})`,
          'error', 'schema-violation',
          ['state-schema.json'],
          varId,
        ));
      }
    }

    if (variable.type === 'enum') {
      if (!variable.options || variable.options.length === 0) {
        findings.push(finding(
          `enum-no-options-${varId}`,
          `Enum variable "${varId}" has no options declared`,
          'error', 'schema-violation',
          ['state-schema.json'],
          varId,
        ));
      } else if (!variable.options.includes(variable.default as string)) {
        findings.push(finding(
          `enum-default-invalid-${varId}`,
          `Enum variable "${varId}" default "${variable.default}" is not in declared options`,
          'error', 'schema-violation',
          ['state-schema.json'],
          varId,
        ));
      }
    }
  }

  // Check preset values are within variable ranges
  for (const [presetName, preset] of Object.entries(world.stateSchema.presets ?? {})) {
    for (const [varId, value] of Object.entries(preset.values)) {
      const variable = world.stateSchema.variables[varId];
      if (!variable) {
        findings.push(finding(
          `preset-undeclared-var-${presetName}-${varId}`,
          `Preset "${presetName}" sets undeclared variable "${varId}"`,
          'error', 'referential-integrity',
          ['state-schema.json'],
          presetName,
        ));
        continue;
      }
      if (variable.type === 'number' && typeof value === 'number') {
        if (variable.min !== undefined && value < variable.min) {
          findings.push(finding(
            `preset-below-min-${presetName}-${varId}`,
            `Preset "${presetName}" sets "${varId}" to ${value}, below min ${variable.min}`,
            'warning', 'schema-violation',
            ['state-schema.json'],
            presetName,
          ));
        }
        if (variable.max !== undefined && value > variable.max) {
          findings.push(finding(
            `preset-above-max-${presetName}-${varId}`,
            `Preset "${presetName}" sets "${varId}" to ${value}, above max ${variable.max}`,
            'warning', 'schema-violation',
            ['state-schema.json'],
            presetName,
          ));
        }
      }
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Compute completeness score (0-100).
 * Based on presence and non-emptiness of the 9 core blocks.
 */
function computeCompletenessScore(world: WorldDefinition): number {
  let score = 0;
  const total = 9;

  if (world.world?.world_id && world.world?.name && world.world?.thesis) score++;
  if (world.invariants && world.invariants.length > 0) score++;
  if (world.assumptions?.profiles && Object.keys(world.assumptions.profiles).length > 0) score++;
  if (world.stateSchema?.variables && Object.keys(world.stateSchema.variables).length > 0) score++;
  if (world.rules && world.rules.length > 0) score++;
  if (world.gates?.viability_classification && world.gates.viability_classification.length > 0) score++;
  if (world.outcomes?.computed_outcomes && world.outcomes.computed_outcomes.length > 0) score++;
  if (world.guards?.guards && world.guards.guards.length > 0) score++;
  if (world.metadata) score++;

  return Math.round((score / total) * 100);
}

/**
 * Compute invariant coverage (0-100).
 * Percentage of invariants with backing structural guards.
 */
function computeInvariantCoverage(world: WorldDefinition): number {
  if (!world.invariants || world.invariants.length === 0) return 0;

  const guards = world.guards?.guards ?? [];
  let covered = 0;

  for (const invariant of world.invariants) {
    const hasGuard = guards.some(g => g.invariant_ref === invariant.id && g.immutable);
    if (hasGuard) covered++;
  }

  return Math.round((covered / world.invariants.length) * 100);
}

/**
 * Convenience for building findings.
 */
function finding(
  id: string,
  message: string,
  severity: FindingSeverity,
  category: FindingCategory,
  affectedBlocks: string[],
  source?: string,
  suggestion?: string,
): ValidateFinding {
  const f: ValidateFinding = { id, message, severity, category, affectedBlocks };
  if (source) f.source = source;
  if (suggestion) f.suggestion = suggestion;
  return f;
}
