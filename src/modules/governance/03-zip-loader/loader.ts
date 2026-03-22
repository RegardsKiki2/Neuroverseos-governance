/**
 * World Loader — Parse .nv-world.zip into a WorldDefinition
 *
 * Works in Node.js, Deno, Bun, Workers, and browsers.
 * Accepts: ArrayBuffer, Uint8Array, Buffer, Blob, or base64 string.
 *
 * Requires jszip as a peer dependency.
 */

import JSZip from 'jszip';
import type {
  WorldDefinition,
  WorldIdentity,
  AssumptionConfig,
  StateSchema,
  GatesConfig,
  OutcomesConfig,
  WorldMetadata,
  KernelConfig,
  Invariant,
  Rule,
} from '../../src/world-engine/types';

type LoadInput = ArrayBuffer | Uint8Array | Blob | string;

/**
 * Load a .nv-world.zip into a WorldDefinition.
 *
 * Accepts ArrayBuffer, Uint8Array, Buffer, Blob, or base64 string.
 */
export async function loadWorld(input: LoadInput): Promise<WorldDefinition> {
  const zip = await JSZip.loadAsync(input, {
    base64: typeof input === 'string',
  });

  const readJson = async <T>(path: string): Promise<T | null> => {
    const entry = zip.file(path);
    if (!entry) return null;
    const text = await entry.async('text');
    return JSON.parse(text) as T;
  };

  const worldJson = await readJson<WorldIdentity>('world.json');
  const invariantsJson = await readJson<{ invariants: Invariant[] }>('invariants.json');
  const assumptionsJson = await readJson<AssumptionConfig>('assumptions.json');
  const stateSchemaJson = await readJson<StateSchema>('state-schema.json');
  const gatesJson = await readJson<GatesConfig>('gates.json');
  const outcomesJson = await readJson<OutcomesConfig>('outcomes.json');
  const metadataJson = await readJson<WorldMetadata>('metadata.json');
  const kernelJson = await readJson<KernelConfig>('kernel.json');

  // Read rules directory
  const rules: Rule[] = [];
  const rulesFolder = zip.folder('rules');
  if (rulesFolder) {
    const ruleFiles: string[] = [];
    rulesFolder.forEach((relativePath) => {
      if (relativePath.endsWith('.json')) {
        ruleFiles.push(`rules/${relativePath}`);
      }
    });
    ruleFiles.sort();
    for (const rulePath of ruleFiles) {
      const ruleData = await readJson<Rule>(rulePath);
      if (ruleData) rules.push(ruleData);
    }
  }

  // Read enforcement.js
  let enforcement: string | undefined;
  const enforcementFile = zip.file('enforcement.js');
  if (enforcementFile) {
    enforcement = await enforcementFile.async('text');
  }

  if (!worldJson) {
    throw new Error('Invalid .nv-world.zip: missing world.json');
  }

  if (!stateSchemaJson) {
    throw new Error('Invalid .nv-world.zip: missing state-schema.json');
  }

  return {
    world: worldJson,
    invariants: invariantsJson?.invariants ?? [],
    assumptions: assumptionsJson ?? { profiles: {}, parameter_definitions: {} },
    stateSchema: stateSchemaJson,
    rules,
    gates: gatesJson ?? {
      viability_classification: [],
      structural_override: { description: 'Structural rule collapse override', enforcement: 'mandatory' },
      sustainability_threshold: 0.10,
      collapse_visual: { background: '#1c1917', text: '#fef2f2', border: '#b91c1c', label: 'Hard Stop' },
    },
    outcomes: outcomesJson ?? {
      computed_outcomes: [],
      comparison_layout: { primary_card: '', status_badge: '', structural_indicators: [] },
    },
    kernel: kernelJson ?? undefined,
    enforcement,
    metadata: metadataJson ?? {
      format_version: 'nv-world-1.0',
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
      authoring_method: 'manual-authoring',
    },
  };
}
