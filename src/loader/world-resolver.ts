/**
 * World Resolver — Resolve world names to paths
 *
 * Resolution order:
 *   1. Explicit path (absolute or relative) → use directly
 *   2. NEUROVERSE_WORLD env var → resolve as name or path
 *   3. .neuroverse/active_world file → read world name
 *   4. Auto-detect if only one world exists in .neuroverse/worlds/
 *
 * World name resolution:
 *   "marketing" → .neuroverse/worlds/marketing/
 *   "./my-world/" → use as-is
 *   "/absolute/path" → use as-is
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import { join, resolve, isAbsolute } from 'path';

const WORLDS_DIR = '.neuroverse/worlds';
const ACTIVE_WORLD_FILE = '.neuroverse/active_world';

// ─── World Discovery ─────────────────────────────────────────────────────────

export interface WorldInfo {
  name: string;
  path: string;
  active: boolean;
}

/**
 * List all compiled worlds in .neuroverse/worlds/
 */
export function listWorlds(cwd: string = process.cwd()): WorldInfo[] {
  const worldsDir = join(cwd, WORLDS_DIR);
  if (!existsSync(worldsDir)) return [];

  const activeName = getActiveWorldName(cwd);
  const entries = readdirSync(worldsDir);

  return entries
    .filter(name => {
      const worldJson = join(worldsDir, name, 'world.json');
      return existsSync(worldJson);
    })
    .map(name => ({
      name,
      path: join(worldsDir, name),
      active: name === activeName,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get the active world name from .neuroverse/active_world
 */
export function getActiveWorldName(cwd: string = process.cwd()): string | undefined {
  const filePath = join(cwd, ACTIVE_WORLD_FILE);
  try {
    return readFileSync(filePath, 'utf-8').trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Set the active world by writing .neuroverse/active_world
 */
export function setActiveWorld(name: string, cwd: string = process.cwd()): void {
  const worldsDir = join(cwd, WORLDS_DIR);
  const worldPath = join(worldsDir, name, 'world.json');

  if (!existsSync(worldPath)) {
    const available = listWorlds(cwd);
    const names = available.map(w => w.name).join(', ');
    throw new Error(
      `World "${name}" not found in ${WORLDS_DIR}/\n` +
      (names ? `Available: ${names}` : 'No worlds found. Run `neuroverse build` first.'),
    );
  }

  const dir = join(cwd, '.neuroverse');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(cwd, ACTIVE_WORLD_FILE), name + '\n', 'utf-8');
}

// ─── World Resolution ────────────────────────────────────────────────────────

/**
 * Resolve a world reference to an absolute path.
 *
 * @param explicit - Value from --world flag (may be undefined)
 * @param cwd - Working directory for relative resolution
 * @returns Resolved absolute path to the world directory
 */
export function resolveWorldPath(
  explicit?: string,
  cwd: string = process.cwd(),
): string | undefined {
  // 1. Explicit --world flag
  if (explicit) {
    return resolveNameOrPath(explicit, cwd);
  }

  // 2. NEUROVERSE_WORLD env var
  const envWorld = process.env.NEUROVERSE_WORLD;
  if (envWorld) {
    return resolveNameOrPath(envWorld, cwd);
  }

  // 3. .neuroverse/active_world file
  const activeName = getActiveWorldName(cwd);
  if (activeName) {
    return resolveNameOrPath(activeName, cwd);
  }

  // 4. Auto-detect single world
  const worlds = listWorlds(cwd);
  if (worlds.length === 1) {
    return resolve(worlds[0].path);
  }

  return undefined;
}

/**
 * Resolve a string that could be a world name or a file path.
 */
function resolveNameOrPath(ref: string, cwd: string): string {
  // If it looks like a path (has separators, starts with . or /), treat as path
  if (ref.includes('/') || ref.includes('\\') || ref.startsWith('.') || isAbsolute(ref)) {
    return resolve(cwd, ref);
  }

  // Otherwise treat as a world name → .neuroverse/worlds/<name>/
  const namedPath = join(cwd, WORLDS_DIR, ref);
  if (existsSync(join(namedPath, 'world.json'))) {
    return resolve(namedPath);
  }

  // Fall back to treating it as a relative path
  return resolve(cwd, ref);
}
