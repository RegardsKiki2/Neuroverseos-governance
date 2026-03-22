/**
 * World Composition Engine — Public API
 *
 * Deterministic merging of base worlds and modules.
 * One merge engine. Many surfaces. Never duplicate merge logic.
 */

export { composeWorld, composeWorldMulti } from './composeWorld';
export type {
  WorldModule,
  CompositionResult,
  CompositionConflict,
  CompositionDiff,
  CompositionSeverity,
  ComposableCategory,
} from './types';
