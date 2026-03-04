/**
 * Post Web Business Viability — Enforcement Guard
 *
 * This is the SoftShell (Action Space) guard logic.
 * It runs as a sensor — classifying intent and detecting scope violations.
 *
 * RULE: Guards are sensors, not judges. SoftShell makes the final decision.
 * RULE: Guards NEVER execute code. They NEVER modify events.
 * RULE: All blocking decisions reference declared invariants and rules.
 *
 * This guard enforces the Post Web strategic spine:
 * - Margin protection (no action can breach the floor)
 * - Compliance gates (high-impact changes require review)
 * - Structural invariant enforcement (no bypass of non-negotiables)
 * - Role-appropriate action scoping
 */

// ─── Invariant Boundaries ─────────────────────────────────────────────────

const MARGIN_FLOOR = 0.15; // 15% — below this, structural collapse
const DISCOUNT_CEILING = 0.85; // Max 15% discount from base

const STRUCTURAL_INVARIANTS = [
  'rev_exceeds_cost',
  'agent_optimization',
  'delegation_compression',
  'attention_requires_human',
  'inaccessible_margin_collapses',
];

// ─── Intent Classification ────────────────────────────────────────────────

const INTENT_PATTERNS = {
  pricing_change: /discount|pricing|price\s*change|reduce\s*cost|lower\s*price/i,
  revenue_model_switch: /switch\s*revenue|change\s*model|pivot\s*to|migrate\s*from/i,
  compliance_bypass: /skip\s*review|bypass\s*compliance|override\s*gate|ignore\s*constraint/i,
  margin_override: /set\s*margin|force\s*margin|override\s*margin|margin\s*to\s*0/i,
  structural_modification: /change\s*invariant|modify\s*rule|remove\s*constraint|delete\s*gate/i,
  agent_deployment: /deploy\s*agent|launch\s*agent|activate\s*automation|enable\s*delegation/i,
  data_access: /scrape|dump\s*database|export\s*all|access\s*internal/i,
};

/**
 * Classify the intent of an incoming agent action.
 *
 * @param {string} actionText — The proposed action description
 * @returns {{ intent: string, confidence: number }[]}
 */
function classifyIntent(actionText) {
  const matches = [];
  for (const [intent, pattern] of Object.entries(INTENT_PATTERNS)) {
    if (pattern.test(actionText)) {
      matches.push({ intent, confidence: 0.9 });
    }
  }
  return matches.length > 0 ? matches : [{ intent: 'general', confidence: 0.5 }];
}

// ─── Scope Detection ──────────────────────────────────────────────────────

/**
 * Check if an action violates structural boundaries.
 *
 * @param {object} event — The execution event
 * @param {object} event.action — Action description
 * @param {string} event.roleId — The role attempting the action
 * @param {object} context — Current simulation context
 * @param {number} context.effective_margin — Current effective margin
 * @returns {{ allowed: boolean, violations: string[], redirects: string[] }}
 */
function checkBoundaries(event, context) {
  const violations = [];
  const redirects = [];

  const intents = classifyIntent(event.action || '');

  for (const { intent } of intents) {
    // Compliance bypass — always blocked
    if (intent === 'compliance_bypass') {
      violations.push(
        'BLOCKED: Compliance review cannot be bypassed. ' +
        'All high-impact changes require structured review. ' +
        '[Invariant: rev_exceeds_cost]'
      );
    }

    // Structural modification — always blocked
    if (intent === 'structural_modification') {
      violations.push(
        'BLOCKED: Invariants and structural rules cannot be modified at runtime. ' +
        'These are constitutional constraints, not configuration. ' +
        '[Invariant: all structural invariants are immutable]'
      );
    }

    // Margin override — blocked with explanation
    if (intent === 'margin_override') {
      violations.push(
        'BLOCKED: Direct margin overrides are not permitted. ' +
        'Margin is a computed outcome of business model parameters, not a settable value. ' +
        '[Invariant: rev_exceeds_cost]'
      );
      redirects.push(
        'REDIRECT: To improve margin, adjust revenue_model, automation_level, ' +
        'or outcome_alignment through the declared parameter interface.'
      );
    }

    // Pricing change — check against floor
    if (intent === 'pricing_change') {
      if (context && context.effective_margin < MARGIN_FLOOR) {
        violations.push(
          `BLOCKED: Pricing change rejected. Current margin (${(context.effective_margin * 100).toFixed(1)}%) ` +
          `is already below structural floor (${MARGIN_FLOOR * 100}%). ` +
          'Further discounting would trigger MODEL_COLLAPSES. ' +
          '[Invariant: rev_exceeds_cost, Gate: structural_override]'
        );
      }
    }

    // Data access — blocked for non-steward roles
    if (intent === 'data_access') {
      if (event.roleId !== 'steward') {
        violations.push(
          'BLOCKED: Bulk data access requires steward-level authority. ' +
          'Current role does not have permission. ' +
          '[Role constraint: cannotDo includes data scraping]'
        );
      }
    }

    // Agent deployment — requires strategist or steward
    if (intent === 'agent_deployment') {
      if (event.roleId !== 'strategist' && event.roleId !== 'steward') {
        violations.push(
          'BLOCKED: Agent deployment requires strategist or steward authority. ' +
          '[Role constraint: operator cannot deploy agents without strategic review]'
        );
        redirects.push(
          'REDIRECT: Submit agent deployment proposal to strategist for review.'
        );
      }
    }
  }

  return {
    allowed: violations.length === 0,
    violations,
    redirects,
  };
}

// ─── Input Boundary Check ─────────────────────────────────────────────────

/**
 * Pre-execution check: Does this action request violate declared boundaries?
 */
function checkInputBoundaries(input, context) {
  return checkBoundaries(
    { action: input, roleId: context?.roleId || 'observer' },
    context
  );
}

// ─── Output Boundary Check ────────────────────────────────────────────────

/**
 * Post-execution check: Does this response violate declared boundaries?
 */
function checkOutputBoundaries(output) {
  const violations = [];

  // Check for financial advice in output
  if (/you should invest|buy this stock|guaranteed returns/i.test(output)) {
    violations.push(
      'OUTPUT VIOLATION: Response contains financial advice. ' +
      'This world provides structural analysis, not investment recommendations.'
    );
  }

  // Check for certainty language
  if (/will definitely|guaranteed to happen|certain that/i.test(output)) {
    violations.push(
      'OUTPUT WARNING: Response uses certainty language about future outcomes. ' +
      'Use structural analysis framing instead.'
    );
  }

  return {
    allowed: violations.length === 0,
    violations,
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────

module.exports = {
  classifyIntent,
  checkBoundaries,
  checkInputBoundaries,
  checkOutputBoundaries,
  MARGIN_FLOOR,
  STRUCTURAL_INVARIANTS,
};
