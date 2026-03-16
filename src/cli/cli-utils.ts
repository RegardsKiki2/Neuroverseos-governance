/**
 * Shared CLI Utilities
 *
 * Consolidates duplicated logic across CLI commands:
 *   - World path resolution (was in explain.ts, improve.ts, simulate.ts)
 *   - Stdin reading (was in guard.ts, plan.ts)
 *   - JSON output helpers
 *   - Error handling
 */

// ─── World Path Resolution ──────────────────────────────────────────────────

/**
 * Resolve a world path from either a direct directory path or a world ID
 * shorthand (e.g., "inherited_silence" → ".neuroverse/worlds/inherited_silence/").
 *
 * Previously duplicated identically in:
 *   - explain.ts:56-83
 *   - improve.ts:51-72
 *   - simulate.ts:84-105
 */
export async function resolveWorldPath(input: string): Promise<string> {
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

// ─── Stdin Reader ───────────────────────────────────────────────────────────

/**
 * Read all data from stdin as a UTF-8 string.
 *
 * Previously duplicated (with different implementations) in:
 *   - guard.ts:60-66
 *   - plan.ts:33-41
 */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

// ─── Output Helpers ─────────────────────────────────────────────────────────

/**
 * Write a JSON result to stdout (pretty-printed).
 * Previously repeated 60+ times across CLI files.
 */
export function writeJsonResult(result: unknown): void {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

/**
 * Write an error result to stderr and exit.
 */
export function writeErrorAndExit(error: unknown, exitCode = 1): never {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(exitCode);
}

// ─── Value Parsing ──────────────────────────────────────────────────────────

/**
 * Parse a CLI value string into typed boolean, number, or string.
 */
export function parseCliValue(raw: string): string | number | boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const num = Number(raw);
  if (!isNaN(num) && raw.trim() !== '') return num;
  return raw;
}
