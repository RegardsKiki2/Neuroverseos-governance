/**
 * World Engine Types — Subset for Governance Engine
 *
 * These types map to the .nv-world.zip file format.
 * This file contains only the types referenced by the governance
 * engine (guard, validate, bootstrap). The full type system lives
 * in the main NeuroVerse OS repo.
 */

// ─── World Identity (world.json) ───────────────────────────────────────────

export interface ModelIdentity {
  modelName: string;
  acronymExpansion?: string;
  nameType: 'acronym' | 'metaphor';
  purpose: string;
  domain?: string;
}

export interface WorldIdentity {
  world_id: string;
  name: string;
  thesis: string;
  version: string;
  runtime_mode: 'SIMULATION' | 'NARRATIVE' | 'COMPLIANCE' | 'CUSTOM';
  default_assumption_profile: string;
  default_alternative_profile: string;
  modules: string[];
  players: {
    thinking_space: boolean;
    experience_space: boolean;
    action_space: boolean;
  };
  modelIdentity?: ModelIdentity;
}

// ─── Invariants (invariants.json) ──────────────────────────────────────────

export interface Invariant {
  id: string;
  label: string;
  enforcement: 'structural';
  mutable: false;
}

// ─── Assumptions (assumptions.json) ────────────────────────────────────────

export interface AssumptionProfile {
  name: string;
  description: string;
  is_default_baseline?: boolean;
  is_default_alternative?: boolean;
  parameters: Record<string, string>;
}

export interface ParameterDefinition {
  type: 'enum' | 'number' | 'boolean';
  options?: string[];
  min?: number;
  max?: number;
  label: string;
  description: string;
}

export interface AssumptionConfig {
  profiles: Record<string, AssumptionProfile>;
  parameter_definitions: Record<string, ParameterDefinition>;
}

// ─── State Schema (state-schema.json) ──────────────────────────────────────

export interface StateVariable {
  type: 'enum' | 'number' | 'boolean';
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  default: string | number | boolean;
  mutable: boolean;
  label: string;
  description: string;
  display_as?: 'percentage' | 'integer' | 'decimal';
}

export interface StatePreset {
  description: string;
  values: Record<string, string | number | boolean>;
}

export interface StateSchema {
  variables: Record<string, StateVariable>;
  presets: Record<string, StatePreset>;
}

// ─── Rules (rules/*.json) ──────────────────────────────────────────────────

export type TriggerOperator = '==' | '!=' | '>' | '<' | '>=' | '<=' | 'in';
export type EffectOperation =
  | 'multiply' | 'add' | 'subtract' | 'set' | 'set_boolean'
  | 'multiply_dynamic' | 'add_dynamic' | 'subtract_dynamic' | 'set_dynamic';
export type RuleSeverity = 'structural' | 'degradation' | 'advantage';

export interface Trigger {
  field: string;
  operator: TriggerOperator;
  value: string | number | boolean | string[];
  source: 'state' | 'assumption';
}

export interface Effect {
  target: string;
  operation: EffectOperation;
  value: number | boolean | string;
  value_formula?: string;
}

export interface CollapseCheck {
  field: string;
  operator: TriggerOperator;
  value: number;
  result: 'MODEL_COLLAPSES';
}

export interface ConditionalEffect {
  condition: Trigger;
  and?: Trigger;
  or?: Trigger;
  condition_any?: Trigger[];
  effects: Effect[];
}

export interface CausalTranslation {
  trigger_text: string;
  rule_text: string;
  shift_text: string;
  effect_text: string;
}

export interface RuleRedirect {
  suggested_action: string;
  reason: string;
  fallback_state_changes?: Record<string, string | number | boolean>;
}

export interface Rule {
  id: string;
  severity: RuleSeverity;
  label: string;
  description: string;
  order: number;
  triggers: Trigger[];
  effects?: Effect[];
  effects_conditional?: ConditionalEffect[];
  collapse_check?: CollapseCheck;
  secondary_check?: CollapseCheck;
  exclusive_with?: string;
  causal_translation: CausalTranslation;
  redirect?: RuleRedirect;
}

// ─── Gates (gates.json) ────────────────────────────────────────────────────

export type ViabilityStatus =
  | 'THRIVING' | 'STABLE' | 'COMPRESSED' | 'CRITICAL' | 'MODEL_COLLAPSES';

export interface ViabilityGate {
  status: ViabilityStatus;
  field: string;
  operator: TriggerOperator;
  value: number;
  color: string;
  icon: string;
}

export interface CollapseVisual {
  background: string;
  text: string;
  border: string;
  label: string;
}

export interface GatesConfig {
  viability_classification: ViabilityGate[];
  structural_override: {
    description: string;
    enforcement: 'mandatory';
  };
  sustainability_threshold: number;
  collapse_visual: CollapseVisual;
}

// ─── Outcomes (outcomes.json) ──────────────────────────────────────────────

export interface ComputedOutcome {
  id: string;
  type: 'number' | 'boolean' | 'enum';
  range?: [number, number];
  options?: string[];
  default?: number | boolean | string;
  display_as?: 'percentage' | 'integer' | 'decimal';
  label: string;
  primary?: boolean;
  initial_value?: string;
  derived_from?: string;
  show_in_comparison: boolean;
  structural_indicator?: boolean;
}

export interface ComparisonLayout {
  primary_card: string;
  status_badge: string;
  structural_indicators: string[];
}

export interface OutcomesConfig {
  computed_outcomes: ComputedOutcome[];
  comparison_layout: ComparisonLayout;
}

// ─── Metadata (metadata.json) ──────────────────────────────────────────────

export interface WorldMetadata {
  format_version: string;
  created_at: string;
  last_modified: string;
  authoring_method: 'manual-authoring' | 'configurator-ai' | 'migration';
  integrity_hash?: string;
}

// ─── Kernel (kernel.json) ──────────────────────────────────────────────────

export interface KernelConfig {
  artifact_type: string;
  kernel_id: string;
  version: string;
  domain: string;
  enforcement_level: 'standard' | 'strict' | 'permissive';
  input_boundaries: {
    forbidden_patterns: Array<{
      id: string;
      pattern: string;
      reason: string;
      action: 'BLOCK' | 'WARN';
    }>;
  };
  output_boundaries: {
    forbidden_patterns: Array<{
      id: string;
      pattern: string;
      reason: string;
      action: 'BLOCK' | 'WARN';
    }>;
  };
  response_vocabulary: Record<string, string>;
  metadata: {
    compiled_by: string;
    compiled_at: string;
    source_hash: string;
    compiler_version: string;
  };
}

// ─── Roles (roles.json) ────────────────────────────────────────────────────

export type RoleArchetype =
  | 'observer' | 'operator' | 'strategist' | 'guardian' | 'steward' | 'executor';
export type RoleAuthority =
  | 'none' | 'execute_within_limits' | 'reprioritize_within_bounds'
  | 'block_violations' | 'escalate_audit_freeze' | 'execute_declared_actions';
export type RolePosture =
  | 'analyze' | 'task_oriented' | 'long_term_coherence'
  | 'constraint_aware' | 'system_integrity' | 'efficient';

export interface WorldRoleDefinition {
  id: string;
  archetype: RoleArchetype;
  authority: RoleAuthority;
  posture: RolePosture;
  name: string;
  description: string;
  icon?: string;
  roleMandate: string;
  voiceStyle?: string;
  canDo: string[];
  cannotDo: string[];
  requiresApproval?: boolean;
  trackedOutcomes?: string[];
  ownedRules?: string[];
}

export type RoleAssignment = 'dynamic' | 'per_session' | 'permanent';

export interface RoleTransition {
  from: string;
  to: string;
  initiator: 'self' | 'steward' | 'any';
  condition?: string;
}

export interface RolesConfig {
  assignment: RoleAssignment;
  roles: WorldRoleDefinition[];
  transitions?: RoleTransition[];
}

// ─── Guards (guards.json) ──────────────────────────────────────────────────

export interface Guard {
  id: string;
  label: string;
  description: string;
  category: 'structural' | 'operational' | 'advisory';
  enforcement: 'block' | 'pause' | 'warn';
  immutable: boolean;
  invariant_ref?: string;
  intent_patterns: string[];
  required_roles?: string[];
  redirect?: string;
  default_enabled?: boolean;
  /** Tool names this guard applies to (case-insensitive). Empty/absent = all tools. */
  appliesTo?: string[];
  player_modes?: {
    thinking?: 'annotate' | 'block' | 'ignore';
    experience?: 'simulate' | 'score' | 'ignore';
    action?: 'block' | 'pause' | 'warn';
  };
}

export interface IntentPattern {
  label: string;
  pattern: string;
}

export interface GuardsConfig {
  guards: Guard[];
  intent_vocabulary: Record<string, IntentPattern>;
}

// ─── Complete World Definition ─────────────────────────────────────────────

export interface WorldDefinition {
  world: WorldIdentity;
  invariants: Invariant[];
  assumptions: AssumptionConfig;
  stateSchema: StateSchema;
  rules: Rule[];
  gates: GatesConfig;
  outcomes: OutcomesConfig;
  guards?: GuardsConfig;
  roles?: RolesConfig;
  kernel?: KernelConfig;
  enforcement?: string;
  metadata: WorldMetadata;
}
