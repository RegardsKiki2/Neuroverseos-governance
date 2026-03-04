/**
 * Bootstrap Contract — Markdown → WorldDefinition Compilation Types
 *
 * Defines the input/output contract for `neuroverse bootstrap`.
 *
 * Input:  .nv-world.md file (structured markdown)
 * Output: WorldDefinition (passed to validate, guard, or compileWorldToZip)
 *
 * The markdown format is:
 *   - YAML frontmatter for world identity and metadata
 *   - H1 sections for each block (Thesis, Invariants, State, etc.)
 *   - Structured sub-sections within each block
 *   - Deterministically parseable — no LLM, no heuristics
 *
 * Exit codes:
 *   0 = SUCCESS  (compiled cleanly)
 *   1 = FAIL     (parse errors, missing required sections)
 *   3 = ERROR    (file not found, invalid input)
 */

// ─── Parse Result ────────────────────────────────────────────────────────────

export type ParseSeverity = 'error' | 'warning' | 'info';

/**
 * A single parse issue found during markdown compilation.
 */
export interface ParseIssue {
  /** Line number in the source markdown (1-based) */
  line: number;

  /** Which section the issue was found in */
  section: string;

  /** Human-readable message */
  message: string;

  /** Severity */
  severity: ParseSeverity;
}

/**
 * The result of parsing a .nv-world.md file.
 */
export interface BootstrapResult {
  /** Whether compilation succeeded (no errors) */
  success: boolean;

  /** Source file path */
  sourcePath: string;

  /** All parse issues */
  issues: ParseIssue[];

  /** Parsed sections (for debugging) */
  parsedSections: string[];

  /** Duration */
  durationMs: number;
}

// ─── Parsed Sections (intermediate representation) ───────────────────────────

/**
 * YAML frontmatter parsed from the markdown header.
 */
export interface ParsedFrontmatter {
  world_id: string;
  name: string;
  version?: string;
  runtime_mode?: string;
  default_profile?: string;
  alternative_profile?: string;
}

/**
 * A parsed invariant from the Invariants section.
 */
export interface ParsedInvariant {
  id: string;
  label: string;
  enforcement: string;
  mutable: boolean;
  line: number;
}

/**
 * A parsed state variable from the State section.
 */
export interface ParsedStateVariable {
  id: string;
  type: 'number' | 'enum' | 'boolean';
  default: string | number | boolean;
  label: string;
  description: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  line: number;
}

/**
 * A parsed assumption profile from the Assumptions section.
 */
export interface ParsedAssumptionProfile {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, string | number | boolean>;
  line: number;
}

/**
 * A parsed trigger from a rule.
 */
export interface ParsedTrigger {
  field: string;
  operator: string;
  value: string | number | boolean;
  source: 'state' | 'assumption';
}

/**
 * A parsed effect from a rule.
 */
export interface ParsedEffect {
  target: string;
  operation: string;
  value: number | boolean | string;
}

/**
 * A parsed rule from the Rules section.
 */
export interface ParsedRule {
  id: string;
  label: string;
  severity: string;
  description?: string;
  order: number;
  triggers: ParsedTrigger[];
  effects: ParsedEffect[];
  collapse_check?: {
    field: string;
    operator: string;
    value: number;
  };
  causal_translation?: {
    trigger_text: string;
    rule_text: string;
    shift_text: string;
    effect_text: string;
  };
  line: number;
}

/**
 * A parsed gate from the Gates section.
 */
export interface ParsedGate {
  status: string;
  field: string;
  operator: string;
  value: number;
  line: number;
}

/**
 * A parsed outcome from the Outcomes section.
 */
export interface ParsedOutcome {
  id: string;
  type: string;
  range?: [number, number];
  display?: string;
  label: string;
  primary?: boolean;
  assignment?: string;
  line: number;
}

/**
 * The full parsed intermediate representation.
 */
export interface ParsedWorld {
  frontmatter: ParsedFrontmatter;
  thesis: string;
  invariants: ParsedInvariant[];
  stateVariables: ParsedStateVariable[];
  assumptions: ParsedAssumptionProfile[];
  rules: ParsedRule[];
  gates: ParsedGate[];
  outcomes: ParsedOutcome[];
}

// ─── Exit Codes ──────────────────────────────────────────────────────────────

export const BOOTSTRAP_EXIT_CODES = {
  SUCCESS: 0,
  FAIL: 1,
  ERROR: 3,
} as const;

export type BootstrapExitCode = (typeof BOOTSTRAP_EXIT_CODES)[keyof typeof BOOTSTRAP_EXIT_CODES];
