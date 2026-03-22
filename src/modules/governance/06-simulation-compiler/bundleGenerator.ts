/**
 * Simulation Bundle Generator
 * 
 * Generates downloadable ZIP package with compiled artifacts.
 * 
 * PHILOSOPHY: World bundles are immutable compiled outputs.
 * Iteration creates a new world via the configurator, not by editing files.
 * 
 * AI KERNEL GENERATION: Every build gets a unique, AI-generated kernel.
 * No default kernels - the AI reads the complete build and generates
 * appropriate enforcement code for that specific use case.
 */

import JSZip from 'jszip';
import type { CompiledSimulation, StarterPrompt } from '../types';
import { generateGuardTS, generateGuardJS, generateGuardPy } from './simulationCompiler';
import type { SimulationDomain } from '../templates/domains';
import { DEFAULT_STARTER_PROMPTS } from '@/types/thinkingSpace';
import { supabase } from '@/integrations/supabase/client';

/**
 * Build config for AI kernel generation
 */
interface BuildConfig {
  name: string;
  domain?: string;
  description?: string;
  canDo: string[];
  cannotDo: string[];
  starterPrompts?: string[];
  contentPolicy?: string;
}

/**
 * Generated kernel response
 */
interface GeneratedKernel {
  code: string;
  metadata: {
    generatedAt: string;
    rulesCount: number;
    patternsGenerated: number;
    fallback?: boolean;
  };
}

/**
 * Progress callback for UI updates
 */
export type GenerationProgressCallback = (stage: 'analyzing' | 'generating' | 'packaging' | 'complete', message: string) => void;

/**
 * Generate AI kernel for this build
 */
async function generateAIKernel(
  compiled: CompiledSimulation, 
  onProgress?: GenerationProgressCallback
): Promise<GeneratedKernel | null> {
  try {
    onProgress?.('analyzing', 'Reading your build configuration...');
    
    // Extract build config from compiled simulation
    const buildConfig: BuildConfig = {
      name: compiled.metadata.name,
      domain: compiled.domain,
      description: compiled.metadata.templateUsed 
        ? `${compiled.domain} domain world` 
        : 'Custom world configuration',
      canDo: compiled.rules.required.map(r => r.text),
      cannotDo: compiled.rules.forbidden.map(r => r.text),
      starterPrompts: compiled.starterPrompts?.map(p => p.text) || [],
      contentPolicy: compiled.contextSettings?.contentRequired 
        ? 'Content required for operation' 
        : 'No content restrictions',
    };
    
    onProgress?.('generating', 'Generating enforcement kernel...');
    
    // Call the AI kernel generation edge function
    const { data, error } = await supabase.functions.invoke('generate-kernel', {
      body: { buildConfig },
    });
    
    if (error) {
      console.error('[bundleGenerator] AI kernel generation error:', error);
      return null;
    }
    
    if (!data?.success || !data?.kernel) {
      console.error('[bundleGenerator] Invalid AI response:', data);
      return null;
    }
    
    onProgress?.('packaging', 'Packaging your Thinking Space...');
    
    return data.kernel as GeneratedKernel;
  } catch (err) {
    console.error('[bundleGenerator] AI kernel generation failed:', err);
    return null;
  }
}

/**
 * Generate fallback kernel when AI is unavailable
 */
function generateFallbackKernel(compiled: CompiledSimulation): string {
  const rulePatterns = compiled.rules.forbidden.map((rule, index) => {
    // Extract key words from the rule to create basic patterns
    const words = rule.text.toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && !['cannot', 'should', 'must', 'will', 'that', 'this', 'with', 'from', 'have', 'been'].includes(w));
    
    const ruleId = `rule_${index + 1}`;
    const patterns = words.slice(0, 3).map(word => 
      `/${word}/i`
    );
    
    if (patterns.length === 0) {
      return '';
    }
    
    return `
  // Rule: ${rule.text}
  const RULE_${index + 1}_PATTERNS = [
    ${patterns.join(',\n    ')}
  ];
  
  for (const pattern of RULE_${index + 1}_PATTERNS) {
    if (pattern.test(text)) {
      violations.push({
        rule: '${ruleId}',
        pattern: pattern.toString(),
        details: '${rule.text.replace(/'/g, "\\'")}'
      });
      break;
    }
  }`;
  }).filter(p => p).join('\n');

  return `// Fallback Kernel for: ${compiled.metadata.name}
// Domain: ${compiled.domain}
// Generated: ${new Date().toISOString()}
// Note: This is a rule-based fallback kernel (AI was unavailable)

function checkInputBoundaries(text) {
  const violations = [];
  
  // Check for prompt injection attempts
  const INJECTION_PATTERNS = [
    /ignore (previous|all|above) instructions/i,
    /disregard (your|the) (rules|constraints)/i,
    /you are now/i,
    /new persona/i,
    /forget everything/i
  ];
  
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      violations.push({
        rule: 'no_prompt_injection',
        pattern: pattern.toString(),
        details: 'Prompt injection attempt detected'
      });
    }
  }
  
  if (violations.length > 0) {
    return {status: 'HALT', violations};
  }
  
  return {status: 'ALLOW'};
}

function checkOutputBoundaries(text) {
  const violations = [];
${rulePatterns || '  // No specific rules defined'}
  
  if (violations.length > 0) {
    return {status: 'HALT', violations};
  }
  
  return {status: 'ALLOW'};
}

module.exports = {checkInputBoundaries, checkOutputBoundaries};
`;
}

/**
 * Get starter prompts for a domain
 */
function getStarterPromptsForDomain(domain: SimulationDomain): StarterPrompt[] {
  // Map simulation domain to thinkingSpace domain
  const domainMap: Record<SimulationDomain, string> = {
    financial: 'financial',
    medical: 'medical',
    legal: 'legal',
    game: 'game',
    academic: 'academic',
    safety: 'custom',       // Safety uses custom prompts
    privacy: 'custom',      // Privacy uses custom prompts
    coordination: 'custom', // Multi-agent uses custom prompts
    character: 'game',      // Character simulation (narrative) maps to game
    'archetypal-arena': 'custom', // Archetypal arena (ideological) uses custom
    committee: 'financial', // Investment committee maps to financial
    // NEW: Specialized multi-agent templates
    'legal-adversarial': 'legal',  // Legal adversarial maps to legal
    'debate': 'custom',            // Debate uses custom prompts
    'strategy-council': 'custom',  // Strategy council uses custom prompts
    'medical-board': 'medical',    // Medical board maps to medical
    'peer-review': 'academic',     // Peer review maps to academic
    'ethics-council': 'custom',    // Ethics council uses custom prompts
    'character-variants': 'game',  // Character variants maps to game
    'crisis-response': 'custom',   // Crisis response uses custom prompts
    'pitch-tank': 'custom',        // Pitch Tank uses custom prompts
    'story-world': 'game',         // Story World Integrity maps to game (creative)
     'teacher-socratic': 'custom',  // Teacher templates use custom prompts
     'teacher-constraint': 'custom',
      'teacher-reflective': 'custom',
     'clear-room': 'clear-room',
    custom: 'custom',
  };
  const mappedDomain = domainMap[domain] || 'custom';
  return DEFAULT_STARTER_PROMPTS[mappedDomain] || DEFAULT_STARTER_PROMPTS.custom;
}

/**
 * Generate README for the simulation package
 */
function generateReadme(compiled: CompiledSimulation): string {
  const worldId = compiled.metadata.name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-');

  return `# ${compiled.metadata.name}

## Compiled Simulation World

**Domain:** ${compiled.domain}
**Built At:** ${compiled.metadata.compiledAt}
**Version:** ${compiled.metadata.version}
**World ID:** ${worldId}

---

## ⚠️ This is a Compiled Artifact

This bundle is a **compiled, immutable world definition**.

- **Inspection**: You may review rules, guards, and behavior via this README and the test matrix.
- **Iteration**: To modify this world, rebuild it using the [NeuroVerse Configurator](https://neuroverseos.com/build/simulation?domain=${compiled.domain}).

Worlds are not meant to be hand-edited. Iteration creates a new world, preserving auditability and governance integrity.

---

## Overview

This world enforces ${compiled.metadata.totalRulesCount} rules:
- **${compiled.rules.required.length}** required behaviors (DOs)
- **${compiled.rules.forbidden.length}** forbidden behaviors (DON'Ts)

${compiled.metadata.templateUsed ? `Based on the **${compiled.domain}** template.` : 'Custom rules (no template).'}
${compiled.metadata.customRulesCount > 0 ? `Includes ${compiled.metadata.customRulesCount} custom/literal rules.` : ''}

---

## Rules

### ✓ Required Behaviors (DOs)

${compiled.rules.required.length > 0 
  ? compiled.rules.required.map(r => `- ${r.text}`).join('\n')
  : '_No required behaviors defined._'}

### ✗ Forbidden Behaviors (DON'Ts)

${compiled.rules.forbidden.length > 0
  ? compiled.rules.forbidden.map(r => `- ${r.text}`).join('\n')
  : '_No forbidden behaviors defined._'}

---

## Integration

### TypeScript/JavaScript

\`\`\`typescript
import { checkOutput, getRules } from './guards/simulation-guard';

const aiOutput = "Some AI response...";
const result = checkOutput(aiOutput);

if (!result.allowed) {
  console.log('Violations:', result.violations);
  // Handle violation
}
\`\`\`

### Python

\`\`\`python
from guards.simulation_guard import check_output, get_rules

ai_output = "Some AI response..."
result = check_output(ai_output)

if not result.allowed:
    print("Violations:", result.violations)
    # Handle violation
\`\`\`

---

## Files

| File | Purpose |
|------|---------|
| \`simulation.json\` | Compiled world definition (enforced) |
| \`guards/simulation-guard.ts\` | TypeScript enforcement guard |
| \`guards/simulation-guard.js\` | JavaScript enforcement guard (CommonJS) |
| \`guards/simulation-guard.py\` | Python enforcement guard |
| \`manifest.json\` | Build metadata and provenance |

---

## Philosophy

This simulation was **compiled, not interpreted**.

Rules are enforced structurally via regex pattern matching — no LLM inference is used in guard execution. This ensures deterministic, auditable governance.

**To iterate on this world**, visit: https://neuroverseos.com/build/simulation

---

*Generated by NeuroVerse Simulation Engine*
*https://neuroverseos.com*
`;
}

/**
 * Generate manifest.json with build provenance and kernel metadata
 */
function generateManifest(
  compiled: CompiledSimulation, 
  kernelMeta?: { generatedAt: string; fallback: boolean; patternsGenerated: number }
): string {
  const worldId = compiled.metadata.name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-');
    
  return JSON.stringify({
    name: compiled.metadata.name,
    version: compiled.metadata.version,
    type: 'simulation-world',
    domain: compiled.domain,
    
    // Build provenance — inspection allowed, mutation discouraged
    build: {
      world_id: worldId,
      built_at: compiled.metadata.compiledAt,
      built_with: 'NeuroVerse Configurator',
      rebuild_url: `https://neuroverseos.com/build/simulation?domain=${compiled.domain}`,
    },
    
    // AI-generated kernel metadata
    kernel: kernelMeta ? {
      generated_at: kernelMeta.generatedAt,
      ai_generated: !kernelMeta.fallback,
      patterns_count: kernelMeta.patternsGenerated,
      type: kernelMeta.fallback ? 'rule-based-fallback' : 'ai-generated',
    } : {
      type: 'static',
    },
    
    stats: {
      totalRules: compiled.metadata.totalRulesCount,
      requiredRules: compiled.rules.required.length,
      forbiddenRules: compiled.rules.forbidden.length,
      customRules: compiled.metadata.customRulesCount,
      templateUsed: compiled.metadata.templateUsed,
    },
    
    files: [
      'simulation.json',
      'kernel/kernel.json',
      'kernel/kernel-guard.js',
      'guards/simulation-guard.ts',
      'guards/simulation-guard.js',
      'guards/simulation-guard.py',
    ],
    
    // Explicit contract
    immutability: 'This is a compiled artifact. Iteration creates a new world via the configurator.',
  }, null, 2);
}

/**
 * Generate package.json
 */
function generatePackageJson(compiled: CompiledSimulation): string {
  const safeName = compiled.metadata.name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-');
    
  return JSON.stringify({
    name: safeName,
    version: compiled.metadata.version,
    description: `Simulation world for ${compiled.domain} domain`,
    main: 'guards/simulation-guard.js',
    types: 'guards/simulation-guard.ts',
    scripts: {
      test: 'echo "Import and test the guard functions"',
    },
    keywords: ['simulation', 'ai-guard', 'neuroverse', compiled.domain],
    license: 'UNLICENSED',
    private: true,
  }, null, 2);
}

/**
 * Generate the complete simulation ZIP bundle with AI-generated kernel
 * 
 * NOTE: This produces a COMPILED artifact with a unique, AI-generated kernel.
 * Every build gets custom enforcement code - no default kernels.
 */
export async function generateSimulationBundle(
  compiled: CompiledSimulation, 
  onProgress?: GenerationProgressCallback
): Promise<Blob> {
  const zip = new JSZip();
  
  // Generate AI kernel for this specific build
  let kernelCode: string;
  let kernelMetadata: { generatedAt: string; fallback: boolean; patternsGenerated: number } = {
    generatedAt: new Date().toISOString(),
    fallback: true,
    patternsGenerated: 0,
  };
  
  const aiKernel = await generateAIKernel(compiled, onProgress);
  
  if (aiKernel) {
    kernelCode = aiKernel.code;
    kernelMetadata = {
      generatedAt: aiKernel.metadata.generatedAt,
      fallback: aiKernel.metadata.fallback || false,
      patternsGenerated: aiKernel.metadata.patternsGenerated,
    };
    console.log('[bundleGenerator] Using AI-generated kernel with', kernelMetadata.patternsGenerated, 'patterns');
  } else {
    // Fallback to rule-based generation
    console.log('[bundleGenerator] Using fallback kernel generation');
    kernelCode = generateFallbackKernel(compiled);
    onProgress?.('packaging', 'Using rule-based kernel (AI unavailable)...');
  }
  
  // Root files
  zip.file('manifest.json', generateManifest(compiled, kernelMetadata));
  zip.file('README.md', generateReadme(compiled));
  zip.file('package.json', generatePackageJson(compiled));
  
  // Compiled simulation data with starter prompts, context settings, and description
  const starterPrompts = compiled.starterPrompts || getStarterPromptsForDomain(compiled.domain);
  const contextSettings = compiled.contextSettings || {
    allowWorldToggle: true,
    defaultContext: 'files',
    contentRequired: true
  };
  
  // Generate description for Runner sidebar
  const domainLabel = compiled.domain.charAt(0).toUpperCase() + compiled.domain.slice(1);
  const description = `A ${domainLabel} domain Thinking Space with ${compiled.metadata.totalRulesCount} rules. ` +
    `Allows ${compiled.rules.required.length} behaviors and restricts ${compiled.rules.forbidden.length}.`;
  
  // Serialize roles with responsibilities and mandates for Runner consumption
  const serializedRoles = (compiled.roles || []).map(role => ({
    id: role.id,
    name: role.name,
    description: role.description,
    icon: role.icon,
    canDo: role.canDo,
    cannotDo: role.cannotDo,
    canAnalyze: role.canAnalyze,
    canSuggest: role.canSuggest,
    canClaimExecution: role.canClaimExecution,
    requiresApproval: role.requiresApproval,
    voiceStyle: role.voiceStyle,
    epistemicPosture: role.epistemicPosture,
    // CRITICAL: Include roleResponsibility for decision accountability
    roleResponsibility: role.roleResponsibility,
    // CRITICAL: Include roleMandate for cognitive differentiation
    roleMandate: role.roleMandate,
    canApproveFor: role.canApproveFor,
    approvalScope: role.approvalScope,
  }));
  
  const simulationData = {
    ...compiled,
    description, // 2-3 sentence summary
    starterPrompts,
    contextSettings,
    // Multi-agent support with full role data including mandates
    roles: serializedRoles,
    isMultiAgent: compiled.isMultiAgent || false,
    // Governance settings for Web Player runtime enforcement
    governance: compiled.governance ? {
      researchPosture: compiled.governance.researchPosture,
      responseBoundaries: compiled.governance.responseBoundaries,
    } : undefined,
    // Active World Rules - THE ACTUAL RULE TEXT for Runner to display
    activeWorldRules: {
      allowed: compiled.rules.required.map((r, i) => ({
        id: r.id || `allowed-${i}`,
        text: r.text,
        source: 'simulation',
      })),
      forbidden: compiled.rules.forbidden.map((r, i) => ({
        id: r.id || `forbidden-${i}`,
        text: r.text,
        source: 'simulation',
      })),
    },
    // Cognitive lens fields — preserved in bundle for Web Player rehydration
    cognitiveMode: (compiled as any).cognitiveMode || undefined,
    genrePresets: (compiled as any).genrePresets || undefined,
  };
  zip.file('simulation.json', JSON.stringify(simulationData, null, 2));
  
  // Kernel directory - contains both kernel.json (rules) and kernel-guard.js (enforcement code)
  // kernel.json is required by the Runner to load the Thinking Space
  const kernelJson = {
    name: compiled.metadata.name,
    version: compiled.metadata.version,
    generatedAt: kernelMetadata.generatedAt,
    type: kernelMetadata.fallback ? 'rule-based' : 'ai-generated',
    reasoningRules: {
      // World-level rules = safety invariants only
      required: compiled.rules.required.map(r => r.text),
      forbidden: compiled.rules.forbidden.map(r => r.text),
    },
    authority: {
      granted: compiled.rules.required.map(r => r.text),
      denied: compiled.rules.forbidden.map(r => r.text),
    },
    worldPhysics: {
      domain: compiled.domain,
      contentPolicy: contextSettings,
    },
    invariants: {
      custom: compiled.rules.forbidden.map((r, i) => ({
        id: `inv-${i + 1}`,
        rule: r.text,
        enforcementStatus: 'enforced',
      })),
    },
    // Governance settings for runtime enforcement
    governance: compiled.governance ? {
      researchPosture: compiled.governance.researchPosture,
      responseBoundaries: {
        must: compiled.governance.responseBoundaries.filter(b => b.type === 'must').map(b => b.text),
        mustNot: compiled.governance.responseBoundaries.filter(b => b.type === 'must-not').map(b => b.text),
      },
    } : undefined,
    // Role-specific cognition data for multi-agent worlds
    roles: serializedRoles.length > 0 ? serializedRoles.map(role => ({
      id: role.id,
      name: role.name,
      roleResponsibility: role.roleResponsibility,
      roleMandate: role.roleMandate,
      canDo: role.canDo,
      cannotDo: role.cannotDo,
    })) : undefined,
    isMultiAgent: compiled.isMultiAgent || false,
  };
  zip.file('kernel/kernel.json', JSON.stringify(kernelJson, null, 2));
  
  // AI-generated kernel guard code
  zip.file('kernel/kernel-guard.js', kernelCode);
  
  // Also include static guard files for compatibility
  zip.file('guards/simulation-guard.ts', generateGuardTS(compiled));
  zip.file('guards/simulation-guard.js', generateGuardJS(compiled));
  zip.file('guards/simulation-guard.py', generateGuardPy(compiled));
  
  onProgress?.('complete', 'Your Thinking Space is ready!');
  
  return await zip.generateAsync({ type: 'blob' });
}

/**
 * Trigger download of simulation bundle with progress feedback
 */
export async function downloadSimulationBundle(
  compiled: CompiledSimulation,
  onProgress?: GenerationProgressCallback
): Promise<void> {
  const blob = await generateSimulationBundle(compiled, onProgress);
  
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${compiled.metadata.name}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
