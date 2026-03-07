/**
 * neuroverse run — Governed Runtime
 *
 * Modes:
 *   --pipe          Pipe mode: JSON lines in → verdicts out (default if stdin is piped)
 *   --interactive   Interactive chat session with a model
 *
 * Usage:
 *   # Pipe mode — works with any language/framework
 *   my_agent | neuroverse run --world ./world/ --plan plan.json
 *
 *   # Interactive mode — governed chat session
 *   neuroverse run --world ./world/ --plan plan.json --provider openai
 *
 *   # Quick start — auto-detect world and plan
 *   neuroverse run
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { resolveWorldPath } from '../loader/world-resolver';
import type { PlanDefinition } from '../contracts/plan-contract';

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function autoDetectWorld(): string | undefined {
  const nvDir = '.neuroverse/worlds';
  if (!existsSync(nvDir)) return undefined;

  const entries = readdirSync(nvDir);
  const worlds = entries.filter(e => {
    const worldJson = join(nvDir, e, 'world.json');
    return existsSync(worldJson);
  });

  if (worlds.length === 1) return join(nvDir, worlds[0]);
  return undefined;
}

function autoDetectPlan(): PlanDefinition | undefined {
  const nvDir = '.neuroverse/plans';
  if (!existsSync(nvDir)) return undefined;

  const entries = readdirSync(nvDir).filter(e => e.endsWith('.json'));
  if (entries.length === 1) {
    try {
      return JSON.parse(readFileSync(join(nvDir, entries[0]), 'utf-8'));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function loadPlan(path: string): PlanDefinition {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

// ─── Usage ──────────────────────────────────────────────────────────────────

const RUN_USAGE = `
neuroverse run — Governed runtime for AI agents.

Modes:
  --pipe            JSON lines in → verdicts out (default if stdin is piped)
  --interactive     Chat session with model + governance

Options:
  --world <path>    Path to world directory
  --plan <path>     Path to plan.json
  --level <level>   Enforcement level (basic|standard|strict)
  --trace           Include evaluation trace in verdicts
  --provider <name> Model provider (openai|anthropic|ollama)
  --model <name>    Model name override
  --api-key <key>   API key (or set via env var)

Usage:
  # Pipe mode — works with any agent
  my_agent | neuroverse run --world ./world/ --plan plan.json

  # Interactive mode — governed chat session
  neuroverse run --interactive --world ./world/ --provider openai

  # Auto-detect world and plan
  neuroverse run
`.trim();

// ─── Main ───────────────────────────────────────────────────────────────────

export async function main(args: string[]): Promise<void> {
  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    process.stdout.write(RUN_USAGE + '\n');
    process.exit(0);
    return;
  }

  // Resolve world (--world flag, env var, active world, or auto-detect)
  const worldPath = resolveWorldPath(parseArg(args, '--world'));
  if (!worldPath) {
    process.stderr.write(
      'Error: No world found.\n' +
      'Use --world <path>, set NEUROVERSE_WORLD, or run `neuroverse world use <name>`\n',
    );
    process.exit(1);
    return;
  }

  // Resolve plan
  const planPath = parseArg(args, '--plan');
  const plan = planPath ? loadPlan(planPath) : autoDetectPlan();

  // Common config
  const level = parseArg(args, '--level') as 'basic' | 'standard' | 'strict' | undefined;
  const trace = hasFlag(args, '--trace');

  // Determine mode
  const isPipeMode = hasFlag(args, '--pipe') || !process.stdin.isTTY;
  const isInteractive = hasFlag(args, '--interactive');

  if (isInteractive) {
    // Interactive mode — requires a model provider
    const providerName = parseArg(args, '--provider');
    if (!providerName) {
      process.stderr.write(
        'Error: Interactive mode requires --provider (openai|anthropic|ollama)\n',
      );
      process.exit(1);
      return;
    }

    const { resolveProvider, ModelAdapter } = await import('../runtime/model-adapter');
    const { runInteractiveMode } = await import('../runtime/session');

    const modelConfig = resolveProvider(providerName, {
      model: parseArg(args, '--model'),
      apiKey: parseArg(args, '--api-key'),
    });

    const model = new ModelAdapter(modelConfig);

    await runInteractiveMode(
      {
        worldPath,
        plan,
        level,
        trace,
        onVerdict: (verdict, event) => {
          if (verdict.status !== 'ALLOW') {
            process.stderr.write(
              `  [${verdict.status}] ${event.intent} — ${verdict.reason ?? verdict.ruleId ?? 'governance rule'}\n`,
            );
          }
        },
        onPlanProgress: (progress) => {
          process.stderr.write(
            `  [plan] ${progress.completed}/${progress.total} (${progress.percentage}%)\n`,
          );
        },
        onPlanComplete: () => {
          process.stderr.write(`  [plan] Complete!\n`);
        },
      },
      model,
    );
  } else if (isPipeMode) {
    // Pipe mode — JSON lines in, verdicts out
    const { runPipeMode } = await import('../runtime/session');

    await runPipeMode({
      worldPath,
      plan,
      level,
      trace,
    });
  } else {
    // No mode specified and TTY — show help
    process.stdout.write(RUN_USAGE + '\n');
    process.exit(0);
  }
}
