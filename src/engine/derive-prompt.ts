/**
 * Derive Prompt — Builds system + user prompts for AI synthesis
 *
 * Loads the bundled DerivationWorld and translates its invariants
 * into LLM instruction language. Does NOT run the governance engine.
 *
 * DerivationWorld is prompt governance only:
 *   1. Build system prompt from DSL spec + DerivationWorld constraints
 *   2. Build user prompt from collected markdown
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import type { CollectedSource } from '../contracts/derive-contract';

// ─── DerivationWorld Loader ─────────────────────────────────────────────────

function getModuleDir(): string {
  // ESM context
  try {
    return dirname(new URL(import.meta.url).pathname);
  } catch {
    // CJS fallback
    return __dirname;
  }
}

export async function loadDerivationWorld(): Promise<string> {
  const worldPath = join(getModuleDir(), '..', 'worlds', 'derivation-world.nv-world.md');
  return readFile(worldPath, 'utf-8');
}

// ─── Markdown Collector ─────────────────────────────────────────────────────

export async function collectMarkdownSources(inputPath: string): Promise<CollectedSource[]> {
  const { stat, readFile: rf, readdir } = await import('fs/promises');
  const { join: pathJoin, extname, basename } = await import('path');

  const stats = await stat(inputPath);

  if (stats.isFile()) {
    const content = await rf(inputPath, 'utf-8');
    return [{ filename: basename(inputPath), content }];
  }

  if (stats.isDirectory()) {
    const sources: CollectedSource[] = [];
    await collectDir(inputPath, sources, rf, pathJoin, extname, basename);

    // Stable alphabetical sort
    sources.sort((a, b) => a.filename.localeCompare(b.filename));
    return sources;
  }

  throw new Error(`Input path is neither a file nor a directory: ${inputPath}`);
}

async function collectDir(
  dir: string,
  sources: CollectedSource[],
  rf: typeof readFile,
  pathJoin: typeof join,
  extname: (p: string) => string,
  basename: (p: string) => string,
): Promise<void> {
  const { readdir } = await import('fs/promises');
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = pathJoin(dir, entry.name);
    if (entry.isDirectory()) {
      await collectDir(fullPath, sources, rf, pathJoin, extname, basename);
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
      const content = await rf(fullPath, 'utf-8');
      sources.push({ filename: entry.name, content });
    }
  }
}

// ─── Concatenation ──────────────────────────────────────────────────────────

export function concatenateSources(sources: CollectedSource[]): string {
  return sources
    .map(s => `=== FILE: ${s.filename} ===\n${s.content}`)
    .join('\n\n');
}

// ─── System Prompt ──────────────────────────────────────────────────────────

const NV_WORLD_SPEC = `
## .nv-world.md Format Specification

A .nv-world.md file is a structured markdown document with YAML frontmatter and H1 sections.

### Frontmatter (required)
\`\`\`yaml
---
world_id: <snake_case_id>
name: <Human Readable Name>
version: 1.0.0
---
\`\`\`

### Required Sections

# Thesis
A single paragraph stating the structural claim this world tests. Must be testable and falsifiable.

# Invariants
Bullet list of non-negotiable constraints:
- \`invariant_id\` — Description (structural, immutable)
- \`another_id\` — Description (operational, immutable)

Use "structural" for constraints derived directly from source material.
Use "operational" for constraints you inferred.

# State
H2 sub-sections, each defining a state variable:
## variable_name
- type: number | enum | boolean
- min: <number> (for number type)
- max: <number> (for number type)
- step: <number> (for number type)
- options: option_a, option_b (for enum type)
- default: <value>
- label: Human Label
- description: What this variable represents

# Assumptions
H2 sub-sections, each defining a scenario profile:
## profile_id
- name: Profile Name
- description: What this profile represents
- param_key: param_value

# Rules
H2 sub-sections with this format:
## rule-001: Rule Label (structural|degradation|advantage)
Single sentence description.

When field == "value" [state] AND other_field > 50 [state]
Then target *= 0.30, other_target = false
Collapse: field < 0.05

> trigger: What triggers this rule
> rule: What the rule means
> shift: What changes
> effect: The concrete effect

Rules must have:
- A "When" line with triggers referencing [state] or [assumption] sources
- A "Then" line with effects using =, *=, +=, or -= operators
- Optional "Collapse:" line for failure conditions

# Gates
Bullet list of status thresholds (must be monotonically decreasing):
- BEST_STATUS: primary_metric >= <highest_value>
- GOOD_STATUS: primary_metric >= <lower_value>
- WARN_STATUS: primary_metric >= <even_lower>
- BAD_STATUS: primary_metric > <near_bottom>
- WORST_STATUS: primary_metric <= <bottom>

# Outcomes
H2 sub-sections defining computed outcomes:
## outcome_id
- type: number | enum | boolean
- range: 0-100 (for numbers)
- display: percentage | integer | decimal
- label: Human Label
- primary: true (for the main metric)
`.trim();

export async function buildSystemPrompt(): Promise<string> {
  const derivationWorld = await loadDerivationWorld();

  // Extract invariants from DerivationWorld for instruction language
  const invariantLines = derivationWorld
    .split('\n')
    .filter(l => l.trim().startsWith('- `'))
    .map(l => {
      const match = l.match(/^-\s+`([^`]+)`\s*[—–-]\s*(.+?)(?:\s*\([^)]+\))?\s*$/);
      return match ? `- ${match[2].trim()}` : null;
    })
    .filter(Boolean);

  return `You are a governance document synthesizer for NeuroVerse OS.

Your task: Given arbitrary markdown source material, synthesize a valid .nv-world.md governance document.

${NV_WORLD_SPEC}

## Synthesis Constraints (from DerivationWorld)

You MUST follow these constraints:
${invariantLines.join('\n')}

## Critical Rules

1. Output ONLY the .nv-world.md document. No preamble, no explanation, no trailing commentary.
2. Do not wrap the output in a code fence.
3. Every invariant derived from explicit source statements must be marked (structural, immutable).
4. Every invariant you infer that is not directly stated in the source must be marked (operational, immutable).
5. All state variables, rules, and invariants must trace to concepts present in the input.
6. Do not invent governance domains beyond what the source material covers.
7. Every rule must have a When trigger line and a Then effect line.
8. Gate thresholds must be monotonically decreasing from best to worst status.
9. The frontmatter must include world_id, name, and version.
10. Rule descriptions must be a single sentence.`;
}

// ─── User Prompt ────────────────────────────────────────────────────────────

export function buildUserPrompt(concatenatedMarkdown: string): string {
  return `Synthesize a valid .nv-world.md under DerivationWorld constraints from the following source material.

Output ONLY the .nv-world.md content. Start with the --- frontmatter delimiter.

Source material:

${concatenatedMarkdown}`;
}
