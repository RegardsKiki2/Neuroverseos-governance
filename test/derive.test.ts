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
import { normalizeWorldMarkdown } from '../src/engine/derive-normalizer';
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

// ─── Normalizer Tests ──────────────────────────────────────────────────────

describe('normalizeWorldMarkdown', () => {
  describe('invariant normalization', () => {
    it('leaves valid invariants unchanged', () => {
      const md = '# Invariants\n- `my_id` — Description (structural, immutable)\n';
      const { normalized, fixCount } = normalizeWorldMarkdown(md);
      expect(fixCount).toBe(0);
      expect(normalized).toContain('`my_id`');
    });

    it('adds backticks to snake_case IDs', () => {
      const md = '# Invariants\n- rage_manifestation — Suppressed rage manifests (structural, immutable)\n';
      const { normalized, fixCount } = normalizeWorldMarkdown(md);
      expect(fixCount).toBe(1);
      expect(normalized).toContain('`rage_manifestation`');
    });

    it('converts bold IDs to backtick IDs', () => {
      const md = '# Invariants\n- **Rage Manifestation** — Description\n';
      const { normalized, fixCount } = normalizeWorldMarkdown(md);
      expect(fixCount).toBe(1);
      expect(normalized).toContain('`rage_manifestation`');
      expect(normalized).toContain('(structural, immutable)');
    });

    it('generates ID from prose description', () => {
      const md = '# Invariants\n- Suppressed rage manifests as a monster (structural, immutable)\n';
      const { normalized, fixCount } = normalizeWorldMarkdown(md);
      expect(fixCount).toBe(1);
      expect(normalized).toContain('`suppressed_rage_manifests_as_a_monster`');
    });

    it('normalized invariants pass the parser', () => {
      const md = `---
world_id: test
name: Test
---

# Thesis

Test thesis.

# Invariants

- rage_manifestation — Suppressed rage manifests (structural, immutable)
- **Bold Id** — Bold description

# Gates

- BEST: score >= 90
- WORST: score <= 10
`;
      const { normalized } = normalizeWorldMarkdown(md);
      const { issues } = parseWorldMarkdown(normalized);
      const invErrors = issues.filter(i => i.section === 'Invariants' && i.severity === 'error');
      expect(invErrors).toHaveLength(0);
    });
  });

  describe('gate normalization', () => {
    it('leaves valid gates unchanged', () => {
      const md = '# Gates\n- THRIVING: score >= 80\n';
      const { normalized, fixCount } = normalizeWorldMarkdown(md);
      expect(fixCount).toBe(0);
      expect(normalized).toContain('score >= 80');
    });

    it('converts symbolic values to numeric', () => {
      const md = '# Gates\n- BEST: integration = full\n';
      const { normalized, fixCount } = normalizeWorldMarkdown(md);
      expect(fixCount).toBe(1);
      expect(normalized).toContain('integration >= 100');
    });

    it('converts = to >= for numeric values', () => {
      const md = '# Gates\n- WARNING: score = 30\n';
      const { normalized, fixCount } = normalizeWorldMarkdown(md);
      expect(fixCount).toBe(1);
      expect(normalized).toContain('score >= 30');
    });

    it('converts quoted symbolic values', () => {
      const md = '# Gates\n- STATUS: field == "partial"\n';
      const { normalized, fixCount } = normalizeWorldMarkdown(md);
      expect(fixCount).toBe(1);
      expect(normalized).toContain('field >= 60');
    });

    it('normalized gates pass the parser', () => {
      const md = `---
world_id: test
name: Test
---

# Thesis

Test thesis.

# Invariants

- \`inv\` — Test (structural, immutable)

# Gates

- BEST: integration = full
- GOOD: integration = partial
- WORST: integration = none
`;
      const { normalized } = normalizeWorldMarkdown(md);
      const { issues } = parseWorldMarkdown(normalized);
      const gateErrors = issues.filter(i => i.section === 'Gates' && i.severity === 'error');
      expect(gateErrors).toHaveLength(0);
    });
  });

  describe('trigger normalization', () => {
    it('leaves valid triggers unchanged', () => {
      const md = '# Rules\n## rule-001: Test (structural)\nWhen score > 50 [state]\nThen score *= 0.5\n';
      const { normalized, fixCount } = normalizeWorldMarkdown(md);
      expect(fixCount).toBe(0);
      expect(normalized).toContain('[state]');
    });

    it('adds [state] to triggers missing source tag', () => {
      const md = '# Rules\n## rule-001: Test (structural)\nWhen score > 50\nThen score *= 0.5\n';
      const { normalized, fixCount } = normalizeWorldMarkdown(md);
      expect(fixCount).toBe(1);
      expect(normalized).toContain('score > 50 [state]');
    });

    it('adds [state] to each part of AND triggers', () => {
      const md = '# Rules\n## rule-001: Test (structural)\nWhen score > 50 AND level < 3\nThen score *= 0.5\n';
      const { normalized, fixCount } = normalizeWorldMarkdown(md);
      expect(fixCount).toBe(1);
      expect(normalized).toContain('score > 50 [state] AND level < 3 [state]');
    });

    it('preserves existing [assumption] tags', () => {
      const md = '# Rules\n## rule-001: Test (structural)\nWhen mode == "hard" [assumption] AND score > 50\nThen score *= 0.5\n';
      const { normalized } = normalizeWorldMarkdown(md);
      expect(normalized).toContain('[assumption]');
      expect(normalized).toContain('score > 50 [state]');
    });
  });

  describe('no interference across sections', () => {
    it('does not normalize non-invariant bullets in other sections', () => {
      const md = '# State\n## my_var\n- type: number\n- default: 50\n';
      const { fixCount } = normalizeWorldMarkdown(md);
      expect(fixCount).toBe(0);
    });

    it('does not modify lines outside sections', () => {
      const md = '---\nworld_id: test\nname: Test\n---\n';
      const { normalized, fixCount } = normalizeWorldMarkdown(md);
      expect(fixCount).toBe(0);
      expect(normalized).toBe(md);
    });
  });

  describe('end-to-end: AI drift → normalized → parseable', () => {
    it('fully normalizes a drifted AI output into a parseable world', () => {
      const drifted = `---
world_id: horror_test
name: Horror Test World
version: 1.0.0
---

# Thesis

Suppressed rage manifests as physical destruction.

# Invariants

- rage_manifestation — Suppressed rage manifests as a physical monster (structural, immutable)
- **Healing Requires Integration** — Recovery requires emotional integration
- Josie must survive all scenarios (structural, immutable)

# State

## rage_level
- type: number
- min: 0
- max: 100
- default: 30
- label: Rage Level
- description: Current suppressed rage intensity

## integration_level
- type: number
- min: 0
- max: 100
- default: 10
- label: Integration Level
- description: Emotional integration progress

# Assumptions

## baseline
- name: Baseline
- description: Default horror scenario

# Rules

## rule-001: Rage Escalation (structural)
Rage increases when suppressed.

When rage_level > 50 AND integration_level < 30
Then rage_level += 10

> trigger: Rage is high and integration is low
> rule: Suppression amplifies rage
> shift: Rage escalates
> effect: Rage level increases

# Gates

- RESOLVED: integration_level = full
- MANAGING: integration_level = partial
- DANGEROUS: rage_level = escalating
- CRITICAL: rage_level = extreme
- COLLAPSE: rage_level = indiscriminate

# Outcomes

## integration_level
- type: number
- range: 0-100
- display: percentage
- label: Integration Level
- primary: true
`;
      const { normalized, fixCount } = normalizeWorldMarkdown(drifted);
      expect(fixCount).toBeGreaterThan(0);

      const { world, issues } = parseWorldMarkdown(normalized);
      const errors = issues.filter(i => i.severity === 'error');

      // Invariants should parse
      expect(world).not.toBeNull();
      expect(world!.invariants.length).toBeGreaterThanOrEqual(2);

      // Gates should parse
      expect(world!.gates.length).toBe(5);

      // Triggers should have [state] tags
      expect(world!.rules[0].triggers.length).toBe(2);

      // No invariant or gate parse errors
      const invErrors = errors.filter(e => e.section === 'Invariants');
      const gateErrors = errors.filter(e => e.section === 'Gates');
      expect(invErrors).toHaveLength(0);
      expect(gateErrors).toHaveLength(0);
    });
  });
});

// ─── Prompt Reinforcement Tests ────────────────────────────────────────────

describe('prompt reinforcement', () => {
  it('system prompt contains invariant syntax guidance', async () => {
    const prompt = await buildSystemPrompt();
    expect(prompt).toContain('Invariant IDs MUST be wrapped in backticks');
    expect(prompt).toContain('VALID examples');
    expect(prompt).toContain('INVALID examples');
  });

  it('system prompt contains gate numeric requirement', async () => {
    const prompt = await buildSystemPrompt();
    expect(prompt).toContain('Gate thresholds MUST be numeric');
    expect(prompt).toContain('Symbolic values like');
  });

  it('system prompt contains syntax precision section', async () => {
    const prompt = await buildSystemPrompt();
    expect(prompt).toContain('Syntax Precision (CRITICAL)');
    expect(prompt).toContain('deterministic regex parser');
  });
});
