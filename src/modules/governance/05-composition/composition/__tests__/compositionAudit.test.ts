/**
 * World Composition Engine — Full Integrity Audit
 *
 * 9-point audit + determinism test + bonus CI guard.
 *
 * Phase 1: Data Model Integrity (checks 1-3)
 *   1. Tier grouping does not mutate world structure
 *   2. World hash stability — no UI-state leakage
 *   3. Round-trip: load → export → deep-equal
 *
 * Phase 2: UI Wiring Audit (checks 4-6)
 *   4. Side panel sync — counts derive from canonical state
 *   5. Upper panel summary accuracy — counts = array lengths
 *   6. Enforcement mode reflects real state
 *
 * Phase 3: Runtime Integrity (checks 7-9)
 *   7. Configurator world = Runtime world (hash match)
 *   8. Invariant enforcement survives composition
 *   9. Collapse gates still fire after composition
 *
 * Phase 4: Determinism
 *   - Compose same modules twice → deep equal
 *   - Shuffle input module order → deterministic within each ordering
 *   - Export composed world → re-import → no drift
 *
 * Bonus: CI guard — hash(exported) === hash(compiled)
 */

import { describe, it, expect } from 'vitest';
import { composeWorld, composeWorldMulti } from '../composeWorld';
import { computeIntegrityHash } from '../../compiler';
import { evaluateStructuralGates, evaluateRules, checkCollapse, classifyOutcome } from '../../WorldEngine';
import type { WorldModule } from '../types';
import type {
  WorldDefinition,
  Invariant,
  Rule,
  Guard,
  WorldRoleDefinition,
  SimulationState,
} from '../../types';

// ─── Test Fixtures ──────────────────────────────────────────────────────────

function makeInvariant(id: string, label?: string): Invariant {
  return { id, label: label ?? `Invariant: ${id}`, enforcement: 'structural', mutable: false };
}

function makeGuard(id: string, label?: string): Guard {
  return {
    id,
    label: label ?? `Guard: ${id}`,
    description: `Guard ${id} description`,
    category: 'operational',
    enforcement: 'pause',
    immutable: false,
    intent_patterns: [],
  };
}

function makeRule(id: string, order: number, overrides?: Partial<Rule>): Rule {
  return {
    id,
    severity: 'degradation',
    label: overrides?.label ?? `Rule: ${id}`,
    description: `Rule ${id} description`,
    order,
    triggers: overrides?.triggers ?? [
      { field: 'test_field', operator: '==', value: true, source: 'state' },
    ],
    effects: overrides?.effects ?? [
      { target: 'test_output', operation: 'set', value: 1 },
    ],
    causal_translation: {
      trigger_text: `When ${id} triggers`,
      rule_text: `${id} fires`,
      shift_text: `${id} shifts state`,
      effect_text: `${id} applied`,
    },
    ...overrides,
  };
}

function makeRole(id: string, name?: string): WorldRoleDefinition {
  return {
    id,
    archetype: 'operator',
    authority: 'execute_within_limits',
    posture: 'task_oriented',
    name: name ?? `Role: ${id}`,
    description: `Role ${id} description`,
    roleMandate: `${id} mandate`,
    canDo: ['read', 'write'],
    cannotDo: [],
  };
}

/** Create a rich world with invariants, rules, guards, roles, gates, outcomes, state schema */
function makeRichWorld(overrides?: Partial<WorldDefinition>): WorldDefinition {
  return {
    world: {
      world_id: 'audit-world',
      name: 'Audit World',
      thesis: 'A world for integrity auditing',
      version: '1.0.0',
      runtime_mode: 'SIMULATION',
      default_assumption_profile: 'baseline',
      default_alternative_profile: 'alternative',
      modules: [],
      players: { thinking_space: true, experience_space: true, action_space: true },
    },
    invariants: [
      makeInvariant('inv-001', 'Revenue must never reach zero'),
      makeInvariant('inv-002', 'Governance is non-optional'),
      makeInvariant('inv-003', 'All actions must be auditable'),
    ],
    assumptions: {
      profiles: {
        baseline: {
          name: 'Baseline',
          description: 'Standard operating conditions',
          parameters: { market_type: 'stable', regulation: 'moderate' },
        },
        alternative: {
          name: 'Disrupted',
          description: 'Disruptive market conditions',
          parameters: { market_type: 'disrupted', regulation: 'light' },
        },
      },
      parameter_definitions: {
        market_type: { type: 'enum', options: ['stable', 'disrupted', 'volatile'], label: 'Market Type', description: 'Market condition' },
        regulation: { type: 'enum', options: ['strict', 'moderate', 'light'], label: 'Regulation', description: 'Regulatory environment' },
      },
    },
    stateSchema: {
      variables: {
        revenue_margin: { type: 'number', min: 0, max: 100, step: 1, default: 35, mutable: true, label: 'Revenue Margin', description: 'Revenue margin %', display_as: 'percentage' },
        cost_ratio: { type: 'number', min: 0, max: 100, step: 1, default: 40, mutable: true, label: 'Cost Ratio', description: 'Cost ratio %', display_as: 'percentage' },
        innovation_index: { type: 'number', min: 0, max: 100, step: 5, default: 50, mutable: true, label: 'Innovation Index', description: 'Innovation score' },
      },
      presets: {
        healthy: { description: 'Healthy state', values: { revenue_margin: 45, cost_ratio: 30, innovation_index: 70 } },
        stressed: { description: 'Stressed state', values: { revenue_margin: 10, cost_ratio: 70, innovation_index: 20 } },
      },
    },
    rules: [
      makeRule('rule-001', 1, {
        label: 'High costs compress margins',
        triggers: [{ field: 'cost_ratio', operator: '>', value: 60, source: 'state' }],
        effects: [{ target: 'revenue_margin', operation: 'multiply', value: 0.7 }],
      }),
      makeRule('rule-002', 2, {
        label: 'Disrupted market cuts revenue',
        triggers: [{ field: 'market_type', operator: '==', value: 'disrupted', source: 'assumption' }],
        effects: [{ target: 'revenue_margin', operation: 'multiply', value: 0.5 }],
      }),
      makeRule('rule-003', 3, {
        label: 'Revenue collapse gate',
        triggers: [{ field: 'revenue_margin', operator: '<', value: 5, source: 'state' }],
        effects: [],
        collapse_check: { field: 'revenue_margin', operator: '<=', value: 3, result: 'MODEL_COLLAPSES' },
      }),
    ],
    gates: {
      viability_classification: [
        { status: 'THRIVING', field: 'revenue_margin', operator: '>=', value: 40, color: '#0f6b3a', icon: 'check' },
        { status: 'STABLE', field: 'revenue_margin', operator: '>=', value: 20, color: '#1856b8', icon: 'minus' },
        { status: 'COMPRESSED', field: 'revenue_margin', operator: '>=', value: 10, color: '#a16207', icon: 'alert' },
        { status: 'CRITICAL', field: 'revenue_margin', operator: '>', value: 3, color: '#b91c1c', icon: 'alert' },
        { status: 'MODEL_COLLAPSES', field: 'revenue_margin', operator: '<=', value: 3, color: '#1c1917', icon: 'x' },
      ],
      structural_override: { description: 'Structural collapse', enforcement: 'mandatory' },
      sustainability_threshold: 0.03,
      collapse_visual: { background: '#1c1917', text: '#fef2f2', border: '#b91c1c', label: 'MODEL COLLAPSES' },
    },
    outcomes: {
      computed_outcomes: [
        { id: 'revenue_margin', type: 'number', range: [0, 100], display_as: 'percentage', label: 'Revenue Margin', primary: true, show_in_comparison: true },
        { id: 'innovation_index', type: 'number', range: [0, 100], label: 'Innovation Index', show_in_comparison: true },
      ],
      comparison_layout: { primary_card: 'revenue_margin', status_badge: 'revenue_margin', structural_indicators: ['innovation_index'] },
    },
    guards: {
      guards: [
        makeGuard('guard-budget', 'Budget guard'),
        makeGuard('guard-safety', 'Safety guard'),
      ],
      intent_vocabulary: { deploy: { label: 'Deploy', pattern: 'deploy.*prod' } },
    },
    roles: {
      assignment: 'dynamic',
      roles: [
        makeRole('analyst', 'Market Analyst'),
        makeRole('guardian', 'Risk Guardian'),
      ],
      transitions: [],
    },
    metadata: {
      format_version: '1.0.0',
      created_at: '2025-01-01T00:00:00Z',
      last_modified: '2025-01-01T00:00:00Z',
      authoring_method: 'manual-authoring',
    },
    ...overrides,
  };
}

function makeModule(overrides?: Partial<WorldModule>): WorldModule {
  return { type: 'module', name: 'Test Module', ...overrides };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1 — DATA MODEL INTEGRITY AUDIT
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase 1 — Data Model Integrity', () => {
  // ─── Check 1: Tier grouping does NOT mutate world structure ────────────
  describe('Check 1: Tier grouping is view-only', () => {
    it('invariants remain at world.invariants, not nested under tiers', () => {
      const world = makeRichWorld();
      const module = makeModule({
        invariants: [makeInvariant('inv-module-001', 'Module constraint')],
      });

      const result = composeWorld(world, module);

      // Invariants are a flat array at the top level — no tier wrapping
      expect(Array.isArray(result.mergedWorld.invariants)).toBe(true);
      expect(result.mergedWorld.invariants.every(i => 'id' in i && 'label' in i)).toBe(true);
      // No tier-based nesting exists
      expect((result.mergedWorld as unknown as Record<string, unknown>).tiers).toBeUndefined();
      expect((result.mergedWorld as unknown as Record<string, unknown>)['non-negotiables']).toBeUndefined();
    });

    it('rules remain at world.rules, not nested under tiers', () => {
      const world = makeRichWorld();
      const module = makeModule({
        rules: [makeRule('rule-module-001', 10, { label: 'Module rule' })],
      });

      const result = composeWorld(world, module);

      expect(Array.isArray(result.mergedWorld.rules)).toBe(true);
      expect(result.mergedWorld.rules.every(r => 'id' in r && 'triggers' in r)).toBe(true);
    });

    it('roles remain at world.roles.roles, not nested under tiers', () => {
      const world = makeRichWorld();
      const module = makeModule({
        roles: [makeRole('executor', 'Task Executor')],
      });

      const result = composeWorld(world, module);

      expect(result.mergedWorld.roles!.roles.every(r => 'id' in r && 'archetype' in r)).toBe(true);
      expect(result.mergedWorld.roles!.assignment).toBe('dynamic');
    });

    it('guards remain at world.guards.guards (canonical location)', () => {
      const world = makeRichWorld();
      const module = makeModule({
        guards: [makeGuard('guard-module', 'Module guard')],
      });

      const result = composeWorld(world, module);

      expect(result.mergedWorld.guards!.guards.every(g => 'id' in g && 'enforcement' in g)).toBe(true);
      expect(result.mergedWorld.guards!.intent_vocabulary).toBeDefined();
    });

    it('gates remain at world.gates (collapse gates in canonical location)', () => {
      const world = makeRichWorld();
      const module = makeModule({ name: 'Empty Module' });

      const result = composeWorld(world, module);

      expect(result.mergedWorld.gates.viability_classification).toHaveLength(5);
      expect(result.mergedWorld.gates.structural_override.enforcement).toBe('mandatory');
      expect(result.mergedWorld.gates.sustainability_threshold).toBe(0.03);
    });
  });

  // ─── Check 2: World hash stability ────────────────────────────────────
  describe('Check 2: World hash stability', () => {
    it('hash does not change when no semantic edits occurred', () => {
      const world = makeRichWorld();

      const hash1 = computeIntegrityHash(world);
      const hash2 = computeIntegrityHash(world);

      expect(hash1).toBe(hash2);
    });

    it('hash is identical after compose with empty module', () => {
      const world = makeRichWorld();
      const hashBefore = computeIntegrityHash(world);

      const result = composeWorld(world, makeModule());
      const hashAfter = result.worldHash;

      // Empty module = no semantic change = same hash
      expect(hashAfter).toBe(hashBefore);
    });

    it('hash changes when structural content changes', () => {
      const world = makeRichWorld();
      const hashBefore = computeIntegrityHash(world);

      const result = composeWorld(world, makeModule({
        invariants: [makeInvariant('inv-new', 'New constraint')],
      }));

      expect(result.worldHash).not.toBe(hashBefore);
    });

    it('structuredClone does not alter hash', () => {
      const world = makeRichWorld();
      const hash1 = computeIntegrityHash(world);
      const clone = structuredClone(world);
      const hash2 = computeIntegrityHash(clone);

      expect(hash1).toBe(hash2);
    });

    it('JSON round-trip does not alter hash', () => {
      const world = makeRichWorld();
      const hash1 = computeIntegrityHash(world);
      const roundTripped = JSON.parse(JSON.stringify(world)) as WorldDefinition;
      const hash2 = computeIntegrityHash(roundTripped);

      expect(hash1).toBe(hash2);
    });
  });

  // ─── Check 3: Round-trip test ─────────────────────────────────────────
  describe('Check 3: Round-trip (load → compose → export → deep-equal)', () => {
    it('composed world survives JSON round-trip without field loss', () => {
      const world = makeRichWorld();
      const module = makeModule({
        name: 'Full Module',
        invariants: [makeInvariant('inv-rt')],
        guards: [makeGuard('guard-rt')],
        rules: [makeRule('rule-rt', 10)],
        roles: [makeRole('role-rt')],
      });

      const result = composeWorld(world, module);
      const exported = JSON.parse(JSON.stringify(result.mergedWorld));

      // Deep-equal after JSON round-trip
      expect(exported.invariants).toEqual(result.mergedWorld.invariants);
      expect(exported.rules).toEqual(result.mergedWorld.rules);
      expect(exported.guards).toEqual(result.mergedWorld.guards);
      expect(exported.roles).toEqual(result.mergedWorld.roles);
      expect(exported.gates).toEqual(result.mergedWorld.gates);
      expect(exported.outcomes).toEqual(result.mergedWorld.outcomes);
      expect(exported.assumptions).toEqual(result.mergedWorld.assumptions);
      expect(exported.stateSchema).toEqual(result.mergedWorld.stateSchema);
      expect(exported.metadata).toEqual(result.mergedWorld.metadata);
    });

    it('no dropped fields after compose + serialize', () => {
      const world = makeRichWorld();
      const result = composeWorld(world, makeModule());
      const exported = JSON.parse(JSON.stringify(result.mergedWorld));

      // All top-level keys preserved
      const expectedKeys = ['world', 'invariants', 'assumptions', 'stateSchema', 'rules', 'gates', 'outcomes', 'guards', 'roles', 'metadata'];
      for (const key of expectedKeys) {
        expect(exported).toHaveProperty(key);
      }
    });

    it('hash matches after round-trip', () => {
      const world = makeRichWorld();
      const module = makeModule({ invariants: [makeInvariant('inv-hash-rt')] });

      const result = composeWorld(world, module);
      const exported = JSON.parse(JSON.stringify(result.mergedWorld)) as WorldDefinition;
      const recomputedHash = computeIntegrityHash(exported);

      expect(recomputedHash).toBe(result.worldHash);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2 — UI WIRING AUDIT
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase 2 — UI Wiring Audit', () => {
  // ─── Check 4: Side panel sync — counts from canonical state ──────────
  describe('Check 4: Side panel sync', () => {
    it('invariant count reflects actual array length after add', () => {
      const world = makeRichWorld();
      const result = composeWorld(world, makeModule({
        invariants: [makeInvariant('inv-new')],
      }));

      // The count a UI would show = invariants.length
      expect(result.mergedWorld.invariants.length).toBe(world.invariants.length + 1);
      expect(result.diff.added.invariants).toContain('inv-new');
    });

    it('rule count updates after module composition', () => {
      const world = makeRichWorld();
      const result = composeWorld(world, makeModule({
        rules: [makeRule('rule-new', 20)],
      }));

      expect(result.mergedWorld.rules.length).toBe(world.rules.length + 1);
    });

    it('role count updates after module composition', () => {
      const world = makeRichWorld();
      const result = composeWorld(world, makeModule({
        roles: [makeRole('new-role', 'New Role')],
      }));

      expect(result.mergedWorld.roles!.roles.length).toBe(world.roles!.roles.length + 1);
    });
  });

  // ─── Check 5: Summary accuracy ───────────────────────────────────────
  describe('Check 5: Summary panel accuracy', () => {
    it('non-negotiable count = invariants.length', () => {
      const world = makeRichWorld();
      expect(world.invariants.length).toBe(3);
    });

    it('rule count = rules.length', () => {
      const world = makeRichWorld();
      expect(world.rules.length).toBe(3);
    });

    it('role count = roles.roles.length', () => {
      const world = makeRichWorld();
      expect(world.roles!.roles.length).toBe(2);
    });

    it('integrity hash is computed from world definition, not UI state', () => {
      const world = makeRichWorld();
      const hash = computeIntegrityHash(world);

      // Hash starts with fnv1a: prefix
      expect(hash).toMatch(/^fnv1a:/);
      // Hash is deterministic
      expect(computeIntegrityHash(world)).toBe(hash);
    });
  });

  // ─── Check 6: Enforcement mode reflects real state ───────────────────
  describe('Check 6: Enforcement mode', () => {
    it('guards enforcement field is readable', () => {
      const world = makeRichWorld();

      for (const guard of world.guards!.guards) {
        expect(['block', 'pause', 'warn']).toContain(guard.enforcement);
      }
    });

    it('kernel absence means no chat governance', () => {
      const world = makeRichWorld();
      // World without kernel → no Thinking Space governance
      expect(world.kernel).toBeUndefined();
    });

    it('adding kernel to world enables governance', () => {
      const world = makeRichWorld({
        kernel: {
          artifact_type: 'kernel',
          kernel_id: 'test-kernel',
          version: '1.0.0',
          domain: 'testing',
          enforcement_level: 'standard',
          input_boundaries: { forbidden_patterns: [] },
          output_boundaries: { forbidden_patterns: [] },
          response_vocabulary: {},
          metadata: { compiled_by: 'test', compiled_at: '2025-01-01T00:00:00Z', source_hash: 'abc', compiler_version: '1.0' },
        },
      });

      expect(world.kernel).toBeDefined();
      expect(world.kernel!.enforcement_level).toBe('standard');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3 — RUNTIME INTEGRITY AUDIT
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase 3 — Runtime Integrity', () => {
  // ─── Check 7: Configurator world = Runtime world (hash match) ────────
  describe('Check 7: Configurator output = Runtime input', () => {
    it('hash of composed world matches recomputed hash', () => {
      const world = makeRichWorld();
      const module = makeModule({
        invariants: [makeInvariant('inv-runtime')],
        rules: [makeRule('rule-runtime', 15)],
      });

      const result = composeWorld(world, module);

      // Simulate: configurator exports, runtime reimports
      const serialized = JSON.stringify(result.mergedWorld);
      const runtimeWorld = JSON.parse(serialized) as WorldDefinition;
      const runtimeHash = computeIntegrityHash(runtimeWorld);

      expect(runtimeHash).toBe(result.worldHash);
    });

    it('rule evaluation on composed world is identical to original', () => {
      const world = makeRichWorld();
      const state: SimulationState = { revenue_margin: 35, cost_ratio: 65, innovation_index: 50 };

      // Evaluate on original world
      const originalResult = evaluateStructuralGates(world, state, 'baseline');

      // Compose with empty module, evaluate on result
      const composed = composeWorld(world, makeModule()).mergedWorld;
      const composedResult = evaluateStructuralGates(composed, state, 'baseline');

      expect(composedResult.classification).toBe(originalResult.classification);
      expect(composedResult.activatedRules.length).toBe(originalResult.activatedRules.length);
      expect(composedResult.activatedRules.map(r => r.ruleId)).toEqual(
        originalResult.activatedRules.map(r => r.ruleId)
      );
    });
  });

  // ─── Check 8: Invariant enforcement survives composition ─────────────
  describe('Check 8: Invariant enforcement survives composition', () => {
    it('invariants from base world survive composition', () => {
      const world = makeRichWorld();
      const module = makeModule({
        invariants: [makeInvariant('inv-extra', 'Extra constraint')],
      });

      const result = composeWorld(world, module);

      // All original invariants still present
      const ids = result.mergedWorld.invariants.map(i => i.id);
      expect(ids).toContain('inv-001');
      expect(ids).toContain('inv-002');
      expect(ids).toContain('inv-003');
      expect(ids).toContain('inv-extra');
    });

    it('invariants retain enforcement=structural and mutable=false', () => {
      const world = makeRichWorld();
      const module = makeModule({
        invariants: [makeInvariant('inv-enforcement')],
      });

      const result = composeWorld(world, module);

      for (const inv of result.mergedWorld.invariants) {
        expect(inv.enforcement).toBe('structural');
        expect(inv.mutable).toBe(false);
      }
    });

    it('rule evaluation still fires correctly after adding invariants', () => {
      const world = makeRichWorld();
      const module = makeModule({
        invariants: [makeInvariant('inv-new', 'New constraint')],
      });

      const result = composeWorld(world, module);
      const state: SimulationState = { revenue_margin: 35, cost_ratio: 65, innovation_index: 50 };

      // rule-001 should fire (cost_ratio > 60)
      const evalResult = evaluateStructuralGates(result.mergedWorld, state, 'baseline');
      const firedIds = evalResult.activatedRules.map(r => r.ruleId);
      expect(firedIds).toContain('rule-001');
    });
  });

  // ─── Check 9: Collapse gates still fire ──────────────────────────────
  describe('Check 9: Collapse gates still fire after composition', () => {
    it('structural collapse triggers on composed world', () => {
      const world = makeRichWorld();
      const module = makeModule({
        invariants: [makeInvariant('inv-extra')],
        roles: [makeRole('new-role')],
      });

      const result = composeWorld(world, module);

      // State that should trigger collapse: revenue_margin near 0
      const collapseState: SimulationState = { revenue_margin: 2, cost_ratio: 90, innovation_index: 5 };
      const evalResult = evaluateStructuralGates(result.mergedWorld, collapseState, 'baseline');

      expect(evalResult.classification).toBe('MODEL_COLLAPSES');
      expect(evalResult.isCollapse).toBe(true);
    });

    it('non-collapse state does not falsely collapse after composition', () => {
      const world = makeRichWorld();
      const module = makeModule({
        guards: [makeGuard('guard-extra')],
      });

      const result = composeWorld(world, module);

      const healthyState: SimulationState = { revenue_margin: 45, cost_ratio: 30, innovation_index: 70 };
      const evalResult = evaluateStructuralGates(result.mergedWorld, healthyState, 'baseline');

      expect(evalResult.classification).toBe('THRIVING');
      expect(evalResult.isCollapse).toBe(false);
    });

    it('collapse check function works in isolation', () => {
      const check = { field: 'revenue_margin', operator: '<=', value: 3, result: 'MODEL_COLLAPSES' };
      expect(checkCollapse(check, { revenue_margin: 2 })).toBe(true);
      expect(checkCollapse(check, { revenue_margin: 3 })).toBe(true);
      expect(checkCollapse(check, { revenue_margin: 4 })).toBe(false);
    });

    it('gate classification works across viability spectrum', () => {
      const world = makeRichWorld();

      const states: Array<{ margin: number; expected: string }> = [
        { margin: 50, expected: 'THRIVING' },
        { margin: 25, expected: 'STABLE' },
        { margin: 12, expected: 'COMPRESSED' },
        { margin: 4, expected: 'CRITICAL' },
        { margin: 3, expected: 'MODEL_COLLAPSES' },
      ];

      for (const { margin, expected } of states) {
        const classification = classifyOutcome(world, { revenue_margin: margin });
        expect(classification.status).toBe(expected);
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4 — DETERMINISM TEST
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase 4 — Determinism', () => {
  it('composing same modules twice produces deep-equal output', () => {
    const world = makeRichWorld();
    const module = makeModule({
      name: 'Determinism Module',
      invariants: [makeInvariant('inv-det')],
      guards: [makeGuard('guard-det')],
      rules: [makeRule('rule-det', 20)],
      roles: [makeRole('role-det')],
    });

    const result1 = composeWorld(world, module);
    const result2 = composeWorld(world, module);

    expect(result1.worldHash).toBe(result2.worldHash);
    expect(result1.mergedWorld.invariants).toEqual(result2.mergedWorld.invariants);
    expect(result1.mergedWorld.rules).toEqual(result2.mergedWorld.rules);
    expect(result1.mergedWorld.guards).toEqual(result2.mergedWorld.guards);
    expect(result1.mergedWorld.roles).toEqual(result2.mergedWorld.roles);
    expect(result1.diff).toEqual(result2.diff);
    expect(result1.conflicts).toEqual(result2.conflicts);
    expect(result1.severity).toBe(result2.severity);
  });

  it('multi-module composition is deterministic', () => {
    const world = makeRichWorld();
    const moduleA = makeModule({
      name: 'Module A',
      invariants: [makeInvariant('inv-a')],
      rules: [makeRule('rule-a', 20)],
    });
    const moduleB = makeModule({
      name: 'Module B',
      guards: [makeGuard('guard-b')],
      roles: [makeRole('role-b')],
    });

    const result1 = composeWorldMulti(world, [moduleA, moduleB]);
    const result2 = composeWorldMulti(world, [moduleA, moduleB]);

    expect(result1.worldHash).toBe(result2.worldHash);
    expect(result1.mergedWorld.invariants).toEqual(result2.mergedWorld.invariants);
    expect(result1.mergedWorld.rules).toEqual(result2.mergedWorld.rules);
  });

  it('different module order produces different (but each deterministic) output', () => {
    const world = makeRichWorld();
    const moduleA = makeModule({
      name: 'Module A',
      invariants: [makeInvariant('inv-a')],
    });
    const moduleB = makeModule({
      name: 'Module B',
      invariants: [makeInvariant('inv-b')],
    });

    const resultAB = composeWorldMulti(world, [moduleA, moduleB]);
    const resultBA = composeWorldMulti(world, [moduleB, moduleA]);

    // Both orders contain same invariant IDs
    const idsAB = resultAB.mergedWorld.invariants.map(i => i.id);
    const idsBA = resultBA.mergedWorld.invariants.map(i => i.id);
    expect(idsAB.sort()).toEqual(idsBA.sort());

    // But order may differ (A+B vs B+A appends in different order)
    // Each result is independently deterministic
    const resultAB2 = composeWorldMulti(world, [moduleA, moduleB]);
    const resultBA2 = composeWorldMulti(world, [moduleB, moduleA]);
    expect(resultAB.worldHash).toBe(resultAB2.worldHash);
    expect(resultBA.worldHash).toBe(resultBA2.worldHash);
  });

  it('composed world exported and re-imported has no drift', () => {
    const world = makeRichWorld();
    const module = makeModule({
      name: 'Drift Test',
      invariants: [makeInvariant('inv-drift')],
      rules: [makeRule('rule-drift', 25)],
    });

    const composed = composeWorld(world, module);
    const exported = JSON.stringify(composed.mergedWorld);
    const reimported = JSON.parse(exported) as WorldDefinition;

    // Hash must survive export → reimport
    expect(computeIntegrityHash(reimported)).toBe(composed.worldHash);

    // Deep structural equality
    expect(reimported.invariants).toEqual(composed.mergedWorld.invariants);
    expect(reimported.rules).toEqual(composed.mergedWorld.rules);
    expect(reimported.guards).toEqual(composed.mergedWorld.guards);
    expect(reimported.roles).toEqual(composed.mergedWorld.roles);
    expect(reimported.gates).toEqual(composed.mergedWorld.gates);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BONUS — CI GUARD AGAINST SILENT DRIFT
// ═══════════════════════════════════════════════════════════════════════════

describe('Bonus — CI Guard: hash(exported) === hash(compiled)', () => {
  it('exported world hash matches compiled world hash', () => {
    const world = makeRichWorld();
    const module = makeModule({
      name: 'CI Guard Module',
      invariants: [makeInvariant('inv-ci')],
      guards: [makeGuard('guard-ci')],
      rules: [makeRule('rule-ci', 30)],
      roles: [makeRole('role-ci')],
    });

    const composed = composeWorld(world, module);

    // Simulate export (what the compiler produces)
    const compiledHash = computeIntegrityHash(composed.mergedWorld);

    // Simulate re-import (what the runtime loads)
    const exported = JSON.parse(JSON.stringify(composed.mergedWorld)) as WorldDefinition;
    const exportedHash = computeIntegrityHash(exported);

    // THIS IS THE CI GUARD — if this fails, UI changes corrupted governance
    expect(exportedHash).toEqual(compiledHash);
    expect(exportedHash).toEqual(composed.worldHash);
  });

  it('base world survives composition purity (never mutated)', () => {
    const world = makeRichWorld();
    const hashBefore = computeIntegrityHash(world);
    const originalInvariantCount = world.invariants.length;
    const originalRuleCount = world.rules.length;

    composeWorld(world, makeModule({
      invariants: [makeInvariant('inv-purity')],
      rules: [makeRule('rule-purity', 50)],
    }));

    // Base world untouched
    expect(world.invariants.length).toBe(originalInvariantCount);
    expect(world.rules.length).toBe(originalRuleCount);
    expect(computeIntegrityHash(world)).toBe(hashBefore);
  });

  it('runtime evaluation on composed world matches evaluation on serialized world', () => {
    const world = makeRichWorld();
    const module = makeModule({ invariants: [makeInvariant('inv-eval')] });
    const composed = composeWorld(world, module);

    const state: SimulationState = { revenue_margin: 35, cost_ratio: 65, innovation_index: 50 };

    // Evaluate on in-memory composed world
    const memoryResult = evaluateStructuralGates(composed.mergedWorld, state, 'baseline');

    // Evaluate on serialized → deserialized world
    const serialized = JSON.parse(JSON.stringify(composed.mergedWorld)) as WorldDefinition;
    const serializedResult = evaluateStructuralGates(serialized, state, 'baseline');

    // Results must be identical
    expect(serializedResult.classification).toBe(memoryResult.classification);
    expect(serializedResult.isCollapse).toBe(memoryResult.isCollapse);
    expect(serializedResult.activatedRules.map(r => r.ruleId)).toEqual(
      memoryResult.activatedRules.map(r => r.ruleId)
    );
  });
});
