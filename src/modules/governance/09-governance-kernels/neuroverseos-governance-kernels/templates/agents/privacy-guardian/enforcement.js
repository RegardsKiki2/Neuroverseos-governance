/**
 * Privacy Guardian — Compiled Enforcement Logic
 * 
 * Artifact type: compiled_governance_snapshot
 * Domain: privacy | Category: agents
 * Enforcement level: strict
 * 
 * This is a standalone, zero-dependency enforcement module.
 * It does not import helpers, libraries, or external modules.
 * It was compiled from source and is not intended to be modified.
 */

var KERNEL_ID = "privacy-guardian";
var VERSION = "1.0.0";

var INPUT_FORBIDDEN = [
  {
    id: "pii-request",
    pattern: /(?:give me (?:their|the user's|customer's) (?:email|phone|address|ssn|social security|credit card|password))/i,
    reason: "Direct requests for personally identifiable information are forbidden.",
    action: "BLOCK"
  },
  {
    id: "bulk-data-export",
    pattern: /(?:export all (?:user|customer|employee) data|dump the database|extract all records)/i,
    reason: "Bulk data extraction requests are forbidden without explicit authorization.",
    action: "BLOCK"
  },
  {
    id: "disable-privacy",
    pattern: /(?:turn off privacy|disable data protection|ignore privacy rules|skip anonymization)/i,
    reason: "Privacy enforcement cannot be disabled during an active session.",
    action: "BLOCK"
  }
];

var OUTPUT_FORBIDDEN = [
  {
    id: "pii-disclosure",
    pattern: /(?:their email is|their phone number is|their address is|their SSN is|their password is)/i,
    reason: "Agent must not disclose personally identifiable information in responses.",
    action: "BLOCK"
  },
  {
    id: "data-retention-claim",
    pattern: /(?:I(?:'ve| have) stored|I(?:'ve| have) saved|I(?:'ll| will) remember|logged (?:their|your) data)/i,
    reason: "Agent must not claim to retain or store user data.",
    action: "BLOCK"
  },
  {
    id: "privacy-dismissal",
    pattern: /(?:privacy doesn't matter|don't worry about privacy|it's fine to share|no one will notice)/i,
    reason: "Agent must never minimize the importance of data privacy.",
    action: "BLOCK"
  }
];

var PAUSE_ACTIONS = [
  {
    id: "data-read-pii",
    capabilityClaim: "data-read",
    condition: "contains_pii",
    reason: "Reading data that may contain PII requires human approval."
  },
  {
    id: "data-transmit",
    capabilityClaim: "network-post",
    condition: "always",
    reason: "All outbound data transmission requires human approval."
  },
  {
    id: "data-persist",
    capabilityClaim: "file-write",
    condition: "always",
    reason: "All data persistence actions require human approval."
  }
];

var RESPONSE_VOCABULARY = {
  OUTSIDE_SCOPE: "That request involves data outside this agent's authorized scope.",
  RULE_VIOLATION: "This agent operates under privacy-first rules that prevent that action.",
  IDENTITY_OVERRIDE: "Privacy governance cannot be modified during an active session.",
  APPROVAL_REQUIRED: "This action involves sensitive data and requires your explicit approval.",
  PII_BLOCKED: "This agent cannot access or disclose personally identifiable information."
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

function checkExecutionBoundary(capabilityClaim) {
  if (typeof capabilityClaim !== "string") {
    return { action: "BLOCK", reason: "Missing capability claim." };
  }
  for (var i = 0; i < PAUSE_ACTIONS.length; i++) {
    if (PAUSE_ACTIONS[i].capabilityClaim === capabilityClaim) {
      return {
        action: "PAUSE",
        ruleId: PAUSE_ACTIONS[i].id,
        reason: PAUSE_ACTIONS[i].reason
      };
    }
  }
  return { action: "ALLOW" };
}

function getResponseMessage(code) {
  return RESPONSE_VOCABULARY[code] || null;
}

function getKernelInfo() {
  return {
    kernelId: KERNEL_ID,
    version: VERSION,
    enforcementLevel: "strict",
    inputRuleCount: INPUT_FORBIDDEN.length,
    outputRuleCount: OUTPUT_FORBIDDEN.length,
    pauseActionCount: PAUSE_ACTIONS.length
  };
}
