/**
 * Improve Engine — Actionable Suggestions from World Analysis
 *
 * Pure function: (world) → ImprovementReport
 *
 * Runs validation, simulation, and structural analysis to produce
 * prioritized, actionable suggestions for improving a world.
 *
 * Categories:
 *   1. Critical fixes — errors that prevent the world from running
 *   2. Structural gaps — missing guards, orphan variables, etc.
 *   3. Balance suggestions — detected from simulation dynamics
 *   4. Completeness — optional blocks that would strengthen the world
 *
 * INVARIANTS:
 *   - Deterministic: same world → same report.
 *   - Zero network calls. Zero LLM calls. Zero async.
 */

import type { WorldDefinition, Rule, Effect } from '../types';
import { validateWorld } from './validate-engine';
import { simulateWorld } from './simulate-engine';
import type { ValidateFinding } from '../contracts/validate-contract';

// ─── Types ───────────────────────────────────────────────────────────────────

export type SuggestionPriority = 'critical' | 'high' | 'medium' | 'low';
export type SuggestionCategory =
  | 'fix'           // Must fix — world won't run
  | 'structure'     // Structural gaps
  | 'balance'       // Rule balance / dynamics
  | 'completeness'  // Optional improvements
  | 'coverage';     // Guard / invariant coverage

export interface Suggestion {
  id: string;
  priority: SuggestionPriority;
  category: SuggestionCategory;
  title: string;
  description: string;
  action: string;
  affectedFiles: string[];
}

export interface ImprovementReport {
  worldId: string;
  worldName: string;
  score: number;            // 0-100 overall health
  suggestions: Suggestion[];
  stats: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

// ─── Core Engine ─────────────────────────────────────────────────────────────

export function improveWorld(world: WorldDefinition): ImprovementReport {
  const suggestions: Suggestion[] = [];

  // Phase 1: Convert validation findings to suggestions
  const report = validateWorld(world);
  addValidationSuggestions(report.findings, suggestions);

  // Phase 2: Structural analysis
  analyzeRuleBalance(world, suggestions);
  analyzeStateCoverage(world, suggestions);
  analyzeGateCoverage(world, suggestions);
  analyzeAssumptions(world, suggestions);

  // Phase 3: Simulation-based insights
  analyzeSimulationDynamics(world, suggestions);

  // Phase 4: Completeness
  analyzeCompleteness(world, suggestions);

  // Deduplicate by id
  const seen = new Set<string>();
  const unique = suggestions.filter(s => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });

  // Sort: critical first, then high, medium, low
  const priorityOrder: Record<SuggestionPriority, number> = {
    critical: 0, high: 1, medium: 2, low: 3,
  };
  unique.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  // Score
  const score = computeHealthScore(world, unique);

  return {
    worldId: world.world.world_id,
    worldName: world.world.name,
    score,
    suggestions: unique,
    stats: {
      critical: unique.filter(s => s.priority === 'critical').length,
      high: unique.filter(s => s.priority === 'high').length,
      medium: unique.filter(s => s.priority === 'medium').length,
      low: unique.filter(s => s.priority === 'low').length,
    },
  };
}

// ─── Phase 1: Validation → Suggestions ───────────────────────────────────────

function addValidationSuggestions(findings: ValidateFinding[], suggestions: Suggestion[]): void {
  for (const f of findings) {
    if (f.severity === 'info') continue;

    const priority: SuggestionPriority = f.severity === 'error' ? 'critical' : 'high';
    const category: SuggestionCategory = f.severity === 'error' ? 'fix' : 'structure';

    suggestions.push({
      id: `validate-${f.id}`,
      priority,
      category,
      title: f.message,
      description: f.message,
      action: f.suggestion ?? `Review ${f.affectedBlocks.join(', ')}`,
      affectedFiles: f.affectedBlocks,
    });
  }
}

// ─── Phase 2: Structural Analysis ────────────────────────────────────────────

function analyzeRuleBalance(world: WorldDefinition, suggestions: Suggestion[]): void {
  if (!world.rules || world.rules.length === 0) return;

  // Check severity distribution
  const structural = world.rules.filter(r => r.severity === 'structural');
  const degradation = world.rules.filter(r => r.severity === 'degradation');
  const advantage = world.rules.filter(r => r.severity === 'advantage');

  if (structural.length === 0) {
    suggestions.push({
      id: 'no-structural-rules',
      priority: 'high',
      category: 'balance',
      title: 'No structural rules',
      description: 'All rules are degradation or advantage. Structural rules define the core mechanics that hold the world together.',
      action: 'Add at least one structural-severity rule that enforces a fundamental world constraint.',
      affectedFiles: ['rules/'],
    });
  }

  if (advantage.length === 0 && world.rules.length >= 3) {
    suggestions.push({
      id: 'no-advantage-rules',
      priority: 'medium',
      category: 'balance',
      title: 'No advantage rules',
      description: 'All rules are negative (structural or degradation). Adding advantage rules creates positive feedback loops.',
      action: 'Add a rule with severity "advantage" that rewards desirable state.',
      affectedFiles: ['rules/'],
    });
  }

  if (degradation.length === 0 && world.rules.length >= 3) {
    suggestions.push({
      id: 'no-degradation-rules',
      priority: 'medium',
      category: 'balance',
      title: 'No degradation rules',
      description: 'No rules model gradual decline. Degradation rules create realistic tension.',
      action: 'Add a rule with severity "degradation" that models gradual state decline.',
      affectedFiles: ['rules/'],
    });
  }

  // Check for rules without causal_translation
  const missingTranslation = world.rules.filter(
    r => !r.causal_translation?.trigger_text && !r.causal_translation?.effect_text,
  );
  if (missingTranslation.length > 0 && missingTranslation.length <= 5) {
    suggestions.push({
      id: 'missing-causal-translations',
      priority: 'low',
      category: 'completeness',
      title: `${missingTranslation.length} rule(s) missing causal translations`,
      description: 'Causal translations provide human-readable narratives for rules. They improve explain output.',
      action: `Add causal_translation to: ${missingTranslation.map(r => r.id).join(', ')}`,
      affectedFiles: ['rules/'],
    });
  }
}

function analyzeStateCoverage(world: WorldDefinition, suggestions: Suggestion[]): void {
  if (!world.stateSchema?.variables || !world.rules) return;

  const variables = Object.keys(world.stateSchema.variables);
  const ruleTargets = new Set<string>();
  const ruleTriggers = new Set<string>();

  for (const rule of world.rules) {
    for (const t of rule.triggers) {
      if (t.source === 'state') ruleTriggers.add(t.field);
    }
    for (const e of rule.effects ?? []) {
      ruleTargets.add(e.target);
    }
    for (const ce of rule.effects_conditional ?? []) {
      for (const e of ce.effects) {
        ruleTargets.add(e.target);
      }
    }
  }

  // Variables that are targets but never triggers (write-only)
  const writeOnly = variables.filter(v => ruleTargets.has(v) && !ruleTriggers.has(v));
  if (writeOnly.length > 0) {
    suggestions.push({
      id: 'write-only-variables',
      priority: 'medium',
      category: 'structure',
      title: `${writeOnly.length} write-only variable(s)`,
      description: `These variables are modified by rules but never trigger any rule: ${writeOnly.join(', ')}. They may be dead-end state.`,
      action: 'Add rules that trigger on these variables to create feedback loops.',
      affectedFiles: ['rules/', 'state-schema.json'],
    });
  }

  // Variables that are triggers but never targets (read-only / inputs)
  const readOnly = variables.filter(v => ruleTriggers.has(v) && !ruleTargets.has(v));
  if (readOnly.length > 0 && readOnly.length <= 3) {
    suggestions.push({
      id: 'read-only-variables',
      priority: 'low',
      category: 'structure',
      title: `${readOnly.length} input-only variable(s)`,
      description: `These variables trigger rules but are never modified: ${readOnly.join(', ')}. They act as fixed inputs.`,
      action: 'This is fine for configuration inputs. If they should evolve, add rules that target them.',
      affectedFiles: ['state-schema.json'],
    });
  }
}

function analyzeGateCoverage(world: WorldDefinition, suggestions: Suggestion[]): void {
  const gates = world.gates?.viability_classification ?? [];
  if (gates.length === 0) return;

  // Check all five standard viability levels are present
  const statuses = new Set(gates.map(g => g.status));
  const standard: ViabilityStatusName[] = ['THRIVING', 'STABLE', 'COMPRESSED', 'CRITICAL', 'MODEL_COLLAPSES'];
  const missing = standard.filter(s => !statuses.has(s));

  if (missing.length > 0 && missing.length <= 2) {
    suggestions.push({
      id: 'incomplete-viability-gates',
      priority: 'medium',
      category: 'structure',
      title: `Missing viability level(s): ${missing.join(', ')}`,
      description: 'A complete viability ladder gives finer-grained status classification.',
      action: `Add gates for: ${missing.join(', ')}`,
      affectedFiles: ['gates.json'],
    });
  }
}

type ViabilityStatusName = 'THRIVING' | 'STABLE' | 'COMPRESSED' | 'CRITICAL' | 'MODEL_COLLAPSES';

function analyzeAssumptions(world: WorldDefinition, suggestions: Suggestion[]): void {
  const profiles = Object.keys(world.assumptions?.profiles ?? {});

  if (profiles.length === 1) {
    suggestions.push({
      id: 'single-assumption-profile',
      priority: 'medium',
      category: 'completeness',
      title: 'Only one assumption profile',
      description: 'A single profile means no scenario comparison. Add an alternative profile to enable what-if analysis.',
      action: 'Add a second profile with different parameter values to assumptions.json.',
      affectedFiles: ['assumptions.json'],
    });
  }
}

// ─── Phase 3: Simulation Dynamics ────────────────────────────────────────────

function analyzeSimulationDynamics(world: WorldDefinition, suggestions: Suggestion[]): void {
  if (!world.rules || world.rules.length === 0) return;
  if (!world.stateSchema?.variables || Object.keys(world.stateSchema.variables).length === 0) return;

  try {
    // Run default simulation
    const result = simulateWorld(world, { steps: 1 });

    // Check if no rules fired with default state
    const step = result.steps[0];
    if (step && step.rulesFired === 0) {
      suggestions.push({
        id: 'no-rules-fire-default',
        priority: 'high',
        category: 'balance',
        title: 'No rules fire with default state',
        description: 'With all variables at their defaults, zero rules trigger. The world is inert until state changes.',
        action: 'Adjust rule thresholds or state defaults so at least some rules fire in the baseline scenario.',
        affectedFiles: ['rules/', 'state-schema.json'],
      });
    }

    // Check if world collapses immediately
    if (result.collapsed && result.collapseStep === 1) {
      suggestions.push({
        id: 'immediate-collapse',
        priority: 'critical',
        category: 'balance',
        title: 'World collapses on first step',
        description: `Rule "${result.collapseRule}" triggers collapse immediately with default state. The world cannot sustain itself.`,
        action: 'Adjust collapse thresholds or state defaults to prevent immediate collapse.',
        affectedFiles: ['rules/', 'state-schema.json'],
      });
    }

    // Run multi-step to check for sustained degradation
    if (!result.collapsed) {
      const multiStep = simulateWorld(world, { steps: 5 });
      if (multiStep.collapsed) {
        suggestions.push({
          id: 'eventual-collapse',
          priority: 'high',
          category: 'balance',
          title: `World collapses by step ${multiStep.collapseStep}`,
          description: `Starting from defaults, the world collapses after ${multiStep.collapseStep} steps. Consider adding stabilizing advantage rules.`,
          action: 'Add advantage rules or adjust degradation rates to allow sustainable states.',
          affectedFiles: ['rules/'],
        });
      }
    }
  } catch {
    // Simulation failed — don't add suggestions from it
  }
}

// ─── Phase 4: Completeness ───────────────────────────────────────────────────

function analyzeCompleteness(world: WorldDefinition, suggestions: Suggestion[]): void {
  if (!world.guards) {
    suggestions.push({
      id: 'add-guards',
      priority: 'low',
      category: 'completeness',
      title: 'No guards defined',
      description: 'Guards enable runtime enforcement in Action Space. Without them, the world has no runtime protection.',
      action: 'Add guards.json with structural guards backing each invariant.',
      affectedFiles: ['guards.json'],
    });
  }

  if (!world.roles) {
    suggestions.push({
      id: 'add-roles',
      priority: 'low',
      category: 'completeness',
      title: 'No roles defined',
      description: 'Roles enable multi-agent governance with different permission levels.',
      action: 'Add roles.json with at least an observer and steward role.',
      affectedFiles: ['roles.json'],
    });
  }

  if (!world.kernel) {
    suggestions.push({
      id: 'add-kernel',
      priority: 'low',
      category: 'completeness',
      title: 'No kernel configuration',
      description: 'A kernel config provides Thinking Space governance with forbidden patterns and response vocabulary.',
      action: 'Add kernel.json with input/output boundaries.',
      affectedFiles: ['kernel.json'],
    });
  }

  // Check outcomes have at least one primary
  const outcomes = world.outcomes?.computed_outcomes ?? [];
  if (outcomes.length > 0 && !outcomes.some(o => o.primary)) {
    suggestions.push({
      id: 'no-primary-outcome',
      priority: 'medium',
      category: 'structure',
      title: 'No primary outcome defined',
      description: 'Marking one outcome as primary helps tools identify the main metric to display.',
      action: 'Set primary: true on the most important computed outcome.',
      affectedFiles: ['outcomes.json'],
    });
  }
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

function computeHealthScore(world: WorldDefinition, suggestions: Suggestion[]): number {
  let score = 100;

  for (const s of suggestions) {
    switch (s.priority) {
      case 'critical': score -= 15; break;
      case 'high': score -= 5; break;
      case 'medium': score -= 2; break;
      case 'low': score -= 1; break;
    }
  }

  return Math.max(0, Math.min(100, score));
}

// ─── Text Renderer ───────────────────────────────────────────────────────────

export function renderImproveText(report: ImprovementReport): string {
  const lines: string[] = [];

  lines.push(`IMPROVE: ${report.worldName}`);
  lines.push(`Health Score: ${report.score}/100`);
  lines.push('');

  if (report.suggestions.length === 0) {
    lines.push('No suggestions — this world is in great shape.');
    return lines.join('\n');
  }

  // Group by priority
  const groups: [string, SuggestionPriority, string][] = [
    ['CRITICAL (must fix)', 'critical', 'x'],
    ['HIGH PRIORITY', 'high', '!'],
    ['SUGGESTIONS', 'medium', '-'],
    ['NICE TO HAVE', 'low', '.'],
  ];

  for (const [header, priority, icon] of groups) {
    const items = report.suggestions.filter(s => s.priority === priority);
    if (items.length === 0) continue;

    lines.push(header);
    for (const s of items) {
      lines.push(`  ${icon} ${s.title}`);
      lines.push(`    Action: ${s.action}`);
    }
    lines.push('');
  }

  // Summary
  const { stats } = report;
  const parts: string[] = [];
  if (stats.critical > 0) parts.push(`${stats.critical} critical`);
  if (stats.high > 0) parts.push(`${stats.high} high`);
  if (stats.medium > 0) parts.push(`${stats.medium} medium`);
  if (stats.low > 0) parts.push(`${stats.low} low`);
  lines.push(`Total: ${report.suggestions.length} suggestions (${parts.join(', ')})`);

  return lines.join('\n');
}
