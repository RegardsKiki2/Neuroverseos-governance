/**
 * CLI Harness: neuroverse explain
 *
 * Human-readable narrative summary of a compiled world.
 *
 * Usage:
 *   neuroverse explain ./world/
 *   neuroverse explain .neuroverse/worlds/inherited_silence/
 *   neuroverse explain inherited_silence
 *
 * Flags:
 *   --json    Output as JSON instead of text
 *
 * Exit codes:
 *   0 = SUCCESS
 *   1 = NOT_FOUND (world directory doesn't exist)
 */

import { loadWorld } from '../loader/world-loader';
import { explainWorld, renderExplainText } from '../engine/explain-engine';

// ─── Argument Parsing ────────────────────────────────────────────────────────

interface ExplainArgs {
  worldPath: string;
  json: boolean;
}

function parseArgs(argv: string[]): ExplainArgs {
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
    throw new Error('Usage: neuroverse explain <world-path-or-id>');
  }

  return { worldPath, json };
}

// ─── World Path Resolution ──────────────────────────────────────────────────

/**
 * Resolve a world path from either:
 *   - A direct directory path (./world/, .neuroverse/worlds/foo/)
 *   - A world ID shorthand (inherited_silence → .neuroverse/worlds/inherited_silence/)
 */
async function resolveWorldPath(input: string): Promise<string> {
  const { stat } = await import('fs/promises');

  // Try as-is first
  try {
    const info = await stat(input);
    if (info.isDirectory()) return input;
  } catch {
    // Not a direct path
  }

  // Try as world ID in .neuroverse/worlds/
  const neuroversePath = `.neuroverse/worlds/${input}`;
  try {
    const info = await stat(neuroversePath);
    if (info.isDirectory()) return neuroversePath;
  } catch {
    // Not found there either
  }

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
    const explanation = explainWorld(world);

    if (args.json) {
      process.stdout.write(JSON.stringify(explanation, null, 2) + '\n');
    } else {
      process.stderr.write('\n');
      process.stderr.write(renderExplainText(explanation));
    }

    process.exit(0);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}
