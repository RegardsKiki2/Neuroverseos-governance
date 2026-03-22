/**
 * World Composition Engine — Tests
 *
 * Tests the deterministic merging of base worlds and modules.
 * Covers the four required cases from the spec plus edge cases.
 *
 * These tests protect the composition engine — any regression
 * in merge logic, conflict detection, or ordering will be caught here.
 */

import { describe, it, expect } from 'vitest';
import { composeWorld, composeWorldMulti } from '../composeWorld';
import type { WorldModule } from '../types';
import type {
  WorldDefinition,
  Invariant,
  Rule,
  Guard,
  WorldRoleDefinition,
} from '../../types';

// ─── Test Fixtures ──────────────────────────────────────────────────────────

/** Minimal valid invariant */
function makeInvariant(id: string, label?: string): Invariant {
  return {
    id,
    label: label ?? `Invariant: ${id}`,
    enforcement: 'structural',
    mutable: false,
  };
}

/** Minimal valid guard */
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

/** Minimal valid rule */
function makeRule(id: string, order: number, label?: string): Rule {
  return {
    id,
    severity: 'degradation',
    label: label ?? `Rule: ${id}`,
    description: `Rule ${id} description`,
    order,
    triggers: [
      { field: 'test_field', operator: '==', value: true, source: 'state' },
    ],
    effects: [
      { target: 'test_output', operation: 'set', value: 1 },
    ],
    causal_translation: {
      trigger_text: `When ${id} triggers`,
      rule_text: `${id} fires`,
      shift_text: `${id} shifts state`,
      effect_text: `${id} applied`,
    },
  };
}

/** Minimal valid role */
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

/** Create a minimal valid base world */
function makeBaseWorld(overrides?: Partial<WorldDefinition>): WorldDefinition {
  return {
    world: {
      world_id: 'test-world',
      name: 'Test World',
      thesis: 'A test world for composition',
      version: '1.0.0',
      runtime_mode: 'SIMULATION',
      default_assumption_profile: 'baseline',
      default_alternative_profile: 'alternative',
      modules: [],
      players: { thinking_space: true, experience_space: true, action_space: true },
    },
    invariants: [
      makeInvariant('inv-alpha', 'Alpha invariant'),
      makeInvariant('inv-beta', 'Beta invariant'),
    ],
    assumptions: {
      profiles: {
        baseline: {
          name: 'Baseline',
          description: 'Default assumptions',
          parameters: {},
        },
      },
      parameter_definitions: {},
    },
    stateSchema: {
      variables: {},
      presets: {},
    },
    rules: [
      makeRule('rule-001', 1, 'First rule'),
      makeRule('rule-002', 2, 'Second rule'),
    ],
    gates: {
      viability_classification: [],
      structural_override: {
        description: 'Structural collapse',
        enforcement: 'mandatory',
      },
      sustainability_threshold: 0.03,
      collapse_visual: {
        background: '#1c1917',
        text: '#fef2f2',
        border: '#b91c1c',
        label: 'MODEL COLLAPSES',
      },
    },
    outcomes: {
      computed_outcomes: [],
      comparison_layout: {
        primary_card: '',
        status_badge: '',
        structural_indicators: [],
      },
    },
    guards: {
      guards: [
        makeGuard('guard-01', 'First guard'),
      ],
      intent_vocabulary: {},
    },
    roles: {
      assignment: 'dynamic',
      roles: [
        makeRole('analyst', 'Market Analyst'),
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

/** Create a minimal module */
function makeModule(overrides?: Partial<WorldModule>): WorldModule {
  return {
    type: 'module',
    name: 'Test Module',
    ...overrides,
  };
}

// ─── Spec Test Case 1: Clean Add ────────────────────────────────────────────

describe('Case 1 — Clean Invariant Add', () => {
  it('appends module invariant to base invariants', () => {
    const base = makeBaseWorld();
    const module = makeModule({
      name: 'Innovation Module',
      invariants: [makeInvariant('inv-gamma', 'Gamma invariant')],
    });

    const result = composeWorld(base, module);

    expect(result.mergedWorld.invariants).toHaveLength(3);
    expect(result.mergedWorld.invariants[0].id).toBe('inv-alpha');
    expect(result.mergedWorld.invariants[1].id).toBe('inv-beta');
    expect(result.mergedWorld.invariants[2].id).toBe('inv-gamma');
  });

  it('reports correct diff', () => {
    const base = makeBaseWorld();
    const module = makeModule({
      invariants: [makeInvariant('inv-gamma')],
    });

    const result = composeWorld(base, module);

    expect(result.diff.added.invariants).toEqual(['inv-gamma']);
    expect(result.diff.unchanged.invariants).toEqual(['inv-alpha', 'inv-beta']);
  });

  it('has severity medium (invariant addition)', () => {
    const base = makeBaseWorld();
    const module = makeModule({
      invariants: [makeInvariant('inv-gamma')],
    });

    const result = composeWorld(base, module);

    expect(result.severity).toBe('medium');
  });

  it('has no conflicts', () => {
    const base = makeBaseWorld();
    const module = makeModule({
      invariants: [makeInvariant('inv-gamma')],
    });

    const result = composeWorld(base, module);

    expect(result.conflicts).toHaveLength(0);
  });
});

// ─── Spec Test Case 2: Guard Add ────────────────────────────────────────────

describe('Case 2 — Guard Add', () => {
  it('appends module guards to base guards', () => {
    const base = makeBaseWorld();
    const module = makeModule({
      name: 'Safety Module',
      guards: [
        makeGuard('guard-02', 'Second guard'),
        makeGuard('guard-03', 'Third guard'),
      ],
    });

    const result = composeWorld(base, module);

    expect(result.mergedWorld.guards!.guards).toHaveLength(3);
    expect(result.mergedWorld.guards!.guards[0].id).toBe('guard-01');
    expect(result.mergedWorld.guards!.guards[1].id).toBe('guard-02');
    expect(result.mergedWorld.guards!.guards[2].id).toBe('guard-03');
  });

  it('has severity medium (guard addition)', () => {
    const base = makeBaseWorld();
    const module = makeModule({
      guards: [makeGuard('guard-02'), makeGuard('guard-03')],
    });

    const result = composeWorld(base, module);

    expect(result.severity).toBe('medium');
  });

  it('preserves existing intent vocabulary', () => {
    const base = makeBaseWorld({
      guards: {
        guards: [makeGuard('guard-01')],
        intent_vocabulary: {
          'deploy': { label: 'Deploy', pattern: 'deploy.*prod' },
        },
      },
    });
    const module = makeModule({
      guards: [makeGuard('guard-02')],
    });

    const result = composeWorld(base, module);

    expect(result.mergedWorld.guards!.intent_vocabulary).toHaveProperty('deploy');
  });
});

// ─── Spec Test Case 3: ID Collision ─────────────────────────────────────────

describe('Case 3 — ID Collision', () => {
  it('detects rule ID collision', () => {
    const base = makeBaseWorld();
    const module = makeModule({
      rules: [makeRule('rule-001', 10, 'Conflicting rule')],
    });

    const result = composeWorld(base, module);

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].type).toBe('id_collision');
    expect(result.conflicts[0].category).toBe('rules');
    expect(result.conflicts[0].id).toBe('rule-001');
  });

  it('has severity critical on ID collision', () => {
    const base = makeBaseWorld();
    const module = makeModule({
      rules: [makeRule('rule-001', 10)],
    });

    const result = composeWorld(base, module);

    expect(result.severity).toBe('critical');
  });

  it('includes both base and module items in conflict', () => {
    const base = makeBaseWorld();
    const module = makeModule({
      rules: [makeRule('rule-001', 10, 'Module version')],
    });

    const result = composeWorld(base, module);

    expect(result.conflicts[0].baseItem).toHaveProperty('id', 'rule-001');
    expect((result.conflicts[0].baseItem as Rule).label).toBe('First rule');
    expect(result.conflicts[0].moduleItem).toHaveProperty('id', 'rule-001');
    expect((result.conflicts[0].moduleItem as Rule).label).toBe('Module version');
  });

  it('does not add conflicting items to merged world', () => {
    const base = makeBaseWorld();
    const module = makeModule({
      rules: [
        makeRule('rule-001', 10, 'Conflicting'),
        makeRule('rule-new', 11, 'Non-conflicting'),
      ],
    });

    const result = composeWorld(base, module);

    // Original 2 base rules + 1 non-conflicting = 3
    expect(result.mergedWorld.rules).toHaveLength(3);
    expect(result.mergedWorld.rules.map(r => r.id)).toContain('rule-new');
    // The conflicting duplicate should not create a second rule-001
    expect(result.mergedWorld.rules.filter(r => r.id === 'rule-001')).toHaveLength(1);
  });

  it('detects collision across multiple categories', () => {
    const base = makeBaseWorld();
    const module = makeModule({
      invariants: [makeInvariant('inv-alpha')], // collision
      guards: [makeGuard('guard-01')],          // collision
      rules: [makeRule('rule-new', 5)],         // clean
      roles: [makeRole('analyst')],             // collision
    });

    const result = composeWorld(base, module);

    expect(result.conflicts).toHaveLength(3);
    expect(result.severity).toBe('critical');

    const categories = result.conflicts.map(c => c.category);
    expect(categories).toContain('invariants');
    expect(categories).toContain('guards');
    expect(categories).toContain('roles');
  });
});

// ─── Spec Test Case 4: Empty Module ─────────────────────────────────────────

describe('Case 4 — Empty Module', () => {
  it('produces no changes', () => {
    const base = makeBaseWorld();
    const module = makeModule({ name: 'Empty Module' });

    const result = composeWorld(base, module);

    expect(result.diff.added.invariants).toHaveLength(0);
    expect(result.diff.added.guards).toHaveLength(0);
    expect(result.diff.added.rules).toHaveLength(0);
    expect(result.diff.added.roles).toHaveLength(0);
  });

  it('has severity low', () => {
    const base = makeBaseWorld();
    const module = makeModule();

    const result = composeWorld(base, module);

    expect(result.severity).toBe('low');
  });

  it('preserves base world exactly', () => {
    const base = makeBaseWorld();
    const module = makeModule();

    const result = composeWorld(base, module);

    expect(result.mergedWorld.invariants).toHaveLength(2);
    expect(result.mergedWorld.rules).toHaveLength(2);
    expect(result.mergedWorld.guards!.guards).toHaveLength(1);
    expect(result.mergedWorld.roles!.roles).toHaveLength(1);
  });

  it('has no conflicts', () => {
    const base = makeBaseWorld();
    const module = makeModule();

    const result = composeWorld(base, module);

    expect(result.conflicts).toHaveLength(0);
  });
});

// ─── Determinism ────────────────────────────────────────────────────────────

describe('Determinism', () => {
  it('produces identical output on repeated calls', () => {
    const base = makeBaseWorld();
    const module = makeModule({
      invariants: [makeInvariant('inv-new')],
      rules: [makeRule('rule-new', 5)],
      guards: [makeGuard('guard-new')],
      roles: [makeRole('new-role')],
    });

    const result1 = composeWorld(base, module);
    const result2 = composeWorld(base, module);

    expect(result1.worldHash).toBe(result2.worldHash);
    expect(result1.severity).toBe(result2.severity);
    expect(result1.diff).toEqual(result2.diff);
    expect(result1.conflicts).toEqual(result2.conflicts);
  });

  it('generates a worldHash', () => {
    const base = makeBaseWorld();
    const module = makeModule({
      invariants: [makeInvariant('inv-new')],
    });

    const result = composeWorld(base, module);

    expect(result.worldHash).toBeTruthy();
    expect(result.worldHash).toMatch(/^fnv1a:/);
  });
});

// ─── Ordering ───────────────────────────────────────────────────────────────

describe('Ordering', () => {
  it('preserves base order then appends module items', () => {
    const base = makeBaseWorld();
    const module = makeModule({
      invariants: [
        makeInvariant('inv-zz', 'ZZ invariant'),
        makeInvariant('inv-aa', 'AA invariant'),
      ],
    });

    const result = composeWorld(base, module);

    const ids = result.mergedWorld.invariants.map(i => i.id);
    // Base first (alpha, beta), then module in module order (zz, aa)
    expect(ids).toEqual(['inv-alpha', 'inv-beta', 'inv-zz', 'inv-aa']);
  });

  it('preserves rule order values from both base and module', () => {
    const base = makeBaseWorld();
    const module = makeModule({
      rules: [
        makeRule('rule-module-1', 3),
        makeRule('rule-module-2', 4),
      ],
    });

    const result = composeWorld(base, module);

    expect(result.mergedWorld.rules).toHaveLength(4);
    // Base rules first, then module rules (in module order)
    expect(result.mergedWorld.rules[0].id).toBe('rule-001');
    expect(result.mergedWorld.rules[1].id).toBe('rule-002');
    expect(result.mergedWorld.rules[2].id).toBe('rule-module-1');
    expect(result.mergedWorld.rules[3].id).toBe('rule-module-2');
  });
});

// ─── Purity ─────────────────────────────────────────────────────────────────

describe('Purity', () => {
  it('does not mutate the base world', () => {
    const base = makeBaseWorld();
    const originalInvariantCount = base.invariants.length;
    const originalRuleCount = base.rules.length;

    const module = makeModule({
      invariants: [makeInvariant('inv-new')],
      rules: [makeRule('rule-new', 5)],
    });

    composeWorld(base, module);

    expect(base.invariants).toHaveLength(originalInvariantCount);
    expect(base.rules).toHaveLength(originalRuleCount);
  });

  it('does not mutate the module', () => {
    const base = makeBaseWorld();
    const moduleInvariants = [makeInvariant('inv-new')];
    const module = makeModule({ invariants: moduleInvariants });

    composeWorld(base, module);

    expect(module.invariants).toHaveLength(1);
    expect(module.invariants![0].id).toBe('inv-new');
  });
});

// ─── Role-Only Addition ─────────────────────────────────────────────────────

describe('Role-only addition', () => {
  it('has severity low when only roles are added', () => {
    const base = makeBaseWorld();
    const module = makeModule({
      roles: [makeRole('executor', 'Task Executor')],
    });

    const result = composeWorld(base, module);

    expect(result.severity).toBe('low');
    expect(result.diff.added.roles).toEqual(['executor']);
  });
});

// ─── Rule-Only Addition ─────────────────────────────────────────────────────

describe('Rule-only addition', () => {
  it('has severity low when only rules are added', () => {
    const base = makeBaseWorld();
    const module = makeModule({
      rules: [makeRule('rule-new', 5)],
    });

    const result = composeWorld(base, module);

    expect(result.severity).toBe('low');
    expect(result.diff.added.rules).toEqual(['rule-new']);
  });
});

// ─── Missing Sections ───────────────────────────────────────────────────────

describe('Missing sections in base world', () => {
  it('handles base world with no guards', () => {
    const base = makeBaseWorld({ guards: undefined });
    const module = makeModule({
      guards: [makeGuard('guard-new')],
    });

    const result = composeWorld(base, module);

    expect(result.mergedWorld.guards!.guards).toHaveLength(1);
    expect(result.mergedWorld.guards!.guards[0].id).toBe('guard-new');
    expect(result.conflicts).toHaveLength(0);
  });

  it('handles base world with no roles', () => {
    const base = makeBaseWorld({ roles: undefined });
    const module = makeModule({
      roles: [makeRole('new-role')],
    });

    const result = composeWorld(base, module);

    expect(result.mergedWorld.roles!.roles).toHaveLength(1);
    expect(result.mergedWorld.roles!.roles[0].id).toBe('new-role');
  });
});

// ─── Multi-Module Composition ───────────────────────────────────────────────

describe('composeWorldMulti', () => {
  it('composes multiple modules in sequence', () => {
    const base = makeBaseWorld();
    const moduleA = makeModule({
      name: 'Module A',
      invariants: [makeInvariant('inv-from-a')],
    });
    const moduleB = makeModule({
      name: 'Module B',
      invariants: [makeInvariant('inv-from-b')],
      rules: [makeRule('rule-from-b', 5)],
    });

    const result = composeWorldMulti(base, [moduleA, moduleB]);

    expect(result.mergedWorld.invariants).toHaveLength(4); // 2 base + 1 A + 1 B
    expect(result.mergedWorld.rules).toHaveLength(3); // 2 base + 1 B
    expect(result.moduleName).toBe('Module A + Module B');
    expect(result.severity).toBe('medium');
  });

  it('stops on first conflict by default', () => {
    const base = makeBaseWorld();
    const moduleA = makeModule({
      name: 'Conflicting Module',
      invariants: [makeInvariant('inv-alpha')], // collision with base
    });
    const moduleB = makeModule({
      name: 'Clean Module',
      invariants: [makeInvariant('inv-new')],
    });

    const result = composeWorldMulti(base, [moduleA, moduleB]);

    expect(result.severity).toBe('critical');
    expect(result.conflicts).toHaveLength(1);
    // Module B was never applied because Module A had a conflict
    expect(result.diff.added.invariants).not.toContain('inv-new');
  });

  it('continues on conflict when told to', () => {
    const base = makeBaseWorld();
    const moduleA = makeModule({
      name: 'Conflicting',
      invariants: [makeInvariant('inv-alpha')], // collision
    });
    const moduleB = makeModule({
      name: 'Clean',
      invariants: [makeInvariant('inv-new')],
    });

    const result = composeWorldMulti(base, [moduleA, moduleB], {
      continueOnConflict: true,
    });

    expect(result.severity).toBe('critical');
    expect(result.conflicts).toHaveLength(1);
    // Module B was applied despite Module A's conflict
    expect(result.diff.added.invariants).toContain('inv-new');
  });

  it('handles empty module array', () => {
    const base = makeBaseWorld();
    const result = composeWorldMulti(base, []);

    expect(result.severity).toBe('low');
    expect(result.conflicts).toHaveLength(0);
    expect(result.mergedWorld.invariants).toHaveLength(2);
  });

  it('detects cross-module ID collision', () => {
    const base = makeBaseWorld();
    const moduleA = makeModule({
      name: 'Module A',
      rules: [makeRule('shared-rule', 5)],
    });
    const moduleB = makeModule({
      name: 'Module B',
      rules: [makeRule('shared-rule', 6)], // collides with A's rule (now in base after A applied)
    });

    const result = composeWorldMulti(base, [moduleA, moduleB]);

    expect(result.severity).toBe('critical');
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].id).toBe('shared-rule');
  });
});

// ─── Full Composition (All Categories) ──────────────────────────────────────

describe('Full composition across all categories', () => {
  it('handles a module adding items to every category', () => {
    const base = makeBaseWorld();
    const module = makeModule({
      name: 'Full Module',
      invariants: [makeInvariant('inv-new')],
      guards: [makeGuard('guard-new')],
      rules: [makeRule('rule-new', 5)],
      roles: [makeRole('new-role')],
    });

    const result = composeWorld(base, module);

    expect(result.mergedWorld.invariants).toHaveLength(3);
    expect(result.mergedWorld.guards!.guards).toHaveLength(2);
    expect(result.mergedWorld.rules).toHaveLength(3);
    expect(result.mergedWorld.roles!.roles).toHaveLength(2);

    expect(result.diff.added.invariants).toEqual(['inv-new']);
    expect(result.diff.added.guards).toEqual(['guard-new']);
    expect(result.diff.added.rules).toEqual(['rule-new']);
    expect(result.diff.added.roles).toEqual(['new-role']);

    // Severity is medium because invariants and guards were added
    expect(result.severity).toBe('medium');
    expect(result.conflicts).toHaveLength(0);
  });
});

// ─── Module Name Tracking ───────────────────────────────────────────────────

describe('Module name tracking', () => {
  it('includes module name in result', () => {
    const base = makeBaseWorld();
    const module = makeModule({ name: 'Innovation Strategy' });

    const result = composeWorld(base, module);

    expect(result.moduleName).toBe('Innovation Strategy');
  });
});
