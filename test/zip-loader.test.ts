/**
 * ZIP World Loader Tests
 *
 * Tests that .nv-world.zip loading produces identical WorldDefinitions
 * to directory loading. Creates zip archives from reference worlds on the fly.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadWorldFromDirectory, loadWorldFromZip, loadWorldFromBuffer } from '../src/loader/world-loader';
import { readZipEntries } from '../src/loader/zip-reader';
import { validateWorld } from '../src/engine/validate-engine';
import { evaluateGuard } from '../src/engine/guard-engine';
import type { GuardEvent } from '../src/contracts/guard-contract';

const WORLDS_DIR = join(__dirname, '../docs/worlds');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createWorldZip(worldDir: string): string {
  const tmp = mkdtempSync(join(tmpdir(), 'nv-zip-test-'));
  const zipPath = join(tmp, 'test.nv-world.zip');
  // Create zip from world directory contents
  execSync(`cd "${worldDir}" && zip -r "${zipPath}" . -x "enforcement.js"`, { stdio: 'pipe' });
  return zipPath;
}

// ─── Test Suite: ZIP Reader ──────────────────────────────────────────────────

describe('ZIP Reader', () => {
  let zipPath: string;

  beforeAll(() => {
    zipPath = createWorldZip(join(WORLDS_DIR, 'configurator-governance'));
  });

  it('reads all entries from a zip file', () => {
    const buf = readFileSync(zipPath);
    const entries = readZipEntries(buf);

    expect(entries.size).toBeGreaterThan(0);
    expect(entries.has('world.json')).toBe(true);
  });

  it('parses JSON content correctly', () => {
    const buf = readFileSync(zipPath);
    const entries = readZipEntries(buf);
    const worldJson = JSON.parse(entries.get('world.json')!);

    expect(worldJson.world_id).toBe('configurator_governance_v1');
  });

  it('throws on invalid zip data', () => {
    const badBuf = Buffer.from('not a zip file');
    expect(() => readZipEntries(badBuf)).toThrow('Invalid ZIP file');
  });
});

// ─── Test Suite: ZIP World Loading ───────────────────────────────────────────

describe('ZIP World Loading', () => {
  describe('configurator-governance', () => {
    let zipPath: string;
    let tmpDir: string;

    beforeAll(() => {
      zipPath = createWorldZip(join(WORLDS_DIR, 'configurator-governance'));
      tmpDir = join(zipPath, '..');
    });

    it('loadWorldFromZip produces same world as loadWorldFromDirectory', async () => {
      const fromDir = await loadWorldFromDirectory(join(WORLDS_DIR, 'configurator-governance'));
      const fromZip = await loadWorldFromZip(zipPath);

      expect(fromZip.world.world_id).toBe(fromDir.world.world_id);
      expect(fromZip.world.name).toBe(fromDir.world.name);
      expect(fromZip.invariants.length).toBe(fromDir.invariants.length);
      expect(fromZip.rules.length).toBe(fromDir.rules.length);
      expect(fromZip.guards).toEqual(fromDir.guards);
      expect(fromZip.roles).toEqual(fromDir.roles);
      expect(fromZip.kernel).toEqual(fromDir.kernel);
    });

    it('loadWorldFromBuffer produces same world as loadWorldFromZip', async () => {
      const buf = readFileSync(zipPath);
      const fromZip = await loadWorldFromZip(zipPath);
      const fromBuffer = loadWorldFromBuffer(buf);

      expect(fromBuffer.world).toEqual(fromZip.world);
      expect(fromBuffer.invariants).toEqual(fromZip.invariants);
      expect(fromBuffer.guards).toEqual(fromZip.guards);
    });

    it('loadWorldFromBuffer works with Uint8Array', async () => {
      const buf = readFileSync(zipPath);
      const uint8 = new Uint8Array(buf);
      const world = loadWorldFromBuffer(uint8);

      expect(world.world.world_id).toBe('configurator_governance_v1');
    });

    it('loadWorld auto-detects .nv-world.zip', async () => {
      const { loadWorld } = await import('../src/loader/world-loader');
      const world = await loadWorld(zipPath);

      expect(world.world.world_id).toBe('configurator_governance_v1');
    });

    it('zip-loaded world passes validation', async () => {
      const world = await loadWorldFromZip(zipPath);
      const report = validateWorld(world);

      expect(report.summary.canRun).toBe(true);
    });

    it('zip-loaded world works with evaluateGuard', async () => {
      const world = await loadWorldFromZip(zipPath);
      const event: GuardEvent = {
        intent: 'Read configuration',
        tool: 'config-reader',
      };
      const verdict = evaluateGuard(event, world);

      expect(['ALLOW', 'BLOCK', 'PAUSE']).toContain(verdict.status);
      expect(verdict).toHaveProperty('status');
    });
  });

  describe('post-web-world', () => {
    let zipPath: string;

    beforeAll(() => {
      zipPath = createWorldZip(join(WORLDS_DIR, 'post-web-world'));
    });

    it('loads post-web world from zip', async () => {
      const world = await loadWorldFromZip(zipPath);

      expect(world.world.world_id).toBe('post_web_model_v1');
      expect(world.invariants.length).toBeGreaterThan(0);
      expect(world.rules.length).toBeGreaterThan(0);
    });

    it('zip-loaded post-web world passes validation', async () => {
      const world = await loadWorldFromZip(zipPath);
      const report = validateWorld(world);

      expect(report.summary.canRun).toBe(true);
    });
  });

  describe('error handling', () => {
    it('throws when world.json is missing from zip', () => {
      // Create a zip with no world.json
      const tmp = mkdtempSync(join(tmpdir(), 'nv-zip-test-'));
      const emptyZipPath = join(tmp, 'empty.nv-world.zip');
      execSync(`cd "${tmp}" && echo '{}' > dummy.json && zip "${emptyZipPath}" dummy.json`, { stdio: 'pipe' });

      const buf = readFileSync(emptyZipPath);
      expect(() => loadWorldFromBuffer(buf)).toThrow('Cannot find world.json');
    });

    it('loadWorldFromZip throws on non-existent file', async () => {
      await expect(loadWorldFromZip('/nonexistent/path.nv-world.zip'))
        .rejects.toThrow();
    });
  });
});
