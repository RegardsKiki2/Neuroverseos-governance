/**
 * Govern — Thin bridge from HTTP/demo consumers to the real guard engine.
 *
 * This is NOT a second engine. It is NOT a parser.
 * It converts AgentAction → GuardEvent, loads a world, and calls evaluateGuard().
 * That's it. Zero intelligence. Zero interpretation.
 *
 * Rule parsing belongs in `neuroverse add`. Evaluation belongs in guard-engine.ts.
 * This bridge just translates types and calls the real thing.
 *
 * Architecture:
 *   [HTTP request] → govern(action, worldPath) → evaluateGuard(event, world) → GuardVerdict
 */

import type { AgentAction, GovernorConfig } from './types';
import type { WorldDefinition } from '../types';
import type { GuardEvent, GuardVerdict, GuardEngineOptions } from '../contracts/guard-contract';
import { evaluateGuard } from '../engine/guard-engine';
import { loadWorld, loadWorldFromDirectory } from '../loader/world-loader';

// ─── Type Conversion ────────────────────────────────────────────────────────

/**
 * Convert an AgentAction (HTTP/demo format) → GuardEvent (engine format).
 * Pure mapping. No interpretation. No intelligence.
 */
export function actionToGuardEvent(action: AgentAction): GuardEvent {
  return {
    intent: action.description,
    tool: action.type,
    roleId: action.agentId,
    riskLevel: magnitudeToRisk(action.magnitude),
    args: action.context as Record<string, unknown> | undefined,
  };
}

function magnitudeToRisk(magnitude?: number): 'low' | 'medium' | 'high' | 'critical' | undefined {
  if (magnitude === undefined) return undefined;
  if (magnitude < 0.25) return 'low';
  if (magnitude < 0.5) return 'medium';
  if (magnitude < 0.75) return 'high';
  return 'critical';
}

// ─── Govern (one-shot) ──────────────────────────────────────────────────────

/**
 * Evaluate a single action against a loaded world.
 *
 * This is the entire bridge. AgentAction in, GuardVerdict out.
 * Uses the same evaluateGuard() as `neuroverse guard`.
 */
export function govern(
  action: AgentAction,
  world: WorldDefinition,
  options?: GuardEngineOptions,
): GuardVerdict {
  const event = actionToGuardEvent(action);
  return evaluateGuard(event, world, options);
}

// ─── Governor (persistent instance) ─────────────────────────────────────────

/**
 * A governor holds a loaded world and evaluates actions against it.
 * Used by the demo server to avoid re-loading the world on every request.
 */
export interface Governor {
  /** Evaluate an action against the loaded world */
  evaluate(action: AgentAction): GuardVerdict;

  /** Reload the world from disk (call after rules change) */
  reload(): Promise<void>;

  /** The loaded world definition */
  readonly world: WorldDefinition;
}

/**
 * Create a governor instance that holds a loaded world.
 *
 * Usage:
 *   const gov = await createGovernor({ worldPath: '/tmp/neuroverse-demo' });
 *   const verdict = gov.evaluate(action);
 *   // After rule changes:
 *   await gov.reload();
 */
export async function createGovernor(config: GovernorConfig): Promise<Governor> {
  const worldPath = config.worldPath;
  if (!worldPath) {
    throw new Error('Governor requires a worldPath');
  }

  const options: GuardEngineOptions = {
    trace: config.trace,
    level: config.level,
  };

  let world = await loadWorld(worldPath);

  return {
    evaluate(action: AgentAction): GuardVerdict {
      return govern(action, world, options);
    },

    async reload(): Promise<void> {
      world = await loadWorld(worldPath);
    },

    get world(): WorldDefinition {
      return world;
    },
  };
}

// ─── Temp World Builder ─────────────────────────────────────────────────────

/**
 * Write a minimal world directory from plain-text rules.
 *
 * This is for the demo server: UI sends plain-text rules,
 * we write them as kernel forbidden_patterns, then load
 * the world through the normal loadWorld() path.
 *
 * NO interpretation. Each rule line becomes a kernel forbidden pattern.
 * The guard engine does the matching.
 */
export async function writeTempWorld(
  dir: string,
  policyLines: string[],
): Promise<void> {
  const { writeFile, mkdir } = await import('fs/promises');
  const { join } = await import('path');

  await mkdir(dir, { recursive: true });

  // Minimal world.json
  const worldJson = {
    world_id: 'demo-live',
    name: 'Live Demo World',
    thesis: 'Interactive governance demo',
    version: '0.1.0',
    runtime_mode: 'COMPLIANCE',
    default_assumption_profile: 'baseline',
    default_alternative_profile: 'baseline',
    modules: [],
    players: { thinking_space: false, experience_space: false, action_space: true },
  };

  // Convert each rule line into a kernel forbidden pattern.
  // The guard engine matches these against event.intent using keyword matching.
  // No interpretation here — just packaging for the engine.
  const forbiddenPatterns = policyLines
    .filter(line => line.trim().length > 0)
    .map((line, i) => ({
      id: `demo-rule-${i + 1}`,
      pattern: line.trim(),
      reason: line.trim(),
      action: 'BLOCK' as const,
    }));

  const kernelJson = {
    artifact_type: 'kernel',
    kernel_id: 'demo-kernel',
    version: '0.1.0',
    domain: 'demo',
    enforcement_level: 'standard',
    input_boundaries: { forbidden_patterns: forbiddenPatterns },
    output_boundaries: { forbidden_patterns: [] },
    response_vocabulary: {},
    metadata: {
      compiled_by: 'neuroverse-demo',
      compiled_at: new Date().toISOString(),
      source_hash: 'live-edit',
      compiler_version: '0.2.2',
    },
  };

  // Minimal metadata.json
  const metadataJson = {
    format_version: '1.0.0',
    created_at: new Date().toISOString(),
    last_modified: new Date().toISOString(),
    authoring_method: 'manual-authoring',
  };

  await Promise.all([
    writeFile(join(dir, 'world.json'), JSON.stringify(worldJson, null, 2)),
    writeFile(join(dir, 'kernel.json'), JSON.stringify(kernelJson, null, 2)),
    writeFile(join(dir, 'metadata.json'), JSON.stringify(metadataJson, null, 2)),
  ]);
}
