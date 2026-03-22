#!/usr/bin/env node
/**
 * neuroverse demo — Launch the interactive governance demo
 *
 * Starts the API server (thin wrapper over evaluateGuard) and opens
 * the browser to the governance flow visualization.
 *
 * Usage:
 *   neuroverse demo                          # full experience
 *   neuroverse demo --world social-media     # specific world
 *   neuroverse demo --port 3456              # custom port
 *   neuroverse demo --no-browser             # server only
 *
 * The server is a thin HTTP layer over the CLI commands:
 *   POST /api/v1/evaluate  → evaluateGuard() (same as `neuroverse guard`)
 *   POST /api/v1/policy    → writes rules to temp world → loadWorld() → evaluateGuard()
 *   GET  /api/v1/events    → SSE stream of governance verdicts
 *
 * ONE engine. ONE execution path. CLI is the bible.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  handleReasonRequest,
  handleCreateCapsule,
  handleHealthCheck,
  handleListPresets,
} from '../engine/api';
import { govern, writeTempWorld } from '../runtime/govern';
import { loadWorld, loadBundledWorld, DEFAULT_BUNDLED_WORLD } from '../loader/world-loader';
import { resolveWorldPath } from '../loader/world-resolver';
import type { AgentAction } from '../runtime/types';
import type { WorldDefinition } from '../types';
import { adaptationFromVerdict, detectBehavioralPatterns, generateAdaptationNarrative } from '../engine/behavioral-engine';
import type { GuardVerdict } from '../contracts/guard-contract';

// ─── Arg parsing ────────────────────────────────────────────────────────────

export async function main(args: string[]): Promise<void> {
  let port = 3456;
  let worldName: string | undefined;
  let noBrowser = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--world' && args[i + 1]) {
      worldName = args[i + 1];
      i++;
    } else if (args[i] === '--no-browser') {
      noBrowser = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      process.stdout.write(`
neuroverse demo — Interactive governance demo

Usage:
  neuroverse demo [options]

Options:
  --world <name>   Load a specific world (e.g., social-media, trading-agent)
  --port <number>  Server port (default: 3456)
  --no-browser     Don't open browser automatically

The demo server wraps the real guard engine.
Same evaluateGuard() as \`neuroverse guard\`. ONE engine. ONE path.
`);
      return;
    }
  }

  // ─── State ──────────────────────────────────────────────────────────────

  const TEMP_WORLD_DIR = join(tmpdir(), 'neuroverse-demo');
  let activePolicy = '';
  let policyUpdatedAt: string | null = null;
  let activeWorld: WorldDefinition | null = null;
  let activeSimulation: ChildProcess | null = null;

  // Load world: explicit flag, resolved path, or bundled default
  if (worldName) {
    try {
      const worldPath = await resolveWorldPath(worldName);
      if (worldPath) {
        activeWorld = await loadWorld(worldPath);
        process.stderr.write(`  Loaded world: ${worldName} (${worldPath})\n`);
      }
    } catch {
      process.stderr.write(`  Warning: Could not load world "${worldName}"\n`);
    }
  }
  if (!activeWorld) {
    // No world specified or load failed — use bundled default so demo always works
    activeWorld = await loadBundledWorld(DEFAULT_BUNDLED_WORLD);
    process.stderr.write(`  Using default world: ${DEFAULT_BUNDLED_WORLD}\n`);
  }

  async function syncPolicyToWorld(): Promise<void> {
    if (!activePolicy) { activeWorld = null; return; }
    const lines = activePolicy.split('\n').filter(l => l.trim().length > 0);
    await writeTempWorld(TEMP_WORLD_DIR, lines);
    activeWorld = await loadWorld(TEMP_WORLD_DIR);
  }

  // ─── SSE ──────────────────────────────────────────────────────────────

  const sseClients = new Set<ServerResponse>();
  let eventCounter = 0;
  const evaluationHistory: Array<{ action: AgentAction; verdict: GuardVerdict }> = [];

  // ─── Viz static file serving ──────────────────────────────────────────
  function resolveVizDir(): string | null {
    // Check multiple locations for the built viz
    const candidates = [
      join(process.cwd(), 'dist', 'viz'),
      join(process.cwd(), 'node_modules', '@neuroverseos', 'governance', 'dist', 'viz'),
    ];
    // Also check relative to this file (for npm-installed packages)
    try {
      const thisDir = typeof __dirname !== 'undefined' ? __dirname : join(fileURLToPath(import.meta.url), '..');
      candidates.push(join(thisDir, '..', 'viz'));
    } catch { /* ok */ }
    for (const dir of candidates) {
      if (existsSync(join(dir, 'index.html'))) return dir;
    }
    return null;
  }

  const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.woff': 'font/woff', '.woff2': 'font/woff2',
  };

  function serveStaticFile(res: ServerResponse, filePath: string): boolean {
    if (!existsSync(filePath)) return false;
    const ext = extname(filePath);
    const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(readFileSync(filePath));
    return true;
  }

  const vizDir = resolveVizDir();

  function broadcastEvent(event: Record<string, unknown>) {
    const id = ++eventCounter;
    const data = JSON.stringify({ id, timestamp: new Date().toISOString(), ...event });
    const message = `id: ${id}\ndata: ${data}\n\n`;
    for (const client of sseClients) {
      try { client.write(message); } catch { sseClients.delete(client); }
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  function setCors(res: ServerResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      req.on('error', reject);
    });
  }

  function normalizeAction(body: Record<string, any>): AgentAction | { error: string } {
    if (body.action && typeof body.action === 'object' && body.action.agentId) {
      return body.action as AgentAction;
    }
    if (body.actor || (body.action && typeof body.action === 'string')) {
      const agentId = body.actor ?? 'unknown';
      const actionType = typeof body.action === 'string' ? body.action : 'unknown';
      const payload = body.payload ?? {};
      return {
        agentId,
        type: actionType,
        description: payload.description ?? `${agentId}: ${actionType}`,
        magnitude: payload.confidence ?? 0.5,
        context: { ...payload, world: body.world, source: 'connector' },
      };
    }
    return { error: 'Invalid request format.' };
  }

  // ─── Server ─────────────────────────────────────────────────────────────

  const server = createServer(async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url = req.url ?? '/';

    try {
      // SSE
      if (url === '/api/v1/events' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });
        res.write(`data: ${JSON.stringify({ type: 'connected', activePolicy: activePolicy.length > 0, eventCount: eventCounter })}\n\n`);
        sseClients.add(res);
        req.on('close', () => { sseClients.delete(res); });
        const keepAlive = setInterval(() => {
          try { res.write(': keepalive\n\n'); } catch { clearInterval(keepAlive); }
        }, 15000);
        req.on('close', () => clearInterval(keepAlive));
        return;
      }

      res.setHeader('Content-Type', 'application/json');

      // Policy set
      if (url === '/api/v1/policy' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const text = body.policyText ?? body.policy ?? body.text;
        if (!text || typeof text !== 'string') {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'policyText is required' }));
          return;
        }
        activePolicy = text;
        policyUpdatedAt = new Date().toISOString();
        await syncPolicyToWorld();
        broadcastEvent({ type: 'policy_updated', policyText: activePolicy, updatedAt: policyUpdatedAt });
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ok', policyText: activePolicy, updatedAt: policyUpdatedAt }));
        return;
      }

      // Policy get
      if (url === '/api/v1/policy' && req.method === 'GET') {
        res.writeHead(200);
        res.end(JSON.stringify({ policyText: activePolicy, active: activePolicy.length > 0, updatedAt: policyUpdatedAt }));
        return;
      }

      // Evaluate
      if ((url === '/api/v1/evaluate' || url === '/api/evaluate') && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const action = normalizeAction(body);
        if ('error' in action) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: action.error }));
          return;
        }
        if (!activeWorld) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'No governance rules set. POST /api/v1/policy first.' }));
          return;
        }
        const verdict = govern(action, activeWorld);
        evaluationHistory.push({ action, verdict });
        broadcastEvent({
          type: 'evaluation',
          action,
          verdict: { status: verdict.status, reason: verdict.reason, ruleId: verdict.ruleId, consequence: verdict.consequence, reward: verdict.reward },
        });
        res.writeHead(200);
        res.end(JSON.stringify(verdict));
        return;
      }

      // Simulate
      if (url === '/api/v1/simulate' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const agents = body.agents ?? 50;
        const steps = body.steps ?? 20;
        const policyText = body.policyText ?? activePolicy;

        if (policyText && policyText !== activePolicy) {
          activePolicy = policyText;
          policyUpdatedAt = new Date().toISOString();
          await syncPolicyToWorld();
          broadcastEvent({ type: 'policy_updated', policyText: activePolicy, updatedAt: policyUpdatedAt });
        }
        if (!activeWorld) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'No governance rules set.' }));
          return;
        }

        if (activeSimulation) {
          try { activeSimulation.kill(); } catch { /* ok */ }
          activeSimulation = null;
        }

        const scriptCandidates = [
          join(process.cwd(), 'examples', 'social-media-sim', 'simulation.py'),
          join(process.cwd(), 'demo', 'simulations', 'social_simulation.py'),
        ];
        const scriptPath = scriptCandidates.find(p => existsSync(p));
        if (!scriptPath) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: 'Simulation script not found' }));
          return;
        }

        const simArgs = [scriptPath, '--agents', String(agents), '--steps', String(steps)];
        if (body.llmApiKey) {
          simArgs.push('--llm-api-key', body.llmApiKey);
          if (body.llmBaseUrl) simArgs.push('--llm-base-url', body.llmBaseUrl);
          if (body.llmModel) simArgs.push('--llm-model', body.llmModel);
        }

        broadcastEvent({ type: 'simulation_start', agents, steps, mode: body.llmApiKey ? 'llm' : 'rule-based' });

        const proc = spawn('python3', simArgs, { cwd: process.cwd(), env: { ...process.env } });
        activeSimulation = proc;

        let buffer = '';
        proc.stdout.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try { broadcastEvent({ type: 'simulation_event', ...JSON.parse(line) }); } catch { /* ok */ }
          }
        });
        proc.stderr.on('data', (chunk: Buffer) => {
          const msg = chunk.toString().trim();
          if (msg) process.stderr.write(`[SIM] ${msg}\n`);
        });
        proc.on('close', (code) => {
          activeSimulation = null;
          broadcastEvent({ type: 'simulation_complete', exitCode: code });
        });

        res.writeHead(200);
        res.end(JSON.stringify({ status: 'started', agents, steps }));
        return;
      }

      // Stop simulation
      if (url === '/api/v1/simulate/stop' && req.method === 'POST') {
        if (activeSimulation) {
          activeSimulation.kill();
          activeSimulation = null;
          broadcastEvent({ type: 'simulation_stopped' });
          res.writeHead(200);
          res.end(JSON.stringify({ status: 'stopped' }));
        } else {
          res.writeHead(200);
          res.end(JSON.stringify({ status: 'no_simulation_running' }));
        }
        return;
      }

      // Simulation source
      if (url === '/api/v1/simulate/source' && req.method === 'GET') {
        const candidates = [
          { sim: 'examples/social-media-sim/simulation.py', bridge: 'examples/social-media-sim/bridge.py' },
          { sim: 'demo/simulations/social_simulation.py', bridge: 'demo/simulations/neuroverse_bridge.py' },
        ];
        const files: Array<{ name: string; path: string; content: string; language: string }> = [];
        for (const c of candidates) {
          const simPath = join(process.cwd(), c.sim);
          if (existsSync(simPath)) {
            files.push({ name: 'simulation.py', path: c.sim, content: readFileSync(simPath, 'utf-8'), language: 'python' });
            const bridgePath = join(process.cwd(), c.bridge);
            if (existsSync(bridgePath)) {
              files.push({ name: 'bridge.py', path: c.bridge, content: readFileSync(bridgePath, 'utf-8'), language: 'python' });
            }
            break;
          }
        }
        res.writeHead(200);
        res.end(JSON.stringify({ files }));
        return;
      }

      // Reason endpoints
      if (url === '/api/v1/reason' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const result = await handleReasonRequest(body);
        res.writeHead('error' in result && result.status === 'error' ? 400 : 200);
        res.end(JSON.stringify(result));
        return;
      }
      if (url === '/api/v1/reason/capsule' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        res.writeHead(200);
        res.end(JSON.stringify(handleCreateCapsule(body)));
        return;
      }
      if (url === '/api/v1/reason/health' && req.method === 'GET') {
        res.writeHead(200);
        res.end(JSON.stringify(handleHealthCheck()));
        return;
      }
      if (url === '/api/v1/reason/presets' && req.method === 'GET') {
        res.writeHead(200);
        res.end(JSON.stringify(await handleListPresets(join(process.cwd(), 'policies'))));
        return;
      }

      // Behavioral analysis
      if (url === '/api/v1/behavioral' && req.method === 'GET') {
        const adaptations = evaluationHistory.map(({ action, verdict }) => {
          const executed = verdict.status === 'BLOCK' ? 'idle' : action.type;
          return adaptationFromVerdict(action.agentId, action.type, executed, verdict);
        });
        const patterns = detectBehavioralPatterns(adaptations, new Set(evaluationHistory.map(e => e.action.agentId)).size);
        const narrative = generateAdaptationNarrative(patterns);
        res.writeHead(200);
        res.end(JSON.stringify({ patterns, narrative, adaptations: adaptations.length, agents: new Set(evaluationHistory.map(e => e.action.agentId)).size }));
        return;
      }

      // ── Serve viz static files ──
      if (req.method === 'GET' && vizDir) {
        const reqPath = url === '/' || url === '/index.html' ? '/index.html' : url;
        const filePath = join(vizDir, reqPath);
        // Prevent path traversal
        if (filePath.startsWith(vizDir) && serveStaticFile(res, filePath)) return;
      }

      // Fallback: if no viz is built, show a helpful message
      if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<html><body style="background:#0a0a0a;color:#e2e8f0;font-family:monospace;padding:40px">
          <h2>NeuroVerse Demo Server</h2>
          <p>API is running. Build the viz to see the Governance Observation Deck:</p>
          <pre style="color:#8b5cf6">npm run build:viz</pre>
          <p style="color:#64748b">Then refresh this page.</p>
          <p style="margin-top:20px">API endpoints:</p>
          <pre style="color:#64748b">POST /api/v1/policy    — Set rules
POST /api/v1/evaluate  — Guard evaluation
GET  /api/v1/events    — SSE governance feed
GET  /api/v1/behavioral — Behavioral analysis
POST /api/v1/simulate  — Launch simulation</pre>
        </body></html>`);
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (err) {
      console.error('Server error:', err);
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  });

  server.listen(port, () => {
    process.stderr.write(`\n  NeuroVerse Demo Server\n`);
    process.stderr.write(`  http://localhost:${port}\n`);
    process.stderr.write(`\n  Engine: evaluateGuard() — same as \`neuroverse guard\`\n`);
    process.stderr.write(`  Temp world: ${TEMP_WORLD_DIR}\n`);
    if (worldName) {
      process.stderr.write(`  World: ${worldName}\n`);
    }
    process.stderr.write(`\n  POST /api/v1/policy     → Set rules (writes temp world)\n`);
    process.stderr.write(`  POST /api/v1/evaluate   → Guard evaluation (real engine)\n`);
    process.stderr.write(`  GET  /api/v1/events     → SSE governance feed\n`);
    process.stderr.write(`  POST /api/v1/simulate   → Launch social simulation\n`);
    process.stderr.write(`\n  ONE engine. ONE path. CLI is the bible.\n\n`);

    // Open browser
    if (!noBrowser) {
      const url = `http://localhost:${port}`;
      try {
        const { exec } = require('child_process');
        const cmd = process.platform === 'darwin' ? `open ${url}`
          : process.platform === 'win32' ? `start ${url}`
          : `xdg-open ${url}`;
        exec(cmd);
      } catch {
        // Can't open browser — that's fine
      }
    }
  });

  // Keep server running
  await new Promise(() => {});
}
