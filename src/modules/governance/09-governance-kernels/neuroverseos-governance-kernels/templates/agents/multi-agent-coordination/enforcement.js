/**
 * Multi-Agent Coordination — Compiled Enforcement Logic
 * 
 * Artifact type: compiled_governance_snapshot
 * Domain: coordination | Category: agents
 * Enforcement level: strict
 * 
 * This is a standalone, zero-dependency enforcement module.
 * It does not import helpers, libraries, or external modules.
 * It was compiled from source and is not intended to be modified.
 */

var KERNEL_ID = "multi-agent-coordination";
var VERSION = "1.0.0";

var INPUT_FORBIDDEN = [
  {
    id: "impersonate-agent",
    pattern: /(?:act as (?:the |another )agent|pretend to be|speak for (?:the other|another) agent|assume (?:their|its) role)/i,
    reason: "Agents cannot impersonate or assume the identity of other agents.",
    action: "BLOCK"
  },
  {
    id: "bypass-coordination",
    pattern: /(?:skip the handoff|don't coordinate|ignore the other agents|act independently of)/i,
    reason: "Coordination protocols cannot be bypassed in a multi-agent system.",
    action: "BLOCK"
  },
  {
    id: "override-agent-permissions",
    pattern: /(?:give .+ agent access|grant .+ permission|elevate .+ authority|remove .+ restrictions)/i,
    reason: "Agent permissions are declared at build time and cannot be modified at runtime.",
    action: "BLOCK"
  }
];

var OUTPUT_FORBIDDEN = [
  {
    id: "undeclared-delegation",
    pattern: /(?:I(?:'ve| have) delegated|I asked (?:the other|another) agent to|I instructed .+ to act)/i,
    reason: "Agents cannot delegate tasks without explicit coordination permissions.",
    action: "BLOCK"
  },
  {
    id: "cross-boundary-claim",
    pattern: /(?:I also handled|I took care of .+ as well|I went ahead and .+ for the other)/i,
    reason: "Agents must not claim to have operated outside their declared scope.",
    action: "BLOCK"
  },
  {
    id: "coordination-bypass-claim",
    pattern: /(?:no need to involve|I can handle everything|the other agents? (?:aren't|isn't) needed)/i,
    reason: "Agents must not discourage coordination or claim sole authority.",
    action: "BLOCK"
  }
];

var PAUSE_ACTIONS = [
  {
    id: "inter-agent-action-trigger",
    capabilityClaim: "agent-trigger",
    condition: "always",
    reason: "Triggering actions in another agent requires human approval."
  },
  {
    id: "shared-resource-write",
    capabilityClaim: "shared-write",
    condition: "always",
    reason: "Writing to shared resources requires human approval."
  },
  {
    id: "external-communication",
    capabilityClaim: "network-post",
    condition: "always",
    reason: "All outbound communication requires human approval."
  }
];

var RESPONSE_VOCABULARY = {
  OUTSIDE_SCOPE: "That action falls outside the authority granted to this agent's role.",
  RULE_VIOLATION: "This system enforces coordination rules that prevent that action.",
  IDENTITY_OVERRIDE: "Agent roles and coordination rules cannot be modified during an active session.",
  APPROVAL_REQUIRED: "This cross-agent action requires your explicit approval.",
  ROLE_REQUIRED: "Each agent must declare a valid role before any actions are processed."
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

function checkRoleAdmission(roleId, validRoles) {
  if (typeof roleId !== "string" || roleId.length === 0) {
    return { admitted: false, reason: "No role declared. Agent must call agent.declare with a valid role ID." };
  }
  if (!Array.isArray(validRoles) || validRoles.indexOf(roleId) === -1) {
    return { admitted: false, reason: "Role '" + roleId + "' is not defined in this world bundle." };
  }
  return { admitted: true, roleId: roleId };
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
    pauseActionCount: PAUSE_ACTIONS.length,
    coordinationModel: "explicit_permission_matrix"
  };
}
