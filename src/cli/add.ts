/**
 * CLI Harness: neuroverse add
 *
 * Incremental governance authoring. Add guards, rules, or invariants
 * to a compiled world directory.
 *
 * Usage:
 *   neuroverse add guard --world ./world/ --label "Block dairy orders" --enforcement block --pattern "*dairy*"
 *   neuroverse add rule --world ./world/ --label "Cost overrun" --severity degradation --trigger "cost > 100" --effect "viability *= 0.5"
 *   neuroverse add invariant --world ./world/ --label "Budget must never exceed 1000"
 *   neuroverse add "Block dairy orders" --world ./world/
 *
 * The last form uses intent classification to auto-detect the construct type.
 *
 * Flags (shared):
 *   --world <path>   Path to world directory (required)
 *   --id <id>        Explicit ID (auto-generated if omitted)
 *   --json           Output full JSON result (default: human summary)
 *
 * Guard flags:
 *   --label <text>         Guard label
 *   --enforcement <type>   block | pause | warn | modify | penalize | reward | neutral
 *   --pattern <glob>       Intent pattern (repeatable)
 *   --category <cat>       structural | operational | advisory
 *   --applies-to <tool>    Tool filter (repeatable)
 *
 * Rule flags:
 *   --label <text>          Rule label
 *   --severity <level>      structural | degradation | advantage
 *   --trigger <expr>        Trigger expression: "field op value [source]" (repeatable)
 *   --effect <expr>         Effect expression: "target op value" (repeatable)
 *   --description <text>    Description
 *
 * Invariant flags:
 *   --label <text>          Invariant label
 *   --enforcement <type>    structural | prompt
 */

import { resolveWorldPath, describeActiveWorld } from '../loader/world-resolver';
import {
  addGuard,
  addRule,
  addInvariant,
  classifyIntent,
  parseGuardDescription,
} from '../engine/add-engine';
import type { AddGuardInput, AddRuleInput, AddInvariantInput, AddResult } from '../engine/add-engine';
import type { Trigger, Effect } from '../types';

// ─── Trigger/Effect Parsers ─────────────────────────────────────────────────

/**
 * Parse a trigger expression like "cost > 100 [state]" or "delegation_level == delegated [assumption]"
 */
function parseTriggerExpr(expr: string): Trigger {
  const match = expr.match(/^(\S+)\s*(==|!=|>=|<=|>|<|in)\s*(.+?)(?:\s*\[(state|assumption)\])?\s*$/);
  if (!match) {
    throw new Error(`Invalid trigger expression: "${expr}". Expected: "field op value [state|assumption]"`);
  }

  const [, field, operator, rawValue, source] = match;
  let value: string | number | boolean | string[] = rawValue.trim();

  // Try to parse as number
  const num = Number(value);
  if (!isNaN(num) && value !== '') value = num;
  else if (value === 'true') value = true;
  else if (value === 'false') value = false;
  // Strip quotes
  else if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }

  return {
    field,
    operator: operator as Trigger['operator'],
    value,
    source: (source as 'state' | 'assumption') ?? 'state',
  };
}

/**
 * Parse an effect expression like "viability *= 0.5" or "budget -= 100"
 */
function parseEffectExpr(expr: string): Effect {
  const match = expr.match(/^(\S+)\s*(\*=|\+=|-=|=)\s*(.+)\s*$/);
  if (!match) {
    throw new Error(`Invalid effect expression: "${expr}". Expected: "target op value" (e.g., "viability *= 0.5")`);
  }

  const [, target, op, rawValue] = match;

  const operationMap: Record<string, Effect['operation']> = {
    '*=': 'multiply',
    '+=': 'add',
    '-=': 'subtract',
    '=': 'set',
  };

  let value: number | boolean | string = rawValue.trim();
  const num = Number(value);
  if (!isNaN(num) && value !== '') value = num;
  else if (value === 'true') value = true;
  else if (value === 'false') value = false;

  return {
    target,
    operation: operationMap[op],
    value,
  };
}

// ─── Argument Parsing ───────────────────────────────────────────────────────

interface CliArgs {
  subcommand: 'guard' | 'rule' | 'invariant' | 'auto';
  worldPath: string;
  label: string;
  id?: string;
  json: boolean;
  // Guard-specific
  enforcement?: string;
  patterns: string[];
  category?: string;
  appliesTo: string[];
  // Rule-specific
  severity?: string;
  triggers: string[];
  effects: string[];
  description?: string;
  // Invariant-specific
  invariantEnforcement?: string;
  // Auto mode: raw text
  rawText?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    subcommand: 'auto',
    worldPath: '',
    label: '',
    json: false,
    patterns: [],
    appliesTo: [],
    triggers: [],
    effects: [],
  };

  // First positional arg determines subcommand
  if (argv.length === 0) {
    throw new Error('Usage: neuroverse add <guard|rule|invariant|"description"> --world <path>');
  }

  const first = argv[0];
  if (first === 'guard' || first === 'rule' || first === 'invariant') {
    args.subcommand = first;
    argv = argv.slice(1);
  } else if (!first.startsWith('--')) {
    // It's a raw NL description — auto-classify
    args.subcommand = 'auto';
    args.rawText = first;
    argv = argv.slice(1);
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--world':
        args.worldPath = argv[++i]; break;
      case '--label':
        args.label = argv[++i]; break;
      case '--id':
        args.id = argv[++i]; break;
      case '--json':
        args.json = true; break;
      case '--enforcement':
        args.enforcement = argv[++i]; break;
      case '--pattern':
        args.patterns.push(argv[++i]); break;
      case '--category':
        args.category = argv[++i]; break;
      case '--applies-to':
        args.appliesTo.push(argv[++i]); break;
      case '--severity':
        args.severity = argv[++i]; break;
      case '--trigger':
        args.triggers.push(argv[++i]); break;
      case '--effect':
        args.effects.push(argv[++i]); break;
      case '--description':
        args.description = argv[++i]; break;
      case '--help':
      case '-h':
        printUsage(); process.exit(0); break;
      default:
        // If it doesn't start with --, treat it as part of raw text
        if (!arg.startsWith('--') && args.subcommand === 'auto' && !args.rawText) {
          args.rawText = arg;
        }
    }
  }

  return args;
}

function printUsage(): void {
  process.stdout.write(`
neuroverse add — Incremental governance authoring

Usage:
  neuroverse add "Block dairy orders" --world ./world/
  neuroverse add guard --world ./world/ --label "Block dairy orders" --pattern "*dairy*"
  neuroverse add rule --world ./world/ --label "Cost overrun" --severity degradation --trigger "cost > 100" --effect "viability *= 0.5"
  neuroverse add invariant --world ./world/ --label "Budget must never exceed 1000"

Auto mode:
  Pass a quoted description as the first argument. The engine classifies it
  as a guard, rule, or invariant based on the language used.

  "Block ..."  / "Prevent ..."  / "Deny ..."     → guard
  "If ... then ..."  / "When ... reduce ..."      → rule
  "... must always ..."  / "... must never ..."   → invariant

Flags:
  --world <path>       World directory (required)
  --id <id>            Explicit ID (auto-generated if omitted)
  --json               Full JSON output

Guard:
  --enforcement <type>   block | pause | warn (default: block)
  --pattern <glob>       Intent pattern (repeatable)
  --category <cat>       structural | operational | advisory

Rule:
  --severity <level>     structural | degradation | advantage
  --trigger <expr>       "field op value [state|assumption]" (repeatable)
  --effect <expr>        "target op value" e.g. "viability *= 0.5" (repeatable)
  --description <text>

Invariant:
  --enforcement <type>   structural | prompt (default: structural)
`.trimStart());
}

// ─── Main ───────────────────────────────────────────────────────────────────

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  try {
    const args = parseArgs(argv);

    // Resolve world
    const worldPath = resolveWorldPath(args.worldPath);
    if (!worldPath) {
      throw new Error(
        'No world specified. Use --world <path>, set NEUROVERSE_WORLD, or run `neuroverse world use <name>`',
      );
    }

    const worldInfo = describeActiveWorld(args.worldPath);
    if (worldInfo) {
      process.stderr.write(`Using world: ${worldInfo.name}\n`);
    }

    let result: AddResult;

    if (args.subcommand === 'auto') {
      // Auto-classify from natural language
      const text = args.rawText ?? args.label;
      if (!text) {
        throw new Error('Provide a description: neuroverse add "Block dairy orders" --world ./world/');
      }

      const type = classifyIntent(text);

      switch (type) {
        case 'guard': {
          const input = parseGuardDescription(text);
          if (args.id) input.id = args.id;
          process.stderr.write(`Classified as: guard (${input.enforcement})\n`);
          result = await addGuard(worldPath, input);
          break;
        }
        case 'invariant': {
          process.stderr.write(`Classified as: invariant\n`);
          result = await addInvariant(worldPath, {
            label: text,
            id: args.id,
          });
          break;
        }
        case 'rule':
        case 'ambiguous': {
          // For ambiguous, default to guard (safest — action control)
          if (type === 'ambiguous') {
            process.stderr.write(`Could not auto-classify. Defaulting to guard.\n`);
            process.stderr.write(`Tip: use "neuroverse add guard|rule|invariant" for explicit control.\n`);
          } else {
            process.stderr.write(`Classified as: rule\n`);
            process.stderr.write(`Note: auto-mode creates a minimal rule. Use explicit "neuroverse add rule" with --trigger and --effect for full control.\n`);
          }
          const input = parseGuardDescription(text);
          if (args.id) input.id = args.id;
          result = await addGuard(worldPath, input);
          break;
        }
        default:
          throw new Error(`Unexpected classification: ${type}`);
      }
    } else if (args.subcommand === 'guard') {
      const label = args.label;
      if (!label) throw new Error('--label is required for guard');

      const input: AddGuardInput = {
        label,
        enforcement: (args.enforcement as AddGuardInput['enforcement']) ?? 'block',
        intentPatterns: args.patterns.length > 0 ? args.patterns : [`*${label.toLowerCase().replace(/\s+/g, '*')}*`],
        description: args.description,
        category: args.category as AddGuardInput['category'],
        appliesTo: args.appliesTo.length > 0 ? args.appliesTo : undefined,
        id: args.id,
      };
      result = await addGuard(worldPath, input);
    } else if (args.subcommand === 'rule') {
      const label = args.label;
      if (!label) throw new Error('--label is required for rule');
      if (args.triggers.length === 0) throw new Error('At least one --trigger is required for rule');

      const input: AddRuleInput = {
        label,
        severity: (args.severity as AddRuleInput['severity']) ?? 'degradation',
        description: args.description,
        triggers: args.triggers.map(parseTriggerExpr),
        effects: args.effects.length > 0 ? args.effects.map(parseEffectExpr) : undefined,
        id: args.id,
      };
      result = await addRule(worldPath, input);
    } else if (args.subcommand === 'invariant') {
      const label = args.label;
      if (!label) throw new Error('--label is required for invariant');

      result = await addInvariant(worldPath, {
        label,
        enforcement: (args.enforcement as 'structural' | 'prompt') ?? 'structural',
        id: args.id,
      });
    } else {
      throw new Error(`Unknown subcommand: ${args.subcommand}`);
    }

    // Output
    if (args.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      const icon = result.type === 'guard' ? 'GUARD' : result.type === 'rule' ? 'RULE' : 'INVARIANT';
      process.stdout.write(`\n[${icon}] Added: ${result.id}\n`);
      process.stdout.write(`  File: ${result.file}\n`);
      process.stdout.write(`  Valid: ${result.valid ? 'yes' : 'no'}\n`);

      const errors = result.findings.filter(f => f.severity === 'error');
      const warnings = result.findings.filter(f => f.severity === 'warning');

      if (errors.length > 0) {
        process.stdout.write(`  Errors: ${errors.length}\n`);
        for (const e of errors.slice(0, 3)) {
          process.stdout.write(`    - ${e.message}\n`);
        }
      }
      if (warnings.length > 0) {
        process.stdout.write(`  Warnings: ${warnings.length}\n`);
        for (const w of warnings.slice(0, 3)) {
          process.stdout.write(`    - ${w.message}\n`);
        }
      }

      if (result.valid && errors.length === 0) {
        process.stdout.write(`\nReady. Guard will be enforced on next evaluation.\n`);
      }
    }

    process.exit(result.valid ? 0 : 1);
  } catch (e) {
    process.stderr.write(`Error: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(3);
  }
}
