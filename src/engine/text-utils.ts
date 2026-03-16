/**
 * Shared Text Utilities for Engine Layer
 *
 * Consolidates duplicated text processing logic across engine files:
 *   - Event text normalization (was in guard-engine, plan-engine 3x)
 *   - Keyword matching variants (was in guard-engine, plan-engine)
 *   - Token similarity (was in plan-engine)
 *   - Safe regex creation (was in guard-engine, condition-engine)
 */

import type { GuardEvent } from '../contracts/guard-contract';

// ─── Event Text Normalization ───────────────────────────────────────────────

/**
 * Build a normalized text string from a GuardEvent for matching.
 *
 * Previously duplicated in:
 *   - guard-engine.ts:181-183
 *   - plan-engine.ts:317-321
 *   - plan-engine.ts:384
 */
export function normalizeEventText(event: GuardEvent): string {
  return [
    event.intent,
    event.tool ?? '',
    event.scope ?? '',
  ].join(' ').toLowerCase();
}

// ─── Keyword Matching ───────────────────────────────────────────────────────

/**
 * Split text into significant keywords (length > minLength).
 */
export function extractKeywords(text: string, minLength = 3): string[] {
  return text.toLowerCase().split(/\s+/).filter(w => w.length > minLength);
}

/**
 * Strict AND keyword matching: ALL significant keywords (>3 chars)
 * from ruleText must be present in eventText.
 *
 * Previously duplicated in:
 *   - guard-engine.ts:830-834 (matchesKeywords)
 */
export function matchesAllKeywords(eventText: string, ruleText: string): boolean {
  const keywords = extractKeywords(ruleText);
  if (keywords.length === 0) return false;
  return keywords.every(kw => eventText.includes(kw));
}

/**
 * Flexible threshold keyword matching: at least `threshold` fraction
 * of keywords must match.
 *
 * Previously similar to plan-engine.ts:38-50 (keywordMatch).
 */
export function matchesKeywordThreshold(
  eventText: string,
  ruleText: string,
  threshold = 0.5,
): boolean {
  const keywords = extractKeywords(ruleText);
  if (keywords.length === 0) return false;
  const matched = keywords.filter(kw => eventText.includes(kw));
  return matched.length >= Math.ceil(keywords.length * threshold);
}

// ─── Token Similarity ───────────────────────────────────────────────────────

/**
 * Compute Jaccard token-overlap similarity between two strings.
 * Returns a value between 0 and 1.
 *
 * Previously in plan-engine.ts:63-77.
 */
export function tokenSimilarity(a: string, b: string): number {
  const tokensA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const tokensB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }

  const union = new Set([...tokensA, ...tokensB]).size;
  return union > 0 ? intersection / union : 0;
}

// ─── Safe Regex ─────────────────────────────────────────────────────────────

/**
 * Compile a regex pattern safely, returning null on invalid patterns.
 *
 * Previously duplicated as try/catch blocks in:
 *   - guard-engine.ts:592-599
 *   - guard-engine.ts:700-705
 *   - condition-engine.ts:203-215
 */
export function createSafeRegex(pattern: string, flags = 'i'): RegExp | null {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}
