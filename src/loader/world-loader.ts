/**
 * World Loader — Shared world file loading for CLI commands
 *
 * Loads a WorldDefinition from either:
 *   - A directory containing individual JSON files
 *   - (Future) A .nv-world.zip archive
 *
 * Used by: neuroverse guard, neuroverse validate, neuroverse init
 * Not used by: neuroverse bootstrap (which produces world files, not consumes them)
 */

import type { WorldDefinition } from '../types';

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

  const invariantsJson = await readJson<any>('invariants.json');
  const assumptionsJson = await readJson<any>('assumptions.json');
  const stateSchemaJson = await readJson<any>('state-schema.json');
  const gatesJson = await readJson<any>('gates.json');
  const outcomesJson = await readJson<any>('outcomes.json');
  const guardsJson = await readJson<any>('guards.json');
  const rolesJson = await readJson<any>('roles.json');
  const kernelJson = await readJson<any>('kernel.json');
  const metadataJson = await readJson<any>('metadata.json');

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

  // ─── Assemble ────────────────────────────────────────────────────────
  return {
    world: worldJson,
    invariants: invariantsJson?.invariants ?? [],
    assumptions: assumptionsJson ?? { profiles: {}, parameter_definitions: {} },
    stateSchema: stateSchemaJson ?? { variables: {}, presets: {} },
    rules,
    gates: gatesJson ?? {
      viability_classification: [],
      structural_override: { description: '', enforcement: 'mandatory' },
      sustainability_threshold: 0,
      collapse_visual: { background: '', text: '', border: '', label: '' },
    },
    outcomes: outcomesJson ?? {
      computed_outcomes: [],
      comparison_layout: { primary_card: '', status_badge: '', structural_indicators: [] },
    },
    guards: guardsJson,
    roles: rolesJson,
    kernel: kernelJson,
    metadata: metadataJson ?? {
      format_version: '1.0.0',
      created_at: '',
      last_modified: '',
      authoring_method: 'manual-authoring' as const,
    },
  };
}

/**
 * Load a world from a path — auto-detects directory vs .nv-world.zip.
 */
export async function loadWorld(worldPath: string): Promise<WorldDefinition> {
  const { stat } = await import('fs/promises');

  const info = await stat(worldPath);

  if (info.isDirectory()) {
    return loadWorldFromDirectory(worldPath);
  }

  if (worldPath.endsWith('.nv-world.zip')) {
    // Future: unzip and load
    throw new Error('.nv-world.zip loading not yet implemented — use a world directory');
  }

  throw new Error(`Cannot load world from: ${worldPath} — expected a directory or .nv-world.zip`);
}
