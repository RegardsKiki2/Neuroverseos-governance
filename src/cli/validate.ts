/**
 * CLI Harness: neuroverse validate
 *
 * Loads a WorldDefinition from a directory or .nv-world.zip.
 * Runs static analysis.
 * Writes a ValidateReport to stdout (JSON).
 * Exits with status code: 0=PASS, 1=FAIL, 2=WARN, 3=ERROR.
 *
 * Usage:
 *   neuroverse validate --world ./my-world/
 *   neuroverse validate --world ./my-world/ --format summary
 *   neuroverse validate --world ./my-world/ --format findings
 *
 * Flags:
 *   --world <path>     Path to world directory or .nv-world.zip (required)
 *   --format <fmt>     Output format: full (default), summary, findings
 */

import { validateWorld } from '../engine/validate-engine';
import { loadWorld } from '../loader/world-loader';
import { VALIDATE_EXIT_CODES } from '../contracts/validate-contract';
import type { ValidateReport, ValidateExitCode } from '../contracts/validate-contract';

// ─── Argument Parsing ────────────────────────────────────────────────────────

type OutputFormat = 'full' | 'summary' | 'findings';

interface CliArgs {
  worldPath: string;
  format: OutputFormat;
}

function parseArgs(argv: string[]): CliArgs {
  let worldPath = '';
  let format: OutputFormat = 'full';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--world' && i + 1 < argv.length) {
      worldPath = argv[++i];
    } else if (arg === '--format' && i + 1 < argv.length) {
      const val = argv[++i];
      if (val === 'full' || val === 'summary' || val === 'findings') {
        format = val;
      } else {
        throw new Error(`Invalid format: "${val}". Must be full, summary, or findings.`);
      }
    }
  }

  if (!worldPath) {
    throw new Error('--world <path> is required');
  }

  return { worldPath, format };
}

// ─── Output Formatters ───────────────────────────────────────────────────────

function formatOutput(report: ValidateReport, format: OutputFormat): string {
  if (format === 'summary') {
    return JSON.stringify({
      worldName: report.worldName,
      worldVersion: report.worldVersion,
      summary: report.summary,
    }, null, 2);
  }

  if (format === 'findings') {
    return JSON.stringify({
      worldName: report.worldName,
      findings: report.findings,
    }, null, 2);
  }

  // full
  return JSON.stringify(report, null, 2);
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  try {
    const args = parseArgs(argv);

    // Load world
    const world = await loadWorld(args.worldPath);

    // Validate
    const report = validateWorld(world);

    // Output
    process.stdout.write(formatOutput(report, args.format) + '\n');

    // Exit with appropriate code
    let exitCode: ValidateExitCode;
    if (report.summary.errors > 0) {
      exitCode = VALIDATE_EXIT_CODES.FAIL;
    } else if (report.summary.warnings > 0) {
      exitCode = VALIDATE_EXIT_CODES.WARN;
    } else {
      exitCode = VALIDATE_EXIT_CODES.PASS;
    }
    process.exit(exitCode);
  } catch (e) {
    const errorResult = { error: 'Validation failed', detail: String(e) };
    process.stderr.write(JSON.stringify(errorResult, null, 2) + '\n');
    process.exit(VALIDATE_EXIT_CODES.ERROR);
  }
}
