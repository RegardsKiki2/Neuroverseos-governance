/**
 * CLI Harness: neuroverse improve
 *
 * Actionable suggestions for strengthening a compiled world.
 *
 * Usage:
 *   neuroverse improve inherited_silence
 *   neuroverse improve ./world/ --json
 *
 * Flags:
 *   --json    Output as JSON instead of text
 *
 * Exit codes:
 *   0 = HEALTHY (no critical issues)
 *   1 = NOT_FOUND (world directory doesn't exist)
 *   2 = NEEDS_WORK (critical issues found)
 */

import { loadWorld } from '../loader/world-loader';
import { improveWorld, renderImproveText } from '../engine/improve-engine';

// ─── Argument Parsing ────────────────────────────────────────────────────────

interface ImproveArgs {
  worldPath: string;
  json: boolean;
}

function parseArgs(argv: string[]): ImproveArgs {
  let worldPath = '';
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      json = true;
    } else if (!arg.startsWith('--') && !worldPath) {
      worldPath = arg;
    }
  }

  if (!worldPath) {
    throw new Error('Usage: neuroverse improve <world-path-or-id>');
  }

  return { worldPath, json };
}

// ─── World Path Resolution ──────────────────────────────────────────────────

async function resolveWorldPath(input: string): Promise<string> {
  const { stat } = await import('fs/promises');

  try {
    const info = await stat(input);
    if (info.isDirectory()) return input;
  } catch { /* Not a direct path */ }

  const neuroversePath = `.neuroverse/worlds/${input}`;
  try {
    const info = await stat(neuroversePath);
    if (info.isDirectory()) return neuroversePath;
  } catch { /* Not found there either */ }

  throw new Error(
    `World not found: "${input}"\n` +
    `Tried:\n` +
    `  ${input}\n` +
    `  ${neuroversePath}\n` +
    `\nBuild a world first: neuroverse build <input.md>`,
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  try {
    const args = parseArgs(argv);
    const resolvedPath = await resolveWorldPath(args.worldPath);

    const world = await loadWorld(resolvedPath);
    const report = improveWorld(world);

    if (args.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    } else {
      process.stderr.write('\n');
      process.stderr.write(renderImproveText(report) + '\n');
    }

    // Next steps
    if (!args.json) {
      process.stderr.write('\nNext steps:\n');
      if (report.stats.critical > 0) {
        process.stderr.write(`  Fix critical issues, then re-run: neuroverse improve ${args.worldPath}\n`);
      } else {
        process.stderr.write(`  Simulate   neuroverse simulate ${args.worldPath}\n`);
        process.stderr.write(`  Explain    neuroverse explain ${args.worldPath}\n`);
      }
      process.stderr.write('\n');
    }

    process.exit(report.stats.critical > 0 ? 2 : 0);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}
