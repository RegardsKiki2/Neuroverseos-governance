/**
 * CLI Harness: neuroverse simulate
 *
 * Step-by-step state evolution of a compiled world.
 *
 * Usage:
 *   neuroverse simulate inherited_silence
 *   neuroverse simulate ./world/ --steps 5
 *   neuroverse simulate inherited_silence --set thesis_clarity=30
 *   neuroverse simulate inherited_silence --profile alternative
 *
 * Flags:
 *   --steps <n>          Number of simulation steps (default: 1, max: 50)
 *   --set <key=value>    Override a state variable (repeatable)
 *   --profile <name>     Assumption profile to use
 *   --json               Output as JSON instead of text
 *
 * Exit codes:
 *   0 = SUCCESS
 *   1 = NOT_FOUND (world directory doesn't exist)
 *   2 = COLLAPSED (world collapsed during simulation)
 */

import { loadWorld } from '../loader/world-loader';
import { simulateWorld, renderSimulateText } from '../engine/simulate-engine';
import { resolveWorldPath, parseCliValue } from './cli-utils';

// ─── Argument Parsing ────────────────────────────────────────────────────────

interface SimulateArgs {
  worldPath: string;
  steps: number;
  stateOverrides: Record<string, string | number | boolean>;
  profile?: string;
  json: boolean;
}

function parseArgs(argv: string[]): SimulateArgs {
  let worldPath = '';
  let steps = 1;
  let json = false;
  let profile: string | undefined;
  const stateOverrides: Record<string, string | number | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      json = true;
    } else if (arg === '--steps' && i + 1 < argv.length) {
      steps = parseInt(argv[++i], 10);
      if (isNaN(steps) || steps < 1) steps = 1;
      if (steps > 50) steps = 50;
    } else if (arg === '--profile' && i + 1 < argv.length) {
      profile = argv[++i];
    } else if (arg === '--set' && i + 1 < argv.length) {
      const pair = argv[++i];
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) {
        const key = pair.slice(0, eqIdx);
        const rawValue = pair.slice(eqIdx + 1);
        stateOverrides[key] = parseCliValue(rawValue);
      }
    } else if (!arg.startsWith('--') && !worldPath) {
      worldPath = arg;
    }
  }

  if (!worldPath) {
    throw new Error('Usage: neuroverse simulate <world-path-or-id> [--steps N] [--set key=value]');
  }

  return { worldPath, steps, stateOverrides, profile, json };
}

// resolveWorldPath and parseCliValue are now imported from cli-utils.ts

// ─── Main ────────────────────────────────────────────────────────────────────

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  try {
    const args = parseArgs(argv);
    const resolvedPath = await resolveWorldPath(args.worldPath);

    const world = await loadWorld(resolvedPath);
    const result = simulateWorld(world, {
      steps: args.steps,
      stateOverrides: Object.keys(args.stateOverrides).length > 0
        ? args.stateOverrides : undefined,
      profile: args.profile,
    });

    if (args.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      process.stderr.write('\n');
      process.stderr.write(renderSimulateText(result) + '\n');
    }

    // Next steps
    if (!args.json) {
      process.stderr.write('\nNext steps:\n');
      process.stderr.write(`  Improve    neuroverse improve ${args.worldPath}\n`);
      if (args.steps === 1) {
        process.stderr.write(`  Deeper     neuroverse simulate ${args.worldPath} --steps 5\n`);
      }
      process.stderr.write('\n');
    }

    process.exit(result.collapsed ? 2 : 0);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}
