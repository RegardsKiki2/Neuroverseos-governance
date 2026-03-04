/**
 * Validate Contract — CLI World File Static Analysis Types
 *
 * Defines the input/output contract for `neuroverse validate`.
 *
 * WorldDefinition comes in (loaded from .nv-world.zip or directory).
 * ValidateReport goes out (stdout JSON).
 * Exit code encodes health: 0=PASS, 1=FAIL, 2=WARN.
 *
 * The validate engine performs static analysis on world files:
 *   - Completeness: Are all required blocks present and non-empty?
 *   - Referential integrity: Do rules reference declared state variables?
 *   - Guard coverage: Do invariants have backing structural guards?
 *   - Contradiction detection: Do rules conflict with each other?
 *   - Orphan detection: Are there unreachable rules or unused variables?
 *
 * INVARIANTS:
 *   - Deterministic: same world → same report.
 *   - Zero network calls.
 *   - Every finding includes the source block and a human-readable message.
 */

// ─── Finding Types ───────────────────────────────────────────────────────────

export type FindingSeverity = 'error' | 'warning' | 'info';

export type FindingCategory =
  | 'completeness'           // Missing required blocks
  | 'referential-integrity'  // Broken references between blocks
  | 'guard-coverage'         // Invariants without backing guards
  | 'contradiction'          // Rules that conflict
  | 'orphan'                 // Unreachable/unused declarations
  | 'schema-violation'       // Values outside declared ranges
  | 'semantic-tension';      // Logically suspicious but not broken

/**
 * A single finding from static analysis.
 */
export interface ValidateFinding {
  /** Unique ID for this finding type (e.g., "missing-thesis", "orphan-rule-003") */
  id: string;

  /** Human-readable message */
  message: string;

  /** Error, warning, or informational */
  severity: FindingSeverity;

  /** What category of issue this is */
  category: FindingCategory;

  /** Which world file block(s) are affected */
  affectedBlocks: string[];

  /** Specific field or rule ID that triggered this finding */
  source?: string;

  /** Suggested fix (when deterministically derivable) */
  suggestion?: string;
}

// ─── Validate Report (Output) ────────────────────────────────────────────────

/**
 * Summary of world health by category.
 */
export interface ValidateSummary {
  /** Total findings by severity */
  errors: number;
  warnings: number;
  info: number;

  /** Block completeness score (0-100) */
  completenessScore: number;

  /** Invariant coverage percentage (invariants with backing guards) */
  invariantCoverage: number;

  /** Whether the world is valid enough to run */
  canRun: boolean;

  /** Whether the world passes full validation (no errors) */
  isHealthy: boolean;
}

/**
 * The validate report — what goes to stdout.
 *
 * Exit codes:
 *   0 = PASS  (no errors, world is healthy)
 *   1 = FAIL  (errors found, world cannot run safely)
 *   2 = WARN  (warnings found but world can run)
 *   3 = ERROR (invalid input, could not parse world)
 */
export interface ValidateReport {
  /** World identity */
  worldId: string;
  worldName: string;
  worldVersion: string;

  /** When the validation ran */
  validatedAt: number;

  /** Duration of validation */
  durationMs: number;

  /** High-level summary */
  summary: ValidateSummary;

  /** All findings, ordered by severity (errors first) */
  findings: ValidateFinding[];
}

// ─── Exit Codes ──────────────────────────────────────────────────────────────

export const VALIDATE_EXIT_CODES = {
  PASS: 0,
  FAIL: 1,
  WARN: 2,
  ERROR: 3,
} as const;

export type ValidateExitCode = (typeof VALIDATE_EXIT_CODES)[keyof typeof VALIDATE_EXIT_CODES];
