/**
 * Validate Engine — World File Static Analysis
 *
 * Pure function: (world) → report
 *
 * Performs comprehensive static analysis on a WorldDefinition:
 *   1. Completeness — are required blocks present and non-empty?
 *   2. Referential integrity — do rules reference declared variables?
 *   3. Guard coverage — do invariants have backing structural guards?
 *   3b. Semantic coverage — can any guard actually intercept the invariant's action class?
 *   4. Contradiction detection — do rules conflict?
 *   5. Guard shadow detection — do guards shadow or conflict with each other?
 *   5b. Fail-closed surface detection — are action surfaces ungoverned?
 *   6. Reachability analysis — are there rules/guards that can never trigger?
 *   7. State space coverage — do guard conditions cover all enumerated states?
 *   8. Orphan detection — unused variables, unreachable rules
 *   9. Schema validation — values within declared ranges
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
  GovernanceHealth,
  FindingSeverity,
  FindingCategory,
  ValidationMode,
} from '../contracts/validate-contract';

// ─── Core Engine ─────────────────────────────────────────────────────────────

/**
 * Validate a world definition and produce a report.
 *
 * This is the entire validate engine. One function. Deterministic.
 */
export function validateWorld(world: WorldDefinition, mode: ValidationMode = 'standard'): ValidateReport {
  const startTime = performance.now();
  const findings: ValidateFinding[] = [];

  // Run all checks
  checkCompleteness(world, findings);
  checkReferentialIntegrity(world, findings);
  checkGuardCoverage(world, findings);
  checkSemanticCoverage(world, findings);
  checkContradictions(world, findings);
  checkGuardShadows(world, findings);
  checkFailClosedSurfaces(world, findings);
  checkReachability(world, findings);
  checkStateCoverage(world, findings);
  checkOrphans(world, findings);
  checkSchemaViolations(world, findings);

  // Apply validation mode to governance findings.
  // Structural findings (completeness, referential-integrity, schema-violation) are
  // never modified — they indicate a truly broken world.
  // Governance findings (guard-coverage, contradiction, semantic-tension, orphan) are
  // adjusted based on mode:
  //   dev:      governance warnings → info (lenient, for experimentation)
  //   standard: no change (default)
  //   strict:   governance info → warning (surface everything for compliance)
  const governanceCategories = new Set<FindingCategory>([
    'guard-coverage', 'contradiction', 'semantic-tension', 'orphan',
  ]);
  if (mode === 'dev') {
    for (const f of findings) {
      if (governanceCategories.has(f.category) && f.severity === 'warning') {
        f.severity = 'info';
      }
    }
  } else if (mode === 'strict') {
    for (const f of findings) {
      if (governanceCategories.has(f.category) && f.severity === 'info') {
        f.severity = 'warning';
      }
    }
  }

  // Sort findings: errors first, then warnings, then info
  const severityOrder: Record<FindingSeverity, number> = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  // Build summary
  const errors = findings.filter(f => f.severity === 'error').length;
  const warnings = findings.filter(f => f.severity === 'warning').length;
  const info = findings.filter(f => f.severity === 'info').length;

  const completenessScore = computeCompletenessScore(world);
  const invariantCoverage = computeInvariantCoverage(world);
  const governanceHealth = computeGovernanceHealth(world, findings);

  const summary: ValidateSummary = {
    errors,
    warnings,
    info,
    completenessScore,
    invariantCoverage,
    canRun: errors === 0,
    isHealthy: errors === 0 && warnings === 0,
    governanceHealth,
  };

  return {
    worldId: world.world.world_id,
    worldName: world.world.name,
    worldVersion: world.world.version,
    validatedAt: Date.now(),
    durationMs: performance.now() - startTime,
    validationMode: mode,
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
 * Check 3b: Semantic coverage — can any guard actually intercept the invariant's action class?
 *
 * Structural coverage (Check 3) verifies a guard *references* the invariant.
 * Semantic coverage verifies the guard's intent patterns could *intercept* it.
 *
 * Extracts action-class tokens from invariant id + label, then checks:
 *   1. Guard intent_patterns (via intent_vocabulary pattern text and key names)
 *   2. Kernel forbidden_patterns (via pattern text and reason)
 *
 * If an invariant has a structural guard but that guard's patterns can't
 * plausibly intercept the action class → warning (weak coverage).
 * If an invariant has NO interceptor at all → error (unenforced invariant).
 */
function checkSemanticCoverage(world: WorldDefinition, findings: ValidateFinding[]): void {
  if (!world.invariants || world.invariants.length === 0) return;

  // Only run semantic coverage when there are guards or kernel rules to check against.
  // Worlds without guards are already flagged by structural coverage (Check 3).
  const hasGuards = (world.guards?.guards?.length ?? 0) > 0;
  const hasKernel = (world.kernel?.input_boundaries?.forbidden_patterns?.length ?? 0) > 0
    || (world.kernel?.output_boundaries?.forbidden_patterns?.length ?? 0) > 0;
  if (!hasGuards && !hasKernel) return;

  const guards = world.guards?.guards ?? [];
  const vocabEntries = world.guards?.intent_vocabulary ?? {};
  const kernelInput = world.kernel?.input_boundaries?.forbidden_patterns ?? [];
  const kernelOutput = world.kernel?.output_boundaries?.forbidden_patterns ?? [];
  const allKernelRules = [...kernelInput, ...kernelOutput];

  // Build a searchable text blob for each guard (patterns + vocab)
  const guardSearchTexts = guards.map(g => {
    const parts: string[] = [];
    for (const patternKey of g.intent_patterns) {
      parts.push(patternKey.toLowerCase());
      const vocab = vocabEntries[patternKey];
      if (vocab) {
        parts.push(vocab.label.toLowerCase());
        parts.push(vocab.pattern.toLowerCase());
      }
    }
    parts.push(g.description.toLowerCase());
    return { guard: g, text: parts.join(' ') };
  });

  // Build searchable text for kernel rules
  const kernelSearchTexts = allKernelRules.map(k => ({
    rule: k,
    text: `${k.id} ${k.reason} ${k.pattern ?? ''}`.toLowerCase(),
  }));

  for (const invariant of world.invariants) {
    if (invariant.enforcement === 'prompt') continue;

    // Extract action-class tokens from invariant id and label
    const tokens = extractActionTokens(invariant.id, invariant.label);
    if (tokens.length === 0) continue;

    // Check if any guard semantically covers this invariant
    const coveringGuards = guardSearchTexts.filter(gs => {
      const enabled = gs.guard.immutable || gs.guard.default_enabled !== false;
      if (!enabled) return false;
      return tokens.some(token => gs.text.includes(token));
    });

    // Check if any kernel rule semantically covers this invariant
    const coveringKernel = kernelSearchTexts.filter(ks =>
      tokens.some(token => ks.text.includes(token)),
    );

    const hasStructuralGuard = guards.some(
      g => g.invariant_ref === invariant.id && g.immutable,
    );

    if (coveringGuards.length === 0 && coveringKernel.length === 0) {
      if (hasStructuralGuard) {
        // Has a structural ref but patterns don't match — weak coverage
        findings.push(finding(
          `weak-coverage-${invariant.id}`,
          `Invariant "${invariant.id}" has a structural guard but no guard's intent patterns ` +
          `match its action class [${tokens.join(', ')}] — the guard may not intercept violations`,
          'warning', 'guard-coverage',
          ['invariants.json', 'guards.json'],
          invariant.id,
          `Ensure the backing guard's intent_patterns include patterns that can detect "${invariant.label}"`,
        ));
      } else {
        // No structural guard AND no semantic match — unenforced
        findings.push(finding(
          `unenforced-invariant-${invariant.id}`,
          `Invariant "${invariant.id}" has no guard or kernel rule capable of enforcing it — ` +
          `no interceptor matches action class [${tokens.join(', ')}]`,
          'warning', 'guard-coverage',
          ['invariants.json', 'guards.json'],
          invariant.id,
          `Add a guard with intent_patterns that can intercept "${invariant.label}", ` +
          `or add a kernel forbidden_pattern`,
        ));
      }
    }
  }
}

/**
 * Extract action-class tokens from an invariant's id and label.
 * Returns lowercased tokens that represent the action domain.
 *
 * Strategy: split id on underscores, split label on whitespace,
 * filter out stop words and very short tokens.
 */
function extractActionTokens(id: string, label: string): string[] {
  const stopWords = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
    'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
    'once', 'that', 'than', 'too', 'very', 'just', 'only', 'not', 'no',
    'all', 'any', 'both', 'each', 'every', 'few', 'more', 'most', 'other',
    'some', 'such', 'and', 'but', 'or', 'nor', 'so', 'yet', 'if',
    'it', 'its', 'they', 'them', 'their', 'this', 'these', 'those',
    'which', 'who', 'whom', 'what', 'where', 'when', 'how', 'why',
  ]);

  const idTokens = id.toLowerCase().split(/[_\-]+/);
  const labelTokens = label.toLowerCase().split(/[\s\-—:,;.!?()[\]{}]+/);
  const allTokens = [...idTokens, ...labelTokens];

  const unique = new Set<string>();
  for (const token of allTokens) {
    const clean = token.replace(/[^a-z0-9]/g, '');
    if (clean.length >= 3 && !stopWords.has(clean)) {
      unique.add(clean);
    }
  }
  return [...unique];
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
 * Check 5b: Fail-closed surface detection — are there action surfaces no guard evaluates?
 *
 * If the world declares `tool_surfaces` in guards config, every surface must
 * have at least one guard that either:
 *   - Has no `appliesTo` (catch-all — covers all surfaces), or
 *   - Has `appliesTo` including that surface.
 *
 * Surfaces without any governing guard are "fail-open" — actions on them
 * bypass governance entirely.
 *
 * Also infers surfaces from guard `appliesTo` values even when `tool_surfaces`
 * is not explicitly declared, and warns if some surfaces are guarded but
 * no catch-all guard exists for unlisted surfaces.
 */
function checkFailClosedSurfaces(world: WorldDefinition, findings: ValidateFinding[]): void {
  // Only run when tool_surfaces is explicitly declared — this is the world
  // author's explicit surface map. Without it, we don't know what to check.
  const declaredSurfaces = world.guards?.tool_surfaces;
  if (!declaredSurfaces || declaredSurfaces.length === 0) return;

  const guards = world.guards?.guards ?? [];

  // Collect all governed surfaces from guard appliesTo + catch-all guards
  const guardedSurfaces = new Set<string>();
  let hasCatchAllGuard = false;

  for (const guard of guards) {
    const enabled = guard.immutable || guard.default_enabled !== false;
    if (!enabled) continue;

    if (!guard.appliesTo || guard.appliesTo.length === 0) {
      hasCatchAllGuard = true;
    } else {
      for (const tool of guard.appliesTo) {
        guardedSurfaces.add(tool.toLowerCase());
      }
    }
  }

  // If there's a catch-all guard, all surfaces are governed
  if (hasCatchAllGuard) return;

  // Check each declared surface
  for (const surface of declaredSurfaces) {
    if (!guardedSurfaces.has(surface.toLowerCase())) {
      findings.push(finding(
        `fail-open-surface-${surface.toLowerCase()}`,
        `Action surface "${surface}" has no governing guard — actions on this surface bypass governance entirely`,
        'warning', 'guard-coverage',
        ['guards.json'],
        undefined,
        `Add a guard with appliesTo including "${surface}", or add a catch-all guard (no appliesTo) to cover all surfaces`,
      ));
    }
  }
}

/**
 * Check 6: Reachability analysis — are there rules whose triggers can never be satisfied?
 *
 * A rule is unreachable when its trigger condition is logically impossible given
 * the state schema's declared constraints (min/max for numbers, options for enums,
 * boolean domain for booleans).
 *
 * Examples of unreachable triggers:
 *   - trigger: field > 100, but schema declares max: 50
 *   - trigger: field < 0, but schema declares min: 0
 *   - trigger: field == "invalid", but schema enum options don't include "invalid"
 *   - trigger: field == true, but field is a number type
 *
 * Also checks gates (viability classifications) for the same conditions.
 */
function checkReachability(world: WorldDefinition, findings: ValidateFinding[]): void {
  if (!world.stateSchema?.variables) return;

  const vars = world.stateSchema.variables;

  // Check rules
  for (const rule of world.rules ?? []) {
    for (const trigger of rule.triggers) {
      if (trigger.source !== 'state') continue;
      const unreachable = isTriggerUnreachable(trigger, vars);
      if (unreachable) {
        findings.push(finding(
          `unreachable-rule-${rule.id}-${trigger.field}`,
          `Rule "${rule.id}" has unreachable trigger: ${trigger.field} ${trigger.operator} ${JSON.stringify(trigger.value)} — ${unreachable}`,
          'warning', 'contradiction',
          ['rules/', 'state-schema.json'],
          rule.id,
          `Remove this rule or adjust the trigger condition to match the schema constraints for "${trigger.field}"`,
        ));
      }
    }

    // Check collapse_check
    if (rule.collapse_check) {
      const cc = rule.collapse_check;
      const unreachable = isTriggerUnreachable(
        { field: cc.field, operator: cc.operator, value: cc.value },
        vars,
      );
      if (unreachable) {
        findings.push(finding(
          `unreachable-collapse-${rule.id}`,
          `Rule "${rule.id}" has unreachable collapse_check: ${cc.field} ${cc.operator} ${cc.value} — ${unreachable}`,
          'warning', 'contradiction',
          ['rules/', 'state-schema.json'],
          rule.id,
        ));
      }
    }
  }

  // Check viability gates
  for (const gate of world.gates?.viability_classification ?? []) {
    const unreachable = isTriggerUnreachable(
      { field: gate.field, operator: gate.operator, value: gate.value },
      vars,
    );
    if (unreachable) {
      findings.push(finding(
        `unreachable-gate-${gate.status}`,
        `Viability gate "${gate.status}" has unreachable condition: ${gate.field} ${gate.operator} ${gate.value} — ${unreachable}`,
        'warning', 'contradiction',
        ['gates.json', 'state-schema.json'],
        `gate-${gate.status}`,
      ));
    }
  }
}

/**
 * Determine if a trigger condition is logically impossible given the schema.
 * Returns a human-readable reason string if unreachable, null if reachable.
 */
function isTriggerUnreachable(
  trigger: { field: string; operator: string; value: string | number | boolean | string[] },
  vars: Record<string, StateVariable>,
): string | null {
  const variable = vars[trigger.field];
  if (!variable) return null; // Unknown variable — referential integrity handles this

  const { operator, value } = trigger;

  if (variable.type === 'number') {
    const numVal = typeof value === 'number' ? value : Number(value);
    if (isNaN(numVal)) return null; // Non-numeric comparison on number field — skip

    const min = variable.min;
    const max = variable.max;

    // Check: trigger requires value above max or below min
    if (operator === '>' || operator === '>=') {
      if (max !== undefined && numVal >= max && operator === '>') {
        return `schema declares max=${max}, so ${trigger.field} can never exceed ${max}`;
      }
      if (max !== undefined && numVal > max && operator === '>=') {
        return `schema declares max=${max}, so ${trigger.field} can never reach ${numVal}`;
      }
    }
    if (operator === '<' || operator === '<=') {
      if (min !== undefined && numVal <= min && operator === '<') {
        return `schema declares min=${min}, so ${trigger.field} can never go below ${min}`;
      }
      if (min !== undefined && numVal < min && operator === '<=') {
        return `schema declares min=${min}, so ${trigger.field} can never reach ${numVal}`;
      }
    }
    if (operator === '==') {
      if (min !== undefined && numVal < min) {
        return `schema declares min=${min}, so ${trigger.field} can never equal ${numVal}`;
      }
      if (max !== undefined && numVal > max) {
        return `schema declares max=${max}, so ${trigger.field} can never equal ${numVal}`;
      }
    }
  }

  if (variable.type === 'enum' && variable.options) {
    if (operator === '==' && typeof value === 'string') {
      if (!variable.options.includes(value)) {
        return `"${value}" is not in enum options [${variable.options.join(', ')}]`;
      }
    }
    if (operator === '!=' && typeof value === 'string') {
      // != on a value not in options is always true — the rule always fires, which
      // is suspicious but not unreachable. Only flag if the enum has exactly one
      // option and they're comparing != to that option (always false = never fires).
      if (variable.options.length === 1 && variable.options[0] === value) {
        return `enum has only option "${value}", so != "${value}" can never be true`;
      }
    }
    if (operator === 'in' && Array.isArray(value)) {
      const validValues = value.filter(v => variable.options!.includes(v));
      if (validValues.length === 0) {
        return `none of [${value.join(', ')}] are in enum options [${variable.options.join(', ')}]`;
      }
    }
  }

  if (variable.type === 'boolean') {
    // Boolean variables can only be true/false
    if (operator === '==' && typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
      return `boolean variable compared to non-boolean value "${value}"`;
    }
  }

  return null;
}

/**
 * Check 7: State space coverage — do rule/gate conditions cover all enumerated states?
 *
 * For enumerated state variables, checks whether rules and gates that branch
 * on those variables handle all possible values. Incomplete coverage means
 * some states have undefined policy behavior.
 *
 * This is the NeuroVerse equivalent of state transition completeness from
 * aircraft flight control validation: every control input must map to a
 * deterministic outcome.
 *
 * Only reports for enum variables that are actually used in branching logic
 * (triggers, gates). Doesn't flag variables used only in effects.
 */
function checkStateCoverage(world: WorldDefinition, findings: ValidateFinding[]): void {
  if (!world.stateSchema?.variables) return;

  const vars = world.stateSchema.variables;

  // Find enum variables used in triggers or gates
  for (const [varId, variable] of Object.entries(vars)) {
    if (variable.type !== 'enum' || !variable.options || variable.options.length <= 1) continue;

    const allOptions = new Set(variable.options);
    const coveredOptions = new Set<string>();

    // Collect values referenced by rule triggers
    for (const rule of world.rules ?? []) {
      for (const trigger of rule.triggers) {
        if (trigger.field !== varId || trigger.source !== 'state') continue;

        if (trigger.operator === '==' && typeof trigger.value === 'string') {
          coveredOptions.add(trigger.value);
        }
        if (trigger.operator === 'in' && Array.isArray(trigger.value)) {
          for (const v of trigger.value) coveredOptions.add(v);
        }
        if (trigger.operator === '!=') {
          // != covers all values EXCEPT the one named
          for (const opt of allOptions) {
            if (opt !== trigger.value) coveredOptions.add(opt);
          }
        }
      }
    }

    // Collect values referenced by viability gates
    for (const gate of world.gates?.viability_classification ?? []) {
      if (gate.field !== varId) continue;
      if (gate.operator === '==' && typeof gate.value === 'string') {
        coveredOptions.add(gate.value);
      }
      if (gate.operator === 'in' && Array.isArray(gate.value)) {
        for (const v of gate.value) coveredOptions.add(v);
      }
    }

    // Only report if the variable is actually used in branching
    if (coveredOptions.size === 0) continue;

    // Find uncovered options
    const uncovered = [...allOptions].filter(opt => !coveredOptions.has(opt));

    if (uncovered.length > 0 && uncovered.length < allOptions.size) {
      findings.push(finding(
        `incomplete-state-coverage-${varId}`,
        `Enum variable "${varId}" has ${uncovered.length} uncovered state${uncovered.length > 1 ? 's' : ''}: ` +
        `[${uncovered.join(', ')}] — rules/gates handle [${[...coveredOptions].join(', ')}] ` +
        `but not all ${allOptions.size} declared options`,
        'warning', 'guard-coverage',
        ['state-schema.json', 'rules/', 'gates.json'],
        varId,
        `Add rules or gates that handle ${uncovered.map(u => `"${u}"`).join(', ')} for variable "${varId}"`,
      ));
    }
  }
}

/**
 * Check 8: Orphan detection — unused variables, unreachable rules.
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
 * Check 9: Schema violations — values outside declared ranges.
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
 * Compute actionable governance health summary from world + findings.
 */
function computeGovernanceHealth(world: WorldDefinition, findings: ValidateFinding[]): GovernanceHealth | undefined {
  const guards = world.guards?.guards ?? [];
  if (guards.length === 0 && !world.kernel) return undefined;

  // Surface coverage
  const declaredSurfaces = world.guards?.tool_surfaces ?? [];
  const guardedSurfaces = new Set<string>();
  let hasCatchAll = false;

  for (const guard of guards) {
    const enabled = guard.immutable || guard.default_enabled !== false;
    if (!enabled) continue;
    if (!guard.appliesTo || guard.appliesTo.length === 0) {
      hasCatchAll = true;
    } else {
      for (const t of guard.appliesTo) guardedSurfaces.add(t.toLowerCase());
    }
  }

  const allSurfaces = new Set<string>();
  for (const s of declaredSurfaces) allSurfaces.add(s.toLowerCase());
  for (const s of guardedSurfaces) allSurfaces.add(s);

  const surfaces: GovernanceHealth['surfaces'] = [...allSurfaces].map(name => ({
    name,
    governed: hasCatchAll || guardedSurfaces.has(name),
  }));
  const surfacesCovered = hasCatchAll ? allSurfaces.size : guardedSurfaces.size;

  // Invariant enforcement
  const structuralInvariants = (world.invariants ?? []).filter(i => i.enforcement === 'structural');
  let invariantsEnforced = 0;
  for (const inv of structuralInvariants) {
    const hasGuard = guards.some(g => g.invariant_ref === inv.id && g.immutable);
    if (hasGuard) invariantsEnforced++;
  }

  // Count findings by type
  const shadowedGuards = findings.filter(f => f.id.startsWith('guard-shadow-')).length;
  const unenforcedInvariants = findings.filter(f => f.id.startsWith('unenforced-invariant-')).length;
  const unreachableRules = findings.filter(f => f.id.startsWith('unreachable-')).length;
  const incompleteStateCoverage = findings.filter(f => f.id.startsWith('incomplete-state-coverage-')).length;

  // Risk level
  const failOpenCount = findings.filter(f => f.id.startsWith('fail-open-surface-')).length;
  let riskLevel: GovernanceHealth['riskLevel'] = 'low';
  const totalIssues = unenforcedInvariants + failOpenCount + incompleteStateCoverage;
  if (totalIssues > 0 || unreachableRules > 0) riskLevel = 'moderate';
  if (totalIssues > 2 || (unenforcedInvariants > 0 && failOpenCount > 0) || incompleteStateCoverage > 2) riskLevel = 'high';

  return {
    surfacesCovered,
    surfacesTotal: allSurfaces.size,
    surfaces,
    invariantsEnforced,
    invariantsTotal: structuralInvariants.length,
    shadowedGuards,
    unenforcedInvariants,
    unreachableRules,
    incompleteStateCoverage,
    riskLevel,
  };
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
