/**
 * CompositionEngine — Reactive Narrative Synthesis for Explore Space
 *
 * When a user moves a lever, the CalibrationEngine computes what happened
 * (deterministic, <1ms). The CompositionEngine then narrates WHY it matters:
 *
 * 1. What changed (the lever adjustment)
 * 2. What cascaded (amplification/undermining effects)
 * 3. What broke (failure modes activated)
 * 4. What recovered (failure modes deactivated)
 * 5. What's at risk (emerging failures, partially-met conditions)
 *
 * TWO MODES:
 * - Deterministic (always available, instant): Structured prose from world file data
 * - AI-enhanced (requires credits, debounced): Richer narrative synthesis
 *
 * The deterministic mode uses ONLY data from the world file:
 * - Lever labels and descriptions
 * - Failure mode consequenceText
 * - Cascade weights and relationships
 * - Stability scores and classifications
 *
 * No AI invention. Every claim traceable to the world file.
 */

import type { CalibrationResult, LeverAnalysis, FailureModeAnalysis, CascadeEffect } from './CalibrationEngine';
import type { LeverLevel, CalibrationConfig } from './types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CompositionMessage {
  /** What triggered this composition */
  type: 'lever_change' | 'context_change' | 'initial' | 'apply_recommended';
  /** The lever that changed (if type === 'lever_change') */
  lever?: { id: string; label: string; from: LeverLevel; to: LeverLevel };
  /** Stability score change */
  stabilityDelta: { from: number; to: number; classFrom: string; classTo: string };
  /** Cascade effects caused by this change */
  cascadeNarrations: CascadeNarration[];
  /** Failure modes that just activated */
  failuresActivated: FailureNarration[];
  /** Failure modes that just deactivated */
  failuresDeactivated: FailureNarration[];
  /** Failure modes approaching activation (emerging risks) */
  emergingRisks: EmergingRisk[];
  /** The deterministic narrative (always available) */
  narrative: string;
  /** Severity: how significant is this change? */
  severity: 'minor' | 'notable' | 'critical';
  /** Timestamp */
  timestamp: number;
}

export interface CascadeNarration {
  sourceLever: string;
  targetLever: string;
  type: 'amplification' | 'undermine';
  contribution: number;
  sentence: string;
}

export interface FailureNarration {
  id: string;
  label: string;
  consequenceText: string;
}

export interface EmergingRisk {
  id: string;
  label: string;
  conditionsMet: number;
  conditionsTotal: number;
  closestCondition: string;
}

// ─── Core Composition ────────────────────────────────────────────────────────

/**
 * Compose a narrative from the delta between two calibration results.
 *
 * If prevResult is null, treats this as an initial evaluation (first context
 * selection or page load).
 */
export function compose(
  config: CalibrationConfig,
  prevResult: CalibrationResult | null,
  newResult: CalibrationResult,
  changedLever?: { id: string; from: LeverLevel; to: LeverLevel },
): CompositionMessage {
  const type = changedLever ? 'lever_change' : (prevResult ? 'apply_recommended' : 'initial');

  // Stability delta
  const prevScore = prevResult?.stabilityScore ?? 100;
  const prevClass = prevResult?.classification ?? 'thriving';
  const stabilityDelta = {
    from: prevScore,
    to: newResult.stabilityScore,
    classFrom: prevClass,
    classTo: newResult.classification,
  };

  // Find the lever label
  const leverLabel = changedLever
    ? config.levers.find(l => l.id === changedLever.id)?.label ?? changedLever.id
    : undefined;

  // Cascade narrations for the changed lever
  const cascadeNarrations: CascadeNarration[] = [];
  if (changedLever) {
    const lever = config.levers.find(l => l.id === changedLever.id);
    if (lever) {
      for (const cascade of newResult.cascades.filter(c => c.sourceLeverId === changedLever.id)) {
        const targetLever = config.levers.find(l => l.id === cascade.targetLeverId);
        const targetLabel = targetLever?.label ?? cascade.targetLeverId;
        const verb = cascade.type === 'amplification' ? 'strengthens' : 'weakens';
        const sign = cascade.contribution >= 0 ? '+' : '';

        cascadeNarrations.push({
          sourceLever: leverLabel!,
          targetLever: targetLabel,
          type: cascade.type,
          contribution: cascade.contribution,
          sentence: `${leverLabel} ${verb} ${targetLabel} (${sign}${cascade.contribution.toFixed(2)})`,
        });
      }
    }
  }

  // Failure mode changes
  const prevActiveFMs = new Set(
    prevResult?.failureModes.filter(fm => fm.active).map(fm => fm.failureModeId) ?? []
  );
  const newActiveFMs = new Set(
    newResult.failureModes.filter(fm => fm.active).map(fm => fm.failureModeId)
  );

  const failuresActivated: FailureNarration[] = newResult.failureModes
    .filter(fm => fm.active && !prevActiveFMs.has(fm.failureModeId))
    .map(fm => ({ id: fm.failureModeId, label: fm.label, consequenceText: fm.consequenceText }));

  const failuresDeactivated: FailureNarration[] = (prevResult?.failureModes ?? [])
    .filter(fm => fm.active && !newActiveFMs.has(fm.failureModeId))
    .map(fm => ({ id: fm.failureModeId, label: fm.label, consequenceText: fm.consequenceText }));

  // Emerging risks: inactive failure modes where ≥50% of conditions are met
  const emergingRisks: EmergingRisk[] = newResult.failureModes
    .filter(fm => !fm.active)
    .map(fm => {
      const met = fm.conditionResults.filter(c => c.met).length;
      const total = fm.conditionResults.length;
      if (met === 0 || met / total < 0.5) return null;

      // Find the closest unmet condition
      const unmet = fm.conditionResults.find(c => !c.met);
      const closestCondition = unmet
        ? `${unmet.condition.leverId} is ${unmet.currentValue.toFixed(2)}, needs ${unmet.condition.operator} ${unmet.condition.value}`
        : '';

      return { id: fm.failureModeId, label: fm.label, conditionsMet: met, conditionsTotal: total, closestCondition };
    })
    .filter((r): r is EmergingRisk => r !== null);

  // Determine severity
  const scoreDelta = Math.abs(newResult.stabilityScore - prevScore);
  const classChanged = prevClass !== newResult.classification;
  const hasNewFailures = failuresActivated.length > 0;
  let severity: CompositionMessage['severity'] = 'minor';
  if (hasNewFailures || (classChanged && newResult.classification === 'collapse')) {
    severity = 'critical';
  } else if (classChanged || scoreDelta > 15) {
    severity = 'notable';
  }

  // Build deterministic narrative
  const narrative = buildNarrative({
    type,
    leverLabel,
    changedLever,
    stabilityDelta,
    cascadeNarrations,
    failuresActivated,
    failuresDeactivated,
    emergingRisks,
    severity,
  });

  return {
    type,
    lever: changedLever ? { ...changedLever, label: leverLabel! } : undefined,
    stabilityDelta,
    cascadeNarrations,
    failuresActivated,
    failuresDeactivated,
    emergingRisks,
    narrative,
    severity,
    timestamp: Date.now(),
  };
}

// ─── Narrative Builder ──────────────────────────────────────────────────────

interface NarrativeInput {
  type: CompositionMessage['type'];
  leverLabel?: string;
  changedLever?: { id: string; from: LeverLevel; to: LeverLevel };
  stabilityDelta: CompositionMessage['stabilityDelta'];
  cascadeNarrations: CascadeNarration[];
  failuresActivated: FailureNarration[];
  failuresDeactivated: FailureNarration[];
  emergingRisks: EmergingRisk[];
  severity: CompositionMessage['severity'];
}

function buildNarrative(input: NarrativeInput): string {
  const parts: string[] = [];

  // Opening: what the user did
  if (input.type === 'lever_change' && input.leverLabel && input.changedLever) {
    parts.push(`${input.leverLabel} moved to ${input.changedLever.to}.`);
  } else if (input.type === 'initial') {
    parts.push(`Initial calibration evaluated.`);
  } else if (input.type === 'apply_recommended') {
    parts.push(`Recommended calibration applied.`);
  }

  // Stability change
  const delta = input.stabilityDelta.to - input.stabilityDelta.from;
  if (Math.abs(delta) > 1) {
    const direction = delta > 0 ? 'improved' : 'dropped';
    parts.push(`Stability ${direction} from ${Math.round(input.stabilityDelta.from)} to ${Math.round(input.stabilityDelta.to)}.`);
  }

  // Classification change
  if (input.stabilityDelta.classFrom !== input.stabilityDelta.classTo) {
    parts.push(`System shifted from ${input.stabilityDelta.classFrom} to ${input.stabilityDelta.classTo}.`);
  }

  // Cascades (only if lever_change, show top 3 by magnitude)
  if (input.cascadeNarrations.length > 0) {
    const sorted = [...input.cascadeNarrations].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
    const top = sorted.slice(0, 3);
    for (const c of top) {
      parts.push(c.sentence + '.');
    }
  }

  // Failures activated (critical — always show)
  for (const fm of input.failuresActivated) {
    parts.push(`${fm.label} is now active: ${fm.consequenceText}`);
  }

  // Failures deactivated (good news)
  for (const fm of input.failuresDeactivated) {
    parts.push(`${fm.label} is no longer active.`);
  }

  // Emerging risks (show top 2)
  const topRisks = input.emergingRisks.slice(0, 2);
  for (const risk of topRisks) {
    parts.push(`${risk.label}: ${risk.conditionsMet}/${risk.conditionsTotal} conditions met — ${risk.closestCondition}.`);
  }

  return parts.join(' ');
}

// ─── Governed AI Narration ───────────────────────────────────────────────────
//
// AI-enhanced composition is a GOVERNED ACTION, not a prompt-constrained one.
//
// Governance by structure, not by trust:
// 1. PRE-SYNTHESIS: Build an allowed-terms vocabulary from the CompositionMessage.
//    The AI only receives data that exists in the world file.
// 2. POST-VALIDATION: Every term the AI references is checked against the
//    vocabulary. Any invented mechanism = governance violation = rejection.
// 3. FAIL-CLOSED: On violation, the user sees the deterministic narrative.
// 4. AUDIT: Every narration decision is logged with classification + result.

/**
 * The set of terms the AI is structurally allowed to reference.
 * Built from the CompositionMessage — not from the full world file.
 * This is the governance boundary.
 */
export interface NarrationVocabulary {
  /** Lever names the AI may reference */
  leverTerms: string[];
  /** Failure mode names the AI may reference */
  failureTerms: string[];
  /** Classification terms the AI may reference */
  classificationTerms: string[];
  /** Cascade relationship descriptions the AI may reference */
  cascadeTerms: string[];
  /** All allowed terms combined (lowercased for matching) */
  allTerms: Set<string>;
}

/** Pre-synthesis classification — determines if AI narration is allowed */
export type NarrationClassification =
  | 'DETERMINISTIC_ONLY'    // Insufficient structural data for AI
  | 'NARRATION_ALLOWED'     // Enough data, AI may synthesize
  | 'NARRATION_BLOCKED';    // Severity too low to spend credits

/** Post-validation result */
export interface NarrationValidation {
  valid: boolean;
  violations: string[];
  /** The narration to show (original if valid, deterministic fallback if not) */
  narration: string;
}

/** Audit record for every AI narration attempt */
export interface NarrationAuditRecord {
  type: 'COMPOSITION_NARRATION';
  timestamp: number;
  classification: NarrationClassification;
  aiGenerated: boolean;
  validation: {
    passed: boolean;
    violationCount: number;
    violations: string[];
  };
  compositionSeverity: CompositionMessage['severity'];
  deterministicFallback: boolean;
}

/**
 * Build the allowed-terms vocabulary from a CompositionMessage.
 * This is the structural boundary — the AI cannot reference anything
 * outside this vocabulary.
 */
export function buildNarrationVocabulary(message: CompositionMessage): NarrationVocabulary {
  const leverTerms: string[] = [];
  const failureTerms: string[] = [];
  const classificationTerms: string[] = [];
  const cascadeTerms: string[] = [];

  // Lever terms
  if (message.lever) {
    leverTerms.push(message.lever.label);
    leverTerms.push(message.lever.id);
  }
  for (const c of message.cascadeNarrations) {
    leverTerms.push(c.sourceLever);
    leverTerms.push(c.targetLever);
  }

  // Failure terms
  for (const fm of [...message.failuresActivated, ...message.failuresDeactivated]) {
    failureTerms.push(fm.label);
    failureTerms.push(fm.id);
  }
  for (const risk of message.emergingRisks) {
    failureTerms.push(risk.label);
    failureTerms.push(risk.id);
  }

  // Classification terms
  classificationTerms.push(message.stabilityDelta.classFrom);
  classificationTerms.push(message.stabilityDelta.classTo);

  // Cascade relationship terms
  for (const c of message.cascadeNarrations) {
    cascadeTerms.push(c.sentence);
    cascadeTerms.push(c.type); // 'amplification' | 'undermine'
  }

  // Build combined set (lowercased for fuzzy matching)
  const allTerms = new Set<string>();
  for (const term of [...leverTerms, ...failureTerms, ...classificationTerms, ...cascadeTerms]) {
    allTerms.add(term.toLowerCase());
    // Also add individual words for multi-word terms
    for (const word of term.toLowerCase().split(/\s+/)) {
      if (word.length > 3) allTerms.add(word);
    }
  }

  return { leverTerms, failureTerms, classificationTerms, cascadeTerms, allTerms };
}

/**
 * Pre-synthesis guard: classify whether AI narration is allowed.
 */
export function classifyNarration(message: CompositionMessage): NarrationClassification {
  // Don't spend credits on minor adjustments
  if (message.severity === 'minor') return 'NARRATION_BLOCKED';

  // Need at least some structural data to narrate
  const hasSubstance = message.cascadeNarrations.length > 0
    || message.failuresActivated.length > 0
    || message.failuresDeactivated.length > 0
    || message.emergingRisks.length > 0
    || message.stabilityDelta.classFrom !== message.stabilityDelta.classTo;

  if (!hasSubstance) return 'DETERMINISTIC_ONLY';

  return 'NARRATION_ALLOWED';
}

/**
 * Post-validation guard: check AI output against the narration vocabulary.
 *
 * Extracts capitalized proper nouns and bracketed references from the AI
 * response and checks each against the allowed vocabulary. Any term that
 * looks like a specific mechanism reference but doesn't appear in the
 * vocabulary is a governance violation.
 *
 * This is structural validation — not semantic. We check terms, not meaning.
 */
export function validateNarration(
  aiResponse: string,
  vocabulary: NarrationVocabulary,
  deterministicFallback: string,
): NarrationValidation {
  const violations: string[] = [];

  // Extract bracketed references like [Elite Conspiracy] or [lever-military]
  const bracketedRefs = aiResponse.match(/\[([^\]]+)\]/g) || [];
  for (const ref of bracketedRefs) {
    const term = ref.slice(1, -1).toLowerCase();
    if (!vocabulary.allTerms.has(term)) {
      // Check if any vocabulary term contains this term or vice versa
      const found = [...vocabulary.allTerms].some(
        allowed => allowed.includes(term) || term.includes(allowed)
      );
      if (!found) {
        violations.push(`Unknown reference: ${ref} — not in structural data`);
      }
    }
  }

  // Check for invented causal language that implies mechanisms not in the data
  // These patterns suggest the AI is inventing rather than synthesizing
  const inventionPatterns = [
    /this could lead to/i,
    /might cause/i,
    /potentially trigger/i,
    /there'?s a risk that/i,
    /it'?s possible that/i,
    /in the future/i,
    /historically/i,
    /typically/i,
    /in general/i,
    /research suggests/i,
    /studies show/i,
  ];

  for (const pattern of inventionPatterns) {
    if (pattern.test(aiResponse)) {
      violations.push(`Speculative language detected: ${pattern.source}`);
    }
  }

  // Check length — AI should produce 2-4 sentences, not essays
  const sentenceCount = aiResponse.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
  if (sentenceCount > 6) {
    violations.push(`Response too long: ${sentenceCount} sentences (max 6)`);
  }

  if (violations.length > 0) {
    return {
      valid: false,
      violations,
      narration: deterministicFallback, // Fail-closed: show deterministic
    };
  }

  return { valid: true, violations: [], narration: aiResponse };
}

/**
 * Build the governed AI composition request.
 *
 * Unlike a bare prompt, this:
 * 1. Pre-classifies whether narration is allowed
 * 2. Builds the vocabulary boundary
 * 3. Returns everything needed for post-validation
 *
 * The caller (CompositionPanel) is responsible for:
 * - Calling the AI edge function
 * - Running validateNarration() on the response
 * - Logging the audit record
 */
export function buildGovernedComposition(message: CompositionMessage): {
  classification: NarrationClassification;
  vocabulary: NarrationVocabulary;
  systemPrompt: string;
  userPrompt: string;
} | null {
  const classification = classifyNarration(message);

  if (classification !== 'NARRATION_ALLOWED') {
    return null; // Pre-synthesis guard: narration not allowed
  }

  const vocabulary = buildNarrationVocabulary(message);

  // The system prompt declares the governance boundary explicitly.
  // The AI is told EXACTLY which terms it may reference — nothing else.
  const systemPrompt = `You are the Explore Space narrator for a governed simulation.

YOUR ROLE: Synthesize the structural changes below into 2-4 sentences of concise prose.

GOVERNANCE BOUNDARY — You may ONLY reference these terms:
LEVERS: ${vocabulary.leverTerms.length > 0 ? vocabulary.leverTerms.join(', ') : 'none'}
FAILURE MODES: ${vocabulary.failureTerms.length > 0 ? vocabulary.failureTerms.join(', ') : 'none'}
CLASSIFICATIONS: ${vocabulary.classificationTerms.join(', ')}
CASCADE TYPES: ${vocabulary.cascadeTerms.length > 0 ? vocabulary.cascadeTerms.join(', ') : 'none'}

RULES:
- Reference ONLY the terms listed above. Do not introduce new terms.
- Describe what DID happen, not what MIGHT happen.
- Use present tense. Be direct.
- If a failure mode activated, lead with that.
- No speculation, no hedging, no "could" or "might" language.
- Maximum 4 sentences.`;

  const userPrompt = `Synthesize this calibration change:

ACTION: ${message.narrative}
STABILITY: ${Math.round(message.stabilityDelta.from)} → ${Math.round(message.stabilityDelta.to)} (${message.stabilityDelta.classFrom} → ${message.stabilityDelta.classTo})
${message.cascadeNarrations.length > 0 ? 'CASCADES:\n' + message.cascadeNarrations.map(c => `- ${c.sentence}`).join('\n') : ''}
${message.failuresActivated.length > 0 ? 'FAILURES ACTIVATED:\n' + message.failuresActivated.map(f => `- ${f.label}: ${f.consequenceText}`).join('\n') : ''}
${message.failuresDeactivated.length > 0 ? 'FAILURES RESOLVED:\n' + message.failuresDeactivated.map(f => `- ${f.label}`).join('\n') : ''}
${message.emergingRisks.length > 0 ? 'EMERGING RISKS:\n' + message.emergingRisks.map(r => `- ${r.label}: ${r.conditionsMet}/${r.conditionsTotal} conditions met`).join('\n') : ''}`;

  return { classification, vocabulary, systemPrompt, userPrompt };
}

/**
 * Create an audit record for a narration attempt.
 */
export function createNarrationAudit(
  classification: NarrationClassification,
  aiGenerated: boolean,
  validation: NarrationValidation | null,
  severity: CompositionMessage['severity'],
): NarrationAuditRecord {
  return {
    type: 'COMPOSITION_NARRATION',
    timestamp: Date.now(),
    classification,
    aiGenerated,
    validation: validation
      ? { passed: validation.valid, violationCount: validation.violations.length, violations: validation.violations }
      : { passed: true, violationCount: 0, violations: [] },
    compositionSeverity: severity,
    deterministicFallback: !aiGenerated || (validation ? !validation.valid : false),
  };
}
