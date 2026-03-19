/**
 * Guard Engine — Deterministic Governance Evaluator
 *
 * Pure function: (event, world, options) → verdict
 *
 * Evaluates a GuardEvent against a loaded WorldDefinition and produces
 * a GuardVerdict with evidence and optional evaluation trace.
 *
 * Evaluation chain (first-match-wins on BLOCK/PAUSE):
 *   1.   Safety checks (prompt injection, scope escape)    → PAUSE
 *   1.5  Plan enforcement (task scope)                     → BLOCK/PAUSE
 *   2.   Role-specific rules (cannotDo, requiresApproval)  → BLOCK/PAUSE
 *   3.   Declarative guards (guards.json)                  → BLOCK/PAUSE/WARN
 *   4.   Kernel rules (kernel.json forbidden patterns)     → BLOCK
 *   5.   Level constraints (basic/standard/strict)         → PAUSE
 *   6.   Default                                           → ALLOW
 *
 * Invariant checks run unconditionally and are recorded in evidence
 * but do not produce verdicts — they measure world health.
 *
 * INVARIANTS:
 *   - Deterministic: same event + same world → same verdict.
 *   - Zero network calls. Zero LLM calls. Zero async.
 *   - Every check is recorded in the trace, not just the decider.
 *   - No hidden logic. Everything is in the world file or declared here.
 */

import type { WorldDefinition, Guard, GuardsConfig, Invariant } from '../types';
import type { KernelConfig } from '../types';
import type { WorldRoleDefinition, RolesConfig } from '../types';
import { evaluateCondition } from './condition-engine';
import type { Condition } from './condition-engine';
import type {
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
  Consequence,
  Reward,
  IntentRecord,
  AgentBehaviorState,
} from '../contracts/guard-contract';
import type { PlanCheck } from '../contracts/plan-contract';
import { evaluatePlan, buildPlanCheck } from './plan-engine';
import { normalizeEventText, matchesAllKeywords } from './text-utils';

// ─── Safety Patterns ─────────────────────────────────────────────────────────

// ─── Prompt Injection Patterns ───────────────────────────────────────────────
// Consolidated from Thinking Space (injection-patterns.ts) + Action Space
// (GovernanceEngine.ts). Covers: instruction override, identity manipulation,
// context reset, constraint bypass, prompt extraction, known jailbreaks.

const PROMPT_INJECTION_PATTERNS: { pattern: RegExp; label: string }[] = [
  // Instruction override
  { pattern: /ignore\s+(previous|all|prior|above)\s+(instructions?|rules?)/i, label: 'ignore-instructions' },
  { pattern: /disregard\s+(your|the)\s+(rules|constraints)/i, label: 'disregard-rules' },
  { pattern: /new\s+instructions?:/i, label: 'new-instructions' },
  // Identity manipulation
  { pattern: /you\s+are\s+now/i, label: 'identity-override' },
  { pattern: /new\s+persona/i, label: 'new-persona' },
  { pattern: /act\s+as\s+if/i, label: 'act-as-if' },
  { pattern: /pretend\s+(you|to\s+be|you\s+are\s+unrestricted)/i, label: 'pretend-to-be' },
  // Context reset
  { pattern: /forget\s+(everything|all|your)/i, label: 'forget-context' },
  { pattern: /system\s*:\s*override/i, label: 'system-override' },
  // Constraint bypass
  { pattern: /override\s+(your|the)\s+(programming|constraints)/i, label: 'override-constraints' },
  { pattern: /bypass\s+(your|the)\s+(filters|constraints|rules)/i, label: 'bypass-filters' },
  // Prompt extraction
  { pattern: /system\s+prompt/i, label: 'system-prompt-probe' },
  { pattern: /reveal\s+your\s+(instructions?|prompt|rules)/i, label: 'reveal-instructions' },
  // Known jailbreak terms
  { pattern: /jailbreak/i, label: 'jailbreak' },
  { pattern: /DAN\s+mode/i, label: 'dan-mode' },
  { pattern: /developer\s+mode/i, label: 'developer-mode' },
];

// ─── Execution Claim Patterns (direction='output') ──────────────────────────
// Detects AI responses that falsely claim to have performed actions.
// Only checked when direction === 'output'.

const EXECUTION_CLAIM_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /I have (executed|completed|performed|done|made|created|sent|deleted|modified|updated)/i, label: 'claim-i-have' },
  { pattern: /Successfully (created|deleted|modified|updated|sent|executed|performed)/i, label: 'claim-successfully' },
  { pattern: /The file has been/i, label: 'claim-file-modified' },
  { pattern: /I've made the changes/i, label: 'claim-made-changes' },
  { pattern: /I('ve| have) (sent|posted|submitted|uploaded|downloaded)/i, label: 'claim-sent' },
  { pattern: /Your (email|message|file|request) has been (sent|submitted)/i, label: 'claim-your-sent' },
  { pattern: /Transaction complete/i, label: 'claim-transaction' },
  { pattern: /Order placed/i, label: 'claim-order' },
  { pattern: /Payment processed/i, label: 'claim-payment' },
];

// ─── Execution Intent Patterns (direction='input') ──────────────────────────
// Detects user requests for execution in thinking-only environments.
// Only checked when direction === 'input'.

const EXECUTION_INTENT_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /^(execute|run|perform|do this)/i, label: 'intent-execute' },
  { pattern: /^(create|write|delete|modify) (a |the )?(file|folder|document)/i, label: 'intent-file-ops' },
  { pattern: /^(send|post|submit) (a |an |the )?(email|message|tweet|post)/i, label: 'intent-send' },
  { pattern: /^(search|look up|browse) (the )?web/i, label: 'intent-web-search' },
  { pattern: /^(make|call|invoke) (a |an )?(api|http|rest) (call|request)/i, label: 'intent-api-call' },
  { pattern: /^(buy|purchase|order|pay|transfer|send money)/i, label: 'intent-financial' },
  { pattern: /^(book|schedule|reserve)/i, label: 'intent-booking' },
  { pattern: /^(download|upload|save to|export to)/i, label: 'intent-transfer' },
];

const SCOPE_ESCAPE_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\.\.\//, label: 'parent-traversal' },
  { pattern: /^\/(?!home|project|workspace)/i, label: 'absolute-path-outside-safe' },
  { pattern: /~\//, label: 'home-directory' },
  { pattern: /\/etc\//i, label: 'system-config' },
  { pattern: /\/usr\//i, label: 'system-binaries' },
  { pattern: /\/var\//i, label: 'system-variable-data' },
];

// ─── Neutral Messages ────────────────────────────────────────────────────────

const NEUTRAL_MESSAGES: Record<string, string> = {
  'prompt-injection': 'This input contains patterns that could alter agent behavior.',
  'scope-escape': 'This action would affect resources outside the declared scope.',
  'execution-claim': 'This response claims to have performed an action.',
  'execution-intent': 'This input requests execution in a thinking-only environment.',
  'delete': 'This action would remove files. Confirmation needed.',
  'write-external': 'This action would write outside the project folder.',
  'network-mutate': 'This action would send data to an external service.',
  'credential-access': 'This action would access stored credentials.',
};

// ─── Level Constraint Logic ──────────────────────────────────────────────────

function levelRequiresConfirmation(
  level: string,
  actionType: 'delete' | 'write-external' | 'network-mutate' | 'credential-access',
): boolean {
  if (level === 'strict') return true;
  if (level === 'standard') {
    return actionType === 'delete' || actionType === 'credential-access';
  }
  return false;
}

function isExternalScope(scope: string): boolean {
  const internalPatterns = [
    /^\.?\/?src\//i,
    /^\.?\/?lib\//i,
    /^\.?\/?app\//i,
    /^\.?\/?components\//i,
    /^\.?\/?pages\//i,
    /^\.?\/?public\//i,
    /^\.?\/?assets\//i,
    /^\.\//,
  ];
  return !internalPatterns.some(p => p.test(scope));
}

// ─── Core Engine ─────────────────────────────────────────────────────────────

/**
 * Evaluate a guard event against a world definition.
 *
 * This is the entire guard engine. One function. Deterministic.
 * No class instantiation, no state, no side effects.
 */
export function evaluateGuard(
  event: GuardEvent,
  world: WorldDefinition,
  options: GuardEngineOptions = {},
): GuardVerdict {
  const startTime = performance.now();
  const level = options.level ?? 'standard';
  const includeTrace = options.trace ?? false;

  // Normalize event text for matching
  const eventText = normalizeEventText(event);

  // ─── Build trace collectors ──────────────────────────────────────────
  const invariantChecks: InvariantCheck[] = [];
  const safetyChecks: SafetyCheck[] = [];
  let planCheckResult: PlanCheck | undefined;
  const roleChecks: RoleCheck[] = [];
  const guardChecks: GuardCheck[] = [];
  const kernelRuleChecks: KernelRuleCheck[] = [];
  const levelChecks: LevelCheck[] = [];

  // Track the deciding check
  let decidingLayer: PrecedenceResolution['decidingLayer'] = 'default-allow';
  let decidingId: string | undefined;

  // Track evidence
  const guardsMatched: string[] = [];
  const rulesMatched: string[] = [];

  // ─── Phase 0: Invariant coverage (world health, not verdict) ─────────
  checkInvariantCoverage(world, invariantChecks);

  // ─── Phase 0.25: Agent cooldown check ───────────────────────────────
  // Penalized agents in cooldown are blocked before any other evaluation.
  if (event.roleId && options.agentStates) {
    const agentState = options.agentStates.get(event.roleId);
    if (agentState && agentState.cooldownRemaining > 0) {
      decidingLayer = 'safety';
      decidingId = `penalize-cooldown-${event.roleId}`;
      const verdict = buildVerdict(
        'PENALIZE',
        `Agent "${event.roleId}" is frozen for ${agentState.cooldownRemaining} more round(s) due to prior penalty.`,
        `penalize-cooldown-${event.roleId}`,
        undefined,
        world, level, invariantChecks, guardsMatched, rulesMatched,
        includeTrace ? buildTrace(
          invariantChecks, safetyChecks, planCheckResult, roleChecks, guardChecks,
          kernelRuleChecks, levelChecks, decidingLayer, decidingId, startTime,
        ) : undefined,
      );
      verdict.intentRecord = {
        originalIntent: event.intent,
        finalAction: 'blocked (agent frozen)',
        enforcement: 'PENALIZE',
        consequence: { type: 'freeze', rounds: agentState.cooldownRemaining, description: 'Agent still in cooldown from prior penalty' },
      };
      return verdict;
    }
  }

  // ─── Phase 0.5: Session allowlist ─────────────────────────────────────
  if (options.sessionAllowlist) {
    const key = eventToAllowlistKey(event);
    if (options.sessionAllowlist.has(key)) {
      decidingLayer = 'session-allowlist';
      decidingId = `allowlist:${key}`;
      return buildVerdict(
        'ALLOW',
        undefined,
        `allowlist:${key}`,
        undefined,
        world, level, invariantChecks, guardsMatched, rulesMatched,
        includeTrace ? buildTrace(
          invariantChecks, safetyChecks, planCheckResult, roleChecks, guardChecks,
          kernelRuleChecks, levelChecks, decidingLayer, decidingId, startTime,
        ) : undefined,
      );
    }
  }

  // ─── Phase 1: Safety checks ──────────────────────────────────────────
  const safetyVerdict = checkSafety(event, eventText, safetyChecks);
  if (safetyVerdict) {
    decidingLayer = 'safety';
    decidingId = safetyVerdict.ruleId;
    return buildVerdict(
      safetyVerdict.status,
      safetyVerdict.reason,
      safetyVerdict.ruleId,
      undefined,
      world, level, invariantChecks, guardsMatched, rulesMatched,
      includeTrace ? buildTrace(
        invariantChecks, safetyChecks, planCheckResult, roleChecks, guardChecks,
        kernelRuleChecks, levelChecks, decidingLayer, decidingId, startTime,
      ) : undefined,
    );
  }

  // ─── Phase 1.5: Plan enforcement ────────────────────────────────────
  if (options.plan) {
    const planVerdict = evaluatePlan(event, options.plan);
    planCheckResult = buildPlanCheck(event, options.plan, planVerdict);

    if (!planVerdict.allowed && planVerdict.status !== 'PLAN_COMPLETE') {
      decidingLayer = 'plan-enforcement';
      decidingId = `plan-${options.plan.plan_id}`;

      const planStatus = planVerdict.status === 'CONSTRAINT_VIOLATED' ? 'PAUSE' : 'BLOCK';
      let reason = planVerdict.reason ?? 'Action blocked by plan.';

      // Include closest step info for OFF_PLAN
      if (planVerdict.status === 'OFF_PLAN' && planVerdict.closestStep) {
        reason += ` Closest step: "${planVerdict.closestStep}" (similarity: ${(planVerdict.similarityScore ?? 0).toFixed(2)})`;
      }

      return buildVerdict(
        planStatus as GuardStatus,
        reason,
        `plan-${options.plan.plan_id}`,
        undefined,
        world, level, invariantChecks, guardsMatched, rulesMatched,
        includeTrace ? buildTrace(
          invariantChecks, safetyChecks, planCheckResult, roleChecks, guardChecks,
          kernelRuleChecks, levelChecks, decidingLayer, decidingId, startTime,
        ) : undefined,
      );
    }
  }

  // ─── Phase 2: Role rules ─────────────────────────────────────────────
  const roleVerdict = checkRoleRules(event, eventText, world, roleChecks);
  if (roleVerdict) {
    decidingLayer = 'role';
    decidingId = roleVerdict.ruleId;
    return buildVerdict(
      roleVerdict.status,
      roleVerdict.reason,
      roleVerdict.ruleId,
      undefined,
      world, level, invariantChecks, guardsMatched, rulesMatched,
      includeTrace ? buildTrace(
        invariantChecks, safetyChecks, planCheckResult, roleChecks, guardChecks,
        kernelRuleChecks, levelChecks, decidingLayer, decidingId, startTime,
      ) : undefined,
    );
  }

  // ─── Phase 3: Declarative guards ────────────────────────────────────
  const guardVerdict = checkGuards(event, eventText, world, guardChecks, guardsMatched);
  if (guardVerdict) {
    // WARN guards produce ALLOW with warning — they don't stop the chain
    if (guardVerdict.status !== 'ALLOW') {
      decidingLayer = 'guard';
      decidingId = guardVerdict.ruleId;

      // Build intent record for behavioral enforcement types
      const intentRecord: IntentRecord = {
        originalIntent: event.intent,
        finalAction: guardVerdict.status === 'MODIFY' ? (guardVerdict.modifiedTo ?? 'modified') :
                     guardVerdict.status === 'PENALIZE' ? 'blocked + penalized' :
                     guardVerdict.status === 'REWARD' ? event.intent :
                     guardVerdict.status === 'NEUTRAL' ? event.intent :
                     guardVerdict.status === 'BLOCK' ? 'blocked' : 'paused',
        ruleApplied: guardVerdict.ruleId,
        enforcement: guardVerdict.status,
        modifiedTo: guardVerdict.modifiedTo,
        consequence: guardVerdict.consequence,
        reward: guardVerdict.reward,
      };

      const verdict = buildVerdict(
        guardVerdict.status,
        guardVerdict.reason,
        guardVerdict.ruleId,
        undefined,
        world, level, invariantChecks, guardsMatched, rulesMatched,
        includeTrace ? buildTrace(
          invariantChecks, safetyChecks, planCheckResult, roleChecks, guardChecks,
          kernelRuleChecks, levelChecks, decidingLayer, decidingId, startTime,
        ) : undefined,
      );

      // Attach behavioral enforcement data
      verdict.intentRecord = intentRecord;
      if (guardVerdict.consequence) verdict.consequence = guardVerdict.consequence;
      if (guardVerdict.reward) verdict.reward = guardVerdict.reward;

      return verdict;
    }
    // ALLOW with warning — continue chain but remember the warning
  }

  // ─── Phase 4: Kernel rules ──────────────────────────────────────────
  const kernelVerdict = checkKernelRules(eventText, world, kernelRuleChecks, rulesMatched);
  if (kernelVerdict) {
    decidingLayer = 'kernel-rule';
    decidingId = kernelVerdict.ruleId;
    return buildVerdict(
      kernelVerdict.status,
      kernelVerdict.reason,
      kernelVerdict.ruleId,
      undefined,
      world, level, invariantChecks, guardsMatched, rulesMatched,
      includeTrace ? buildTrace(
        invariantChecks, safetyChecks, planCheckResult, roleChecks, guardChecks,
        kernelRuleChecks, levelChecks, decidingLayer, decidingId, startTime,
      ) : undefined,
    );
  }

  // ─── Phase 5: Level constraints ─────────────────────────────────────
  const levelVerdict = checkLevelConstraints(event, level, levelChecks);
  if (levelVerdict) {
    decidingLayer = 'level-constraint';
    decidingId = levelVerdict.ruleId;
    return buildVerdict(
      levelVerdict.status,
      levelVerdict.reason,
      levelVerdict.ruleId,
      undefined,
      world, level, invariantChecks, guardsMatched, rulesMatched,
      includeTrace ? buildTrace(
        invariantChecks, safetyChecks, planCheckResult, roleChecks, guardChecks,
        kernelRuleChecks, levelChecks, decidingLayer, decidingId, startTime,
      ) : undefined,
    );
  }

  // ─── Phase 6: Default ALLOW ─────────────────────────────────────────
  // Attach any warn-mode guard warning to the ALLOW verdict
  const warning = guardVerdict?.warning;

  return buildVerdict(
    'ALLOW',
    undefined,
    undefined,
    warning,
    world, level, invariantChecks, guardsMatched, rulesMatched,
    includeTrace ? buildTrace(
      invariantChecks, safetyChecks, planCheckResult, roleChecks, guardChecks,
      kernelRuleChecks, levelChecks, decidingLayer, decidingId, startTime,
    ) : undefined,
  );
}

// ─── Phase Implementations ─────────────────────────────────────────────────

/**
 * Phase 0: Check invariant coverage.
 * Records whether each world invariant has a backing structural guard.
 * This is a health metric, not a verdict producer.
 */
function checkInvariantCoverage(
  world: WorldDefinition,
  checks: InvariantCheck[],
): void {
  const invariants = world.invariants ?? [];
  const guards = world.guards?.guards ?? [];

  for (const invariant of invariants) {
    const coveringGuard = guards.find(
      g => g.invariant_ref === invariant.id && g.immutable,
    );
    checks.push({
      invariantId: invariant.id,
      label: invariant.label,
      hasGuardCoverage: !!coveringGuard,
      coveringGuardId: coveringGuard?.id,
    });
  }
}

/**
 * Phase 1: Safety checks — prompt injection and scope escape.
 * These run at all enforcement levels.
 */
function checkSafety(
  event: GuardEvent,
  eventText: string,
  checks: SafetyCheck[],
): { status: GuardStatus; reason: string; ruleId: string } | null {
  // Check prompt injection
  const textToCheck = event.intent + (event.payload ? JSON.stringify(event.payload) : '');

  for (const { pattern, label } of PROMPT_INJECTION_PATTERNS) {
    const triggered = pattern.test(textToCheck);
    checks.push({
      checkType: 'prompt-injection',
      triggered,
      matchedPattern: triggered ? label : undefined,
    });
    if (triggered) {
      // Still check remaining patterns for trace completeness
      for (const remaining of PROMPT_INJECTION_PATTERNS.filter(p => p.label !== label)) {
        checks.push({
          checkType: 'prompt-injection',
          triggered: remaining.pattern.test(textToCheck),
          matchedPattern: remaining.pattern.test(textToCheck) ? remaining.label : undefined,
        });
      }
      return {
        status: 'PAUSE',
        reason: NEUTRAL_MESSAGES['prompt-injection'],
        ruleId: `safety-injection-${label}`,
      };
    }
  }

  // Check scope escape
  const scopeToCheck = event.scope ?? event.intent;
  for (const { pattern, label } of SCOPE_ESCAPE_PATTERNS) {
    const triggered = pattern.test(scopeToCheck);
    checks.push({
      checkType: 'scope-escape',
      triggered,
      matchedPattern: triggered ? label : undefined,
    });
    if (triggered) {
      for (const remaining of SCOPE_ESCAPE_PATTERNS.filter(p => p.label !== label)) {
        checks.push({
          checkType: 'scope-escape',
          triggered: remaining.pattern.test(scopeToCheck),
          matchedPattern: remaining.pattern.test(scopeToCheck) ? remaining.label : undefined,
        });
      }
      return {
        status: 'PAUSE',
        reason: NEUTRAL_MESSAGES['scope-escape'],
        ruleId: `safety-scope-${label}`,
      };
    }
  }

  // Check execution claims (only when direction === 'output')
  if (event.direction === 'output') {
    for (const { pattern, label } of EXECUTION_CLAIM_PATTERNS) {
      const triggered = pattern.test(textToCheck);
      checks.push({
        checkType: 'execution-claim',
        triggered,
        matchedPattern: triggered ? label : undefined,
      });
      if (triggered) {
        for (const remaining of EXECUTION_CLAIM_PATTERNS.filter(p => p.label !== label)) {
          checks.push({
            checkType: 'execution-claim',
            triggered: remaining.pattern.test(textToCheck),
            matchedPattern: remaining.pattern.test(textToCheck) ? remaining.label : undefined,
          });
        }
        return {
          status: 'PAUSE',
          reason: NEUTRAL_MESSAGES['execution-claim'],
          ruleId: `safety-execution-claim-${label}`,
        };
      }
    }
  }

  // Check execution intent (only when direction === 'input')
  if (event.direction === 'input') {
    const intentTrimmed = event.intent.trim();
    for (const { pattern, label } of EXECUTION_INTENT_PATTERNS) {
      const triggered = pattern.test(intentTrimmed);
      checks.push({
        checkType: 'execution-intent',
        triggered,
        matchedPattern: triggered ? label : undefined,
      });
      if (triggered) {
        for (const remaining of EXECUTION_INTENT_PATTERNS.filter(p => p.label !== label)) {
          checks.push({
            checkType: 'execution-intent',
            triggered: remaining.pattern.test(intentTrimmed),
            matchedPattern: remaining.pattern.test(intentTrimmed) ? remaining.label : undefined,
          });
        }
        return {
          status: 'PAUSE',
          reason: NEUTRAL_MESSAGES['execution-intent'],
          ruleId: `safety-execution-intent-${label}`,
        };
      }
    }
  }

  return null;
}

/**
 * Phase 2: Role-specific rules.
 * Checks cannotDo rules and requiresApproval on the event's role.
 */
function checkRoleRules(
  event: GuardEvent,
  eventText: string,
  world: WorldDefinition,
  checks: RoleCheck[],
): { status: GuardStatus; reason: string; ruleId: string } | null {
  if (!event.roleId || !world.roles) return null;

  const role = world.roles.roles.find(r => r.id === event.roleId);
  if (!role) return null;

  // Check requiresApproval
  if (role.requiresApproval) {
    checks.push({
      roleId: role.id,
      roleName: role.name,
      rule: 'All actions require approval',
      ruleType: 'requiresApproval',
      matched: true,
    });
    return {
      status: 'PAUSE',
      reason: `Role "${role.name}" requires approval for all actions.`,
      ruleId: `role-${role.id}-requires-approval`,
    };
  }

  // Check cannotDo rules
  for (const rule of role.cannotDo) {
    const matched = matchesKeywords(eventText, rule);
    checks.push({
      roleId: role.id,
      roleName: role.name,
      rule,
      ruleType: 'cannotDo',
      matched,
    });
    if (matched) {
      return {
        status: 'BLOCK',
        reason: `Role "${role.name}" cannot: ${rule}`,
        ruleId: `role-${role.id}-cannotdo`,
      };
    }
  }

  // Record canDo rules too (for trace completeness)
  for (const rule of role.canDo) {
    checks.push({
      roleId: role.id,
      roleName: role.name,
      rule,
      ruleType: 'canDo',
      matched: matchesKeywords(eventText, rule),
    });
  }

  return null;
}

/**
 * Phase 3: Declarative guards from guards.json.
 * Evaluates event against enabled guards' intent patterns.
 */
function checkGuards(
  event: GuardEvent,
  eventText: string,
  world: WorldDefinition,
  checks: GuardCheck[],
  guardsMatched: string[],
): { status: GuardStatus; reason?: string; ruleId?: string; warning?: string; consequence?: Consequence; reward?: Reward; modifiedTo?: string } | null {
  if (!world.guards) return null;

  const guardsConfig = world.guards;
  let warnResult: { status: 'ALLOW'; warning: string; ruleId: string } | null = null;

  // Compile intent patterns
  const compiledPatterns = new Map<string, RegExp>();
  for (const [key, def] of Object.entries(guardsConfig.intent_vocabulary)) {
    try {
      compiledPatterns.set(key, new RegExp(def.pattern, 'i'));
    } catch {
      // Invalid pattern — skip
    }
  }

  const eventTool = (event.tool ?? '').toLowerCase();

  for (const guard of guardsConfig.guards) {
    // appliesTo[] filter — skip guard entirely if tool doesn't match.
    // This is a scope filter, not a condition. No trace entry for skipped guards.
    if (guard.appliesTo && guard.appliesTo.length > 0) {
      const normalizedAppliesTo = guard.appliesTo.map(t => t.toLowerCase());
      if (!normalizedAppliesTo.includes(eventTool)) {
        continue;
      }
    }

    // Determine enabled state
    // Structural/immutable guards are always enabled
    // Operational guards respect default_enabled
    const enabled = guard.immutable || guard.default_enabled !== false;

    // Check which patterns match
    const matchedPatterns: string[] = [];
    for (const patternKey of guard.intent_patterns) {
      const regex = compiledPatterns.get(patternKey);
      if (regex?.test(eventText)) {
        matchedPatterns.push(patternKey);
      }
    }

    // Also check conditions from intent patterns using the condition engine
    // If guard has structured conditions (future), evaluate them here
    const matched = matchedPatterns.length > 0 && enabled;

    // Check role gating
    let roleGated = false;
    if (
      matched &&
      guard.required_roles &&
      guard.required_roles.length > 0 &&
      event.roleId &&
      guard.required_roles.includes(event.roleId)
    ) {
      roleGated = true;
    }

    checks.push({
      guardId: guard.id,
      label: guard.label,
      category: guard.category,
      enabled,
      matched: matched && !roleGated,
      enforcement: guard.enforcement,
      matchedPatterns,
      roleGated,
    });

    if (!matched || roleGated) continue;

    guardsMatched.push(guard.id);

    // Determine enforcement action
    const actionMode = guard.player_modes?.action ?? guard.enforcement;
    const reason = guard.redirect
      ? `${guard.description} — ${guard.redirect}`
      : guard.description;

    if (actionMode === 'block') {
      return { status: 'BLOCK', reason, ruleId: `guard-${guard.id}` };
    }
    if (actionMode === 'pause') {
      return { status: 'PAUSE', reason, ruleId: `guard-${guard.id}` };
    }
    if (actionMode === 'penalize') {
      const consequence: Consequence = guard.consequence
        ? { ...guard.consequence }
        : { type: 'freeze', rounds: 1, description: `Penalized for violating: ${guard.label}` };
      return { status: 'PENALIZE', reason, ruleId: `guard-${guard.id}`, consequence };
    }
    if (actionMode === 'reward') {
      const reward: Reward = guard.reward
        ? { ...guard.reward }
        : { type: 'boost_influence', magnitude: 0.1, description: `Rewarded for: ${guard.label}` };
      return { status: 'REWARD', reason, ruleId: `guard-${guard.id}`, reward };
    }
    if (actionMode === 'modify') {
      const modifiedTo = guard.modify_to ?? guard.redirect ?? 'hold';
      return { status: 'MODIFY', reason: `${reason} → Modified to: ${modifiedTo}`, ruleId: `guard-${guard.id}`, modifiedTo };
    }
    if (actionMode === 'neutral') {
      return { status: 'NEUTRAL', reason, ruleId: `guard-${guard.id}` };
    }
    if (actionMode === 'warn' && !warnResult) {
      // Capture first warning, continue checking for BLOCK/PAUSE
      warnResult = { status: 'ALLOW', warning: reason, ruleId: `guard-${guard.id}` };
    }
  }

  return warnResult;
}

/**
 * Phase 4: Kernel rules from kernel.json.
 * Checks forbidden patterns against the event text.
 */
function checkKernelRules(
  eventText: string,
  world: WorldDefinition,
  checks: KernelRuleCheck[],
  rulesMatched: string[],
): { status: GuardStatus; reason: string; ruleId: string } | null {
  if (!world.kernel) return null;

  const forbidden = world.kernel.input_boundaries?.forbidden_patterns ?? [];
  const output = world.kernel.output_boundaries?.forbidden_patterns ?? [];

  // Check input forbidden patterns
  for (const rule of forbidden) {
    let matched = false;
    let matchMethod: 'pattern' | 'keyword' | 'none' = 'none';

    if (rule.pattern) {
      try {
        matched = new RegExp(rule.pattern, 'i').test(eventText);
        matchMethod = 'pattern';
      } catch {
        // Invalid pattern — try keyword fallback
      }
    }

    if (!matched && rule.reason) {
      matched = matchesKeywords(eventText, rule.reason);
      if (matched) matchMethod = 'keyword';
    }

    checks.push({
      ruleId: rule.id,
      text: rule.reason,
      category: 'forbidden',
      matched,
      matchMethod,
    });

    if (matched) {
      rulesMatched.push(rule.id);
      if (rule.action === 'BLOCK') {
        return {
          status: 'BLOCK',
          reason: rule.reason,
          ruleId: `kernel-${rule.id}`,
        };
      }
      // WARN kernel rules don't stop the chain
    }
  }

  return null;
}

/**
 * Phase 5: Level constraints.
 * Enforces basic/standard/strict level policies.
 */
function checkLevelConstraints(
  event: GuardEvent,
  level: string,
  checks: LevelCheck[],
): { status: GuardStatus; reason: string; ruleId: string } | null {
  if (level === 'basic') return null;

  const intent = event.intent.toLowerCase();
  const tool = (event.tool ?? '').toLowerCase();

  // Delete operations
  const isDelete = intent.includes('delete') || intent.includes('remove') || intent.includes('rm ') || tool === 'delete';
  const deleteTriggered = isDelete && levelRequiresConfirmation(level, 'delete');
  checks.push({
    checkType: 'delete',
    level,
    triggered: deleteTriggered,
    reason: deleteTriggered ? NEUTRAL_MESSAGES['delete'] : undefined,
  });
  if (deleteTriggered) {
    return { status: 'PAUSE', reason: NEUTRAL_MESSAGES['delete'], ruleId: 'level-delete-check' };
  }

  // External writes
  const isExternal = event.scope ? isExternalScope(event.scope) : false;
  const externalTriggered = isExternal && levelRequiresConfirmation(level, 'write-external');
  checks.push({
    checkType: 'write-external',
    level,
    triggered: externalTriggered,
    reason: externalTriggered ? NEUTRAL_MESSAGES['write-external'] : undefined,
  });
  if (externalTriggered) {
    return { status: 'PAUSE', reason: NEUTRAL_MESSAGES['write-external'], ruleId: 'level-external-write-check' };
  }

  // Network mutations
  const isNetwork = tool === 'http' || tool === 'fetch' || tool === 'request' ||
    intent.includes('post ') || intent.includes('sending');
  const networkTriggered = isNetwork && levelRequiresConfirmation(level, 'network-mutate');
  checks.push({
    checkType: 'network-mutate',
    level,
    triggered: networkTriggered,
    reason: networkTriggered ? NEUTRAL_MESSAGES['network-mutate'] : undefined,
  });
  if (networkTriggered) {
    return { status: 'PAUSE', reason: NEUTRAL_MESSAGES['network-mutate'], ruleId: 'level-network-mutate-check' };
  }

  // Credential access
  const isCredential = intent.includes('credential') || intent.includes('password') ||
    intent.includes('secret') || intent.includes('api key') || intent.includes('token');
  const credentialTriggered = isCredential && levelRequiresConfirmation(level, 'credential-access');
  checks.push({
    checkType: 'credential-access',
    level,
    triggered: credentialTriggered,
    reason: credentialTriggered ? NEUTRAL_MESSAGES['credential-access'] : undefined,
  });
  if (credentialTriggered) {
    return { status: 'PAUSE', reason: NEUTRAL_MESSAGES['credential-access'], ruleId: 'level-credential-check' };
  }

  // Irreversible hint
  const irreversibleTriggered = !!event.irreversible && level !== 'basic';
  checks.push({
    checkType: 'irreversible',
    level,
    triggered: irreversibleTriggered,
    reason: irreversibleTriggered ? 'This action is marked as irreversible.' : undefined,
  });
  if (irreversibleTriggered) {
    return {
      status: 'PAUSE',
      reason: 'This action is marked as irreversible.',
      ruleId: 'level-irreversible-check',
    };
  }

  return null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Keyword matching: ALL significant keywords (>3 chars) must be present.
 * Delegates to shared text-utils.
 */
function matchesKeywords(eventText: string, ruleText: string): boolean {
  return matchesAllKeywords(eventText, ruleText);
}

/**
 * Build a normalized allowlist key from a GuardEvent.
 *
 * Format: `tool::intent` (both lowercased, intent trimmed).
 * Tool defaults to '*' when absent.
 *
 * Callers use this to:
 *   1. Add keys to the allowlist set (on user "allow-always" decision)
 *   2. The engine uses it to check membership before evaluation
 *
 * The key is opaque — callers should always use this function
 * rather than constructing keys manually.
 */
export function eventToAllowlistKey(event: GuardEvent): string {
  return `${(event.tool ?? '*').toLowerCase()}::${event.intent.toLowerCase().trim()}`;
}

/**
 * Build the evaluation trace.
 */
function buildTrace(
  invariantChecks: InvariantCheck[],
  safetyChecks: SafetyCheck[],
  planCheck: PlanCheck | undefined,
  roleChecks: RoleCheck[],
  guardChecks: GuardCheck[],
  kernelRuleChecks: KernelRuleCheck[],
  levelChecks: LevelCheck[],
  decidingLayer: PrecedenceResolution['decidingLayer'],
  decidingId: string | undefined,
  startTime: number,
): EvaluationTrace {
  const trace: EvaluationTrace = {
    invariantChecks,
    safetyChecks,
    roleChecks,
    guardChecks,
    kernelRuleChecks,
    levelChecks,
    precedenceResolution: {
      decidingLayer,
      decidingId,
      strategy: 'first-match-wins',
      chainOrder: [
        'invariant-coverage',
        'session-allowlist',
        'safety-injection',
        'safety-scope-escape',
        'safety-execution-claim',
        'safety-execution-intent',
        'plan-enforcement',
        'role-rules',
        'declarative-guards',
        'kernel-rules',
        'level-constraints',
        'default-allow',
      ],
    },
    durationMs: performance.now() - startTime,
  };

  if (planCheck) {
    trace.planCheck = planCheck;
  }

  return trace;
}

/**
 * Build the verdict with evidence.
 */
function buildVerdict(
  status: GuardStatus,
  reason: string | undefined,
  ruleId: string | undefined,
  warning: string | undefined,
  world: WorldDefinition,
  level: string,
  invariantChecks: InvariantCheck[],
  guardsMatched: string[],
  rulesMatched: string[],
  trace: EvaluationTrace | undefined,
): GuardVerdict {
  const evidence: VerdictEvidence = {
    worldId: world.world.world_id,
    worldName: world.world.name,
    worldVersion: world.world.version,
    evaluatedAt: Date.now(),
    invariantsSatisfied: invariantChecks.filter(c => c.hasGuardCoverage).length,
    invariantsTotal: invariantChecks.length,
    guardsMatched,
    rulesMatched,
    enforcementLevel: level,
  };

  const verdict: GuardVerdict = {
    status,
    evidence,
  };

  if (reason) verdict.reason = reason;
  if (ruleId) verdict.ruleId = ruleId;
  if (warning) verdict.warning = warning;
  if (trace) verdict.trace = trace;

  return verdict;
}
