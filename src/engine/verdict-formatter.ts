/**
 * Verdict Formatter — Human-Readable Verdict Output
 *
 * Converts a GuardVerdict into a consistent, human-readable string.
 * Used by adapters, CLIs, and UIs to display governance decisions.
 *
 * Design:
 *   - One function, one concern: verdict → string
 *   - No side effects, no I/O
 *   - Adapters call this so every integration has consistent messaging
 */

import type { GuardVerdict } from '../contracts/guard-contract';

// ─── Format Options ─────────────────────────────────────────────────────────

export interface FormatVerdictOptions {
  /** Include rule/guard ID. Default: true. */
  showRuleId?: boolean;

  /** Include evidence summary. Default: false. */
  showEvidence?: boolean;

  /** Include warning if present. Default: true. */
  showWarning?: boolean;

  /** Use ANSI colors in output. Default: false. */
  color?: boolean;

  /** Compact single-line format. Default: false. */
  compact?: boolean;
}

// ─── ANSI helpers ───────────────────────────────────────────────────────────

const ANSI = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
};

function c(text: string, ...codes: string[]): string {
  return codes.join('') + text + ANSI.reset;
}

// ─── Format Functions ───────────────────────────────────────────────────────

/**
 * Format a GuardVerdict as a human-readable string.
 *
 * Examples:
 *   formatVerdict(verdict)
 *   // "BLOCKED\n  Rule: margin_floor\n  Reason: margin ratio below 10%"
 *
 *   formatVerdict(verdict, { compact: true })
 *   // "BLOCKED — margin_floor: margin ratio below 10%"
 *
 *   formatVerdict(verdict, { color: true })
 *   // Same but with ANSI colors
 */
export function formatVerdict(verdict: GuardVerdict, options: FormatVerdictOptions = {}): string {
  const {
    showRuleId = true,
    showEvidence = false,
    showWarning = true,
    color = false,
    compact = false,
  } = options;

  if (compact) {
    return formatCompact(verdict, { showRuleId, showWarning, color });
  }

  return formatFull(verdict, { showRuleId, showEvidence, showWarning, color });
}

function formatCompact(
  verdict: GuardVerdict,
  opts: { showRuleId: boolean; showWarning: boolean; color: boolean },
): string {
  const status = formatStatus(verdict.status, opts.color);
  const parts: string[] = [status];

  if (opts.showRuleId && verdict.ruleId) {
    parts.push(verdict.ruleId);
  }
  if (verdict.reason) {
    parts.push(verdict.reason);
  }
  if (opts.showWarning && verdict.warning) {
    parts.push(`warning: ${verdict.warning}`);
  }

  return parts.join(' — ');
}

function formatFull(
  verdict: GuardVerdict,
  opts: { showRuleId: boolean; showEvidence: boolean; showWarning: boolean; color: boolean },
): string {
  const lines: string[] = [];

  // Status line
  lines.push(formatStatus(verdict.status, opts.color));

  // Rule
  if (opts.showRuleId && verdict.ruleId) {
    lines.push(`  Rule: ${verdict.ruleId}`);
  }

  // Reason
  if (verdict.reason) {
    lines.push(`  Reason: ${verdict.reason}`);
  }

  // Consequence (PENALIZE)
  if (verdict.consequence) {
    const label = opts.color ? c('Consequence:', ANSI.red) : 'Consequence:';
    lines.push(`  ${label} ${verdict.consequence.description}`);
    if (verdict.consequence.rounds) {
      lines.push(`  Freeze: ${verdict.consequence.rounds} round(s)`);
    }
    if (verdict.consequence.magnitude) {
      lines.push(`  Magnitude: ${(verdict.consequence.magnitude * 100).toFixed(0)}%`);
    }
  }

  // Reward (REWARD)
  if (verdict.reward) {
    const label = opts.color ? c('Reward:', ANSI.blue) : 'Reward:';
    lines.push(`  ${label} ${verdict.reward.description}`);
    if (verdict.reward.rounds) {
      lines.push(`  Duration: ${verdict.reward.rounds} round(s)`);
    }
    if (verdict.reward.magnitude) {
      lines.push(`  Boost: ${(verdict.reward.magnitude * 100).toFixed(0)}%`);
    }
  }

  // Intent record
  if (verdict.intentRecord) {
    const ir = verdict.intentRecord;
    const label = opts.color ? c('Intent Flow:', ANSI.cyan) : 'Intent Flow:';
    lines.push(`  ${label} ${ir.originalIntent} → ${ir.finalAction}`);
  }

  // Warning
  if (opts.showWarning && verdict.warning) {
    const label = opts.color ? c('Warning:', ANSI.yellow) : 'Warning:';
    lines.push(`  ${label} ${verdict.warning}`);
  }

  // Evidence
  if (opts.showEvidence) {
    const ev = verdict.evidence;
    lines.push(`  World: ${ev.worldName} v${ev.worldVersion}`);
    lines.push(`  Invariants: ${ev.invariantsSatisfied}/${ev.invariantsTotal} covered`);

    if (ev.guardsMatched.length > 0) {
      lines.push(`  Guards matched: ${ev.guardsMatched.join(', ')}`);
    }
    if (ev.rulesMatched.length > 0) {
      lines.push(`  Rules matched: ${ev.rulesMatched.join(', ')}`);
    }
    lines.push(`  Enforcement: ${ev.enforcementLevel}`);
  }

  return lines.join('\n');
}

function formatStatus(status: string, color: boolean): string {
  switch (status) {
    case 'ALLOW':
      return color ? c('ALLOWED', ANSI.green, ANSI.bold) : 'ALLOWED';
    case 'BLOCK':
      return color ? c('BLOCKED', ANSI.red, ANSI.bold) : 'BLOCKED';
    case 'PAUSE':
      return color ? c('PAUSED', ANSI.yellow, ANSI.bold) : 'PAUSED';
    case 'MODIFY':
      return color ? c('MODIFIED', ANSI.yellow, ANSI.bold) : 'MODIFIED';
    case 'PENALIZE':
      return color ? c('PENALIZED', ANSI.red, ANSI.bold) : 'PENALIZED';
    case 'REWARD':
      return color ? c('REWARDED', ANSI.blue, ANSI.bold) : 'REWARDED';
    case 'NEUTRAL':
      return color ? c('NEUTRAL', ANSI.gray, ANSI.bold) : 'NEUTRAL';
    default:
      return status;
  }
}

/**
 * Format a verdict as a short one-line status message.
 * Useful for logging, status bars, and notifications.
 *
 * Example: "BLOCKED: margin_floor — margin ratio below 10%"
 */
export function formatVerdictOneLine(verdict: GuardVerdict): string {
  const parts: string[] = [verdict.status];

  if (verdict.ruleId) {
    parts[0] += `: ${verdict.ruleId}`;
  }

  if (verdict.reason) {
    parts.push(verdict.reason);
  }

  return parts.join(' — ');
}
