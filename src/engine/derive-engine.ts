/**
 * Derive Engine — AI-Assisted World Synthesis Pipeline
 *
 * Pipeline:
 *   collect → prompt → AI → extract → parseWorldMarkdown → write → JSON
 *
 * DerivationWorld is advisory only:
 *   - Gate status is reported but never blocks file writing
 *   - parseWorldMarkdown errors ARE blocking (invalid .nv-world.md)
 *   - Governance engine does NOT run during derive
 */

import { writeFile } from 'fs/promises';
import { parseWorldMarkdown } from './bootstrap-parser';
import { normalizeWorldMarkdown } from './derive-normalizer';
import { emitWorldDefinition } from './bootstrap-emitter';
import { validateWorld } from './validate-engine';
import {
  collectMarkdownSources,
  concatenateSources,
  buildSystemPrompt,
  buildUserPrompt,
} from './derive-prompt';
import { createProvider } from '../providers/ai-provider';
import { loadConfig } from '../providers/config-manager';
import type { DeriveResult, AIProviderConfig } from '../contracts/derive-contract';

// ─── Output Extraction ──────────────────────────────────────────────────────

/**
 * Extract .nv-world.md content from LLM response.
 *
 * Handles:
 *   - Triple backtick fences (```markdown ... ``` or ``` ... ```)
 *   - Sentinel markers (BEGIN NV WORLD / END NV WORLD)
 *   - Raw content starting with ---
 *
 * Pre-parse safety: output must contain `world_id:` in frontmatter.
 */
export function extractWorldMarkdown(raw: string): string | null {
  let content = raw.trim();

  // Try triple backtick fence extraction
  const fenceMatch = content.match(/```(?:markdown|md)?\s*\n([\s\S]*?)```/);
  if (fenceMatch) {
    content = fenceMatch[1].trim();
  }

  // Try sentinel markers
  const sentinelMatch = content.match(
    /(?:BEGIN NV WORLD|BEGIN_NV_WORLD)[\s\n]*([\s\S]*?)[\s\n]*(?:END NV WORLD|END_NV_WORLD)/i,
  );
  if (sentinelMatch) {
    content = sentinelMatch[1].trim();
  }

  // If content doesn't start with ---, try to find frontmatter
  if (!content.startsWith('---')) {
    const fmIndex = content.indexOf('---\n');
    if (fmIndex >= 0) {
      content = content.slice(fmIndex);
    }
  }

  // Safety check: must contain world_id in frontmatter
  if (!content.startsWith('---')) return null;

  const fmEnd = content.indexOf('---', 3);
  if (fmEnd === -1) return null;

  const frontmatter = content.slice(3, fmEnd);
  if (!frontmatter.includes('world_id:')) return null;

  return content;
}

// ─── Gate Classification (advisory) ─────────────────────────────────────────

const GATES = [
  { status: 'FAITHFUL', threshold: 0.85 },
  { status: 'USABLE', threshold: 0.60 },
  { status: 'REVIEWABLE', threshold: 0.40 },
  { status: 'SUSPECT', threshold: 0.15 },
  { status: 'DERIVATION_REJECTED', threshold: 0 },
] as const;

function classifyGate(errors: number, warnings: number, sectionCount: number): string {
  // Simple heuristic based on parse quality (not a full engine run)
  const maxSections = 7; // Thesis, Invariants, State, Assumptions, Rules, Gates, Outcomes
  const completeness = sectionCount / maxSections;
  const fidelity = errors === 0
    ? Math.max(0, completeness - (warnings * 0.05))
    : 0;

  for (const gate of GATES) {
    if (fidelity >= gate.threshold) return gate.status;
  }
  return 'DERIVATION_REJECTED';
}

// ─── Main Pipeline ──────────────────────────────────────────────────────────

export interface DeriveOptions {
  inputPath: string;
  outputPath: string;
  validate: boolean;
  dryRun: boolean;
  providerOverride?: Partial<AIProviderConfig>;
}

export async function deriveWorld(options: DeriveOptions): Promise<{
  result: DeriveResult;
  exitCode: number;
  dryRunOutput?: { systemPrompt: string; userPrompt: string };
}> {
  const startTime = performance.now();

  // 1. Collect sources
  const sources = await collectMarkdownSources(options.inputPath);
  if (sources.length === 0) {
    throw new DeriveInputError('No markdown files found in input path');
  }

  const concatenated = concatenateSources(sources);

  // 2. Build prompts
  const systemPrompt = await buildSystemPrompt();
  const userPrompt = buildUserPrompt(concatenated);

  // 3. Dry run — return prompts without calling AI
  if (options.dryRun) {
    return {
      result: {
        success: true,
        outputPath: options.outputPath,
        sectionsDetected: [],
        validationErrors: 0,
        validationWarnings: 0,
        findings: [],
        gate: 'DRY_RUN',
        durationMs: performance.now() - startTime,
      },
      exitCode: 0,
      dryRunOutput: { systemPrompt, userPrompt },
    };
  }

  // 4. Load config + create provider
  const savedConfig = await loadConfig();
  const config: AIProviderConfig = {
    provider: options.providerOverride?.provider ?? savedConfig?.provider ?? '',
    model: options.providerOverride?.model ?? savedConfig?.model ?? '',
    apiKey: options.providerOverride?.apiKey ?? savedConfig?.apiKey ?? '',
    endpoint: options.providerOverride?.endpoint ?? savedConfig?.endpoint ?? null,
  };

  if (!config.apiKey) {
    throw new DeriveProviderError('No API key configured. Run: neuroverse configure-ai');
  }
  if (!config.model) {
    throw new DeriveProviderError('No model configured. Run: neuroverse configure-ai');
  }

  const provider = createProvider(config);

  // 5. Call AI
  let rawResponse: string;
  try {
    rawResponse = await provider.complete(systemPrompt, userPrompt);
  } catch (e) {
    throw new DeriveProviderError(`AI provider failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 6. Extract world markdown
  const extracted = extractWorldMarkdown(rawResponse);
  if (!extracted) {
    throw new DeriveProviderError(
      'Could not extract valid .nv-world.md from AI response. ' +
      'Response must contain frontmatter with world_id.',
    );
  }

  // 7. Normalize AI output to fix common drift patterns
  const { normalized, fixCount } = normalizeWorldMarkdown(extracted);

  // 8. Validate with parseWorldMarkdown
  const { world, issues } = parseWorldMarkdown(normalized);
  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');

  const sectionsDetected = world
    ? Object.keys(world).filter(k => {
        const val = world[k as keyof typeof world];
        if (Array.isArray(val)) return val.length > 0;
        if (typeof val === 'string') return val.length > 0;
        return !!val;
      })
    : [];

  // 9. Run full validator if parsing produced a usable world
  //    This catches referential integrity, semantic tensions, orphans, schema violations
  if (world && options.validate) {
    try {
      const { world: worldDef } = emitWorldDefinition(world);
      const report = validateWorld(worldDef);
      for (const finding of report.findings) {
        if (finding.severity === 'error' || finding.severity === 'warning') {
          issues.push({
            line: 0,
            section: `Validate:${finding.category}`,
            message: finding.message,
            severity: finding.severity,
          });
        }
      }
    } catch {
      // Emission can fail on incomplete worlds — that's fine, parser errors cover it
    }
  }

  // Recount after validation
  const allErrors = issues.filter(i => i.severity === 'error');
  const allWarnings = issues.filter(i => i.severity === 'warning');

  // 10. Advisory gate classification
  const gate = classifyGate(allErrors.length, allWarnings.length, sectionsDetected.length);

  // 11. Build findings for CLI output
  const findings = issues
    .filter(i => i.severity === 'error' || i.severity === 'warning')
    .map(i => ({
      severity: i.severity as 'error' | 'warning',
      section: i.section,
      message: i.message,
      line: i.line,
    }));

  // 12. ALWAYS write the file so users can inspect and iterate
  //     Gate status is advisory — never blocks file writing
  //     Embed diagnostics as HTML comment when findings exist
  let output = normalized;
  if (findings.length > 0 || fixCount > 0) {
    const lines = [`<!-- DERIVATION STATUS: ${gate}`];
    if (fixCount > 0) {
      lines.push(``, `Normalizer: ${fixCount} fix(es) applied to AI output`);
    }
    const errs = findings.filter(f => f.severity === 'error');
    const warns = findings.filter(f => f.severity === 'warning');
    if (errs.length > 0) {
      lines.push('', 'Errors:');
      for (const f of errs) lines.push(`- [${f.section}] ${f.message}`);
    }
    if (warns.length > 0) {
      lines.push('', 'Warnings:');
      for (const f of warns) lines.push(`- [${f.section}] ${f.message}`);
    }
    lines.push('-->', '');
    output = lines.join('\n') + normalized;
  }

  await writeFile(options.outputPath, output, 'utf-8');

  const hasErrors = allErrors.length > 0;

  return {
    result: {
      success: !hasErrors,
      outputPath: options.outputPath,
      sectionsDetected,
      validationErrors: allErrors.length,
      validationWarnings: allWarnings.length,
      findings,
      gate,
      durationMs: performance.now() - startTime,
    },
    exitCode: hasErrors ? 1 : 0,
  };
}

// ─── Error Types ────────────────────────────────────────────────────────────

export class DeriveInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeriveInputError';
  }
}

export class DeriveProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeriveProviderError';
  }
}
