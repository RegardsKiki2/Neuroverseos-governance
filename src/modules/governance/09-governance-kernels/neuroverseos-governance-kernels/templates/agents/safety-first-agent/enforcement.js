/**
 * Safety-First Agent — Compiled Enforcement Logic
 * 
 * Artifact type: compiled_governance_snapshot
 * Domain: safety | Category: agents
 * Enforcement level: strict
 * 
 * This is a standalone, zero-dependency enforcement module.
 * It does not import helpers, libraries, or external modules.
 * It was compiled from source and is not intended to be modified.
 */

var KERNEL_ID = "safety-first-agent";
var VERSION = "1.0.0";

var INPUT_FORBIDDEN = [
  {
    id: "bypass-approval",
    pattern: /(?:skip approval|don't ask|just do it|no confirmation needed|auto-approve)/i,
    reason: "Human approval for destructive actions cannot be bypassed.",
    action: "BLOCK"
  },
  {
    id: "elevate-permissions",
    pattern: /(?:grant yourself|escalate privileges|override permissions|act as admin)/i,
    reason: "Agents cannot self-elevate beyond their declared authority.",
    action: "BLOCK"
  },
  {
    id: "disable-governance",
    pattern: /(?:turn off safety|disable checks|ignore rules|remove restrictions)/i,
    reason: "Governance cannot be disabled during an active session.",
    action: "BLOCK"
  }
];

var OUTPUT_FORBIDDEN = [
  {
    id: "unauthorized-execution",
    pattern: /(?:I went ahead and|I already completed|done without asking|executed automatically)/i,
    reason: "Agent must not claim to have executed actions without approval.",
    action: "BLOCK"
  },
  {
    id: "authority-overreach",
    pattern: /(?:I have full access|I can do anything|no limitations|unrestricted)/i,
    reason: "Agent must not claim authority beyond its declared scope.",
    action: "BLOCK"
  },
  {
    id: "approval-dismissal",
    pattern: /(?:you don't need to approve|trust me on this|no need to review)/i,
    reason: "Agent must never discourage human oversight.",
    action: "BLOCK"
  }
];

var PAUSE_ACTIONS = [
  {
    id: "destructive-write",
    capabilityClaim: "file-write",
    condition: "always",
    reason: "All file writes require human approval under strict enforcement."
  },
  {
    id: "destructive-delete",
    capabilityClaim: "file-delete",
    condition: "always",
    reason: "All file deletions require human approval under strict enforcement."
  },
  {
    id: "network-post",
    capabilityClaim: "network-post",
    condition: "always",
    reason: "All outbound network requests require human approval under strict enforcement."
  }
];

var RESPONSE_VOCABULARY = {
  OUTSIDE_SCOPE: "That action falls outside the authority granted to this agent.",
  RULE_VIOLATION: "This agent operates under safety-first rules that prevent that action.",
  IDENTITY_OVERRIDE: "Agent governance cannot be modified during an active session.",
  APPROVAL_REQUIRED: "This action requires your explicit approval before it can proceed."
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
