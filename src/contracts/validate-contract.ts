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

// ─── Validation Mode ─────────────────────────────────────────────────────────

/**
 * Controls the strictness of governance validation.
 *
 * - `dev`:      Lenient — governance findings are downgraded to info. Build always succeeds.
 * - `standard`: Recommended default — governance findings are warnings. Build always succeeds.
 * - `strict`:   Compliance — governance findings stay as warnings but are flagged for attention.
 *               Build still succeeds (worlds always work) but the report highlights all gaps.
 *
 * Structural issues (missing blocks, broken references, schema violations) are
 * always reported at their natural severity regardless of mode.
 */
export type ValidationMode = 'dev' | 'standard' | 'strict';

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

  /** Governance health — actionable summary of coverage gaps */
  governanceHealth?: GovernanceHealth;
}

/**
 * Actionable governance health summary.
 * Provides at-a-glance understanding of how well-governed a world is.
 */
export interface GovernanceHealth {
  /** How many declared action surfaces are governed vs total */
  surfacesCovered: number;
  surfacesTotal: number;
  /** Individual surface governance status */
  surfaces: Array<{ name: string; governed: boolean }>;

  /** How many structural invariants are enforced vs total */
  invariantsEnforced: number;
  invariantsTotal: number;

  /** Number of shadowed guards detected */
  shadowedGuards: number;

  /** Number of unenforced invariants */
  unenforcedInvariants: number;

  /** Overall risk level */
  riskLevel: 'low' | 'moderate' | 'high';
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

  /** Validation mode used */
  validationMode: ValidationMode;

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
