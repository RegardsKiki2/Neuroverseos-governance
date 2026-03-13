/**
 * World Loader — Unified world loading for all runtimes
 *
 * Loads a WorldDefinition from:
 *   - A directory containing individual JSON files (Node/Deno)
 *   - A .nv-world.zip archive (Node/Deno — file path)
 *   - A Buffer/Uint8Array of a .nv-world.zip (any runtime, including browser)
 *
 * Used by: neuroverse guard, neuroverse validate, neuroverse init, adapters
 * Not used by: neuroverse bootstrap (which produces world files, not consumes them)
 */

import type { WorldDefinition } from '../types';
import { readZipEntries } from './zip-reader';

// ─── Shared assembly logic ───────────────────────────────────────────────────

/**
 * Default values for optional world blocks — keeps assembly DRY.
 */
const DEFAULTS = {
  assumptions: { profiles: {}, parameter_definitions: {} },
  stateSchema: { variables: {}, presets: {} },
  gates: {
    viability_classification: [],
    structural_override: { description: '', enforcement: 'mandatory' },
    sustainability_threshold: 0,
    collapse_visual: { background: '', text: '', border: '', label: '' },
  },
  outcomes: {
    computed_outcomes: [],
    comparison_layout: { primary_card: '', status_badge: '', structural_indicators: [] },
  },
  metadata: {
    format_version: '1.0.0',
    created_at: '',
    last_modified: '',
    authoring_method: 'manual-authoring' as const,
  },
} as const;

/**
 * Assemble a WorldDefinition from a bag of parsed JSON blocks.
 * Shared by directory loader, zip loader, and buffer loader.
 */
function assembleWorld(files: {
  world: any;
  invariants?: any;
  assumptions?: any;
  stateSchema?: any;
  rules: any[];
  gates?: any;
  outcomes?: any;
  guards?: any;
  roles?: any;
  kernel?: any;
  metadata?: any;
}): WorldDefinition {
  return {
    world: files.world,
    invariants: files.invariants?.invariants ?? [],
    assumptions: files.assumptions ?? DEFAULTS.assumptions,
    stateSchema: files.stateSchema ?? DEFAULTS.stateSchema,
    rules: files.rules,
    gates: files.gates ?? DEFAULTS.gates,
    outcomes: files.outcomes ?? DEFAULTS.outcomes,
    guards: files.guards,
    roles: files.roles,
    kernel: files.kernel,
    metadata: files.metadata ?? DEFAULTS.metadata,
  };
}

// ─── Directory Loader ────────────────────────────────────────────────────────

/**
 * Load a WorldDefinition from a directory of JSON files.
 *
 * Reads all standard world files and assembles them into a WorldDefinition.
 * Missing optional files are handled gracefully with defaults.
 * Missing required files (world.json) throw.
 */
export async function loadWorldFromDirectory(dirPath: string): Promise<WorldDefinition> {
  const { readFile } = await import('fs/promises');
  const { join } = await import('path');
  const { readdirSync } = await import('fs');

  async function readJson<T>(filename: string): Promise<T | undefined> {
    try {
      const content = await readFile(join(dirPath, filename), 'utf-8');
      return JSON.parse(content) as T;
    } catch {
      return undefined;
    }
  }

  // ─── Core files ──────────────────────────────────────────────────────
  const worldJson = await readJson<any>('world.json');
  if (!worldJson) {
    throw new Error(`Cannot read world.json in ${dirPath}`);
  }

  // ─── Rules from rules/ directory ─────────────────────────────────────
  const rules: any[] = [];
  try {
    const rulesDir = join(dirPath, 'rules');
    const ruleFiles = readdirSync(rulesDir)
      .filter(f => f.endsWith('.json'))
      .sort();
    for (const file of ruleFiles) {
      const content = await readFile(join(rulesDir, file), 'utf-8');
      rules.push(JSON.parse(content));
    }
  } catch {
    // No rules directory — that's fine, validate engine will catch it
  }

  return assembleWorld({
    world: worldJson,
    invariants: await readJson<any>('invariants.json'),
    assumptions: await readJson<any>('assumptions.json'),
    stateSchema: await readJson<any>('state-schema.json'),
    rules,
    gates: await readJson<any>('gates.json'),
    outcomes: await readJson<any>('outcomes.json'),
    guards: await readJson<any>('guards.json'),
    roles: await readJson<any>('roles.json'),
    kernel: await readJson<any>('kernel.json'),
    metadata: await readJson<any>('metadata.json'),
  });
}

// ─── ZIP / Buffer Loader ─────────────────────────────────────────────────────

/**
 * Detect if all zip entries share a common top-level directory prefix.
 * Returns the prefix string (e.g., "my-world/") or "" if entries are at root.
 */
function detectPrefix(entries: Map<string, string>): string {
  // Check if world.json exists directly
  if (entries.has('world.json')) return '';

  // Look for world.json under a single directory prefix
  for (const key of entries.keys()) {
    if (key.endsWith('/world.json')) {
      const slashIdx = key.indexOf('/');
      if (slashIdx === key.lastIndexOf('/')) {
        // e.g., "my-world/world.json" → prefix is "my-world/"
        return key.substring(0, slashIdx + 1);
      }
    }
  }

  return '';
}

/**
 * Load a WorldDefinition from a .nv-world.zip Buffer or Uint8Array.
 *
 * This is the runtime-agnostic entry point — works in Node, Deno, and browsers
 * (pass the ArrayBuffer/Uint8Array from a fetch response or file input).
 *
 * Usage:
 *   const buf = await fetch('/worlds/my.nv-world.zip').then(r => r.arrayBuffer());
 *   const world = loadWorldFromBuffer(Buffer.from(buf));
 */
export function loadWorldFromBuffer(buf: Buffer | Uint8Array): WorldDefinition {
  const zipBuf = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const entries = readZipEntries(zipBuf);

  // Detect whether entries are nested under a single top-level directory.
  // e.g., "my-world/world.json" vs "world.json"
  const prefix = detectPrefix(entries);

  function readJson<T>(filename: string): T | undefined {
    const key = prefix + filename;
    const content = entries.get(key);
    if (content === undefined) return undefined;
    return JSON.parse(content) as T;
  }

  const worldJson = readJson<any>('world.json');
  if (!worldJson) {
    throw new Error('Cannot find world.json in .nv-world.zip');
  }

  // Collect rules — match rules/*.json entries
  const rules: any[] = [];
  const rulesPrefix = prefix + 'rules/';
  for (const [key, value] of entries) {
    if (key.startsWith(rulesPrefix) && key.endsWith('.json')) {
      rules.push(JSON.parse(value));
    }
  }
  // Sort rules by entry name for deterministic ordering
  const ruleEntries: [string, any][] = [];
  for (const [key, value] of entries) {
    if (key.startsWith(rulesPrefix) && key.endsWith('.json')) {
      ruleEntries.push([key, value]);
    }
  }
  rules.length = 0; // reset and rebuild sorted
  ruleEntries.sort((a, b) => a[0].localeCompare(b[0]));
  for (const [, value] of ruleEntries) {
    rules.push(JSON.parse(value));
  }

  return assembleWorld({
    world: worldJson,
    invariants: readJson<any>('invariants.json'),
    assumptions: readJson<any>('assumptions.json'),
    stateSchema: readJson<any>('state-schema.json'),
    rules,
    gates: readJson<any>('gates.json'),
    outcomes: readJson<any>('outcomes.json'),
    guards: readJson<any>('guards.json'),
    roles: readJson<any>('roles.json'),
    kernel: readJson<any>('kernel.json'),
    metadata: readJson<any>('metadata.json'),
  });
}

/**
 * Load a WorldDefinition from a .nv-world.zip file on disk.
 */
export async function loadWorldFromZip(zipPath: string): Promise<WorldDefinition> {
  const { readFile } = await import('fs/promises');
  const buf = await readFile(zipPath);
  return loadWorldFromBuffer(buf);
}

// ─── Unified Entry Point ─────────────────────────────────────────────────────

/**
 * Load a world from a path — auto-detects directory vs .nv-world.zip.
 *
 * This is the recommended entry point for Node/Deno CLI and server usage.
 * For browser usage, use loadWorldFromBuffer() with a fetched ArrayBuffer.
 */
export async function loadWorld(worldPath: string): Promise<WorldDefinition> {
  const { stat } = await import('fs/promises');

  const info = await stat(worldPath);

  if (info.isDirectory()) {
    return loadWorldFromDirectory(worldPath);
  }

  if (worldPath.endsWith('.nv-world.zip')) {
    return loadWorldFromZip(worldPath);
  }

  throw new Error(`Cannot load world from: ${worldPath} — expected a directory or .nv-world.zip`);
}
