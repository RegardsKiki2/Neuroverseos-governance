#!/usr/bin/env node
/**
 * NeuroVerse API Server
 *
 * Thin HTTP wrapper over the real guard engine.
 * NO governance logic lives here. This server:
 *   1. Accepts HTTP requests
 *   2. Converts them to the engine's types
 *   3. Calls evaluateGuard() — the SAME function as `neuroverse guard`
 *   4. Returns the verdict
 *
 * The CLI is the bible. This server is just a network interface to it.
 *
 * Endpoints:
 *   POST /api/v1/evaluate        — Evaluate a single action against policy
 *   POST /api/evaluate           — Same (connector compat)
 *   POST /api/v1/policy          — Set active governance policy (writes temp world)
 *   GET  /api/v1/policy          — Get active governance policy
 *   GET  /api/v1/events          — SSE stream of governance events
 *   POST /api/v1/simulate        — Launch governed simulation
 *   POST /api/v1/simulate/stop   — Stop running simulation
 *   GET  /api/v1/simulate/source — View simulation source code
 *   POST /api/v1/reason          — Run governed reasoning on a scenario
 *   POST /api/v1/reason/capsule  — Create a shareable scenario capsule
 *   GET  /api/v1/reason/health   — Engine health check
 *   GET  /api/v1/reason/presets  — List preset scenario templates
 *
 * Usage:
 *   npx tsx demo/server/index.ts
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  handleReasonRequest,
  handleCreateCapsule,
  handleHealthCheck,
  handleListPresets,
} from "../../src/engine/api";
import { govern, writeTempWorld, createGovernor } from "../../src/runtime/govern";
import { loadWorld } from "../../src/loader/world-loader";
import type { AgentAction } from "../../src/runtime/types";
import type { WorldDefinition } from "../../src/types";

const PORT = parseInt(process.env.NV_PORT ?? "3456", 10);

// ============================================
// TEMP WORLD DIRECTORY — the runtime sandbox
// ============================================
// Policy rules are written here as kernel.json.
// All evaluation goes through loadWorld() → evaluateGuard().
// ONE engine. ONE path. NO interpretation.

const TEMP_WORLD_DIR = join(tmpdir(), "neuroverse-demo");

// ============================================
// ACTIVE POLICY STORE
// ============================================

let activePolicy = "";
let policyUpdatedAt: string | null = null;
let activeWorld: WorldDefinition | null = null;
let activeSimulation: ChildProcess | null = null;

/**
 * Write current policy to temp world dir and reload.
 * This is the ONLY place rules become a world.
 */
async function syncPolicyToWorld(): Promise<void> {
  if (!activePolicy) {
    activeWorld = null;
    return;
  }
  const lines = activePolicy.split("\n").filter(l => l.trim().length > 0);
  await writeTempWorld(TEMP_WORLD_DIR, lines);
  activeWorld = await loadWorld(TEMP_WORLD_DIR);
}

// ============================================
// SSE EVENT BROADCASTING
// ============================================

const sseClients = new Set<ServerResponse>();
let eventCounter = 0;

function broadcastEvent(event: Record<string, unknown>) {
  const id = ++eventCounter;
  const data = JSON.stringify({ id, timestamp: new Date().toISOString(), ...event });
  const message = `id: ${id}\ndata: ${data}\n\n`;

  for (const client of sseClients) {
    try {
      client.write(message);
    } catch {
      sseClients.delete(client);
    }
  }
}

// ============================================
// CORS HEADERS
// ============================================

function setCors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// ============================================
// REQUEST BODY PARSER
// ============================================

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

// ============================================
// NORMALIZE ACTION — accept both formats
// ============================================

/**
 * Accept either:
 *   { action: AgentAction }                — full format (UI)
 *   { actor, action, payload, world }      — connector format (Python bridge)
 */
function normalizeAction(body: Record<string, any>): AgentAction | { error: string } {
  // Full format: action is an AgentAction object
  if (body.action && typeof body.action === "object" && body.action.agentId) {
    return body.action as AgentAction;
  }

  // Connector format: actor + action strings
  if (body.actor || (body.action && typeof body.action === "string")) {
    const agentId = body.actor ?? "unknown";
    const actionType = typeof body.action === "string" ? body.action : "unknown";
    const payload = body.payload ?? {};
    const description = payload.description ?? `${agentId}: ${actionType}`;
    const confidence = payload.confidence ?? 0.5;

    return {
      agentId,
      type: actionType,
      description,
      magnitude: confidence,
      context: {
        ...payload,
        world: body.world,
        source: "connector",
      },
    };
  }

  return { error: "Invalid request format. Send either { action: AgentAction } or { actor, action, payload }." };
}

// ============================================
// ROUTE HANDLER
// ============================================

const server = createServer(async (req, res) => {
  setCors(res);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url ?? "/";

  try {
    // GET /api/v1/events — SSE stream
    if (url === "/api/v1/events" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });

      const connectMsg = `data: ${JSON.stringify({ type: "connected", activePolicy: activePolicy.length > 0, eventCount: eventCounter })}\n\n`;
      res.write(connectMsg);

      sseClients.add(res);
      req.on("close", () => { sseClients.delete(res); });

      const keepAlive = setInterval(() => {
        try { res.write(": keepalive\n\n"); } catch { clearInterval(keepAlive); }
      }, 15000);
      req.on("close", () => clearInterval(keepAlive));
      return;
    }

    res.setHeader("Content-Type", "application/json");

    // POST /api/v1/policy — Set active governance policy
    // Writes rules to temp world dir → loads through real engine
    if (url === "/api/v1/policy" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const text = body.policyText ?? body.policy ?? body.text;

      if (!text || typeof text !== "string") {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "policyText is required" }));
        return;
      }

      activePolicy = text;
      policyUpdatedAt = new Date().toISOString();

      // Write to temp world and reload — this is the bridge
      await syncPolicyToWorld();

      broadcastEvent({
        type: "policy_updated",
        policyText: activePolicy,
        updatedAt: policyUpdatedAt,
      });

      res.writeHead(200);
      res.end(JSON.stringify({
        status: "ok",
        policyText: activePolicy,
        updatedAt: policyUpdatedAt,
      }));
      return;
    }

    // GET /api/v1/policy — Get active governance policy
    if (url === "/api/v1/policy" && req.method === "GET") {
      res.writeHead(200);
      res.end(JSON.stringify({
        policyText: activePolicy,
        active: activePolicy.length > 0,
        updatedAt: policyUpdatedAt,
      }));
      return;
    }

    // POST /api/v1/reason
    if (url === "/api/v1/reason" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const result = await handleReasonRequest(body);
      const status = "error" in result && result.status === "error" ? 400 : 200;
      res.writeHead(status);
      res.end(JSON.stringify(result));
      return;
    }

    // POST /api/v1/reason/capsule
    if (url === "/api/v1/reason/capsule" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const result = handleCreateCapsule(body);
      res.writeHead(200);
      res.end(JSON.stringify(result));
      return;
    }

    // GET /api/v1/reason/health
    if (url === "/api/v1/reason/health" && req.method === "GET") {
      const result = handleHealthCheck();
      res.writeHead(200);
      res.end(JSON.stringify(result));
      return;
    }

    // GET /api/v1/reason/presets
    if (url === "/api/v1/reason/presets" && req.method === "GET") {
      const result = await handleListPresets(join(process.cwd(), "policies"));
      res.writeHead(200);
      res.end(JSON.stringify(result));
      return;
    }

    // POST /api/v1/evaluate OR /api/evaluate — Governance evaluation
    // Uses the REAL guard engine. Same evaluateGuard() as `neuroverse guard`.
    if ((url === "/api/v1/evaluate" || url === "/api/evaluate") && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const action = normalizeAction(body);

      if ("error" in action) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: action.error }));
        return;
      }

      if (!activeWorld) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "No governance rules set. POST /api/v1/policy first." }));
        return;
      }

      // THE BRIDGE: AgentAction → govern() → evaluateGuard() → GuardVerdict
      const verdict = govern(action, activeWorld);

      // Broadcast to SSE clients — using the real GuardVerdict shape
      broadcastEvent({
        type: "evaluation",
        action,
        verdict: {
          status: verdict.status,
          reason: verdict.reason,
          ruleId: verdict.ruleId,
          consequence: verdict.consequence,
          reward: verdict.reward,
        },
      });

      // Return full verdict (same shape as `neuroverse guard` output)
      res.writeHead(200);
      res.end(JSON.stringify(verdict));
      return;
    }

    // POST /api/v1/simulate — Launch a governed simulation
    if (url === "/api/v1/simulate" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const agents = body.agents ?? 50;
      const steps = body.steps ?? 20;
      const scenario = body.scenario ?? "social-media";
      const llmApiKey = body.llmApiKey;
      const llmBaseUrl = body.llmBaseUrl;
      const llmModel = body.llmModel;
      const policyText = body.policyText ?? activePolicy;

      // Set policy before running
      if (policyText && policyText !== activePolicy) {
        activePolicy = policyText;
        policyUpdatedAt = new Date().toISOString();
        await syncPolicyToWorld();
        broadcastEvent({ type: "policy_updated", policyText: activePolicy, updatedAt: policyUpdatedAt });
      }

      if (!activeWorld) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "No governance rules set. Define rules first." }));
        return;
      }

      // Kill any running simulation
      if (activeSimulation) {
        try { activeSimulation.kill(); } catch { /* already dead */ }
        activeSimulation = null;
      }

      // Look for simulation script in examples/ (reorganized) or demo/ (legacy)
      const { existsSync } = await import("node:fs");
      const scriptCandidates = [
        join(process.cwd(), "examples", "social-media-sim", "simulation.py"),
        join(process.cwd(), "demo", "simulations", "social_simulation.py"),
      ];
      const scriptPath = scriptCandidates.find(p => existsSync(p));

      if (!scriptPath) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: "Simulation script not found" }));
        return;
      }

      const args = [scriptPath, "--agents", String(agents), "--steps", String(steps)];

      if (llmApiKey) {
        args.push("--llm-api-key", llmApiKey);
        if (llmBaseUrl) args.push("--llm-base-url", llmBaseUrl);
        if (llmModel) args.push("--llm-model", llmModel);
      }

      broadcastEvent({
        type: "simulation_start",
        agents,
        steps,
        scenario,
        mode: llmApiKey ? "llm" : "rule-based",
      });

      const proc = spawn("python3", args, {
        cwd: process.cwd(),
        env: { ...process.env },
      });
      activeSimulation = proc;

      // Stream stdout lines — each line is a simulation event
      let buffer = "";
      proc.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            broadcastEvent({ type: "simulation_event", ...event });
          } catch { /* not JSON, ignore */ }
        }
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        const msg = chunk.toString().trim();
        if (msg) console.error(`[SIM] ${msg}`);
      });

      proc.on("close", (code) => {
        activeSimulation = null;
        broadcastEvent({ type: "simulation_complete", exitCode: code });
      });

      res.writeHead(200);
      res.end(JSON.stringify({ status: "started", agents, steps, scenario }));
      return;
    }

    // POST /api/v1/simulate/stop — Stop a running simulation
    if (url === "/api/v1/simulate/stop" && req.method === "POST") {
      if (activeSimulation) {
        activeSimulation.kill();
        activeSimulation = null;
        broadcastEvent({ type: "simulation_stopped" });
        res.writeHead(200);
        res.end(JSON.stringify({ status: "stopped" }));
      } else {
        res.writeHead(200);
        res.end(JSON.stringify({ status: "no_simulation_running" }));
      }
      return;
    }

    // GET /api/v1/simulate/source — Return simulation source code for display
    if (url === "/api/v1/simulate/source" && req.method === "GET") {
      try {
        const { readFileSync } = await import("node:fs");
        const { existsSync } = await import("node:fs");

        // Try reorganized path first, then legacy
        const candidates = [
          { sim: "examples/social-media-sim/simulation.py", bridge: "examples/social-media-sim/bridge.py" },
          { sim: "demo/simulations/social_simulation.py", bridge: "demo/simulations/neuroverse_bridge.py" },
        ];

        let files: Array<{ name: string; path: string; content: string; language: string }> = [];
        for (const c of candidates) {
          const simPath = join(process.cwd(), c.sim);
          const bridgePath = join(process.cwd(), c.bridge);
          if (existsSync(simPath)) {
            files.push({ name: "simulation.py", path: c.sim, content: readFileSync(simPath, "utf-8"), language: "python" });
            if (existsSync(bridgePath)) {
              files.push({ name: "bridge.py", path: c.bridge, content: readFileSync(bridgePath, "utf-8"), language: "python" });
            }
            break;
          }
        }

        res.writeHead(200);
        res.end(JSON.stringify({ files }));
      } catch {
        res.writeHead(500);
        res.end(JSON.stringify({ error: "Could not read source files" }));
      }
      return;
    }

    // 404
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (err) {
    console.error("Server error:", err);
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
});

server.listen(PORT, () => {
  console.log(`\n  NeuroVerse API Server`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`\n  Engine: @neuroverseos/governance (evaluateGuard)`);
  console.log(`  Temp world: ${TEMP_WORLD_DIR}`);
  console.log(`\n  Endpoints:`);
  console.log(`    POST /api/v1/evaluate        — Governance evaluation (real engine)`);
  console.log(`    POST /api/v1/policy          — Set rules → writes temp world → evaluateGuard()`);
  console.log(`    GET  /api/v1/policy          — Get active governance rules`);
  console.log(`    GET  /api/v1/events          — SSE stream (live governance feed)`);
  console.log(`    POST /api/v1/simulate        — Launch governed simulation`);
  console.log(`    POST /api/v1/simulate/stop   — Stop running simulation`);
  console.log(`    GET  /api/v1/simulate/source — View simulation source code`);
  console.log(`    POST /api/v1/reason          — Governed reasoning`);
  console.log(`    GET  /api/v1/reason/health   — Health check`);
  console.log(`    GET  /api/v1/reason/presets  — Scenario presets`);
  console.log(`\n  ONE engine. ONE path. CLI is the bible.\n`);
});
