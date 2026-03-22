/**
 * NeuroVerse Evaluator — Standalone Agent Governance
 *
 * Drop this into any agent project. Load a .nv-world.zip.
 * Evaluate actions. Get: APPROVE | BLOCK | REQUIRE_HUMAN.
 *
 * The evaluator enforces and redirects. It does not think.
 *
 * Usage:
 *
 *   import { Evaluator, loadWorld } from "neuroverse-evaluator"
 *
 *   const world = await loadWorld(fs.readFileSync("sun-tzu.nv-world.zip"))
 *   const evaluator = new Evaluator(world)
 *
 *   const result = evaluator.evaluate({
 *     stateChanges: { action_type: "direct_attack", visibility: 100 }
 *   })
 *
 *   if (result.decision === "APPROVE") {
 *     executeTool(action)
 *   } else if (result.decision === "BLOCK") {
 *     console.log(result.reasoning)
 *     console.log(result.redirects) // deterministic alternatives
 *   }
 */

// ─── Core Evaluator ─────────────────────────────────────────────────────────

export { Evaluator } from '../../src/world-engine/Evaluator';
export type {
  Decision,
  Action,
  EvaluationResult,
  SuggestedRedirect,
} from '../../src/world-engine/Evaluator';

// ─── Types (for advanced usage) ─────────────────────────────────────────────

export type {
  WorldDefinition,
  SimulationState,
  ViabilityStatus,
  RuleActivation,
  RuleRedirect,
  Rule,
  Trigger,
  Effect,
} from '../../src/world-engine/types';

// ─── World Loader ───────────────────────────────────────────────────────────

export { loadWorld } from './loader';
