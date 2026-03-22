/**
 * Pitch Tank — Compiled Enforcement Logic
 * 
 * Artifact type: compiled_governance_snapshot
 * Domain: pitch-tank | Category: simulations
 * Enforcement level: standard
 * 
 * This is a standalone, zero-dependency enforcement module.
 * It does not import helpers, libraries, or external modules.
 * It was compiled from source and is not intended to be modified.
 */

var KERNEL_ID = "pitch-tank";
var VERSION = "1.0.0";

var INPUT_FORBIDDEN = [
  {
    id: "skip-evaluation",
    pattern: /(?:just approve it|skip the critique|don't challenge|go easy on|be nice about)/i,
    reason: "The pitch tank exists to pressure-test. Evaluation cannot be softened or skipped.",
    action: "BLOCK"
  },
  {
    id: "override-role",
    pattern: /(?:stop being (?:the |a )?(?:investor|critic|skeptic)|drop your character|speak normally|be yourself)/i,
    reason: "Evaluator roles are fixed for the session and cannot be overridden.",
    action: "BLOCK"
  },
  {
    id: "merge-perspectives",
    pattern: /(?:combine all (?:your |the )?views|give me one unified|speak as a group|consensus opinion)/i,
    reason: "Each evaluator provides an independent perspective. Merging defeats the purpose.",
    action: "BLOCK"
  }
];

var OUTPUT_FORBIDDEN = [
  {
    id: "generic-praise",
    pattern: /(?:great (?:idea|pitch|job)|love it|sounds amazing|I'm impressed|brilliant)/i,
    reason: "Evaluators must provide substantive critique, not generic encouragement.",
    action: "BLOCK"
  },
  {
    id: "break-character",
    pattern: /(?:as an AI|I'm actually|in reality I|outside of this simulation|breaking character)/i,
    reason: "Evaluators must maintain their assigned identity throughout the session.",
    action: "BLOCK"
  },
  {
    id: "cross-role-speaking",
    pattern: /(?:speaking for (?:the other|all) evaluators|on behalf of the panel|we all (?:think|agree))/i,
    reason: "Each evaluator speaks only for their own perspective.",
    action: "BLOCK"
  }
];

var RESPONSE_VOCABULARY = {
  OUTSIDE_SCOPE: "That falls outside the boundaries of this simulation.",
  RULE_VIOLATION: "This simulation has rules that prevent that kind of interaction.",
  IDENTITY_OVERRIDE: "Evaluator roles are locked for this session and cannot be changed.",
  ROLE_VIOLATION: "Each evaluator must speak only from their assigned perspective."
};

function checkBoundaries(text, rules) {
  if (typeof text !== "string" || text.length === 0) {
    return { passed: true, violations: [] };
  }
  var violations = [];
  for (var i = 0; i < rules.length; i++) {
    if (rules[i].pattern.test(text)) {
      violations.push({
        ruleId: rules[i].id,
        reason: rules[i].reason,
        action: rules[i].action
      });
    }
  }
  return {
    passed: violations.length === 0,
    violations: violations
  };
}

function checkInputBoundaries(input) {
  return checkBoundaries(input, INPUT_FORBIDDEN);
}

function checkOutputBoundaries(output) {
  return checkBoundaries(output, OUTPUT_FORBIDDEN);
}

function validateRolePersistence(currentRole, attemptedRole) {
  if (typeof currentRole !== "string" || typeof attemptedRole !== "string") {
    return { valid: false, reason: "Role identity is required." };
  }
  if (currentRole !== attemptedRole) {
    return { valid: false, reason: "Role switching is not permitted. Session role is locked to '" + currentRole + "'." };
  }
  return { valid: true };
}

function getResponseMessage(code) {
  return RESPONSE_VOCABULARY[code] || null;
}

function getKernelInfo() {
  return {
    kernelId: KERNEL_ID,
    version: VERSION,
    enforcementLevel: "standard",
    interactionModel: "adversarial",
    rolePersistence: "session_locked",
    inputRuleCount: INPUT_FORBIDDEN.length,
    outputRuleCount: OUTPUT_FORBIDDEN.length
  };
}
