import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import {
  listWorlds,
  getActiveWorldName,
  setActiveWorld,
  resolveWorldPath,
  describeActiveWorld,
} from '../src/loader/world-resolver';

// ─── Test Fixture ─────────────────────────────────────────────────────────────

const TEST_DIR = join(__dirname, '.test-world-resolver');

function makeWorld(name: string) {
  const dir = join(TEST_DIR, '.neuroverse', 'worlds', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'world.json'), JSON.stringify({ id: name, name, version: '1.0.0' }));
}

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  delete process.env.NEUROVERSE_WORLD;
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.NEUROVERSE_WORLD;
});

// ─── listWorlds ──────────────────────────────────────────────────────────────

describe('listWorlds', () => {
  it('returns empty array when no .neuroverse/worlds/ exists', () => {
    expect(listWorlds(TEST_DIR)).toEqual([]);
  });

  it('returns empty array when worlds dir exists but has no valid worlds', () => {
    mkdirSync(join(TEST_DIR, '.neuroverse', 'worlds', 'empty'), { recursive: true });
    expect(listWorlds(TEST_DIR)).toEqual([]);
  });

  it('lists worlds with world.json', () => {
    makeWorld('marketing');
    makeWorld('engineering');
    const result = listWorlds(TEST_DIR);
    expect(result).toHaveLength(2);
    expect(result.map(w => w.name)).toEqual(['engineering', 'marketing']);
    expect(result.every(w => w.active === false)).toBe(true);
  });

  it('marks the active world', () => {
    makeWorld('marketing');
    makeWorld('engineering');
    setActiveWorld('marketing', TEST_DIR);
    const result = listWorlds(TEST_DIR);
    const marketing = result.find(w => w.name === 'marketing');
    const engineering = result.find(w => w.name === 'engineering');
    expect(marketing?.active).toBe(true);
    expect(engineering?.active).toBe(false);
  });
});

// ─── setActiveWorld / getActiveWorldName ─────────────────────────────────────

describe('setActiveWorld / getActiveWorldName', () => {
  it('sets and reads the active world name', () => {
    makeWorld('finance');
    setActiveWorld('finance', TEST_DIR);
    expect(getActiveWorldName(TEST_DIR)).toBe('finance');
  });

  it('throws when world does not exist', () => {
    expect(() => setActiveWorld('nonexistent', TEST_DIR)).toThrow('not found');
  });

  it('returns undefined when no active world is set', () => {
    expect(getActiveWorldName(TEST_DIR)).toBeUndefined();
  });

  it('overwrites previous active world', () => {
    makeWorld('a');
    makeWorld('b');
    setActiveWorld('a', TEST_DIR);
    expect(getActiveWorldName(TEST_DIR)).toBe('a');
    setActiveWorld('b', TEST_DIR);
    expect(getActiveWorldName(TEST_DIR)).toBe('b');
  });
});

// ─── resolveWorldPath ────────────────────────────────────────────────────────

describe('resolveWorldPath', () => {
  it('returns explicit path when provided as a path-like string', () => {
    const result = resolveWorldPath('./my-world/', TEST_DIR);
    expect(result).toBe(join(TEST_DIR, 'my-world'));
  });

  it('resolves a world name to .neuroverse/worlds/<name>/', () => {
    makeWorld('marketing');
    const result = resolveWorldPath('marketing', TEST_DIR);
    expect(result).toBe(join(TEST_DIR, '.neuroverse', 'worlds', 'marketing'));
  });

  it('uses NEUROVERSE_WORLD env var when no explicit path', () => {
    makeWorld('finance');
    process.env.NEUROVERSE_WORLD = 'finance';
    const result = resolveWorldPath(undefined, TEST_DIR);
    expect(result).toBe(join(TEST_DIR, '.neuroverse', 'worlds', 'finance'));
  });

  it('uses active world when no explicit path and no env var', () => {
    makeWorld('deploy');
    setActiveWorld('deploy', TEST_DIR);
    const result = resolveWorldPath(undefined, TEST_DIR);
    expect(result).toBe(join(TEST_DIR, '.neuroverse', 'worlds', 'deploy'));
  });

  it('auto-detects when only one world exists', () => {
    makeWorld('only_one');
    const result = resolveWorldPath(undefined, TEST_DIR);
    expect(result).toContain('only_one');
  });

  it('returns undefined when multiple worlds exist and nothing is set', () => {
    makeWorld('a');
    makeWorld('b');
    const result = resolveWorldPath(undefined, TEST_DIR);
    expect(result).toBeUndefined();
  });

  it('explicit path takes priority over env var', () => {
    makeWorld('marketing');
    makeWorld('finance');
    process.env.NEUROVERSE_WORLD = 'finance';
    const result = resolveWorldPath('marketing', TEST_DIR);
    expect(result).toBe(join(TEST_DIR, '.neuroverse', 'worlds', 'marketing'));
  });

  it('env var takes priority over active world', () => {
    makeWorld('marketing');
    makeWorld('finance');
    setActiveWorld('marketing', TEST_DIR);
    process.env.NEUROVERSE_WORLD = 'finance';
    const result = resolveWorldPath(undefined, TEST_DIR);
    expect(result).toBe(join(TEST_DIR, '.neuroverse', 'worlds', 'finance'));
  });
});

// ─── describeActiveWorld ─────────────────────────────────────────────────────

describe('describeActiveWorld', () => {
  it('returns explicit flag source', () => {
    const result = describeActiveWorld('./my-world/', TEST_DIR);
    expect(result).toEqual({ name: './my-world/', source: '--world flag' });
  });

  it('returns env var source', () => {
    makeWorld('finance');
    process.env.NEUROVERSE_WORLD = 'finance';
    const result = describeActiveWorld(undefined, TEST_DIR);
    expect(result).toEqual({ name: 'finance', source: 'NEUROVERSE_WORLD env var' });
  });

  it('returns active_world file source', () => {
    makeWorld('deploy');
    setActiveWorld('deploy', TEST_DIR);
    const result = describeActiveWorld(undefined, TEST_DIR);
    expect(result).toEqual({ name: 'deploy', source: '.neuroverse/active_world' });
  });

  it('returns auto-detected source for single world', () => {
    makeWorld('only_one');
    const result = describeActiveWorld(undefined, TEST_DIR);
    expect(result).toEqual({ name: 'only_one', source: 'auto-detected (only world)' });
  });

  it('returns undefined when no world can be resolved', () => {
    makeWorld('a');
    makeWorld('b');
    const result = describeActiveWorld(undefined, TEST_DIR);
    expect(result).toBeUndefined();
  });
});
