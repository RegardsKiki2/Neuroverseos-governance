/**
 * NeuroVerse Governance — Portable Runtime Governance for AI
 *
 * Define the rules once. Run them anywhere AI operates.
 *
 * World files are portable governance definitions that can be
 * evaluated by this engine or integrated into any runtime.
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

// ─── Audit Logger ──────────────────────────────────────────────────────────

export {
  createGovernanceEngine,
  verdictToAuditEvent,
  readAuditLog,
  summarizeAuditEvents,
  FileAuditLogger,
  ConsoleAuditLogger,
  CompositeAuditLogger,
} from './engine/audit-logger';

export type {
  AuditEvent,
  AuditSummary,
  AuditLogger,
  GovernanceEngineOptions,
} from './engine/audit-logger';

// ─── World Loader ──────────────────────────────────────────────────────────

export { loadWorld, loadWorldFromDirectory } from './loader/world-loader';

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
export { explainWorld, renderExplainText } from './engine/explain-engine';
export type { ExplainOutput } from './engine/explain-engine';

// ─── Simulate Engine ────────────────────────────────────────────────────────

export { simulateWorld, renderSimulateText } from './engine/simulate-engine';

export type {
  SimulateOptions,
  SimulationResult,
  SimulationStep,
  RuleEvaluation,
  AppliedEffect,
} from './engine/simulate-engine';

// ─── Improve Engine ─────────────────────────────────────────────────────────

export { improveWorld, renderImproveText } from './engine/improve-engine';

export type {
  ImprovementReport,
  Suggestion,
  SuggestionPriority,
  SuggestionCategory,
} from './engine/improve-engine';

export type {
  DeriveResult,
  DeriveFinding,
  DeriveExitCode,
  NormalizationSummary,
  CollectedSource,
  AIProviderConfig,
  AIProvider,
} from './contracts/derive-contract';

export { DERIVE_EXIT_CODES, CONFIGURE_AI_EXIT_CODES } from './contracts/derive-contract';
