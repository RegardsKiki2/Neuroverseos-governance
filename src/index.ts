/**
 * NeuroVerse Governance — CLI Governance Engine
 *
 * Deterministic evaluation of events against world definitions.
 * Powers: neuroverse guard, neuroverse validate, neuroverse bootstrap
 *
 * Architecture:
 *   contracts/  — Type definitions (input/output schemas)
 *   engine/     — Pure evaluation functions (no side effects)
 *   cli/        — Thin stdin/stdout/exit-code wrappers
 */

// ─── Guard Engine ────────────────────────────────────────────────────────────

export { evaluateGuard, eventToAllowlistKey } from './engine/guard-engine';

export type {
  GuardEvent,
  GuardVerdict,
  GuardStatus,
  GuardEngineOptions,
  VerdictEvidence,
  EvaluationTrace,
  InvariantCheck,
  SafetyCheck,
  RoleCheck,
  GuardCheck,
  KernelRuleCheck,
  LevelCheck,
  PrecedenceResolution,
  GuardExitCode,
} from './contracts/guard-contract';

export { GUARD_EXIT_CODES } from './contracts/guard-contract';

// ─── Condition Engine ───────────────────────────────────────────────────────

export { evaluateCondition } from './engine/condition-engine';

export type {
  Condition,
  ConditionOperator,
  ConditionResult,
} from './engine/condition-engine';

// ─── Validate Engine ─────────────────────────────────────────────────────────

export { validateWorld } from './engine/validate-engine';

export type {
  ValidateReport,
  ValidateFinding,
  ValidateSummary,
  FindingSeverity,
  FindingCategory,
  ValidateExitCode,
} from './contracts/validate-contract';

export { VALIDATE_EXIT_CODES } from './contracts/validate-contract';

// ─── Bootstrap Engine ────────────────────────────────────────────────────────

export { parseWorldMarkdown } from './engine/bootstrap-parser';
export { emitWorldDefinition } from './engine/bootstrap-emitter';

export type {
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
  BootstrapResult,
  BootstrapExitCode,
} from './contracts/bootstrap-contract';

export { BOOTSTRAP_EXIT_CODES } from './contracts/bootstrap-contract';

// ─── Derive Engine ──────────────────────────────────────────────────────────

export { deriveWorld, extractWorldMarkdown } from './engine/derive-engine';
export { normalizeWorldMarkdown } from './engine/derive-normalizer';

export type {
  DeriveResult,
  DeriveFinding,
  DeriveExitCode,
  CollectedSource,
  AIProviderConfig,
  AIProvider,
} from './contracts/derive-contract';

export { DERIVE_EXIT_CODES, CONFIGURE_AI_EXIT_CODES } from './contracts/derive-contract';
