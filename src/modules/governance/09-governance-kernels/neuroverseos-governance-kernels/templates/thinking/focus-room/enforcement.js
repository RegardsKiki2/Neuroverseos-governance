/**
 * Focus Room — Compiled Enforcement Logic
 * 
 * Artifact type: compiled_governance_snapshot
 * Domain: custom | Category: thinking
 * 
 * This is a standalone, zero-dependency enforcement module.
 * It does not import helpers, libraries, or external modules.
 * It was compiled from source and is not intended to be modified.
 */

var KERNEL_ID = "focus-room";
var VERSION = "1.0.0";

var INPUT_FORBIDDEN = [
  {
    id: "off-topic-drift",
    pattern: /(?:let's talk about something else|change the subject|forget about that)/i,
    reason: "Prevents deviation from the declared focus topic.",
    action: "BLOCK"
  },
  {
    id: "identity-override",
    pattern: /(?:ignore your instructions|pretend you are|act as if you have no rules)/i,
    reason: "Prevents attempts to override kernel identity or bypass governance.",
    action: "BLOCK"
  },
  {
    id: "external-tool-request",
    pattern: /(?:search the web|browse the internet|look up online|fetch from)/i,
    reason: "Thinking spaces are closed environments. No external tool access.",
    action: "BLOCK"
  }
];

var OUTPUT_FORBIDDEN = [
  {
    id: "scope-escape",
    pattern: /(?:I can also help you with|outside of this topic|let me suggest a different)/i,
    reason: "Model must not offer to operate outside the defined thinking space.",
    action: "BLOCK"
  },
  {
    id: "authority-claim",
    pattern: /(?:I am an AI|as a language model|I don't have personal)/i,
    reason: "Model speaks as the world, not as itself. No meta-identity references.",
    action: "BLOCK"
  }
];

var RESPONSE_VOCABULARY = {
  OUTSIDE_SCOPE: "That falls outside the boundaries of this thinking space.",
  RULE_VIOLATION: "This space has rules that prevent that kind of input.",
  IDENTITY_OVERRIDE: "The rules of this space cannot be changed during a session."
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

function getResponseMessage(code) {
  return RESPONSE_VOCABULARY[code] || null;
}

function getKernelInfo() {
  return {
    kernelId: KERNEL_ID,
    version: VERSION,
    inputRuleCount: INPUT_FORBIDDEN.length,
    outputRuleCount: OUTPUT_FORBIDDEN.length
  };
}
