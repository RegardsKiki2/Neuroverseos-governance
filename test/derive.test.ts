/**
 * Derive Engine Tests
 *
 * Tests the derive pipeline with mocked AI provider.
 * No real API calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { extractWorldMarkdown } from '../src/engine/derive-engine';
import {
  collectMarkdownSources,
  concatenateSources,
  buildSystemPrompt,
  buildUserPrompt,
} from '../src/engine/derive-prompt';
import { parseWorldMarkdown } from '../src/engine/bootstrap-parser';
import { DERIVE_EXIT_CODES, CONFIGURE_AI_EXIT_CODES } from '../src/contracts/derive-contract';

// ─── Test Fixtures ──────────────────────────────────────────────────────────

const VALID_NV_WORLD = `---
world_id: test_derived
name: Test Derived World
version: 1.0.0
---

# Thesis

This world tests the derive pipeline.

# Invariants

- \`test_invariant\` — All tests must pass (structural, immutable)
- \`inferred_invariant\` — Inferred from context (operational, immutable)

# State

## test_score
- type: number
- min: 0
- max: 100
- default: 50
- label: Test Score
- description: A test score variable

# Assumptions

## baseline
- name: Baseline
- description: Default scenario
- test_param: default

# Rules

## rule-001: Test Rule (structural)
A test rule for validation.

When test_score < 25 [state]
Then test_score *= 0.50

> trigger: Test score below 25
> rule: Low scores degrade further
> shift: Score drops
> effect: Test score halved

# Gates

- PASSING: test_score >= 75
- ACCEPTABLE: test_score >= 50
- WARNING: test_score >= 25
- FAILING: test_score > 10
- REJECTED: test_score <= 10

# Outcomes

## test_score
- type: number
- range: 0-100
- display: percentage
- label: Test Score
- primary: true
`;

const TMP_DIR = join(process.cwd(), 'test', '.tmp-derive-test');

// ─── Setup / Teardown ───────────────────────────────────────────────────────

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

// ─── Extraction Tests ───────────────────────────────────────────────────────

describe('extractWorldMarkdown', () => {
  it('extracts raw content starting with frontmatter', () => {
    const result = extractWorldMarkdown(VALID_NV_WORLD);
    expect(result).not.toBeNull();
    expect(result).toContain('world_id: test_derived');
  });

  it('extracts from triple backtick fences', () => {
    const wrapped = '```markdown\n' + VALID_NV_WORLD + '\n```';
    const result = extractWorldMarkdown(wrapped);
    expect(result).not.toBeNull();
    expect(result).toContain('world_id: test_derived');
  });

  it('extracts from code fence with md tag', () => {
    const wrapped = '```md\n' + VALID_NV_WORLD + '\n```';
    const result = extractWorldMarkdown(wrapped);
    expect(result).not.toBeNull();
    expect(result).toContain('world_id: test_derived');
  });

  it('extracts from sentinel markers', () => {
    const wrapped = 'BEGIN NV WORLD\n' + VALID_NV_WORLD + '\nEND NV WORLD';
    const result = extractWorldMarkdown(wrapped);
    expect(result).not.toBeNull();
    expect(result).toContain('world_id: test_derived');
  });

  it('rejects LLM preamble without frontmatter', () => {
    const bad = 'Sure! Here is your world file:\n\nThis is some content without frontmatter.';
    const result = extractWorldMarkdown(bad);
    expect(result).toBeNull();
  });

  it('rejects content without world_id', () => {
    const bad = '---\nname: Missing ID\nversion: 1.0.0\n---\n# Thesis\nTest';
    const result = extractWorldMarkdown(bad);
    expect(result).toBeNull();
  });

  it('handles LLM preamble before frontmatter', () => {
    const withPreamble = 'Here is the generated world:\n\n' + VALID_NV_WORLD;
    const result = extractWorldMarkdown(withPreamble);
    expect(result).not.toBeNull();
    expect(result).toContain('world_id: test_derived');
  });
});

// ─── Markdown Collection Tests ──────────────────────────────────────────────

describe('collectMarkdownSources', () => {
  it('collects a single file', async () => {
    const filePath = join(TMP_DIR, 'test.md');
    writeFileSync(filePath, '# Test\nHello world');

    const sources = await collectMarkdownSources(filePath);
    expect(sources).toHaveLength(1);
    expect(sources[0].filename).toBe('test.md');
    expect(sources[0].content).toContain('Hello world');
  });

  it('collects directory of markdown files', async () => {
    writeFileSync(join(TMP_DIR, 'b.md'), '# B');
    writeFileSync(join(TMP_DIR, 'a.md'), '# A');
    writeFileSync(join(TMP_DIR, 'c.txt'), 'not markdown');

    const sources = await collectMarkdownSources(TMP_DIR);
    expect(sources).toHaveLength(2);
    // Alphabetical order
    expect(sources[0].filename).toBe('a.md');
    expect(sources[1].filename).toBe('b.md');
  });

  it('collects nested directories recursively', async () => {
    const subDir = join(TMP_DIR, 'sub');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(TMP_DIR, 'root.md'), '# Root');
    writeFileSync(join(subDir, 'nested.md'), '# Nested');

    const sources = await collectMarkdownSources(TMP_DIR);
    expect(sources).toHaveLength(2);
  });

  it('throws on nonexistent path', async () => {
    await expect(
      collectMarkdownSources(join(TMP_DIR, 'nonexistent')),
    ).rejects.toThrow();
  });
});

// ─── Concatenation Tests ────────────────────────────────────────────────────

describe('concatenateSources', () => {
  it('formats with file headers', () => {
    const result = concatenateSources([
      { filename: 'agents.md', content: '# Agents\nContent' },
      { filename: 'roles.md', content: '# Roles\nContent' },
    ]);

    expect(result).toContain('=== FILE: agents.md ===');
    expect(result).toContain('=== FILE: roles.md ===');
    expect(result).toContain('# Agents');
    expect(result).toContain('# Roles');
  });
});

// ─── Prompt Builder Tests ───────────────────────────────────────────────────

describe('buildSystemPrompt', () => {
  it('includes DSL spec and DerivationWorld constraints', async () => {
    const prompt = await buildSystemPrompt();

    expect(prompt).toContain('.nv-world.md');
    expect(prompt).toContain('world_id');
    expect(prompt).toContain('Synthesis Constraints');
    expect(prompt).toContain('structural, immutable');
    expect(prompt).toContain('operational, immutable');
  });
});

describe('buildUserPrompt', () => {
  it('includes source material and instruction', () => {
    const prompt = buildUserPrompt('=== FILE: test.md ===\n# Test');

    expect(prompt).toContain('=== FILE: test.md ===');
    expect(prompt).toContain('Synthesize a valid .nv-world.md');
  });
});

// ─── Validation Tests ───────────────────────────────────────────────────────

describe('extracted output validation', () => {
  it('valid fixture passes parseWorldMarkdown', () => {
    const extracted = extractWorldMarkdown(VALID_NV_WORLD);
    expect(extracted).not.toBeNull();

    const { world, issues } = parseWorldMarkdown(extracted!);
    const errors = issues.filter(i => i.severity === 'error');
    expect(errors).toHaveLength(0);
    expect(world).not.toBeNull();
    expect(world!.frontmatter.world_id).toBe('test_derived');
  });

  it('identifies parse errors in malformed output', () => {
    const bad = '---\nworld_id: bad\nname: Bad\n---\n# Thesis\n\n# Invariants\n';
    const { issues } = parseWorldMarkdown(bad);
    const errors = issues.filter(i => i.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ─── DerivationWorld Self-Test ──────────────────────────────────────────────

describe('DerivationWorld', () => {
  it('parses with zero errors and zero warnings', () => {
    const derivationWorld = readFileSync(
      join(process.cwd(), 'src', 'worlds', 'derivation-world.nv-world.md'),
      'utf-8',
    );

    const { world, issues } = parseWorldMarkdown(derivationWorld);
    const errors = issues.filter(i => i.severity === 'error');
    const warnings = issues.filter(i => i.severity === 'warning');

    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
    expect(world).not.toBeNull();
    expect(world!.frontmatter.world_id).toBe('derivationworld');
    expect(world!.invariants).toHaveLength(10);
    expect(world!.rules).toHaveLength(10);
    expect(world!.gates).toHaveLength(5);
  });
});

// ─── Exit Code Constants ────────────────────────────────────────────────────

describe('exit codes', () => {
  it('derive exit codes are correct', () => {
    expect(DERIVE_EXIT_CODES.SUCCESS).toBe(0);
    expect(DERIVE_EXIT_CODES.VALIDATION_FAIL).toBe(1);
    expect(DERIVE_EXIT_CODES.INPUT_ERROR).toBe(2);
    expect(DERIVE_EXIT_CODES.PROVIDER_ERROR).toBe(3);
  });

  it('configure-ai exit codes are correct', () => {
    expect(CONFIGURE_AI_EXIT_CODES.SUCCESS).toBe(0);
    expect(CONFIGURE_AI_EXIT_CODES.VALIDATION_FAIL).toBe(1);
    expect(CONFIGURE_AI_EXIT_CODES.ERROR).toBe(3);
  });
});

// ─── Dry Run Test ───────────────────────────────────────────────────────────

describe('dry run', () => {
  it('returns prompts without calling AI', async () => {
    const { deriveWorld } = await import('../src/engine/derive-engine');

    const inputFile = join(TMP_DIR, 'input.md');
    writeFileSync(inputFile, '# Test\nSome governance content.');

    const { result, exitCode, dryRunOutput } = await deriveWorld({
      inputPath: inputFile,
      outputPath: join(TMP_DIR, 'output.nv-world.md'),
      validate: true,
      dryRun: true,
    });

    expect(exitCode).toBe(0);
    expect(result.gate).toBe('DRY_RUN');
    expect(dryRunOutput).toBeDefined();
    expect(dryRunOutput!.systemPrompt).toContain('.nv-world.md');
    expect(dryRunOutput!.userPrompt).toContain('Test');
  });
});
