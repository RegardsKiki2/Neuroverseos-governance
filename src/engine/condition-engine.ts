/**
 * Condition Engine — Structured operator evaluation
 *
 * Ported from the OpenClaw governance plugin. Provides 12 operators
 * for evaluating conditions against guard events:
 *
 *   ==, !=, >, <, >=, <=, in,
 *   contains, contains_any, matches_pattern, starts_with, ends_with
 *
 * Supports dot-notation field resolution (e.g. "args.command", "args.file_path")
 * for inspecting tool arguments.
 *
 * Deterministic. No AI. No network. Sub-millisecond per evaluation.
 */

import type { GuardEvent } from '../contracts/guard-contract';

// ─── Types ──────────────────────────────────────────────────────────────────

export type ConditionOperator =
  | '==' | '!=' | '>' | '<' | '>=' | '<='
  | 'in' | 'contains' | 'contains_any'
  | 'matches_pattern' | 'starts_with' | 'ends_with';

export interface Condition {
  field: string;
  operator: ConditionOperator;
  value: string | string[] | number | boolean;
}

export interface ConditionResult {
  matched: boolean;
  evidence: string | null;
}

// ─── Field Resolution ───────────────────────────────────────────────────────

/**
 * Resolve a field path from the event.
 * Supports top-level fields and nested args (e.g. "args.command", "args.file_path").
 */
function getFieldValue(event: GuardEvent, field: string): unknown {
  if (field.startsWith('args.')) {
    const key = field.slice(5);
    return event.args?.[key];
  }
  return (event as Record<string, unknown>)[field];
}

/**
 * Coerce a field value to string for text operations.
 * Objects/arrays are JSON-stringified. Nullish becomes empty string.
 */
function toString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

// ─── Core Evaluator ─────────────────────────────────────────────────────────

/**
 * Evaluate a single condition against a guard event.
 * Returns whether it matched and what evidence was found.
 */
export function evaluateCondition(
  condition: Condition,
  event: GuardEvent,
): ConditionResult {
  const fieldValue = getFieldValue(event, condition.field);

  // Missing field never matches (except != which evaluates against empty)
  if (fieldValue === undefined && condition.operator !== '!=') {
    return { matched: false, evidence: null };
  }

  switch (condition.operator) {
    case '==':
      return evaluateEquals(fieldValue, condition.value);
    case '!=':
      return evaluateNotEquals(fieldValue, condition.value);
    case '>':
      return evaluateComparison(fieldValue, condition.value, (a, b) => a > b);
    case '<':
      return evaluateComparison(fieldValue, condition.value, (a, b) => a < b);
    case '>=':
      return evaluateComparison(fieldValue, condition.value, (a, b) => a >= b);
    case '<=':
      return evaluateComparison(fieldValue, condition.value, (a, b) => a <= b);
    case 'in':
      return evaluateIn(fieldValue, condition.value);
    case 'contains':
      return evaluateContains(fieldValue, condition.value);
    case 'contains_any':
      return evaluateContainsAny(fieldValue, condition.value);
    case 'matches_pattern':
      return evaluateMatchesPattern(fieldValue, condition.value);
    case 'starts_with':
      return evaluateStartsWith(fieldValue, condition.value);
    case 'ends_with':
      return evaluateEndsWith(fieldValue, condition.value);
    default:
      return { matched: false, evidence: null };
  }
}

// ─── Operator Implementations ───────────────────────────────────────────────

function evaluateEquals(
  fieldValue: unknown,
  conditionValue: string | string[] | number | boolean,
): ConditionResult {
  const fieldStr = toString(fieldValue);
  const condStr = toString(conditionValue);
  const matched = fieldStr === condStr;
  return {
    matched,
    evidence: matched ? `${fieldStr} == ${condStr}` : null,
  };
}

function evaluateNotEquals(
  fieldValue: unknown,
  conditionValue: string | string[] | number | boolean,
): ConditionResult {
  const fieldStr = toString(fieldValue);
  const condStr = toString(conditionValue);
  const matched = fieldStr !== condStr;
  return {
    matched,
    evidence: matched ? `${fieldStr} != ${condStr}` : null,
  };
}

function evaluateComparison(
  fieldValue: unknown,
  conditionValue: string | string[] | number | boolean,
  comparator: (a: number, b: number) => boolean,
): ConditionResult {
  const a = Number(fieldValue);
  const b = Number(conditionValue);
  if (isNaN(a) || isNaN(b)) return { matched: false, evidence: null };
  const matched = comparator(a, b);
  return {
    matched,
    evidence: matched ? `${a} compared to ${b}` : null,
  };
}

function evaluateIn(
  fieldValue: unknown,
  conditionValue: string | string[] | number | boolean,
): ConditionResult {
  if (!Array.isArray(conditionValue)) return { matched: false, evidence: null };
  const fieldStr = toString(fieldValue);
  const matched = conditionValue.some(v => toString(v) === fieldStr);
  return {
    matched,
    evidence: matched ? `"${fieldStr}" found in [${conditionValue.join(', ')}]` : null,
  };
}

function evaluateContains(
  fieldValue: unknown,
  conditionValue: string | string[] | number | boolean,
): ConditionResult {
  const fieldStr = toString(fieldValue).toLowerCase();
  const searchStr = toString(conditionValue).toLowerCase();
  const matched = fieldStr.includes(searchStr);
  return {
    matched,
    evidence: matched ? `"${searchStr}" found in field` : null,
  };
}

function evaluateContainsAny(
  fieldValue: unknown,
  conditionValue: string | string[] | number | boolean,
): ConditionResult {
  if (!Array.isArray(conditionValue)) return { matched: false, evidence: null };
  const fieldStr = toString(fieldValue).toLowerCase();

  for (const pattern of conditionValue) {
    const patternLower = toString(pattern).toLowerCase();
    if (fieldStr.includes(patternLower)) {
      return {
        matched: true,
        evidence: `"${patternLower}" found in field`,
      };
    }
  }
  return { matched: false, evidence: null };
}

function evaluateMatchesPattern(
  fieldValue: unknown,
  conditionValue: string | string[] | number | boolean,
): ConditionResult {
  const fieldStr = toString(fieldValue);
  const patterns = Array.isArray(conditionValue) ? conditionValue : [toString(conditionValue)];

  for (const pattern of patterns) {
    try {
      const regex = new RegExp(toString(pattern), 'i');
      if (regex.test(fieldStr)) {
        return {
          matched: true,
          evidence: `matched pattern /${pattern}/`,
        };
      }
    } catch {
      // Invalid regex — skip silently (don't crash enforcement)
      continue;
    }
  }
  return { matched: false, evidence: null };
}

function evaluateStartsWith(
  fieldValue: unknown,
  conditionValue: string | string[] | number | boolean,
): ConditionResult {
  const fieldStr = toString(fieldValue).toLowerCase();
  const prefix = toString(conditionValue).toLowerCase();
  const matched = fieldStr.startsWith(prefix);
  return {
    matched,
    evidence: matched ? `field starts with "${prefix}"` : null,
  };
}

function evaluateEndsWith(
  fieldValue: unknown,
  conditionValue: string | string[] | number | boolean,
): ConditionResult {
  const fieldStr = toString(fieldValue).toLowerCase();
  const suffix = toString(conditionValue).toLowerCase();
  const matched = fieldStr.endsWith(suffix);
  return {
    matched,
    evidence: matched ? `field ends with "${suffix}"` : null,
  };
}
