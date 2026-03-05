/**
 * CLI Harness: neuroverse build
 *
 * The canonical entry point for turning ideas into worlds.
 * One command: markdown in, compiled world out.
 *
 * Usage:
 *   neuroverse build my-story.md
 *   neuroverse build ./docs/
 *   neuroverse build my-story.md --output ./my-world/
 *   neuroverse build my-story.md --dry-run
 *
 * Flags:
 *   --output <dir>       Output directory (default: .neuroverse/worlds/<world_id>/)
 *   --dry-run            Print prompts, do not call AI
 *   --no-validate        Skip validation pass
 *   --provider <name>    Override configured provider
 *   --model <name>       Override configured model
 *   --endpoint <url>     Override configured endpoint
 *
 * Exit codes:
 *   0 = SUCCESS
 *   1 = VALIDATION_FAIL
 *   2 = INPUT_ERROR
 *   3 = PROVIDER_ERROR
 */

import { DERIVE_EXIT_CODES } from '../contracts/derive-contract';
import { deriveWorld, DeriveInputError, DeriveProviderError } from '../engine/derive-engine';
import { parseWorldMarkdown } from '../engine/bootstrap-parser';
import { emitWorldDefinition } from '../engine/bootstrap-emitter';
import type { DeriveFinding } from '../contracts/derive-contract';
import type { ParsedRule } from '../contracts/bootstrap-contract';

// ─── Human-Readable Finding Labels ──────────────────────────────────────────

const FINDING_LABELS: Record<string, string> = {
  'guard-coverage': 'STORY INSIGHT',
  'semantic-tension': 'DRAMATIC TENSION',
  'orphan': 'MISSING CAUSALITY',
  'contradiction': 'CONFLICT DETECTED',
  'referential-integrity': 'BROKEN REFERENCE',
  'completeness': 'INCOMPLETE STRUCTURE',
  'schema-violation': 'VALUE OUT OF RANGE',
};

export function humanLabel(section: string): string {
  // Section format from derive: "Validate:<category>" or raw section name
  const category = section.replace(/^Validate:/, '');
  return FINDING_LABELS[category] ?? section.toUpperCase();
}

// ─── Causal Chain Tracer ─────────────────────────────────────────────────────

/**
 * Trace causal chains through rules: find sequences where one rule's
 * effect target becomes another rule's trigger field.
 *
 * Returns chains like: rage -> violence -> danger
 */
export function traceCausalChains(rules: ParsedRule[]): string[][] {
  // Build adjacency: effect target -> rules triggered by that field
  const effectToTrigger = new Map<string, Set<string>>();

  for (const rule of rules) {
    for (const trigger of rule.triggers) {
      if (!effectToTrigger.has(trigger.field)) effectToTrigger.set(trigger.field, new Set());
      effectToTrigger.get(trigger.field)!.add(rule.id);
    }
  }

  // For each rule, trace forward through effect chains
  const chains: string[][] = [];
  const ruleById = new Map(rules.map(r => [r.id, r]));

  for (const startRule of rules) {
    const chain = [startRule.effects[0]?.target].filter(Boolean);
    if (chain.length === 0) continue;

    const visited = new Set<string>([startRule.id]);
    let current = startRule;

    // Follow the chain: current rule's effect target -> next rule's trigger
    for (let depth = 0; depth < 5; depth++) {
      const lastTarget = current.effects[0]?.target;
      if (!lastTarget) break;

      // Find a rule triggered by this target
      const triggeredRuleIds = effectToTrigger.get(lastTarget);
      if (!triggeredRuleIds) break;

      let nextRule: ParsedRule | undefined;
      for (const id of triggeredRuleIds) {
        if (!visited.has(id)) {
          nextRule = ruleById.get(id);
          break;
        }
      }
      if (!nextRule) break;

      visited.add(nextRule.id);
      const nextTarget = nextRule.effects[0]?.target;
      if (nextTarget && !chain.includes(nextTarget)) {
        chain.push(nextTarget);
      }
      current = nextRule;
    }

    if (chain.length >= 2) {
      chains.push(chain);
    }
  }

  // Deduplicate: remove chains that are subsets of longer chains
  const sorted = chains.sort((a, b) => b.length - a.length);
  const unique: string[][] = [];
  for (const chain of sorted) {
    const key = chain.join(' -> ');
    const isSubset = unique.some(existing => existing.join(' -> ').includes(key));
    if (!isSubset) unique.push(chain);
  }

  return unique.slice(0, 3); // Show top 3 chains
}

// ─── Argument Parsing ────────────────────────────────────────────────────────

interface BuildArgs {
  inputPath: string;
  outputDir?: string;
  validate: boolean;
  dryRun: boolean;
  provider?: string;
  model?: string;
  endpoint?: string;
}

function parseArgs(argv: string[]): BuildArgs {
  let inputPath = '';
  let outputDir: string | undefined;
  let validate = true;
  let dryRun = false;
  let provider: string | undefined;
  let model: string | undefined;
  let endpoint: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--output' && i + 1 < argv.length) {
      outputDir = argv[++i];
    } else if (arg === '--no-validate') {
      validate = false;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--provider' && i + 1 < argv.length) {
      provider = argv[++i];
    } else if (arg === '--model' && i + 1 < argv.length) {
      model = argv[++i];
    } else if (arg === '--endpoint' && i + 1 < argv.length) {
      endpoint = argv[++i];
    } else if (!arg.startsWith('--') && !inputPath) {
      inputPath = arg;
    }
  }

  if (!inputPath) throw new DeriveInputError('Usage: neuroverse build <input.md> [--output <dir>]');

  return { inputPath, outputDir, validate, dryRun, provider, model, endpoint };
}

// ─── File Writer (reused from bootstrap) ────────────────────────────────────

async function writeWorldFiles(
  outputDir: string,
  world: ReturnType<typeof emitWorldDefinition>['world'],
): Promise<void> {
  const { writeFile, mkdir } = await import('fs/promises');
  const { join } = await import('path');

  await mkdir(outputDir, { recursive: true });

  await writeFile(join(outputDir, 'world.json'), JSON.stringify(world.world, null, 2));
  await writeFile(join(outputDir, 'invariants.json'), JSON.stringify({ invariants: world.invariants }, null, 2));
  await writeFile(join(outputDir, 'assumptions.json'), JSON.stringify(world.assumptions, null, 2));
  await writeFile(join(outputDir, 'state-schema.json'), JSON.stringify(world.stateSchema, null, 2));
  await writeFile(join(outputDir, 'gates.json'), JSON.stringify(world.gates, null, 2));
  await writeFile(join(outputDir, 'outcomes.json'), JSON.stringify(world.outcomes, null, 2));
  await writeFile(join(outputDir, 'metadata.json'), JSON.stringify(world.metadata, null, 2));

  const rulesDir = join(outputDir, 'rules');
  await mkdir(rulesDir, { recursive: true });
  const sortedRules = [...world.rules].sort((a, b) => a.order - b.order);
  for (let i = 0; i < sortedRules.length; i++) {
    const ruleNum = String(i + 1).padStart(3, '0');
    await writeFile(join(rulesDir, `rule-${ruleNum}.json`), JSON.stringify(sortedRules[i], null, 2));
  }
}

// ─── Output Formatting ──────────────────────────────────────────────────────

function write(msg: string): void {
  process.stderr.write(msg);
}

function printInsight(finding: DeriveFinding): void {
  const label = humanLabel(finding.section);
  const icon = finding.severity === 'error' ? 'x' : '!';
  write(`  ${icon} ${label}: ${finding.message}\n`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  try {
    const args = parseArgs(argv);
    const { basename } = await import('path');

    write(`\nNeuroVerse World Builder\n`);
    write(`\nAnalyzing: ${basename(args.inputPath)}\n`);

    // ── Step 1: Derive ──────────────────────────────────────────────────

    // Use a temp path for the .nv-world.md — final output is compiled JSON
    const derivedPath = args.outputDir
      ? `${args.outputDir}/source.nv-world.md`
      : '.neuroverse/build-output.nv-world.md';

    // Ensure parent dir exists
    const { mkdir } = await import('fs/promises');
    const { dirname } = await import('path');
    await mkdir(dirname(derivedPath), { recursive: true });

    const { result, exitCode, dryRunOutput } = await deriveWorld({
      inputPath: args.inputPath,
      outputPath: derivedPath,
      validate: args.validate,
      dryRun: args.dryRun,
      providerOverride: (args.provider || args.model || args.endpoint)
        ? { provider: args.provider, model: args.model, endpoint: args.endpoint }
        : undefined,
    });

    if (dryRunOutput) {
      process.stdout.write(JSON.stringify({
        dryRun: true,
        systemPrompt: dryRunOutput.systemPrompt,
        userPrompt: dryRunOutput.userPrompt,
        durationMs: result.durationMs,
      }, null, 2) + '\n');
      process.exit(DERIVE_EXIT_CODES.SUCCESS);
      return;
    }

    // ── Step 2: Extract world name from derived result ──────────────────

    const { readFile } = await import('fs/promises');
    const derivedContent = await readFile(derivedPath, 'utf-8');
    const parseResult = parseWorldMarkdown(derivedContent);

    const worldName = parseResult.world?.frontmatter?.name ?? 'Derived World';
    const worldId = parseResult.world?.frontmatter?.world_id ?? 'derived_world';
    const thesis = parseResult.world?.thesis ?? '';

    write(`\nWorld: ${worldName}\n`);
    if (thesis) {
      // Show first sentence of thesis
      const firstLine = thesis.split(/[.\n]/)[0].trim();
      if (firstLine) write(`Theme: ${firstLine}\n`);
    }

    // ── Step 3: Print causal preview ────────────────────────────────────

    const parsedRules = parseResult.world?.rules ?? [];
    if (parsedRules.length > 0) {
      const chains = traceCausalChains(parsedRules);
      if (chains.length > 0) {
        write(`\nCore dynamics:\n`);
        for (const chain of chains) {
          write(`  ${chain.join(' -> ')}\n`);
        }
      }
    }

    // ── Step 4: Print structure summary ─────────────────────────────────

    write(`\nStructure:\n`);
    const sectionLabels: Record<string, string> = {
      frontmatter: 'Metadata',
      thesis: 'Thesis',
      invariants: 'Invariants',
      state: 'State variables',
      assumptions: 'Assumptions',
      rules: 'Rules',
      gates: 'Gates',
      outcomes: 'Outcomes',
    };

    for (const [key, label] of Object.entries(sectionLabels)) {
      if (result.sectionsDetected.includes(key)) {
        const val = parseResult.world?.[key as keyof typeof parseResult.world];
        const count = Array.isArray(val) ? ` (${val.length})` : '';
        write(`  + ${label}${count}\n`);
      }
    }

    // ── Step 4: Print normalization report ───────────────────────────────

    if (result.normalization) {
      const n = result.normalization;
      write(`\nAuto-corrections: ${n.fixCount}\n`);
      if (n.invariantIds > 0) write(`  - ${n.invariantIds} invariant ID(s) formatted\n`);
      if (n.gateThresholds > 0) write(`  - ${n.gateThresholds} gate threshold(s) converted\n`);
      if (n.triggerTags > 0) write(`  - ${n.triggerTags} trigger(s) tagged\n`);
    }

    // ── Step 5: Print insights (human-readable findings) ────────────────

    const errors = result.findings.filter(f => f.severity === 'error');
    const warnings = result.findings.filter(f => f.severity === 'warning');

    if (warnings.length > 0) {
      write(`\nInsights:\n`);
      for (const w of warnings) printInsight(w);
    }

    if (errors.length > 0) {
      write(`\nIssues:\n`);
      for (const e of errors) printInsight(e);
    }

    // ── Step 6: Bootstrap (compile to JSON) ─────────────────────────────

    if (exitCode !== 0 || !parseResult.world) {
      write(`\nWorld source written to: ${derivedPath}\n`);
      write(`Fix the issues above, then run: neuroverse build ${derivedPath}\n\n`);
      process.exit(exitCode);
      return;
    }

    // Determine output directory
    const outputDir = args.outputDir ?? `.neuroverse/worlds/${worldId}`;

    try {
      const emitResult = emitWorldDefinition(parseResult.world);
      await writeWorldFiles(outputDir, emitResult.world);

      // Also save source .nv-world.md alongside compiled output
      const { join } = await import('path');
      const { copyFile } = await import('fs/promises');
      const sourceDest = join(outputDir, 'source.nv-world.md');
      if (derivedPath !== sourceDest) {
        await copyFile(derivedPath, sourceDest);
      }

      write(`\nWorld ready: ${worldId}\n`);
      write(`  ${outputDir}/\n`);
    } catch (bootstrapError) {
      write(`\nWorld source written to: ${derivedPath}\n`);
      write(`Bootstrap failed: ${bootstrapError instanceof Error ? bootstrapError.message : String(bootstrapError)}\n`);
      write(`Run: neuroverse bootstrap --input ${derivedPath} --output <dir>\n\n`);
      process.exit(1);
      return;
    }

    // ── Step 7: Next steps ──────────────────────────────────────────────

    write(`\nNext steps:\n`);
    write(`  Explore    neuroverse explain ${worldId}\n`);
    write(`  Simulate   neuroverse simulate ${worldId}\n`);
    write(`  Improve    neuroverse improve ${worldId}\n`);
    write(`\n`);

    process.exit(0);
  } catch (e) {
    if (e instanceof DeriveInputError) {
      process.stderr.write(`Input error: ${e.message}\n`);
      process.exit(DERIVE_EXIT_CODES.INPUT_ERROR);
    } else if (e instanceof DeriveProviderError) {
      process.stderr.write(`Provider error: ${e.message}\n`);
      process.exit(DERIVE_EXIT_CODES.PROVIDER_ERROR);
    } else {
      process.stderr.write(`Build failed: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(DERIVE_EXIT_CODES.PROVIDER_ERROR);
    }
  }
}
