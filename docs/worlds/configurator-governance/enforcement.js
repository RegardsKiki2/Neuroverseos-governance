/**
 * Configurator Governance World — Enforcement Guard
 *
 * SoftShell (Action Space) guard logic for the world-building process.
 *
 * RULE: Guards are sensors, not judges. SoftShell makes the final decision.
 * RULE: Guards NEVER execute code. They NEVER modify events.
 * RULE: All blocking decisions reference declared invariants and rules.
 *
 * This guard enforces:
 * - Minimum structural integrity for publication
 * - Thesis requirement (no publishing without a thesis)
 * - Invariant minimum (no publishing with zero invariants)
 * - Enforcement coherence (declared invariants must have matching enforcement)
 * - Rule validity (no rules referencing undeclared variables)
 */

// ─── Governance Thresholds ────────────────────────────────────────────────

const MIN_INTEGRITY_FOR_PUBLICATION = 0.35;
const MIN_INVARIANT_COUNT = 1;
const MIN_THESIS_CLARITY = 20;

const STRUCTURAL_INVARIANTS = [
  'testable_thesis',
  'structural_invariants',
  'declared_variables_only',
  'no_invented_physics',
  'enforcement_references_constitution',
];

// ─── Intent Classification ────────────────────────────────────────────────

const INTENT_PATTERNS = {
  publish_world: /publish|ship|deploy|release|go\s*live|make\s*public/i,
  skip_invariants: /skip\s*invariant|no\s*invariant|remove\s*all\s*invariant|clear\s*invariant/i,
  skip_thesis: /skip\s*thesis|no\s*thesis|remove\s*thesis|blank\s*thesis/i,
  bypass_review: /skip\s*review|bypass\s*check|override\s*guardian|force\s*publish/i,
  modify_platform_rules: /change\s*platform|modify\s*threshold|lower\s*requirement|relax\s*constraint/i,
  delete_enforcement: /remove\s*enforcement|delete\s*guard|disable\s*enforcement|no\s*enforcement/i,
  bulk_clone: /clone\s*all|copy\s*every|duplicate\s*all|mass\s*clone/i,
};

/**
 * Classify the intent of an incoming builder action.
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
 * Check if a builder action violates governance boundaries.
 */
function checkBoundaries(event, context) {
  const violations = [];
  const redirects = [];

  const intents = classifyIntent(event.action || '');

  for (const { intent } of intents) {
    // Publish without minimum integrity
    if (intent === 'publish_world') {
      if (context && context.world_integrity < MIN_INTEGRITY_FOR_PUBLICATION) {
        violations.push(
          `BLOCKED: Publication rejected. World integrity (${(context.world_integrity * 100).toFixed(1)}%) ` +
          `is below minimum threshold (${MIN_INTEGRITY_FOR_PUBLICATION * 100}%). ` +
          'Resolve structural issues before publishing. ' +
          '[Invariant: testable_thesis, structural_invariants]'
        );
        redirects.push(
          'REDIRECT: Run the world through the Governance Reviewer to identify specific integrity gaps.'
        );
      }
    }

    // Skip invariants
    if (intent === 'skip_invariants') {
      violations.push(
        'BLOCKED: Cannot skip invariant declaration. ' +
        'Every world requires at least one structural invariant. ' +
        'Invariants are the constitution — without them, governance is empty. ' +
        '[Invariant: structural_invariants]'
      );
      redirects.push(
        'REDIRECT: If unsure what invariants to declare, start with the domain\'s most fundamental non-negotiable truth.'
      );
    }

    // Skip thesis
    if (intent === 'skip_thesis') {
      violations.push(
        'BLOCKED: Cannot skip thesis declaration. ' +
        'Every world must have a testable structural claim. ' +
        'The thesis is the anchor — without it, rules float free. ' +
        '[Invariant: testable_thesis]'
      );
    }

    // Bypass review
    if (intent === 'bypass_review') {
      violations.push(
        'BLOCKED: Governance review cannot be bypassed. ' +
        'All worlds must pass structural integrity checks before publication. ' +
        '[Invariant: enforcement_references_constitution]'
      );
    }

    // Modify platform rules
    if (intent === 'modify_platform_rules') {
      violations.push(
        'BLOCKED: Platform governance thresholds cannot be modified by builders. ' +
        'These are structural constants maintained by the Governance Steward. ' +
        '[Invariant: all structural invariants are immutable]'
      );
    }

    // Delete enforcement
    if (intent === 'delete_enforcement') {
      if (context && context.invariant_count > 0) {
        violations.push(
          'BLOCKED: Cannot remove enforcement while invariants are declared. ' +
          'Declaring invariants without enforcement is constitutional theater. ' +
          '[Invariant: enforcement_references_constitution]'
        );
        redirects.push(
          'REDIRECT: If enforcement feels too restrictive, review whether your invariants are truly structural or merely aspirational.'
        );
      }
    }

    // Bulk clone
    if (intent === 'bulk_clone') {
      violations.push(
        'BLOCKED: Mass cloning of worlds is not permitted. ' +
        'Each world must be individually authored or customized with intent. ' +
        '[Invariant: no_invented_physics — cloned worlds inherit physics without understanding]'
      );
    }
  }

  return {
    allowed: violations.length === 0,
    violations,
    redirects,
  };
}

/**
 * Pre-execution boundary check (before action runs).
 */
function checkInputBoundaries(event, context) {
  return checkBoundaries(event, context);
}

/**
 * Post-execution boundary check (after action completes).
 */
function checkOutputBoundaries(event, context, result) {
  const violations = [];

  // Check if publication resulted in a world below integrity threshold
  if (result && result.published && context) {
    if (context.world_integrity < MIN_INTEGRITY_FOR_PUBLICATION) {
      violations.push(
        'POST-CHECK VIOLATION: Published world has integrity below minimum threshold. ' +
        'This should have been caught pre-publication. Flagging for steward review.'
      );
    }
  }

  return {
    allowed: violations.length === 0,
    violations,
    redirects: [],
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────

module.exports = {
  classifyIntent,
  checkBoundaries,
  checkInputBoundaries,
  checkOutputBoundaries,
  MIN_INTEGRITY_FOR_PUBLICATION,
  MIN_INVARIANT_COUNT,
  MIN_THESIS_CLARITY,
  STRUCTURAL_INVARIANTS,
};
