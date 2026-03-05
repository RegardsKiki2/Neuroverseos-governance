/**
 * Derive Normalizer — Post-processing pass for AI output drift
 *
 * Runs AFTER AI generation but BEFORE parsing. Normalizes common
 * deviations from the strict .nv-world.md grammar so the parser
 * can accept the output.
 *
 * Transformations:
 *   1. Invariant lines: adds backtick-wrapped IDs when missing
 *   2. Gate lines: converts symbolic values to numeric thresholds
 *   3. Trigger lines: ensures [state] / [assumption] source tags
 *
 * INVARIANTS:
 *   - Deterministic: same input → same output, always.
 *   - Zero network calls. Zero LLM calls.
 *   - Never removes content — only reformats.
 *   - Operates on raw markdown string, not parsed structures.
 */

// ─── Section Extraction ──────────────────────────────────────────────────────

interface SectionRange {
  name: string;
  start: number; // line index (inclusive, the heading line)
  end: number;   // line index (exclusive)
}

/**
 * Find H1 section boundaries in markdown lines.
 */
function findSections(lines: string[]): SectionRange[] {
  const sections: SectionRange[] = [];
  let current: SectionRange | null = null;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('# ')) {
      if (current) {
        current.end = i;
        sections.push(current);
      }
      current = { name: lines[i].replace(/^#\s+/, '').trim(), start: i, end: lines.length };
    }
  }

  if (current) {
    current.end = lines.length;
    sections.push(current);
  }

  return sections;
}

// ─── Invariant Normalizer ────────────────────────────────────────────────────

/**
 * The parser expects: - `invariant_id` — Description (enforcement, mutability)
 *
 * Common AI drift patterns:
 *   - invariant_id — Description (structural, immutable)    → missing backticks
 *   - Description text (structural, immutable)              → missing ID entirely
 *   - **invariant_id** — Description                       → bold instead of backticks
 */

const VALID_INVARIANT_RE = /^-\s+`[^`]+`\s*[—–-]\s*.+/;

function normalizeInvariantLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith('- ')) return line;

  // Already valid
  if (VALID_INVARIANT_RE.test(trimmed)) return line;

  // Pattern: - **id** — Description → convert bold to backtick
  const boldMatch = trimmed.match(/^-\s+\*\*([^*]+)\*\*\s*([—–-])\s*(.+)$/);
  if (boldMatch) {
    const id = boldMatch[1].toLowerCase().replace(/\s+/g, '_');
    const desc = boldMatch[3].trim();
    const hasParens = /\([^)]+\)\s*$/.test(desc);
    return `- \`${id}\` — ${hasParens ? desc : desc + ' (structural, immutable)'}`;
  }

  // Pattern: - snake_id — Description (with optional parens)
  const snakeMatch = trimmed.match(/^-\s+(\w[\w]*(?:_\w+)+)\s*([—–-])\s*(.+)$/);
  if (snakeMatch) {
    const id = snakeMatch[1];
    const desc = snakeMatch[3].trim();
    const hasParens = /\([^)]+\)\s*$/.test(desc);
    return `- \`${id}\` — ${hasParens ? desc : desc + ' (structural, immutable)'}`;
  }

  // Pattern: - Description text (enforcement, mutability) — no ID at all
  // Generate ID from description
  const proseMatch = trimmed.match(/^-\s+([A-Z][^(]+?)(?:\s*\(([^)]+)\))?\s*$/);
  if (proseMatch) {
    const desc = proseMatch[1].trim();
    const parens = proseMatch[2] ?? 'structural, immutable';
    const id = desc
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 50);
    if (id.length >= 3) {
      return `- \`${id}\` — ${desc} (${parens})`;
    }
  }

  return line;
}

// ─── Gate Normalizer ─────────────────────────────────────────────────────────

/**
 * The parser expects: - STATUS: field >= <number>
 *
 * Common AI drift patterns:
 *   - STATUS: field = symbolic_value           → symbolic instead of numeric
 *   - STATUS: field == "string_value"          → quoted string comparison
 *   - STATUS: field = 100                      → = instead of >=
 */

const VALID_GATE_RE = /^-\s+\w+:\s*\w+\s*(==|!=|>=|<=|>|<)\s*[\d.]+/;

/** Maps common symbolic values to numeric thresholds (0-100 scale) */
const SYMBOLIC_TO_NUMERIC: Record<string, number> = {
  // Positive states
  full: 100,
  complete: 100,
  total: 100,
  optimal: 95,
  maximum: 100,
  high: 80,
  strong: 80,
  // Mid states
  partial: 60,
  moderate: 50,
  medium: 50,
  growing: 60,
  developing: 50,
  // Low/negative states
  low: 30,
  minimal: 20,
  weak: 20,
  declining: 40,
  limited: 30,
  escalating: 50,
  // Extreme states
  none: 0,
  absent: 0,
  zero: 0,
  critical: 80,
  extreme: 90,
  severe: 85,
  indiscriminate: 80,
  uncontrolled: 90,
  overwhelming: 90,
};

function normalizeGateLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith('- ')) return line;

  // Already valid
  if (VALID_GATE_RE.test(trimmed)) return line;

  // Pattern: - STATUS: field = symbolic_value or field == "symbolic"
  const symbolicMatch = trimmed.match(
    /^-\s+(\w+):\s*(\w+)\s*(?:==?)\s*"?([a-zA-Z_]+)"?\s*$/,
  );
  if (symbolicMatch) {
    const status = symbolicMatch[1];
    const field = symbolicMatch[2];
    const symbolic = symbolicMatch[3].toLowerCase();
    const numeric = SYMBOLIC_TO_NUMERIC[symbolic];
    if (numeric !== undefined) {
      return `- ${status}: ${field} >= ${numeric}`;
    }
    // If we can't map it, try a reasonable default based on position context
    return `- ${status}: ${field} >= 50`;
  }

  // Pattern: - STATUS: field = <number> (missing comparison operator)
  const eqNumMatch = trimmed.match(/^-\s+(\w+):\s*(\w+)\s*=\s*([\d.]+)\s*$/);
  if (eqNumMatch) {
    return `- ${eqNumMatch[1]}: ${eqNumMatch[2]} >= ${eqNumMatch[3]}`;
  }

  return line;
}

// ─── Trigger Normalizer ──────────────────────────────────────────────────────

/**
 * Ensure When-line triggers have [state] or [assumption] tags.
 *
 * Common AI drift:
 *   When field > 50 AND other == "val"     → missing [state] tags
 */
function normalizeWhenLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith('When ')) return line;

  const parts = trimmed.slice(5).split(/\s+AND\s+/i);
  const normalized = parts.map(part => {
    const p = part.trim();
    // Already has source tag
    if (/\[(state|assumption)\]\s*$/.test(p)) return p;
    // Add [state] as default
    return p + ' [state]';
  });

  return 'When ' + normalized.join(' AND ');
}

// ─── Main Normalizer ─────────────────────────────────────────────────────────

/**
 * Normalize AI-generated .nv-world.md content to fix common drift patterns.
 *
 * Returns the normalized markdown string and a count of fixes applied.
 */
export function normalizeWorldMarkdown(markdown: string): { normalized: string; fixCount: number } {
  const lines = markdown.split('\n');
  const sections = findSections(lines);
  let fixCount = 0;

  // Find section boundaries
  const invariantsSection = sections.find(s => s.name.toLowerCase() === 'invariants');
  const gatesSection = sections.find(s => s.name.toLowerCase() === 'gates');
  const rulesSection = sections.find(s => s.name.toLowerCase() === 'rules');

  for (let i = 0; i < lines.length; i++) {
    const original = lines[i];

    // Normalize invariant lines
    if (invariantsSection && i > invariantsSection.start && i < invariantsSection.end) {
      lines[i] = normalizeInvariantLine(lines[i]);
    }

    // Normalize gate lines
    if (gatesSection && i > gatesSection.start && i < gatesSection.end) {
      lines[i] = normalizeGateLine(lines[i]);
    }

    // Normalize trigger lines within rules
    if (rulesSection && i > rulesSection.start && i < rulesSection.end) {
      lines[i] = normalizeWhenLine(lines[i]);
    }

    if (lines[i] !== original) fixCount++;
  }

  return { normalized: lines.join('\n'), fixCount };
}
