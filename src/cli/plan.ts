/**
 * neuroverse plan — Plan Enforcement CLI
 *
 * Subcommands:
 *   compile   Parse plan markdown into plan.json
 *   check     Check an action against a plan (stdin → stdout)
 *   status    Show plan progress
 *   advance   Mark a step as completed
 *   derive    Generate a full world from a plan
 *
 * Usage:
 *   neuroverse plan compile <plan.md> [--output plan.json]
 *   echo '{"intent":"..."}' | neuroverse plan check --plan plan.json [--world ./world/]
 *   neuroverse plan status --plan plan.json
 *   neuroverse plan advance <step_id> --plan plan.json
 *   neuroverse plan derive <plan.md> [--output ./world/]
 */

import { readFileSync, writeFileSync } from 'fs';
import { parsePlanMarkdown } from '../engine/plan-parser';
import { evaluatePlan, advancePlan, getPlanProgress } from '../engine/plan-engine';
import { PLAN_EXIT_CODES } from '../contracts/plan-contract';
import type { PlanDefinition } from '../contracts/plan-contract';
import type { GuardEvent } from '../contracts/guard-contract';

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

// ─── Compile ────────────────────────────────────────────────────────────────

async function compileCommand(args: string[]): Promise<void> {
  const inputPath = args.find(a => !a.startsWith('--'));
  if (!inputPath) {
    process.stderr.write('Usage: neuroverse plan compile <plan.md> [--output plan.json]\n');
    process.exit(PLAN_EXIT_CODES.ERROR);
    return;
  }

  const outputPath = parseArg(args, '--output') ?? inputPath.replace(/\.md$/, '.json');

  let markdown: string;
  try {
    markdown = readFileSync(inputPath, 'utf-8');
  } catch (err) {
    process.stderr.write(`Error reading ${inputPath}: ${err}\n`);
    process.exit(PLAN_EXIT_CODES.ERROR);
    return;
  }

  const result = parsePlanMarkdown(markdown);

  if (!result.success || !result.plan) {
    process.stderr.write(`Parse errors:\n`);
    for (const error of result.errors) {
      process.stderr.write(`  - ${error}\n`);
    }
    process.exit(PLAN_EXIT_CODES.ERROR);
    return;
  }

  writeFileSync(outputPath, JSON.stringify(result.plan, null, 2) + '\n');

  const plan = result.plan;
  process.stdout.write(`Plan compiled: ${plan.plan_id}\n`);
  process.stdout.write(`  Objective: ${plan.objective}\n`);
  process.stdout.write(`  Steps: ${plan.steps.length}\n`);
  process.stdout.write(`  Constraints: ${plan.constraints.length}\n`);
  process.stdout.write(`  Sequential: ${plan.sequential}\n`);
  process.stdout.write(`  Completion: ${plan.completion}\n`);
  if (plan.world_id) process.stdout.write(`  World: ${plan.world_id}\n`);
  if (plan.expires_at) process.stdout.write(`  Expires: ${plan.expires_at}\n`);
  process.stdout.write(`  Output: ${outputPath}\n`);
}

// ─── Check ──────────────────────────────────────────────────────────────────

async function checkCommand(args: string[]): Promise<void> {
  const planPath = parseArg(args, '--plan');
  if (!planPath) {
    process.stderr.write('Usage: echo \'{"intent":"..."}\' | neuroverse plan check --plan plan.json\n');
    process.exit(PLAN_EXIT_CODES.ERROR);
    return;
  }

  let plan: PlanDefinition;
  try {
    plan = JSON.parse(readFileSync(planPath, 'utf-8'));
  } catch (err) {
    process.stderr.write(`Error reading plan: ${err}\n`);
    process.exit(PLAN_EXIT_CODES.ERROR);
    return;
  }

  const stdinData = await readStdin();
  let event: GuardEvent;
  try {
    event = JSON.parse(stdinData);
  } catch {
    process.stderr.write('Error: stdin must be valid JSON with an "intent" field.\n');
    process.exit(PLAN_EXIT_CODES.ERROR);
    return;
  }

  if (!event.intent) {
    process.stderr.write('Error: event must have an "intent" field.\n');
    process.exit(PLAN_EXIT_CODES.ERROR);
    return;
  }

  // Optionally load world for combined evaluation
  const worldPath = parseArg(args, '--world');
  if (worldPath) {
    const { loadWorld } = await import('../loader/world-loader');
    const { evaluateGuard } = await import('../engine/guard-engine');
    const world = await loadWorld(worldPath);
    const verdict = evaluateGuard(event, world, { plan });
    process.stdout.write(JSON.stringify(verdict, null, 2) + '\n');

    const exitCode = verdict.status === 'ALLOW' ? 0 : verdict.status === 'BLOCK' ? 1 : 2;
    process.exit(exitCode);
    return;
  }

  // Plan-only evaluation
  const verdict = evaluatePlan(event, plan);
  process.stdout.write(JSON.stringify(verdict, null, 2) + '\n');

  const exitCode = PLAN_EXIT_CODES[verdict.status] ?? PLAN_EXIT_CODES.ERROR;
  process.exit(exitCode);
}

// ─── Status ─────────────────────────────────────────────────────────────────

async function statusCommand(args: string[]): Promise<void> {
  const planPath = parseArg(args, '--plan');
  if (!planPath) {
    process.stderr.write('Usage: neuroverse plan status --plan plan.json\n');
    process.exit(PLAN_EXIT_CODES.ERROR);
    return;
  }

  let plan: PlanDefinition;
  try {
    plan = JSON.parse(readFileSync(planPath, 'utf-8'));
  } catch (err) {
    process.stderr.write(`Error reading plan: ${err}\n`);
    process.exit(PLAN_EXIT_CODES.ERROR);
    return;
  }

  const progress = getPlanProgress(plan);

  process.stdout.write(`Plan: ${plan.plan_id}\n`);
  process.stdout.write(`Objective: ${plan.objective}\n`);
  process.stdout.write(`Completion: ${plan.completion ?? 'trust'}\n`);
  process.stdout.write(`Progress: ${progress.completed}/${progress.total} (${progress.percentage}%)\n`);
  process.stdout.write(`\nSteps:\n`);

  for (const step of plan.steps) {
    const status = step.status === 'completed' ? '[x]'
      : step.status === 'active' ? '[>]'
      : step.status === 'skipped' ? '[-]'
      : '[ ]';
    let line = `  ${status} ${step.label}`;
    if (step.tags?.length) line += ` [tag: ${step.tags.join(', ')}]`;
    if (step.verify) line += ` [verify: ${step.verify}]`;
    if (step.requires?.length) line += ` (after: ${step.requires.join(', ')})`;
    process.stdout.write(line + '\n');
  }

  if (plan.constraints.length > 0) {
    process.stdout.write(`\nConstraints:\n`);
    for (const c of plan.constraints) {
      process.stdout.write(`  - ${c.description} [${c.type}/${c.enforcement}]\n`);
    }
  }
}

// ─── Advance ────────────────────────────────────────────────────────────────

async function advanceCommand(args: string[]): Promise<void> {
  const stepId = args.find(a => !a.startsWith('--'));
  const planPath = parseArg(args, '--plan');

  if (!stepId || !planPath) {
    process.stderr.write('Usage: neuroverse plan advance <step_id> --plan plan.json [--evidence <type> --proof <proof>]\n');
    process.exit(PLAN_EXIT_CODES.ERROR);
    return;
  }

  let plan: PlanDefinition;
  try {
    plan = JSON.parse(readFileSync(planPath, 'utf-8'));
  } catch (err) {
    process.stderr.write(`Error reading plan: ${err}\n`);
    process.exit(PLAN_EXIT_CODES.ERROR);
    return;
  }

  // Build evidence if provided
  const evidenceType = parseArg(args, '--evidence');
  const evidenceProof = parseArg(args, '--proof');
  let evidence: import('../contracts/plan-contract').StepEvidence | undefined;

  if (evidenceType && evidenceProof) {
    evidence = {
      type: evidenceType,
      proof: evidenceProof,
      timestamp: new Date().toISOString(),
    };
  } else if (evidenceType || evidenceProof) {
    process.stderr.write('Error: --evidence and --proof must both be provided.\n');
    process.exit(PLAN_EXIT_CODES.ERROR);
    return;
  }

  const result = advancePlan(plan, stepId, evidence);

  if (!result.success) {
    process.stderr.write(`Error: ${result.reason}\n`);
    process.exit(PLAN_EXIT_CODES.ERROR);
    return;
  }

  writeFileSync(planPath, JSON.stringify(result.plan, null, 2) + '\n');

  const progress = getPlanProgress(result.plan!);
  const step = plan.steps.find(s => s.id === stepId)!;
  process.stdout.write(`Step completed: ${step.label}\n`);
  if (result.evidence) {
    process.stdout.write(`Evidence: ${result.evidence.type} = ${result.evidence.proof}\n`);
  }
  process.stdout.write(`Progress: ${progress.completed}/${progress.total} (${progress.percentage}%)\n`);

  if (progress.completed === progress.total) {
    process.stdout.write(`\nPlan complete!\n`);
  }
}

// ─── Derive ─────────────────────────────────────────────────────────────────

async function deriveCommand(args: string[]): Promise<void> {
  const inputPath = args.find(a => !a.startsWith('--'));
  if (!inputPath) {
    process.stderr.write('Usage: neuroverse plan derive <plan.md> [--output ./world/]\n');
    process.exit(PLAN_EXIT_CODES.ERROR);
    return;
  }

  const outputDir = parseArg(args, '--output') ?? './derived-world/';

  let markdown: string;
  try {
    markdown = readFileSync(inputPath, 'utf-8');
  } catch (err) {
    process.stderr.write(`Error reading ${inputPath}: ${err}\n`);
    process.exit(PLAN_EXIT_CODES.ERROR);
    return;
  }

  const result = parsePlanMarkdown(markdown);
  if (!result.success || !result.plan) {
    process.stderr.write(`Parse errors:\n`);
    for (const error of result.errors) {
      process.stderr.write(`  - ${error}\n`);
    }
    process.exit(PLAN_EXIT_CODES.ERROR);
    return;
  }

  const plan = result.plan;

  // Generate world definition from plan
  const { mkdirSync } = await import('fs');
  mkdirSync(outputDir, { recursive: true });

  // world.json
  const worldJson = {
    world_id: `plan_${plan.plan_id}`,
    name: `Derived: ${plan.objective}`,
    thesis: plan.objective,
    version: '1.0.0',
    runtime_mode: 'COMPLIANCE',
    default_assumption_profile: 'default',
    default_alternative_profile: 'default',
    modules: ['governance'],
    players: { thinking_space: true, experience_space: false, action_space: true },
  };

  // invariants from constraints
  const invariants = plan.constraints.map((c, i) => ({
    id: `inv_${c.id}`,
    label: c.description,
    type: 'structural' as const,
    enforcement: c.enforcement === 'block' ? 'hard' as const : 'soft' as const,
  }));

  // guards from steps (each step becomes a guarded action pattern)
  const guards = {
    intent_vocabulary: {} as Record<string, { pattern: string; description: string }>,
    guards: plan.steps.map(step => {
      const patternKey = `plan_step_${step.id}`;
      return {
        id: `guard_${step.id}`,
        label: `Plan step: ${step.label}`,
        description: `Governs execution of plan step: ${step.label}`,
        category: 'operational' as const,
        enforcement: 'warn' as const,
        intent_patterns: [patternKey],
        appliesTo: step.tools ?? [],
        default_enabled: true,
        immutable: false,
      };
    }),
  };

  // Add intent patterns
  for (const step of plan.steps) {
    const keywords = step.label.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const pattern = keywords.map(k => `(?=.*${k})`).join('') + '.*';
    guards.intent_vocabulary[`plan_step_${step.id}`] = {
      pattern,
      description: step.label,
    };
  }

  writeFileSync(`${outputDir}/world.json`, JSON.stringify(worldJson, null, 2) + '\n');
  writeFileSync(`${outputDir}/invariants.json`, JSON.stringify(invariants, null, 2) + '\n');
  writeFileSync(`${outputDir}/guards.json`, JSON.stringify(guards, null, 2) + '\n');

  process.stdout.write(`World derived from plan: ${plan.plan_id}\n`);
  process.stdout.write(`  Output: ${outputDir}\n`);
  process.stdout.write(`  Files: world.json, invariants.json, guards.json\n`);
  process.stdout.write(`  Guards: ${plan.steps.length} (one per step)\n`);
  process.stdout.write(`  Invariants: ${plan.constraints.length} (one per constraint)\n`);
}

// ─── Router ─────────────────────────────────────────────────────────────────

const PLAN_USAGE = `
neuroverse plan — Plan enforcement for AI agents.

Subcommands:
  compile   Parse plan markdown into plan.json
  check     Check an action against a plan (stdin → stdout)
  status    Show plan progress
  advance   Mark a step as completed
  derive    Generate a full world from a plan

Usage:
  neuroverse plan compile <plan.md> [--output plan.json]
  echo '{"intent":"..."}' | neuroverse plan check --plan plan.json [--world ./world/]
  neuroverse plan status --plan plan.json
  neuroverse plan advance <step_id> --plan plan.json
  neuroverse plan derive <plan.md> [--output ./world/]
`.trim();

export async function main(args: string[]): Promise<void> {
  const subcommand = args[0];
  const subArgs = args.slice(1);

  switch (subcommand) {
    case 'compile':
      return compileCommand(subArgs);
    case 'check':
      return checkCommand(subArgs);
    case 'status':
      return statusCommand(subArgs);
    case 'advance':
      return advanceCommand(subArgs);
    case 'derive':
      return deriveCommand(subArgs);
    case '--help':
    case '-h':
    case 'help':
    case undefined:
      process.stdout.write(PLAN_USAGE + '\n');
      process.exit(0);
      break;
    default:
      process.stderr.write(`Unknown plan subcommand: "${subcommand}"\n\n`);
      process.stdout.write(PLAN_USAGE + '\n');
      process.exit(1);
  }
}
