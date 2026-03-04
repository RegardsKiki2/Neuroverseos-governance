/**
 * Bootstrap Parser — .nv-world.md → ParsedWorld
 *
 * Deterministic markdown parser for the NeuroVerse world authoring format.
 * No LLM calls. No heuristics. Pattern matching on structured markdown.
 *
 * ## Markdown Format (.nv-world.md)
 *
 * ```markdown
 * ---
 * world_id: my-world
 * name: My World
 * version: 1.0.0
 * default_profile: baseline
 * alternative_profile: alternative
 * ---
 *
 * # Thesis
 * The structural claim this world tests...
 *
 * # Invariants
 * - `invariant_id` — Label text (structural, immutable)
 * - `another_id` — Another label (structural, immutable)
 *
 * # State
 * ## variable_name
 * - type: number
 * - min: 0
 * - max: 100
 * - step: 5
 * - default: 50
 * - label: Human Label
 * - description: What this variable represents
 *
 * ## another_variable
 * - type: enum
 * - options: option_a, option_b, option_c
 * - default: option_a
 * - label: Another Variable
 * - description: Description here
 *
 * # Assumptions
 * ## baseline
 * - name: Baseline Scenario
 * - description: The default conditions
 * - param_key: param_value
 *
 * ## alternative
 * - name: Alternative Scenario
 * - description: What changes
 * - param_key: different_value
 *
 * # Rules
 * ## rule-001: Rule Label (structural)
 * Description of what this rule does.
 *
 * When field == "value" [state] AND other_field > 50 [assumption]
 * Then target *= 0.30, other_target = false
 * Collapse: field < 0.03
 *
 * > trigger: Trigger text here
 * > rule: Rule text here
 * > shift: Shift text here
 * > effect: Effect text here
 *
 * # Gates
 * - THRIVING: effective_margin >= 40
 * - STABLE: effective_margin >= 20
 * - COMPRESSED: effective_margin >= 10
 * - CRITICAL: effective_margin > 3
 * - MODEL_COLLAPSES: effective_margin <= 3
 *
 * # Outcomes
 * ## outcome_id
 * - type: number
 * - range: 0-100
 * - display: percentage
 * - label: Outcome Label
 * - primary: true
 * ```
 */

import type {
  ParsedWorld,
  ParsedFrontmatter,
  ParsedInvariant,
  ParsedStateVariable,
  ParsedAssumptionProfile,
  ParsedRule,
  ParsedTrigger,
  ParsedEffect,
  ParsedGate,
  ParsedOutcome,
  ParseIssue,
} from '../contracts/bootstrap-contract';

// ─── Section Splitter ────────────────────────────────────────────────────────

interface Section {
  name: string;
  content: string;
  startLine: number;
}

/**
 * Split markdown into frontmatter and H1 sections.
 */
function splitSections(markdown: string): { frontmatter: string; sections: Section[] } {
  const lines = markdown.split('\n');
  let frontmatter = '';
  let bodyStart = 0;

  // Extract YAML frontmatter
  if (lines[0]?.trim() === '---') {
    const endIdx = lines.indexOf('---', 1);
    if (endIdx > 0) {
      frontmatter = lines.slice(1, endIdx).join('\n');
      bodyStart = endIdx + 1;
    }
  }

  // Split on H1 headings
  const sections: Section[] = [];
  let currentSection: Section | null = null;
  const contentLines: string[] = [];

  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('# ')) {
      if (currentSection) {
        currentSection.content = contentLines.join('\n').trim();
        sections.push(currentSection);
        contentLines.length = 0;
      }
      currentSection = {
        name: line.replace(/^#\s+/, '').trim(),
        content: '',
        startLine: i + 1, // 1-based
      };
    } else if (currentSection) {
      contentLines.push(line);
    }
  }

  if (currentSection) {
    currentSection.content = contentLines.join('\n').trim();
    sections.push(currentSection);
  }

  return { frontmatter, sections };
}

// ─── Frontmatter Parser ─────────────────────────────────────────────────────

function parseFrontmatter(yaml: string, issues: ParseIssue[]): ParsedFrontmatter {
  const result: Record<string, string> = {};

  for (const line of yaml.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    result[key] = value;
  }

  if (!result.world_id) {
    issues.push({ line: 1, section: 'frontmatter', message: 'Missing world_id in frontmatter', severity: 'error' });
  }
  if (!result.name) {
    issues.push({ line: 1, section: 'frontmatter', message: 'Missing name in frontmatter', severity: 'error' });
  }

  return {
    world_id: result.world_id ?? '',
    name: result.name ?? '',
    version: result.version,
    runtime_mode: result.runtime_mode,
    default_profile: result.default_profile,
    alternative_profile: result.alternative_profile,
  };
}

// ─── Thesis Parser ──────────────────────────────────────────────────────────

function parseThesis(content: string, startLine: number, issues: ParseIssue[]): string {
  const thesis = content.trim();
  if (!thesis) {
    issues.push({ line: startLine, section: 'Thesis', message: 'Thesis section is empty', severity: 'error' });
  }
  return thesis;
}

// ─── Invariants Parser ──────────────────────────────────────────────────────

/**
 * Parses:
 *   - `invariant_id` — Label text (structural, immutable)
 *   - `invariant_id` — Label text
 */
function parseInvariants(content: string, startLine: number, issues: ParseIssue[]): ParsedInvariant[] {
  const invariants: ParsedInvariant[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('- ')) continue;

    const lineNum = startLine + i + 1;

    // Match: - `id` — Label (enforcement, mutable/immutable)
    const match = line.match(
      /^-\s+`([^`]+)`\s*[—–-]\s*(.+?)(?:\s*\(([^)]+)\))?\s*$/,
    );

    if (match) {
      const id = match[1];
      const label = match[2].trim();
      const parens = match[3] ?? 'structural, immutable';

      const enforcement = parens.includes('prompt') ? 'prompt'
        : parens.includes('operational') ? 'operational' : 'structural';
      const mutable = parens.includes('mutable') && !parens.includes('immutable');

      invariants.push({ id, label, enforcement, mutable, line: lineNum });
    } else {
      // Fallback: plain bullet with no backtick ID
      const fallback = line.match(/^-\s+\*\*([^*]+)\*\*\s*[—–-]\s*(.+)/);
      if (fallback) {
        const id = fallback[1].toLowerCase().replace(/\s+/g, '_');
        const label = fallback[2].trim();
        invariants.push({ id, label, enforcement: 'structural', mutable: false, line: lineNum });
      } else {
        issues.push({ line: lineNum, section: 'Invariants', message: `Could not parse invariant: "${line}"`, severity: 'warning' });
      }
    }
  }

  if (invariants.length === 0) {
    issues.push({ line: startLine, section: 'Invariants', message: 'No invariants found', severity: 'error' });
  }

  return invariants;
}

// ─── State Variables Parser ─────────────────────────────────────────────────

/**
 * Parses H2 sub-sections in the State block.
 * Each variable is an H2 heading followed by key-value bullet items.
 */
function parseStateVariables(content: string, startLine: number, issues: ParseIssue[]): ParsedStateVariable[] {
  const variables: ParsedStateVariable[] = [];
  const subSections = splitH2Sections(content, startLine);

  for (const sub of subSections) {
    const props = parseKeyValueBullets(sub.content);
    const lineNum = sub.startLine;

    const type = props.type as 'number' | 'enum' | 'boolean' | undefined;
    if (!type) {
      issues.push({ line: lineNum, section: 'State', message: `Variable "${sub.name}" missing type`, severity: 'error' });
      continue;
    }

    let defaultVal: string | number | boolean = props.default ?? '';
    if (type === 'number') {
      defaultVal = parseFloat(String(defaultVal)) || 0;
    } else if (type === 'boolean') {
      defaultVal = String(defaultVal).toLowerCase() === 'true';
    }

    const variable: ParsedStateVariable = {
      id: sub.name,
      type,
      default: defaultVal,
      label: props.label ?? sub.name,
      description: props.description ?? '',
      line: lineNum,
    };

    if (type === 'number') {
      if (props.min !== undefined) variable.min = parseFloat(props.min);
      if (props.max !== undefined) variable.max = parseFloat(props.max);
      if (props.step !== undefined) variable.step = parseFloat(props.step);
    }

    if (type === 'enum' && props.options) {
      variable.options = props.options.split(',').map(s => s.trim());
    }

    variables.push(variable);
  }

  return variables;
}

// ─── Assumptions Parser ─────────────────────────────────────────────────────

function parseAssumptions(content: string, startLine: number, issues: ParseIssue[]): ParsedAssumptionProfile[] {
  const profiles: ParsedAssumptionProfile[] = [];
  const subSections = splitH2Sections(content, startLine);

  for (const sub of subSections) {
    const props = parseKeyValueBullets(sub.content);
    const name = props.name ?? sub.name;
    const description = props.description ?? '';

    // Everything except name/description becomes a parameter
    const parameters: Record<string, string | number | boolean> = {};
    for (const [key, val] of Object.entries(props)) {
      if (key === 'name' || key === 'description') continue;
      // Try to parse as number or boolean
      if (val === 'true') parameters[key] = true;
      else if (val === 'false') parameters[key] = false;
      else if (!isNaN(Number(val)) && val.trim() !== '') parameters[key] = Number(val);
      else parameters[key] = val;
    }

    profiles.push({
      id: sub.name,
      name,
      description,
      parameters,
      line: sub.startLine,
    });
  }

  return profiles;
}

// ─── Rules Parser ───────────────────────────────────────────────────────────

/**
 * Parses rules with this format:
 *
 * ## rule-001: Rule Label (structural)
 * Optional description paragraph.
 *
 * When field == "value" [state] AND other > 50 [assumption]
 * Then target *= 0.30, other_target = false
 * Collapse: field < 0.03
 *
 * > trigger: Trigger text
 * > rule: Rule text
 * > shift: Shift text
 * > effect: Effect text
 */
function parseRules(content: string, startLine: number, issues: ParseIssue[]): ParsedRule[] {
  const rules: ParsedRule[] = [];
  const subSections = splitH2Sections(content, startLine);

  for (let ruleIdx = 0; ruleIdx < subSections.length; ruleIdx++) {
    const sub = subSections[ruleIdx];
    const lineNum = sub.startLine;

    // Parse heading: rule-001: Label (severity)
    const headingMatch = sub.name.match(/^([^:]+):\s*(.+?)(?:\s*\(([^)]+)\))?\s*$/);
    const id = headingMatch ? headingMatch[1].trim() : `rule-${String(ruleIdx + 1).padStart(3, '0')}`;
    const label = headingMatch ? headingMatch[2].trim() : sub.name;
    const severity = headingMatch?.[3]?.trim() ?? 'degradation';

    const lines = sub.content.split('\n');
    let description = '';
    const triggers: ParsedTrigger[] = [];
    const effects: ParsedEffect[] = [];
    let collapseCheck: ParsedRule['collapse_check'] | undefined;
    const causalParts: Record<string, string> = {};

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // When ... (triggers)
      if (line.startsWith('When ')) {
        const triggerStr = line.slice(5);
        const parts = triggerStr.split(/\s+AND\s+/i);
        for (const part of parts) {
          const trigger = parseTriggerExpression(part.trim());
          if (trigger) triggers.push(trigger);
          else issues.push({ line: lineNum + i, section: 'Rules', message: `Could not parse trigger: "${part}"`, severity: 'warning' });
        }
      }
      // Then ... (effects)
      else if (line.startsWith('Then ')) {
        const effectStr = line.slice(5);
        const parts = effectStr.split(',');
        for (const part of parts) {
          const effect = parseEffectExpression(part.trim());
          if (effect) effects.push(effect);
          else issues.push({ line: lineNum + i, section: 'Rules', message: `Could not parse effect: "${part}"`, severity: 'warning' });
        }
      }
      // Collapse: field < value
      else if (line.startsWith('Collapse:')) {
        const collapseStr = line.slice(9).trim();
        const collapse = parseCollapseExpression(collapseStr);
        if (collapse) collapseCheck = collapse;
        else issues.push({ line: lineNum + i, section: 'Rules', message: `Could not parse collapse: "${collapseStr}"`, severity: 'warning' });
      }
      // > trigger: text (causal translation)
      else if (line.startsWith('> ')) {
        const causalMatch = line.match(/^>\s*(trigger|rule|shift|effect):\s*(.+)/i);
        if (causalMatch) {
          causalParts[causalMatch[1].toLowerCase()] = causalMatch[2].trim();
        }
      }
      // Description paragraph (anything else that's not empty)
      else if (line && !line.startsWith('-') && !line.startsWith('#')) {
        if (!description) description = line;
        else description += ' ' + line;
      }
    }

    if (triggers.length === 0) {
      issues.push({ line: lineNum, section: 'Rules', message: `Rule "${id}" has no triggers (missing "When" line)`, severity: 'warning' });
    }
    if (effects.length === 0) {
      issues.push({ line: lineNum, section: 'Rules', message: `Rule "${id}" has no effects (missing "Then" line)`, severity: 'warning' });
    }

    const causal_translation = Object.keys(causalParts).length > 0
      ? {
        trigger_text: causalParts.trigger ?? '',
        rule_text: causalParts.rule ?? '',
        shift_text: causalParts.shift ?? '',
        effect_text: causalParts.effect ?? '',
      }
      : undefined;

    rules.push({
      id,
      label,
      severity,
      description: description || undefined,
      order: ruleIdx + 1,
      triggers,
      effects,
      collapse_check: collapseCheck,
      causal_translation,
      line: lineNum,
    });
  }

  return rules;
}

/**
 * Parse a trigger expression: field == "value" [state]
 */
function parseTriggerExpression(expr: string): ParsedTrigger | null {
  // Match: field <op> <value> [source]
  const match = expr.match(
    /^(\w+)\s*(==|!=|>=|<=|>|<|in)\s*(.+?)\s*\[(state|assumption)\]\s*$/,
  );
  if (!match) return null;

  const field = match[1];
  const operator = match[2];
  let value: string | number | boolean = match[3].trim();
  const source = match[4] as 'state' | 'assumption';

  // Parse value type
  value = parseValueLiteral(value);

  return { field, operator, value, source };
}

/**
 * Parse an effect expression: target *= 0.30
 */
function parseEffectExpression(expr: string): ParsedEffect | null {
  // Compound assignment: target *= 0.5
  const compound = expr.match(/^(\w+)\s*(\*=|\+=|-=)\s*(.+)$/);
  if (compound) {
    const target = compound[1];
    const op = compound[2];
    const value = parseValueLiteral(compound[3].trim());
    const operationMap: Record<string, string> = {
      '*=': 'multiply',
      '+=': 'add',
      '-=': 'subtract',
    };
    return { target, operation: operationMap[op], value: value as number };
  }

  // Simple assignment: target = value
  const assignment = expr.match(/^(\w+)\s*=\s*(.+)$/);
  if (assignment) {
    const target = assignment[1];
    const value = parseValueLiteral(assignment[2].trim());
    const operation = typeof value === 'boolean' ? 'set_boolean' : 'set';
    return { target, operation, value };
  }

  return null;
}

/**
 * Parse a collapse expression: field < 0.03
 */
function parseCollapseExpression(expr: string): { field: string; operator: string; value: number } | null {
  // Strip trailing → MODEL_COLLAPSES or similar
  const cleaned = expr.replace(/\s*→.*$/, '').trim();
  const match = cleaned.match(/^(\w+)\s*(==|!=|>=|<=|>|<)\s*([\d.]+)$/);
  if (!match) return null;

  return {
    field: match[1],
    operator: match[2],
    value: parseFloat(match[3]),
  };
}

// ─── Gates Parser ───────────────────────────────────────────────────────────

/**
 * Parses:
 *   - THRIVING: effective_margin >= 40
 */
function parseGates(content: string, startLine: number, issues: ParseIssue[]): ParsedGate[] {
  const gates: ParsedGate[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('- ')) continue;

    const lineNum = startLine + i + 1;
    const match = line.match(/^-\s+(\w+):\s*(\w+)\s*(==|!=|>=|<=|>|<)\s*([\d.]+)/);

    if (match) {
      gates.push({
        status: match[1],
        field: match[2],
        operator: match[3],
        value: parseFloat(match[4]),
        line: lineNum,
      });
    } else {
      issues.push({ line: lineNum, section: 'Gates', message: `Could not parse gate: "${line}"`, severity: 'warning' });
    }
  }

  if (gates.length === 0) {
    issues.push({ line: startLine, section: 'Gates', message: 'No gates found', severity: 'error' });
  }

  return gates;
}

// ─── Outcomes Parser ─────────────────────────────────────────────────────────

function parseOutcomes(content: string, startLine: number, issues: ParseIssue[]): ParsedOutcome[] {
  const outcomes: ParsedOutcome[] = [];
  const subSections = splitH2Sections(content, startLine);

  for (const sub of subSections) {
    const props = parseKeyValueBullets(sub.content);

    const outcome: ParsedOutcome = {
      id: sub.name,
      type: props.type ?? 'number',
      label: props.label ?? sub.name,
      line: sub.startLine,
    };

    if (props.range) {
      const rangeParts = props.range.split('-').map(Number);
      if (rangeParts.length === 2 && !isNaN(rangeParts[0]) && !isNaN(rangeParts[1])) {
        outcome.range = [rangeParts[0], rangeParts[1]];
      }
    }

    if (props.display) outcome.display = props.display;
    if (props.primary) outcome.primary = props.primary === 'true';
    if (props.assignment) outcome.assignment = props.assignment;

    outcomes.push(outcome);
  }

  return outcomes;
}

// ─── Shared Helpers ─────────────────────────────────────────────────────────

interface H2Section {
  name: string;
  content: string;
  startLine: number;
}

/**
 * Split content into H2 sub-sections.
 */
function splitH2Sections(content: string, baseStartLine: number): H2Section[] {
  const lines = content.split('\n');
  const sections: H2Section[] = [];
  let current: H2Section | null = null;
  const contentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('## ')) {
      if (current) {
        current.content = contentLines.join('\n').trim();
        sections.push(current);
        contentLines.length = 0;
      }
      current = {
        name: line.replace(/^##\s+/, '').trim(),
        content: '',
        startLine: baseStartLine + i + 1,
      };
    } else if (current) {
      contentLines.push(line);
    }
  }

  if (current) {
    current.content = contentLines.join('\n').trim();
    sections.push(current);
  }

  return sections;
}

/**
 * Parse bullet-list key-value pairs:
 *   - key: value
 */
function parseKeyValueBullets(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    const match = trimmed.match(/^-\s+(\w[\w\s]*?):\s*(.+)$/);
    if (match) {
      result[match[1].trim().toLowerCase().replace(/\s+/g, '_')] = match[2].trim();
    }
  }
  return result;
}

/**
 * Parse a literal value (string, number, boolean).
 */
function parseValueLiteral(raw: string): string | number | boolean {
  // Boolean
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  // Quoted string
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  // Number
  const num = Number(raw);
  if (!isNaN(num) && raw.trim() !== '') return num;
  // Default: string
  return raw;
}

// ─── Main Parser ─────────────────────────────────────────────────────────────

/**
 * Parse a .nv-world.md string into a ParsedWorld.
 *
 * Returns the parsed world and a list of issues.
 * Callers should check issues for severity === 'error' before proceeding.
 */
export function parseWorldMarkdown(
  markdown: string,
): { world: ParsedWorld | null; issues: ParseIssue[] } {
  const issues: ParseIssue[] = [];

  const { frontmatter: fmRaw, sections } = splitSections(markdown);

  // Parse frontmatter
  const frontmatter = parseFrontmatter(fmRaw, issues);

  // Find sections by name (case-insensitive)
  const findSection = (name: string) =>
    sections.find(s => s.name.toLowerCase() === name.toLowerCase());

  // Parse each block
  const thesisSection = findSection('Thesis');
  const thesis = thesisSection
    ? parseThesis(thesisSection.content, thesisSection.startLine, issues)
    : '';
  if (!thesisSection) {
    issues.push({ line: 0, section: 'Thesis', message: 'Missing # Thesis section', severity: 'error' });
  }

  const invariantsSection = findSection('Invariants');
  const invariants = invariantsSection
    ? parseInvariants(invariantsSection.content, invariantsSection.startLine, issues)
    : [];
  if (!invariantsSection) {
    issues.push({ line: 0, section: 'Invariants', message: 'Missing # Invariants section', severity: 'error' });
  }

  const stateSection = findSection('State');
  const stateVariables = stateSection
    ? parseStateVariables(stateSection.content, stateSection.startLine, issues)
    : [];
  if (!stateSection) {
    issues.push({ line: 0, section: 'State', message: 'Missing # State section', severity: 'warning' });
  }

  const assumptionsSection = findSection('Assumptions');
  const assumptions = assumptionsSection
    ? parseAssumptions(assumptionsSection.content, assumptionsSection.startLine, issues)
    : [];
  if (!assumptionsSection) {
    issues.push({ line: 0, section: 'Assumptions', message: 'Missing # Assumptions section', severity: 'warning' });
  }

  const rulesSection = findSection('Rules');
  const rules = rulesSection
    ? parseRules(rulesSection.content, rulesSection.startLine, issues)
    : [];
  if (!rulesSection) {
    issues.push({ line: 0, section: 'Rules', message: 'Missing # Rules section', severity: 'warning' });
  }

  const gatesSection = findSection('Gates');
  const gates = gatesSection
    ? parseGates(gatesSection.content, gatesSection.startLine, issues)
    : [];
  if (!gatesSection) {
    issues.push({ line: 0, section: 'Gates', message: 'Missing # Gates section', severity: 'warning' });
  }

  const outcomesSection = findSection('Outcomes');
  const outcomes = outcomesSection
    ? parseOutcomes(outcomesSection.content, outcomesSection.startLine, issues)
    : [];

  // Report parsed sections
  const parsedSections = sections.map(s => s.name);

  // Check for unrecognized sections
  const knownSections = new Set(['thesis', 'invariants', 'state', 'assumptions', 'rules', 'gates', 'outcomes']);
  for (const section of sections) {
    if (!knownSections.has(section.name.toLowerCase())) {
      issues.push({
        line: section.startLine,
        section: section.name,
        message: `Unrecognized section "${section.name}" — will be ignored`,
        severity: 'info',
      });
    }
  }

  // If there are fatal errors in frontmatter, bail
  const hasErrors = issues.some(i => i.severity === 'error');
  if (!frontmatter.world_id || !thesis) {
    if (hasErrors) {
      return { world: null, issues };
    }
  }

  return {
    world: {
      frontmatter,
      thesis,
      invariants,
      stateVariables,
      assumptions,
      rules,
      gates,
      outcomes,
    },
    issues,
  };
}
