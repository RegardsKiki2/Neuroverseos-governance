/**
 * World Loader — Shared world file loading for CLI commands
 *
 * Loads a WorldDefinition from a directory containing individual JSON files.
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
    const filePath = join(dirPath, filename);
    try {
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch (err) {
      // Distinguish between missing files (expected) and corrupt files (unexpected)
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined; // File doesn't exist — fine, use defaults
      }
      // File exists but is corrupt or unreadable — warn, don't silently swallow
      process.stderr.write(
        `[neuroverse] Warning: Failed to read ${filename}: ${err instanceof Error ? err.message : String(err)}\n`
      );
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
      try {
        const content = await readFile(join(rulesDir, file), 'utf-8');
        rules.push(JSON.parse(content));
      } catch (err) {
        process.stderr.write(
          `[neuroverse] Warning: Failed to parse rule ${file}: ${err instanceof Error ? err.message : String(err)}\n`
        );
      }
    }
  } catch (err) {
    // No rules directory — fine if ENOENT, warn otherwise
    if (!(err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT')) {
      process.stderr.write(
        `[neuroverse] Warning: Failed to read rules directory: ${err instanceof Error ? err.message : String(err)}\n`
      );
    }
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
 * Load a world from a directory path.
 */
export async function loadWorld(worldPath: string): Promise<WorldDefinition> {
  const { stat } = await import('fs/promises');

  const info = await stat(worldPath);

  if (info.isDirectory()) {
    return loadWorldFromDirectory(worldPath);
  }

  throw new Error(`Cannot load world from: ${worldPath} — expected a directory`);
}

/**
 * Default bundled world name used when no world is specified.
 */
export const DEFAULT_BUNDLED_WORLD = 'coding-agent';

/**
 * Load a bundled .nv-world.md world by name.
 *
 * Searches for the world file in dist/worlds/ and src/worlds/ relative to
 * the package root. Parses the markdown through the bootstrap pipeline
 * (parseWorldMarkdown → emitWorldDefinition) to produce a WorldDefinition.
 *
 * This allows CLI tools (playground, demo) to work out of the box with
 * a default world when no --world flag is provided.
 */
export async function loadBundledWorld(name: string = DEFAULT_BUNDLED_WORLD): Promise<WorldDefinition> {
  const { readFile } = await import('fs/promises');
  const { join, dirname } = await import('path');
  const { existsSync } = await import('fs');
  const { fileURLToPath } = await import('url');
  const { parseWorldMarkdown } = await import('../engine/bootstrap-parser');
  const { emitWorldDefinition } = await import('../engine/bootstrap-emitter');

  const filename = `${name}.nv-world.md`;

  // Resolve package root from this file's location
  let packageRoot: string;
  try {
    const thisFile = typeof __dirname !== 'undefined'
      ? __dirname
      : dirname(fileURLToPath(import.meta.url));
    // loader/ is one level under src/ or dist/
    packageRoot = join(thisFile, '..', '..');
  } catch {
    packageRoot = process.cwd();
  }

  // Search order: dist/worlds/, src/worlds/
  const candidates = [
    join(packageRoot, 'dist', 'worlds', filename),
    join(packageRoot, 'src', 'worlds', filename),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const markdown = await readFile(candidate, 'utf-8');
      const parsed = parseWorldMarkdown(markdown);
      if (!parsed.world) {
        throw new Error(`Failed to parse bundled world: ${candidate}`);
      }
      const { world } = emitWorldDefinition(parsed.world);
      return world;
    }
  }

  throw new Error(
    `Bundled world "${name}" not found. Searched:\n` +
    candidates.map(c => `  ${c}`).join('\n'),
  );
}
