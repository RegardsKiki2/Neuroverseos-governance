#!/usr/bin/env node
/**
 * NeuroVerse API Server
 *
 * Lightweight HTTP server that runs the governance engine server-side
 * where @neuroverseos/governance can actually load and enforce rules.
 *
 * The browser UI calls these endpoints instead of importing the engine directly.
 *
 * Endpoints:
 *   POST /api/v1/reason          — Run governed reasoning on a scenario
 *   POST /api/v1/reason/capsule  — Create a shareable scenario capsule
 *   GET  /api/v1/reason/health   — Engine health check
 *   GET  /api/v1/reason/presets  — List preset scenario templates
 *   POST /api/v1/evaluate        — Evaluate a single action against policy
 *   POST /api/v1/policy          — Set active governance policy
 *   GET  /api/v1/policy          — Get active governance policy
 *   GET  /api/v1/events          — SSE stream of governance events
 *
 * Usage:
 *   npx tsx src/server/index.ts
 *   # or after build:
 *   node dist/server/index.js
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import {
  handleReasonRequest,
  handleCreateCapsule,
  handleHealthCheck,
  handleListPresets,
} from "../engine/api";
import { govern, createGovernor } from "../runtime/govern";
import type { AgentAction, WorldState, GovernorConfig } from "../runtime/types";

const PORT = parseInt(process.env.NV_PORT ?? "3456", 10);

// ============================================
// ACTIVE POLICY STORE (in-memory)
// ============================================

let activePolicy = "";
let policyUpdatedAt: string | null = null;
let activeSimulation: ChildProcess | null = null;

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
 *   { action: AgentAction, worldState, policyText }    — full format (UI)
 *   { actor, action, payload, world }                   — connector format (CLI wrapper)
 */
function normalizeEvaluateRequest(body: Record<string, any>): {
  action: AgentAction;
  worldState: WorldState;
  policyText: string;
} | { error: string } {
  // Full format: action is an AgentAction object
  if (body.action && typeof body.action === "object" && body.action.agentId) {
    const policyText = body.policyText ?? activePolicy;
    if (!policyText) {
      return { error: "No policyText provided and no active policy set. POST /api/v1/policy first, or include policyText in request." };
    }
    return {
      action: body.action as AgentAction,
      worldState: body.worldState ?? {},
      policyText,
    };
  }

  // Connector format: actor + action strings
  if (body.actor || (body.action && typeof body.action === "string")) {
    const agentId = body.actor ?? "unknown";
    const actionType = typeof body.action === "string" ? body.action : "unknown";
    const payload = body.payload ?? {};
    const description = payload.description ?? `${agentId}: ${actionType}`;
    const confidence = payload.confidence ?? 0.5;
    const magnitude = confidence;

    const action: AgentAction = {
      agentId,
      type: actionType,
      description,
      magnitude,
      context: {
        ...payload,
        world: body.world,
        source: "connector",
      },
    };

    const worldState: WorldState = {};
    if (body.state && typeof body.state === "object") {
      Object.assign(worldState, body.state);
    }

    const policyText = body.policyText ?? activePolicy;
    if (!policyText) {
      return { error: "No policyText provided and no active policy set. POST /api/v1/policy first, or include policyText in request." };
    }

    return { action, worldState, policyText };
  }

  return { error: "Invalid request format. Send either { action: AgentAction, policyText } or { actor, action, payload }." };
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

      // Send initial connection event
      const connectMsg = `data: ${JSON.stringify({ type: "connected", activePolicy: activePolicy.length > 0, eventCount: eventCounter })}\n\n`;
      res.write(connectMsg);

      sseClients.add(res);

      req.on("close", () => {
        sseClients.delete(res);
      });

      // Keep alive
      const keepAlive = setInterval(() => {
        try { res.write(": keepalive\n\n"); } catch { clearInterval(keepAlive); }
      }, 15000);

      req.on("close", () => clearInterval(keepAlive));
      return;
    }

    res.setHeader("Content-Type", "application/json");

    // POST /api/v1/policy — Set active governance policy
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
      const result = handleListPresets();
      res.writeHead(200);
      res.end(JSON.stringify(result));
      return;
    }

    // POST /api/v1/evaluate OR /api/evaluate — Direct governance evaluation
    // Accepts both full format (UI) and connector format (CLI wrapper)
    // /api/evaluate is the path the CLI connector uses
    if ((url === "/api/v1/evaluate" || url === "/api/evaluate") && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const normalized = normalizeEvaluateRequest(body);

      if ("error" in normalized) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: normalized.error }));
        return;
      }

      const verdict = govern(normalized.action, normalized.worldState, normalized.policyText);

      // Broadcast to all SSE clients
      broadcastEvent({
        type: "evaluation",
        action: normalized.action,
        verdict: {
          status: verdict.status,
          reason: verdict.reason,
          rulesFired: verdict.rulesFired,
          confidence: verdict.confidence,
          consequence: verdict.consequence,
          reward: verdict.reward,
        },
      });

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
      if (policyText) {
        activePolicy = policyText;
        policyUpdatedAt = new Date().toISOString();
        broadcastEvent({ type: "policy_updated", policyText: activePolicy, updatedAt: policyUpdatedAt });
      }

      if (!activePolicy) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "No governance rules set. Define rules first." }));
        return;
      }

      // Kill any running simulation
      if (activeSimulation) {
        try { activeSimulation.kill(); } catch { /* already dead */ }
        activeSimulation = null;
      }

      const scriptPath = join(process.cwd(), "bridge", "social_simulation.py");
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
        const simSource = readFileSync(join(process.cwd(), "bridge", "social_simulation.py"), "utf-8");
        const bridgeSource = readFileSync(join(process.cwd(), "bridge", "neuroverse_bridge.py"), "utf-8");
        res.writeHead(200);
        res.end(JSON.stringify({
          files: [
            { name: "social_simulation.py", path: "bridge/social_simulation.py", content: simSource, language: "python" },
            { name: "neuroverse_bridge.py", path: "bridge/neuroverse_bridge.py", content: bridgeSource, language: "python" },
          ],
        }));
      } catch (err) {
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
  console.log(`\n  Endpoints:`);
  console.log(`    POST /api/v1/evaluate        — Governance evaluation (real)`);
  console.log(`    POST /api/v1/policy          — Set active governance rules`);
  console.log(`    GET  /api/v1/policy          — Get active governance rules`);
  console.log(`    GET  /api/v1/events          — SSE stream (live governance feed)`);
  console.log(`    POST /api/v1/simulate        — Launch governed simulation`);
  console.log(`    POST /api/v1/simulate/stop   — Stop running simulation`);
  console.log(`    GET  /api/v1/simulate/source — View simulation source code`);
  console.log(`    POST /api/v1/reason          — Governed reasoning`);
  console.log(`    GET  /api/v1/reason/health   — Health check`);
  console.log(`    GET  /api/v1/reason/presets  — Scenario presets`);
  console.log(`\n  Governance engine: @neuroverseos/governance`);
  console.log(`  Rules ARE enforced. This is not a fallback.\n`);
});
