/**
 * CLI Harness: neuroverse bootstrap
 *
 * Compiles a .nv-world.md file into world JSON files.
 *
 * Usage:
 *   neuroverse bootstrap --input ./my-world.nv-world.md --output ./my-world/
 *   neuroverse bootstrap --input ./my-world.nv-world.md --output ./my-world/ --validate
 *
 * Flags:
 *   --input <path>    Path to .nv-world.md source file (required)
 *   --output <path>   Output directory for world JSON files (required)
 *   --validate        Run validate engine on compiled output
 *   --format <fmt>    Output report format: full (default), summary
 *
 * Exit codes:
 *   0 = SUCCESS  (compiled cleanly)
 *   1 = FAIL     (parse errors, missing required sections)
 *   3 = ERROR    (file not found, invalid input)
 */

import { parseWorldMarkdown } from '../engine/bootstrap-parser';
import { emitWorldDefinition } from '../engine/bootstrap-emitter';
import { BOOTSTRAP_EXIT_CODES } from '../contracts/bootstrap-contract';
import type { BootstrapResult, BootstrapExitCode } from '../contracts/bootstrap-contract';

// ─── Argument Parsing ────────────────────────────────────────────────────────

interface CliArgs {
  inputPath: string;
  outputPath: string;
  validate: boolean;
  format: 'full' | 'summary';
}

function parseArgs(argv: string[]): CliArgs {
  let inputPath = '';
  let outputPath = '';
  let validate = false;
  let format: 'full' | 'summary' = 'full';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input' && i + 1 < argv.length) {
      inputPath = argv[++i];
    } else if (arg === '--output' && i + 1 < argv.length) {
      outputPath = argv[++i];
    } else if (arg === '--validate') {
      validate = true;
    } else if (arg === '--format' && i + 1 < argv.length) {
      const val = argv[++i];
      if (val === 'full' || val === 'summary') format = val;
    }
  }

  if (!inputPath) throw new Error('--input <path> is required');
  if (!outputPath) throw new Error('--output <path> is required');

  return { inputPath, outputPath, validate, format };
}

// ─── File Writer ─────────────────────────────────────────────────────────────

async function writeWorldFiles(outputDir: string, world: ReturnType<typeof emitWorldDefinition>['world']): Promise<void> {
  const { writeFile, mkdir } = await import('fs/promises');
  const { join } = await import('path');

  // Create output directory
  await mkdir(outputDir, { recursive: true });

  // world.json
  await writeFile(join(outputDir, 'world.json'), JSON.stringify(world.world, null, 2));

  // invariants.json
  await writeFile(join(outputDir, 'invariants.json'), JSON.stringify({ invariants: world.invariants }, null, 2));

  // assumptions.json
  await writeFile(join(outputDir, 'assumptions.json'), JSON.stringify(world.assumptions, null, 2));

  // state-schema.json
  await writeFile(join(outputDir, 'state-schema.json'), JSON.stringify(world.stateSchema, null, 2));

  // rules/ directory
  const rulesDir = join(outputDir, 'rules');
  await mkdir(rulesDir, { recursive: true });
  const sortedRules = [...world.rules].sort((a, b) => a.order - b.order);
  for (let i = 0; i < sortedRules.length; i++) {
    const ruleNum = String(i + 1).padStart(3, '0');
    await writeFile(join(rulesDir, `rule-${ruleNum}.json`), JSON.stringify(sortedRules[i], null, 2));
  }

  // gates.json
  await writeFile(join(outputDir, 'gates.json'), JSON.stringify(world.gates, null, 2));

  // outcomes.json
  await writeFile(join(outputDir, 'outcomes.json'), JSON.stringify(world.outcomes, null, 2));

  // metadata.json
  await writeFile(join(outputDir, 'metadata.json'), JSON.stringify(world.metadata, null, 2));
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const startTime = performance.now();

  try {
    const args = parseArgs(argv);

    // Read source file
    const { readFile } = await import('fs/promises');
    let markdown: string;
    try {
      markdown = await readFile(args.inputPath, 'utf-8');
    } catch {
      const errorResult = { error: `Cannot read file: ${args.inputPath}` };
      process.stderr.write(JSON.stringify(errorResult, null, 2) + '\n');
      process.exit(BOOTSTRAP_EXIT_CODES.ERROR);
      return;
    }

    // Parse markdown
    const parseResult = parseWorldMarkdown(markdown);
    const parseErrors = parseResult.issues.filter(i => i.severity === 'error');

    if (parseErrors.length > 0 || !parseResult.world) {
      const result: BootstrapResult = {
        success: false,
        sourcePath: args.inputPath,
        issues: parseResult.issues,
        parsedSections: [],
        durationMs: performance.now() - startTime,
      };
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      process.exit(BOOTSTRAP_EXIT_CODES.FAIL);
      return;
    }

    // Emit WorldDefinition
    const emitResult = emitWorldDefinition(parseResult.world);
    const allIssues = [...parseResult.issues, ...emitResult.issues];

    // Write files
    await writeWorldFiles(args.outputPath, emitResult.world);

    // Optionally validate
    let validateReport;
    if (args.validate) {
      const { validateWorld } = await import('../engine/validate-engine');
      validateReport = validateWorld(emitResult.world);
    }

    // Build result
    const result: BootstrapResult & { validateReport?: unknown } = {
      success: true,
      sourcePath: args.inputPath,
      issues: allIssues,
      parsedSections: Object.keys(parseResult.world).filter(k => {
        const val = parseResult.world![k as keyof typeof parseResult.world];
        if (Array.isArray(val)) return val.length > 0;
        if (typeof val === 'string') return val.length > 0;
        return !!val;
      }),
      durationMs: performance.now() - startTime,
    };

    if (validateReport) {
      result.validateReport = args.format === 'summary'
        ? { summary: validateReport.summary }
        : validateReport;
    }

    process.stdout.write(JSON.stringify(result, null, 2) + '\n');

    const hasErrors = allIssues.some(i => i.severity === 'error');
    process.exit(hasErrors ? BOOTSTRAP_EXIT_CODES.FAIL : BOOTSTRAP_EXIT_CODES.SUCCESS);
  } catch (e) {
    const errorResult = { error: 'Bootstrap failed', detail: String(e) };
    process.stderr.write(JSON.stringify(errorResult, null, 2) + '\n');
    process.exit(BOOTSTRAP_EXIT_CODES.ERROR);
  }
}
