/**
 * Add Engine — Incremental Governance Authoring
 *
 * Appends guards, rules, or invariants to a compiled world directory.
 * Runs validation after every addition. Deterministic, no LLM calls.
 *
 * Three construct types map to user intent:
 *   "Block X"                    → Guard   (action control)
 *   "If X happens → Y changes"  → Rule    (world evolution)
 *   "X must always be true"      → Invariant (hard constraint)
 *
 * Architecture:
 *   addGuard()     → append to guards.json → validate → report
 *   addRule()      → write rules/rule-NNN.json → validate → report
 *   addInvariant() → append to invariants.json → validate → report
 */

import type {
  Guard,
  GuardsConfig,
  Rule,
  Invariant,
  WorldDefinition,
} from '../types';
import type { ValidateReport } from '../contracts/validate-contract';
import { validateWorld } from './validate-engine';

// ─── Result Types ────────────────────────────────────────────────────────────

export interface AddResult {
  /** What was added */
  type: 'guard' | 'rule' | 'invariant';
  /** The ID of the added construct */
  id: string;
  /** The file that was written */
  file: string;
  /** Whether validation passed after addition */
  valid: boolean;
  /** Validation findings (errors/warnings) introduced by this addition */
  findings: ValidateReport['findings'];
  /** The full object that was written */
  construct: Guard | Rule | Invariant;
}

// ─── ID Generation ──────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 60);
}

// ─── Guard Addition ─────────────────────────────────────────────────────────

export interface AddGuardInput {
  /** Human-readable label (e.g., "Block dairy orders") */
  label: string;
  /** What enforcement to apply */
  enforcement: Guard['enforcement'];
  /** Intent patterns to match (e.g., ["order*dairy", "purchase*dairy"]) */
  intentPatterns: string[];
  /** Optional description */
  description?: string;
  /** Optional category override */
  category?: Guard['category'];
  /** Optional tool filter */
  appliesTo?: string[];
  /** Optional reason for block/pause */
  reason?: string;
  /** Optional invariant reference */
  invariantRef?: string;
  /** Optional explicit ID */
  id?: string;
}

export async function addGuard(
  worldDir: string,
  input: AddGuardInput,
): Promise<AddResult> {
  const { readFile, writeFile } = await import('fs/promises');
  const { join } = await import('path');

  const guardsPath = join(worldDir, 'guards.json');

  // Load existing guards or create new config
  let config: GuardsConfig;
  try {
    const raw = await readFile(guardsPath, 'utf-8');
    config = JSON.parse(raw);
  } catch {
    config = { guards: [], intent_vocabulary: {} };
  }

  // Generate ID
  const id = input.id ?? `guard_${slugify(input.label)}`;

  // Check for duplicates
  if (config.guards.some(g => g.id === id)) {
    throw new Error(`Guard with id "${id}" already exists. Use a different label or provide --id.`);
  }

  // Build the guard
  const guard: Guard = {
    id,
    label: input.label,
    description: input.description ?? input.label,
    category: input.category ?? 'operational',
    enforcement: input.enforcement,
    immutable: false,
    intent_patterns: input.intentPatterns,
    ...(input.appliesTo && { appliesTo: input.appliesTo }),
    ...(input.invariantRef && { invariant_ref: input.invariantRef }),
    ...(input.enforcement === 'modify' && input.reason && { modify_to: input.reason }),
  };

  // Append
  config.guards.push(guard);

  // Write
  await writeFile(guardsPath, JSON.stringify(config, null, 2) + '\n');

  // Validate
  const { loadWorldFromDirectory } = await import('../loader/world-loader');
  const world = await loadWorldFromDirectory(worldDir);
  const report = validateWorld(world);

  return {
    type: 'guard',
    id,
    file: guardsPath,
    valid: report.summary.isHealthy,
    findings: report.findings,
    construct: guard,
  };
}

// ─── Rule Addition ──────────────────────────────────────────────────────────

export interface AddRuleInput {
  /** Human-readable label */
  label: string;
  /** Severity level */
  severity: Rule['severity'];
  /** Description of what this rule does */
  description?: string;
  /** Trigger conditions */
  triggers: Rule['triggers'];
  /** Effects when triggered */
  effects?: Rule['effects'];
  /** Optional collapse check */
  collapseCheck?: Rule['collapse_check'];
  /** Causal translation (human-readable explanation) */
  causalTranslation?: Rule['causal_translation'];
  /** Optional explicit ID */
  id?: string;
}

export async function addRule(
  worldDir: string,
  input: AddRuleInput,
): Promise<AddResult> {
  const { readFile, writeFile, mkdir } = await import('fs/promises');
  const { join } = await import('path');
  const { readdirSync } = await import('fs');

  const rulesDir = join(worldDir, 'rules');

  // Ensure rules directory exists
  await mkdir(rulesDir, { recursive: true });

  // Determine next rule number
  let nextNum = 1;
  try {
    const existing = readdirSync(rulesDir)
      .filter(f => f.match(/^rule-\d+\.json$/))
      .sort();
    if (existing.length > 0) {
      const lastFile = existing[existing.length - 1];
      const match = lastFile.match(/rule-(\d+)\.json/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
  } catch {
    // Directory didn't exist, starting at 1
  }

  const ruleNum = String(nextNum).padStart(3, '0');
  const id = input.id ?? `rule_${slugify(input.label)}`;

  // Build the rule
  const rule: Rule = {
    id,
    severity: input.severity,
    label: input.label,
    description: input.description ?? input.label,
    order: nextNum,
    triggers: input.triggers,
    ...(input.effects && { effects: input.effects }),
    ...(input.collapseCheck && { collapse_check: input.collapseCheck }),
    causal_translation: input.causalTranslation ?? {
      trigger_text: `Triggers when: ${input.triggers.map(t => `${t.field} ${t.operator} ${t.value}`).join(' AND ')}`,
      rule_text: input.label,
      shift_text: input.description ?? input.label,
      effect_text: input.effects
        ? input.effects.map(e => `${e.target} ${e.operation} ${e.value}`).join(', ')
        : 'No direct effects',
    },
  };

  // Write rule file
  const rulePath = join(rulesDir, `rule-${ruleNum}.json`);
  await writeFile(rulePath, JSON.stringify(rule, null, 2) + '\n');

  // Validate
  const { loadWorldFromDirectory } = await import('../loader/world-loader');
  const world = await loadWorldFromDirectory(worldDir);
  const report = validateWorld(world);

  return {
    type: 'rule',
    id,
    file: rulePath,
    valid: report.summary.isHealthy,
    findings: report.findings,
    construct: rule,
  };
}

// ─── Invariant Addition ─────────────────────────────────────────────────────

export interface AddInvariantInput {
  /** Human-readable label (e.g., "Budget must never exceed 1000") */
  label: string;
  /** Enforcement type */
  enforcement?: Invariant['enforcement'];
  /** Optional explicit ID */
  id?: string;
}

export async function addInvariant(
  worldDir: string,
  input: AddInvariantInput,
): Promise<AddResult> {
  const { readFile, writeFile } = await import('fs/promises');
  const { join } = await import('path');

  const invariantsPath = join(worldDir, 'invariants.json');

  // Load existing
  let config: { invariants: Invariant[] };
  try {
    const raw = await readFile(invariantsPath, 'utf-8');
    config = JSON.parse(raw);
  } catch {
    config = { invariants: [] };
  }

  const id = input.id ?? slugify(input.label);

  // Check for duplicates
  if (config.invariants.some(inv => inv.id === id)) {
    throw new Error(`Invariant with id "${id}" already exists.`);
  }

  const invariant: Invariant = {
    id,
    label: input.label,
    enforcement: input.enforcement ?? 'structural',
    mutable: false,
  };

  config.invariants.push(invariant);
  await writeFile(invariantsPath, JSON.stringify(config, null, 2) + '\n');

  // Validate
  const { loadWorldFromDirectory } = await import('../loader/world-loader');
  const world = await loadWorldFromDirectory(worldDir);
  const report = validateWorld(world);

  return {
    type: 'invariant',
    id,
    file: invariantsPath,
    valid: report.summary.isHealthy,
    findings: report.findings,
    construct: invariant,
  };
}

// ─── Intent Classifier ──────────────────────────────────────────────────────

/**
 * Classify a natural-language intent into the correct construct type.
 * This is a simple deterministic classifier — no LLM required.
 *
 * Returns 'guard' | 'rule' | 'invariant' | 'ambiguous'
 */
export type ConstructType = 'guard' | 'rule' | 'invariant' | 'ambiguous';

export function classifyIntent(text: string): ConstructType {
  const lower = text.toLowerCase().trim();

  // Guard patterns — action control
  const guardPatterns = [
    /^block\b/,
    /^prevent\b/,
    /^deny\b/,
    /^reject\b/,
    /^disallow\b/,
    /^forbid\b/,
    /^stop\b/,
    /^pause\b/,
    /^warn\s+(when|if|on|before)\b/,
    /^require\s+approval\b/,
    /^flag\b/,
    /^restrict\b/,
  ];

  // Invariant patterns — hard constraints
  const invariantPatterns = [
    /must\s+(always|never)\b/,
    /must\s+not\b/,
    /shall\s+(always|never)\b/,
    /can\s*not\s+(ever|drop|exceed|go)\b/,
    /cannot\s+(ever|drop|exceed|go)\b/,
    /\bmust\s+remain\b/,
    /\balways\s+be\b/,
    /\bnever\s+(exceed|drop|go|fall|be)\b/,
    /\bfloor\b.*\bmust\b/,
    /\bcap\b.*\bmust\b/,
    /\bhard\s+limit\b/,
    /\bguarantee\b/,
  ];

  // Rule patterns — state mutation / simulation
  const rulePatterns = [
    /^if\b.*\bthen\b/,
    /^when\b.*\b(reduce|increase|multiply|set|add|subtract)\b/,
    /\b(reduce|increase|multiply|degrade|boost)\b.*\bby\b/,
    /\b(viability|margin|score|trust|budget)\b.*\b(drop|rise|change|shift)/,
    /\beffect\b/,
    /\btrigger\b.*\bwhen\b/,
    /\bcollapse\b.*\bif\b/,
  ];

  const guardScore = guardPatterns.filter(p => p.test(lower)).length;
  const invariantScore = invariantPatterns.filter(p => p.test(lower)).length;
  const ruleScore = rulePatterns.filter(p => p.test(lower)).length;

  const max = Math.max(guardScore, invariantScore, ruleScore);
  if (max === 0) return 'ambiguous';

  // Require clear winner
  const scores = [guardScore, invariantScore, ruleScore];
  const winners = scores.filter(s => s === max);
  if (winners.length > 1) return 'ambiguous';

  if (guardScore === max) return 'guard';
  if (invariantScore === max) return 'invariant';
  return 'rule';
}

// ─── Quick Guard Builder ────────────────────────────────────────────────────

/**
 * Parse a natural-language guard description into AddGuardInput.
 * Handles common patterns like:
 *   "Block dairy orders"
 *   "Pause if cost > 500"
 *   "Warn on shell access"
 */
export function parseGuardDescription(text: string): AddGuardInput {
  const lower = text.toLowerCase().trim();

  // Detect enforcement
  let enforcement: Guard['enforcement'] = 'block';
  if (/^pause\b|require\s+approval/i.test(lower)) enforcement = 'pause';
  else if (/^warn\b|^flag\b/i.test(lower)) enforcement = 'warn';
  else if (/^block\b|^prevent\b|^deny\b|^reject\b|^forbid\b|^disallow\b|^stop\b/i.test(lower)) enforcement = 'block';

  // Strip the verb prefix to get the intent description
  const stripped = text.replace(/^(block|prevent|deny|reject|forbid|disallow|stop|pause|warn|flag|restrict)\s+(if\s+|when\s+|on\s+|before\s+)?/i, '').trim();

  // Generate intent patterns from key words
  const words = stripped.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const patterns: string[] = [];
  if (words.length > 0) {
    // Create glob pattern from significant words
    patterns.push(`*${words.join('*')}*`);
    // Also add individual word patterns for broader matching
    if (words.length > 1) {
      for (const word of words) {
        patterns.push(`*${word}*`);
      }
    }
  }

  return {
    label: text,
    enforcement,
    intentPatterns: patterns.length > 0 ? patterns : ['*'],
    description: text,
  };
}
