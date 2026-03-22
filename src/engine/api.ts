/**
 * API Handlers — Server-side request handlers for the demo server.
 *
 * These are pure functions that handle HTTP request bodies and return
 * response objects. No HTTP framework dependency — just data in, data out.
 *
 * The demo server (src/cli/demo.ts) wires these to routes.
 */

import { evaluateGuard } from './guard-engine';
import type { GuardEvent } from '../contracts/guard-contract';
import type { WorldDefinition } from '../types';
import { loadWorld } from '../loader/world-loader';

// ─── Health Check ───────────────────────────────────────────────────────────

export function handleHealthCheck(): {
  status: string;
  engine: string;
  version: string;
  capabilities: string[];
} {
  return {
    status: 'ok',
    engine: '@neuroverseos/governance',
    version: '0.2.2',
    capabilities: [
      'guard',
      'simulate',
      'validate',
      'bootstrap',
      'decision-flow',
      'impact-report',
      'behavioral-analysis',
    ],
  };
}

// ─── List Presets ───────────────────────────────────────────────────────────

export async function handleListPresets(policiesDir?: string): Promise<{
  presets: Array<{ id: string; name: string; description: string; rules: string }>;
}> {
  const { readdir, readFile } = await import('fs/promises');
  const { join } = await import('path');

  const dir = policiesDir ?? join(process.cwd(), 'policies');
  const presets: Array<{ id: string; name: string; description: string; rules: string }> = [];

  try {
    const files = await readdir(dir);
    for (const file of files.filter(f => f.endsWith('.txt')).sort()) {
      const content = await readFile(join(dir, file), 'utf-8');
      const id = file.replace('.txt', '');
      const name = id
        .split('-')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
      // First line or first rule as description
      const firstLine = content.split('\n').find(l => l.trim().length > 0) ?? '';
      presets.push({ id, name, description: firstLine, rules: content });
    }
  } catch {
    // No policies directory — return empty
  }

  return { presets };
}

// ─── Reason Request ─────────────────────────────────────────────────────────

/**
 * Run governed reasoning on a scenario.
 * Takes a scenario description + world path, evaluates through the guard engine.
 */
export async function handleReasonRequest(body: {
  scenario?: string;
  worldPath?: string;
  intent?: string;
  tool?: string;
  roleId?: string;
}): Promise<Record<string, unknown>> {
  const intent = body.intent ?? body.scenario;
  if (!intent) {
    return { status: 'error', error: 'intent or scenario is required' };
  }

  const event: GuardEvent = {
    intent,
    tool: body.tool,
    roleId: body.roleId,
  };

  if (body.worldPath) {
    try {
      const world = await loadWorld(body.worldPath);
      const verdict = evaluateGuard(event, world);
      return { status: 'ok', verdict };
    } catch (err) {
      return { status: 'error', error: `Failed to load world: ${err}` };
    }
  }

  return { status: 'error', error: 'worldPath is required' };
}

// ─── Create Capsule ─────────────────────────────────────────────────────────

/**
 * Create a shareable scenario capsule — a self-contained snapshot
 * of a governance scenario that can be shared or replayed.
 */
export function handleCreateCapsule(body: {
  scenario?: string;
  rules?: string[];
  events?: Array<{ intent: string; tool?: string }>;
}): {
  capsuleId: string;
  scenario: string;
  rules: string[];
  events: Array<{ intent: string; tool?: string }>;
  createdAt: string;
} {
  const capsuleId = `cap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    capsuleId,
    scenario: body.scenario ?? 'Untitled scenario',
    rules: body.rules ?? [],
    events: body.events ?? [],
    createdAt: new Date().toISOString(),
  };
}
