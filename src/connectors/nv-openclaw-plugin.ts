/**
 * nv-openclaw-plugin — NeuroVerse governance plugin for OpenClaw
 *
 * Process-level enforcement for OpenClaw agents.
 * Your AGENTS.md is a suggestion. This makes it a law.
 *
 * How it works:
 *   1. Registers as an OpenClaw Gateway plugin
 *   2. Hooks into before_tool_call events
 *   3. Evaluates every tool call against your governance rules
 *   4. Blocks, modifies, or allows based on verdict
 *   5. Logs all decisions for audit
 *
 * Unlike .md file rules (which the agent can ignore), this plugin
 * enforces at the process boundary — the agent cannot bypass it.
 *
 * Installation:
 *   1. Copy this file to your OpenClaw plugins directory:
 *      cp nv-openclaw-plugin.ts ~/.openclaw/plugins/
 *
 *   2. Or install via npm:
 *      npm i @neuroverseos/openclaw-plugin
 *
 * Configuration (environment variables):
 *   NEUROVERSE_WORLD    — Path to your world.json file (rules)
 *   NEUROVERSE_URL      — Governance API URL (optional, for server mode)
 *   NV_LOG_FILE         — Path to write audit log (default: ./nv-audit.jsonl)
 *   NV_MODE             — "enforce" (default) or "observe" (log only, don't block)
 *   NV_VERBOSE          — Set to "1" for verbose output
 *
 * Usage modes:
 *   A. Standalone (no server needed):
 *      Uses the governance engine directly with your world.json
 *
 *   B. Server mode:
 *      Calls your NeuroVerse server's /api/evaluate endpoint
 *
 * Zero edits to your OpenClaw agent required.
 */

import { readFileSync, appendFileSync, existsSync } from "fs";

// ============================================
// CONFIGURATION
// ============================================

const WORLD_PATH = process.env.NEUROVERSE_WORLD ?? "./world.json";
const NEUROVERSE_URL = process.env.NEUROVERSE_URL ?? "";
const LOG_FILE = process.env.NV_LOG_FILE ?? "./nv-audit.jsonl";
const MODE = (process.env.NV_MODE ?? "enforce") as "enforce" | "observe";
const VERBOSE = process.env.NV_VERBOSE === "1";

// ============================================
// TYPES
// ============================================

interface ToolCall {
  tool_name: string;
  tool_input: Record<string, unknown>;
}

interface PluginContext {
  agent_id: string;
  workspace: string;
  platform?: string;
  skill?: string;
  turn?: number;
}

interface GovernVerdict {
  status: "ALLOW" | "BLOCK" | "MODIFY" | "PENALIZE" | "REWARD";
  reason: string;
  rulesFired: { ruleId: string; description: string }[];
  modifications?: Record<string, unknown>;
}

interface WorldRule {
  type: "explore" | "exclude" | "elevate" | "shape";
  text: string;
}

interface WorldFile {
  rules?: WorldRule[];
  policyText?: string;
}

// ============================================
// RULE LOADING
// ============================================

let cachedRules: string[] | null = null;

function loadRules(): string[] {
  if (cachedRules) return cachedRules;

  if (!existsSync(WORLD_PATH)) {
    log("warn", `No world file found at ${WORLD_PATH} — running in passthrough mode`);
    cachedRules = [];
    return cachedRules;
  }

  try {
    const raw = readFileSync(WORLD_PATH, "utf-8");
    const world: WorldFile = JSON.parse(raw);

    if (world.policyText) {
      cachedRules = world.policyText.split("\n").filter((l: string) => l.trim());
    } else if (world.rules) {
      cachedRules = world.rules.map((r: WorldRule) => r.text);
    } else {
      cachedRules = [];
    }

    log("info", `Loaded ${cachedRules.length} governance rules from ${WORLD_PATH}`);
    return cachedRules;
  } catch (err) {
    log("error", `Failed to load world file: ${err}`);
    cachedRules = [];
    return cachedRules;
  }
}

// ============================================
// LOCAL GOVERNANCE ENGINE (no server needed)
// ============================================

function evaluateLocally(
  toolCall: ToolCall,
  context: PluginContext,
  rules: string[],
): GovernVerdict {
  const firedRules: { ruleId: string; description: string }[] = [];
  let status: GovernVerdict["status"] = "ALLOW";
  let reason = "No rules violated";

  const toolName = toolCall.tool_name.toLowerCase();
  const inputStr = JSON.stringify(toolCall.tool_input).toLowerCase();
  const description = String(toolCall.tool_input.input ?? toolCall.tool_input.description ?? toolCall.tool_input.query ?? "").toLowerCase();
  const confidence = Number(toolCall.tool_input.confidence ?? toolCall.tool_input.risk_score ?? 1);

  for (const rule of rules) {
    const ruleLower = rule.toLowerCase();

    // BLOCK rules
    if (ruleLower.startsWith("block")) {
      const condition = ruleLower.replace(/^block\s+/i, "");

      // "block <tool_name>" — block specific tools
      if (condition === toolName || condition === `tool ${toolName}`) {
        status = "BLOCK";
        reason = `Tool "${toolCall.tool_name}" is blocked by rule`;
        firedRules.push({ ruleId: `block-tool-${toolName}`, description: rule });
        break;
      }

      // "block ... when confidence < X" or "block ... when confidence is below X"
      const confMatch = condition.match(/when\s+confidence\s+(?:is\s+)?(?:below|<|under)\s+([\d.]+)/);
      if (confMatch && confidence < parseFloat(confMatch[1])) {
        status = "BLOCK";
        reason = `Confidence ${confidence} is below threshold ${confMatch[1]}`;
        firedRules.push({ ruleId: "block-low-confidence", description: rule });
        break;
      }

      // "block ... when risk_score > X" or "block ... when risk_score exceeds X"
      const riskMatch = condition.match(/when\s+risk_score\s+(?:exceeds?|>|above)\s+([\d.]+)/);
      if (riskMatch) {
        const riskScore = Number(toolCall.tool_input.risk_score ?? 0);
        if (riskScore > parseFloat(riskMatch[1])) {
          status = "BLOCK";
          reason = `Risk score ${riskScore} exceeds threshold ${riskMatch[1]}`;
          firedRules.push({ ruleId: "block-high-risk", description: rule });
          break;
        }
      }

      // "block ... not in the allowed scope"
      if (condition.includes("not in") && condition.includes("scope")) {
        // Check if tool is in context fields that define scope
        // This is a simplified check — real implementation would use workspace TOOLS.md
        firedRules.push({ ruleId: "scope-check", description: rule });
      }

      // Generic keyword match in description/input
      const keywords = condition.match(/(?:containing|with|that\s+\w+)\s+"([^"]+)"/);
      if (keywords && (description.includes(keywords[1].toLowerCase()) || inputStr.includes(keywords[1].toLowerCase()))) {
        status = "BLOCK";
        reason = `Content matches blocked pattern: "${keywords[1]}"`;
        firedRules.push({ ruleId: "block-keyword", description: rule });
        break;
      }
    }

    // PENALIZE rules
    if (ruleLower.startsWith("penalize")) {
      const condition = ruleLower.replace(/^penalize\s+/i, "");

      if (condition.includes("skip confirmation") && condition.includes("destructive")) {
        const destructiveTools = ["delete", "remove", "drop", "reset", "destroy", "kill"];
        if (destructiveTools.some(t => toolName.includes(t))) {
          if (!toolCall.tool_input.confirmed) {
            status = "PENALIZE";
            reason = `Destructive action "${toolCall.tool_name}" attempted without confirmation`;
            firedRules.push({ ruleId: "penalize-no-confirm", description: rule });
          }
        }
      }
    }

    // HALT rules
    if (ruleLower.startsWith("halt")) {
      const riskMatch = ruleLower.match(/when\s+risk_score\s+(?:exceeds?|>|above)\s+([\d.]+)/);
      if (riskMatch) {
        const riskScore = Number(toolCall.tool_input.risk_score ?? 0);
        if (riskScore > parseFloat(riskMatch[1])) {
          status = "BLOCK";
          reason = `Risk score ${riskScore} exceeds halt threshold ${riskMatch[1]} — execution halted`;
          firedRules.push({ ruleId: "halt-high-risk", description: rule });
          break;
        }
      }
    }

    // REQUIRE rules
    if (ruleLower.startsWith("require")) {
      const condition = ruleLower.replace(/^require\s+/i, "");

      if (condition.includes("validation") && condition.includes("file")) {
        const fileTools = ["write_file", "create_file", "move_file", "delete_file", "edit_file"];
        if (fileTools.some(t => toolName.includes(t))) {
          if (!toolCall.tool_input.validated) {
            status = "BLOCK";
            reason = `File operation "${toolCall.tool_name}" requires validation`;
            firedRules.push({ ruleId: "require-validation", description: rule });
            break;
          }
        }
      }
    }

    // REWARD rules
    if (ruleLower.startsWith("reward")) {
      const condition = ruleLower.replace(/^reward\s+/i, "");

      if (condition.includes("cite sources") || condition.includes("sources in responses")) {
        if (description.includes("source") || description.includes("citation") || description.includes("reference")) {
          if (status === "ALLOW") {
            status = "REWARD";
            reason = "Response includes source citations";
            firedRules.push({ ruleId: "reward-citations", description: rule });
          }
        }
      }
    }
  }

  return { status, reason, rulesFired: firedRules };
}

// ============================================
// SERVER-BASED EVALUATION
// ============================================

async function evaluateViaServer(
  toolCall: ToolCall,
  context: PluginContext,
): Promise<GovernVerdict> {
  const payload = {
    agent_id: context.agent_id,
    type: toolCall.tool_name,
    description: String(toolCall.tool_input.input ?? toolCall.tool_input.description ?? ""),
    confidence: Number(toolCall.tool_input.confidence ?? 1),
    step: context.turn ?? 0,
    platform: context.platform,
    skill: context.skill,
    tool_input: toolCall.tool_input,
  };

  const res = await fetch(`${NEUROVERSE_URL}/api/v1/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    log("error", `Server returned ${res.status} — falling back to ALLOW`);
    return { status: "ALLOW", reason: "Server error — passthrough", rulesFired: [] };
  }

  return (await res.json()) as GovernVerdict;
}

// ============================================
// AUDIT LOGGING
// ============================================

function auditLog(
  toolCall: ToolCall,
  context: PluginContext,
  verdict: GovernVerdict,
): void {
  const entry = {
    timestamp: new Date().toISOString(),
    agent_id: context.agent_id,
    tool: toolCall.tool_name,
    verdict: verdict.status,
    reason: verdict.reason,
    rules_fired: verdict.rulesFired.length,
    mode: MODE,
    platform: context.platform,
  };

  try {
    appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
  } catch {
    // Audit logging should never crash the plugin
  }
}

// ============================================
// LOGGING
// ============================================

function log(level: "info" | "warn" | "error", message: string): void {
  if (level === "info" && !VERBOSE) return;
  const prefix = level === "error" ? "[NV ERROR]" : level === "warn" ? "[NV WARN]" : "[NV]";
  console.error(`${prefix} ${message}`);
}

// ============================================
// OPENCLAW PLUGIN INTERFACE
// ============================================

/**
 * OpenClaw plugin entry point.
 *
 * This exports the hooks that OpenClaw Gateway calls:
 *   - before_tool_call: evaluate and potentially block/modify tool calls
 *   - on_init: load governance rules on startup
 *
 * The plugin enforces at the process boundary. The agent cannot bypass it.
 * This is the fundamental difference from .md file rules.
 */
export default {
  name: "neuroverse-governance",
  version: "1.0.0",
  description: "Process-level governance enforcement for OpenClaw agents. Your AGENTS.md is a suggestion. This makes it a law.",

  /**
   * Called when the plugin loads.
   */
  on_init() {
    const rules = loadRules();
    log("info", `NeuroVerse governance plugin loaded — ${rules.length} rules, mode: ${MODE}`);
    if (MODE === "observe") {
      log("warn", "Running in OBSERVE mode — verdicts are logged but NOT enforced");
    }
  },

  /**
   * Called before every tool call the agent attempts.
   * This is the enforcement point.
   *
   * Return:
   *   - { allow: true } to let the tool call proceed
   *   - { allow: false, reason: "..." } to block it
   *   - { allow: true, modified_input: {...} } to modify it
   */
  async before_tool_call(
    toolCall: ToolCall,
    context: PluginContext,
  ): Promise<{ allow: boolean; reason?: string; modified_input?: Record<string, unknown> }> {
    const rules = loadRules();

    // No rules = passthrough
    if (rules.length === 0) {
      return { allow: true };
    }

    // Evaluate
    let verdict: GovernVerdict;
    if (NEUROVERSE_URL) {
      verdict = await evaluateViaServer(toolCall, context);
    } else {
      verdict = evaluateLocally(toolCall, context, rules);
    }

    // Always log
    auditLog(toolCall, context, verdict);

    // In observe mode, always allow
    if (MODE === "observe") {
      if (verdict.status === "BLOCK" || verdict.status === "PENALIZE") {
        log("info", `[OBSERVE] Would have ${verdict.status}ed ${toolCall.tool_name}: ${verdict.reason}`);
      }
      return { allow: true };
    }

    // Enforce
    switch (verdict.status) {
      case "BLOCK":
        log("info", `BLOCKED ${toolCall.tool_name} from ${context.agent_id}: ${verdict.reason}`);
        return { allow: false, reason: verdict.reason };

      case "MODIFY":
        log("info", `MODIFIED ${toolCall.tool_name} from ${context.agent_id}: ${verdict.reason}`);
        return { allow: true, modified_input: verdict.modifications ?? toolCall.tool_input };

      case "PENALIZE":
        log("info", `PENALIZED ${toolCall.tool_name} from ${context.agent_id}: ${verdict.reason}`);
        // Penalize = allow but log for downstream consequences
        return { allow: true, reason: verdict.reason };

      case "REWARD":
        log("info", `REWARDED ${toolCall.tool_name} from ${context.agent_id}: ${verdict.reason}`);
        return { allow: true };

      case "ALLOW":
      default:
        return { allow: true };
    }
  },

  /**
   * Called after a tool call completes (for logging/tracking).
   */
  after_tool_call(
    toolCall: ToolCall,
    context: PluginContext,
    result: { output: unknown; error?: string },
  ): void {
    if (!VERBOSE) return;
    const status = result.error ? "FAILED" : "OK";
    log("info", `Tool ${toolCall.tool_name} completed: ${status}`);
  },
};
