/**
 * CLI Harness: neuroverse derive
 *
 * AI-assisted synthesis of .nv-world.md from arbitrary markdown.
 *
 * Usage:
 *   neuroverse derive --input ./docs/ --output ./derived.nv-world.md
 *   neuroverse derive --input ./notes.md --dry-run
 *   neuroverse derive --input ./docs/ --validate --model gpt-4.1
 *   neuroverse derive --input ./notes.md --bootstrap ./world/
 *
 * Flags:
 *   --input <path>       Path to file or directory of markdown (required)
 *   --output <path>      Output path (default: ./derived.nv-world.md)
 *   --validate           Run parseWorldMarkdown on output (default: true)
 *   --dry-run            Print prompts, do not call AI
 *   --bootstrap <dir>    Auto-compile derived file into world JSON (skips manual bootstrap)
 *   --provider <name>    Override configured provider
 *   --model <name>       Override configured model
 *   --endpoint <url>     Override configured endpoint
 *
 * Exit codes:
 *   0 = SUCCESS          (valid file written)
 *   1 = VALIDATION_FAIL  (output failed parseWorldMarkdown)
 *   2 = INPUT_ERROR      (missing input, empty dir, unreadable)
 *   3 = PROVIDER_ERROR   (no config, API failure, timeout)
 */

import { DERIVE_EXIT_CODES } from '../contracts/derive-contract';
import { deriveWorld, DeriveInputError, DeriveProviderError } from '../engine/derive-engine';

// ─── Argument Parsing ────────────────────────────────────────────────────────

interface CliArgs {
  inputPath: string;
  outputPath: string;
  validate: boolean;
  dryRun: boolean;
  bootstrapDir?: string;
  provider?: string;
  model?: string;
  endpoint?: string;
}

function parseArgs(argv: string[]): CliArgs {
  let inputPath = '';
  let outputPath = './derived.nv-world.md';
  let validate = true;
  let dryRun = false;
  let bootstrapDir: string | undefined;
  let provider: string | undefined;
  let model: string | undefined;
  let endpoint: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input' && i + 1 < argv.length) {
      inputPath = argv[++i];
    } else if (arg === '--output' && i + 1 < argv.length) {
      outputPath = argv[++i];
    } else if (arg === '--validate') {
      validate = true;
    } else if (arg === '--no-validate') {
      validate = false;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--bootstrap' && i + 1 < argv.length) {
      bootstrapDir = argv[++i];
    } else if (arg === '--provider' && i + 1 < argv.length) {
      provider = argv[++i];
    } else if (arg === '--model' && i + 1 < argv.length) {
      model = argv[++i];
    } else if (arg === '--endpoint' && i + 1 < argv.length) {
      endpoint = argv[++i];
    }
  }

  if (!inputPath) throw new DeriveInputError('--input <path> is required');

  return { inputPath, outputPath, validate, dryRun, bootstrapDir, provider, model, endpoint };
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  try {
    const args = parseArgs(argv);

    const { result, exitCode, dryRunOutput } = await deriveWorld({
      inputPath: args.inputPath,
      outputPath: args.outputPath,
      validate: args.validate,
      dryRun: args.dryRun,
      providerOverride: (args.provider || args.model || args.endpoint)
        ? {
            provider: args.provider,
            model: args.model,
            endpoint: args.endpoint,
          }
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

    // Human-readable summary to stderr
    process.stderr.write(`\nDerived world written to: ${result.outputPath}\n`);
    process.stderr.write(`Derivation Gate: ${result.gate}\n`);

    if (result.normalization) {
      const n = result.normalization;
      const details: string[] = [];
      if (n.invariantIds > 0) details.push(`${n.invariantIds} invariant ID(s) wrapped`);
      if (n.gateThresholds > 0) details.push(`${n.gateThresholds} gate threshold(s) converted`);
      if (n.triggerTags > 0) details.push(`${n.triggerTags} trigger(s) tagged with [state]`);
      process.stderr.write(`\nNormalization: ${n.fixCount} fix(es) applied\n`);
      for (const d of details) process.stderr.write(`  - ${d}\n`);
    }

    if (result.findings.length > 0) {
      process.stderr.write(`\n`);

      const errs = result.findings.filter(f => f.severity === 'error');
      const warns = result.findings.filter(f => f.severity === 'warning');

      if (errs.length > 0) {
        process.stderr.write(`Errors (${errs.length}):\n`);
        for (const f of errs) {
          process.stderr.write(`  ERROR [${f.section}]: ${f.message}\n`);
        }
      }

      if (warns.length > 0) {
        process.stderr.write(`Warnings (${warns.length}):\n`);
        for (const f of warns) {
          process.stderr.write(`  WARN  [${f.section}]: ${f.message}\n`);
        }
      }

      process.stderr.write(`\n`);
    }

    if (result.gate === 'SUSPECT' || result.gate === 'DERIVATION_REJECTED') {
      process.stderr.write(`The file has been written. Open ${result.outputPath} to review and fix.\n`);
    }

    // Auto-bootstrap if requested and derivation succeeded
    if (args.bootstrapDir && exitCode === 0) {
      process.stderr.write(`\nBootstrapping to ${args.bootstrapDir}...\n`);
      const { main: bootstrapMain } = await import('./bootstrap');
      await bootstrapMain([
        '--input', result.outputPath,
        '--output', args.bootstrapDir,
        ...(args.validate ? ['--validate'] : []),
      ]);
      return; // bootstrap handles its own exit
    }

    // Machine-readable JSON to stdout
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(exitCode);
  } catch (e) {
    if (e instanceof DeriveInputError) {
      process.stderr.write(JSON.stringify({ error: e.message }, null, 2) + '\n');
      process.exit(DERIVE_EXIT_CODES.INPUT_ERROR);
    } else if (e instanceof DeriveProviderError) {
      process.stderr.write(JSON.stringify({ error: e.message }, null, 2) + '\n');
      process.exit(DERIVE_EXIT_CODES.PROVIDER_ERROR);
    } else {
      process.stderr.write(JSON.stringify({
        error: 'Derive failed',
        detail: e instanceof Error ? e.message : String(e),
      }, null, 2) + '\n');
      process.exit(DERIVE_EXIT_CODES.PROVIDER_ERROR);
    }
  }
}
