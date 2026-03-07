/**
 * Plan Parser — Deterministic Markdown-to-PlanDefinition Parser
 *
 * Parses a simple markdown format into a PlanDefinition.
 * No AI needed. This is pure parsing like bootstrap-parser.
 *
 * Supported syntax:
 *   - YAML frontmatter: plan_id, objective, sequential, budget, expires, world
 *   - # Steps section: each `- ` line becomes a PlanStep
 *   - # Constraints section: each `- ` line becomes a PlanConstraint
 *   - Step dependencies: (after: step_id)
 *   - Tool restrictions: [tools: http, shell]
 *   - Tags: [tag: deploy, marketing]
 *   - Verification: [verify: condition_name]
 *   - Approval constraints: [type: approval]
 */

import type { PlanDefinition, PlanStep, PlanConstraint } from '../contracts/plan-contract';

// ─── Slug Generation ────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '_');
}

// ─── Bracket Annotation Extraction ──────────────────────────────────────────

function extractBracketAnnotation(line: string, key: string): string[] | null {
  const regex = new RegExp(`\\[${key}:\\s*([^\\]]+)\\]`, 'i');
  const match = line.match(regex);
  if (!match) return null;
  return match[1].split(',').map(s => s.trim()).filter(Boolean);
}

function extractParenAnnotation(line: string, key: string): string[] | null {
  const regex = new RegExp(`\\(${key}:\\s*([^)]+)\\)`, 'i');
  const match = line.match(regex);
  if (!match) return null;
  return match[1].split(',').map(s => s.trim()).filter(Boolean);
}

function stripAnnotations(line: string): string {
  return line
    .replace(/\[(?:tools|tag|verify|type):\s*[^\]]+\]/gi, '')
    .replace(/\((?:after):\s*[^)]+\)/gi, '')
    .trim();
}

// ─── Frontmatter Parser ────────────────────────────────────────────────────

function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const frontmatter: Record<string, string> = {};

  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!fmMatch) {
    return { frontmatter, body: content };
  }

  const fmBody = fmMatch[1];
  for (const line of fmBody.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      frontmatter[key] = value;
    }
  }

  return { frontmatter, body: content.slice(fmMatch[0].length) };
}

// ─── Section Parser ─────────────────────────────────────────────────────────

function parseSections(body: string): { steps: string[]; constraints: string[] } {
  const steps: string[] = [];
  const constraints: string[] = [];
  let currentSection: 'none' | 'steps' | 'constraints' = 'none';

  for (const line of body.split('\n')) {
    const trimmed = line.trim();

    if (/^#+\s*Steps/i.test(trimmed)) {
      currentSection = 'steps';
      continue;
    }
    if (/^#+\s*Constraints/i.test(trimmed)) {
      currentSection = 'constraints';
      continue;
    }
    // A new heading that isn't Steps or Constraints ends the section
    if (/^#+\s/.test(trimmed) && currentSection !== 'none') {
      currentSection = 'none';
      continue;
    }

    if (trimmed.startsWith('- ')) {
      const item = trimmed.slice(2).trim();
      if (currentSection === 'steps') {
        steps.push(item);
      } else if (currentSection === 'constraints') {
        constraints.push(item);
      }
    }
  }

  return { steps, constraints };
}

// ─── Step Parser ────────────────────────────────────────────────────────────

function parseStep(raw: string): PlanStep {
  const label = stripAnnotations(raw);
  const id = slugify(label);

  const tools = extractBracketAnnotation(raw, 'tools');
  const tags = extractBracketAnnotation(raw, 'tag');
  const verifyArr = extractBracketAnnotation(raw, 'verify');
  const requires = extractParenAnnotation(raw, 'after');

  return {
    id,
    label,
    tools: tools ?? undefined,
    tags: tags ?? undefined,
    verify: verifyArr?.[0] ?? undefined,
    requires: requires ?? undefined,
    status: 'pending',
  };
}

// ─── Constraint Parser ──────────────────────────────────────────────────────

function parseConstraint(raw: string, index: number): PlanConstraint {
  const typeAnnotation = extractBracketAnnotation(raw, 'type');
  const description = stripAnnotations(raw);
  const id = `constraint_${index}`;

  // Detect type from annotation or content
  let type: PlanConstraint['type'] = 'custom';
  let enforcement: PlanConstraint['enforcement'] = 'block';
  let limit: number | undefined;
  let unit: string | undefined;

  if (typeAnnotation?.[0] === 'approval') {
    type = 'approval';
    enforcement = 'pause';
  } else if (/budget|\$|spending|cost/i.test(description)) {
    type = 'budget';
    const amountMatch = description.match(/\$?([\d,]+)/);
    if (amountMatch) {
      limit = parseInt(amountMatch[1].replace(/,/g, ''), 10);
      unit = 'USD';
    }
  } else if (/time|hour|minute|day|deadline/i.test(description)) {
    type = 'time';
  } else if (/scope|access|database|production/i.test(description)) {
    type = 'scope';
  }

  // Detect trigger pattern from description
  const trigger = description.toLowerCase();

  return {
    id,
    type,
    description,
    enforcement,
    limit,
    unit,
    trigger,
  };
}

// ─── Main Parser ────────────────────────────────────────────────────────────

export interface PlanParseResult {
  success: boolean;
  plan?: PlanDefinition;
  errors: string[];
}

/**
 * Parse a plan markdown string into a PlanDefinition.
 *
 * Format:
 * ```markdown
 * ---
 * plan_id: my_plan
 * objective: Do the thing
 * sequential: false
 * ---
 *
 * # Steps
 * - Step one [tag: deploy]
 * - Step two (after: step_one) [verify: check_name]
 *
 * # Constraints
 * - No spending above $500
 * - External comms require review [type: approval]
 * ```
 */
export function parsePlanMarkdown(markdown: string): PlanParseResult {
  const errors: string[] = [];

  const { frontmatter, body } = parseFrontmatter(markdown.trim());
  const { steps: stepLines, constraints: constraintLines } = parseSections(body);

  // Validate required fields
  if (!frontmatter.plan_id) {
    errors.push('Missing required field: plan_id');
  }

  if (stepLines.length === 0) {
    errors.push('Plan must have at least one step');
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  // Parse steps
  const steps = stepLines.map(line => parseStep(line));

  // Parse constraints
  const constraints = constraintLines.map((line, i) => parseConstraint(line, i));

  // Build expiry date
  let expires_at: string | undefined;
  if (frontmatter.expires) {
    expires_at = new Date(frontmatter.expires).toISOString();
  }

  const plan: PlanDefinition = {
    plan_id: frontmatter.plan_id,
    objective: frontmatter.objective ?? '',
    sequential: frontmatter.sequential === 'true',
    steps,
    constraints,
    world_id: frontmatter.world ?? undefined,
    created_at: new Date().toISOString(),
    expires_at,
  };

  return { success: true, plan, errors: [] };
}
