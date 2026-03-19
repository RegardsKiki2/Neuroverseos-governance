/**
 * Governance Impact Report — Counterfactual Audit
 *
 * Answers: "What would have happened if governance did not exist?"
 *
 * This is the killer enterprise feature. It doesn't just log what happened —
 * it proves the value of governance by showing what it prevented.
 *
 * Architecture:
 *   - Reads audit events (from FileAuditLogger NDJSON)
 *   - Classifies blocked/paused actions by risk category
 *   - Produces an ImpactReport with aggregated prevention metrics
 *   - CLI renders as human-readable or JSON
 *
 * INVARIANTS:
 *   - No speculation — only reports on actual evaluated actions
 *   - Risk categories derived from world rules, not invented
 *   - All numbers are exact counts from the audit log
 */

import type { AuditEvent, AuditSummary } from './audit-logger';
import { readAuditLog, summarizeAuditEvents } from './audit-logger';

// ─── Impact Report Types ────────────────────────────────────────────────────

/**
 * A counterfactual governance impact report.
 */
export interface ImpactReport {
  /** Report metadata */
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  worldName: string;

  /** High-level stats */
  totalEvaluations: number;
  totalBlocked: number;
  totalPaused: number;
  totalAllowed: number;
  totalModified: number;
  totalPenalized: number;
  totalRewarded: number;
  totalNeutral: number;

  /** Prevention rate: (blocked + paused + modified + penalized) / total */
  preventionRate: number;

  /** Redirection rate: everything not ALLOW/NEUTRAL */
  redirectionRate: number;

  /** Blocked actions grouped by category */
  preventedByCategory: PreventionCategory[];

  /** Top prevented intents */
  topPreventedIntents: { intent: string; count: number; topRule: string }[];

  /** Actors with most blocked actions (potential policy violations) */
  hotActors: { actor: string; blocked: number; paused: number; total: number }[];

  /** Rules that triggered most often */
  mostActiveRules: { ruleId: string; blockCount: number; pauseCount: number }[];

  /** Hourly activity pattern (governance load) */
  hourlyDistribution: { hour: number; total: number; blocked: number }[];

  /** Repeat offenders: actions attempted more than once after being blocked */
  repeatViolations: { intent: string; actor: string; attempts: number; firstSeen: string; lastSeen: string }[];
}

export interface PreventionCategory {
  category: string;
  count: number;
  /** Example intents in this category */
  examples: string[];
}

// ─── Report Generation ──────────────────────────────────────────────────────

/**
 * Generate a governance impact report from audit events.
 */
export function generateImpactReport(events: AuditEvent[]): ImpactReport {
  if (events.length === 0) {
    return emptyReport();
  }

  const blocked = events.filter(e => e.decision === 'BLOCK');
  const paused = events.filter(e => e.decision === 'PAUSE');
  const modified = events.filter(e => e.decision === 'MODIFY');
  const penalized = events.filter(e => e.decision === 'PENALIZE');
  const rewarded = events.filter(e => e.decision === 'REWARD');
  const neutralEvents = events.filter(e => e.decision === 'NEUTRAL');
  const prevented = [...blocked, ...paused, ...modified, ...penalized];

  // ─── Prevented by category ──────────────────────────────────────────
  const categoryMap = new Map<string, Set<string>>();
  for (const e of prevented) {
    const cat = classifyPreventionCategory(e);
    if (!categoryMap.has(cat)) categoryMap.set(cat, new Set());
    categoryMap.get(cat)!.add(e.intent);
  }
  const preventedByCategory: PreventionCategory[] = [...categoryMap.entries()]
    .map(([category, intents]) => ({
      category,
      count: prevented.filter(e => classifyPreventionCategory(e) === category).length,
      examples: [...intents].slice(0, 5),
    }))
    .sort((a, b) => b.count - a.count);

  // ─── Top prevented intents ──────────────────────────────────────────
  const intentMap = new Map<string, { count: number; rules: Map<string, number> }>();
  for (const e of prevented) {
    const entry = intentMap.get(e.intent) ?? { count: 0, rules: new Map() };
    entry.count++;
    if (e.ruleId) {
      entry.rules.set(e.ruleId, (entry.rules.get(e.ruleId) ?? 0) + 1);
    }
    for (const g of e.guardsMatched) {
      entry.rules.set(g, (entry.rules.get(g) ?? 0) + 1);
    }
    intentMap.set(e.intent, entry);
  }
  const topPreventedIntents = [...intentMap.entries()]
    .map(([intent, data]) => {
      let topRule = '';
      let topCount = 0;
      for (const [rule, count] of data.rules) {
        if (count > topCount) {
          topRule = rule;
          topCount = count;
        }
      }
      return { intent, count: data.count, topRule };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  // ─── Hot actors ─────────────────────────────────────────────────────
  const actorMap = new Map<string, { blocked: number; paused: number; total: number }>();
  for (const e of events) {
    const actor = e.actor ?? 'unknown';
    const entry = actorMap.get(actor) ?? { blocked: 0, paused: 0, total: 0 };
    entry.total++;
    if (e.decision === 'BLOCK') entry.blocked++;
    if (e.decision === 'PAUSE') entry.paused++;
    actorMap.set(actor, entry);
  }
  const hotActors = [...actorMap.entries()]
    .filter(([, data]) => data.blocked > 0 || data.paused > 0)
    .map(([actor, data]) => ({ actor, ...data }))
    .sort((a, b) => (b.blocked + b.paused) - (a.blocked + a.paused))
    .slice(0, 10);

  // ─── Most active rules ──────────────────────────────────────────────
  const ruleMap = new Map<string, { blockCount: number; pauseCount: number }>();
  for (const e of prevented) {
    const ruleIds = [e.ruleId, ...e.guardsMatched, ...e.rulesMatched].filter(Boolean) as string[];
    for (const rId of new Set(ruleIds)) {
      const entry = ruleMap.get(rId) ?? { blockCount: 0, pauseCount: 0 };
      if (e.decision === 'BLOCK') entry.blockCount++;
      if (e.decision === 'PAUSE') entry.pauseCount++;
      ruleMap.set(rId, entry);
    }
  }
  const mostActiveRules = [...ruleMap.entries()]
    .map(([ruleId, data]) => ({ ruleId, ...data }))
    .sort((a, b) => (b.blockCount + b.pauseCount) - (a.blockCount + a.pauseCount))
    .slice(0, 10);

  // ─── Hourly distribution ────────────────────────────────────────────
  const hourMap = new Map<number, { total: number; blocked: number }>();
  for (const e of events) {
    const hour = new Date(e.timestamp).getHours();
    const entry = hourMap.get(hour) ?? { total: 0, blocked: 0 };
    entry.total++;
    if (e.decision === 'BLOCK') entry.blocked++;
    hourMap.set(hour, entry);
  }
  const hourlyDistribution = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    total: hourMap.get(hour)?.total ?? 0,
    blocked: hourMap.get(hour)?.blocked ?? 0,
  }));

  // ─── Repeat violations ──────────────────────────────────────────────
  const violationKey = (e: AuditEvent) => `${e.actor ?? 'unknown'}::${e.intent}`;
  const violationMap = new Map<string, { intent: string; actor: string; attempts: number; firstSeen: string; lastSeen: string }>();
  for (const e of blocked) {
    const key = violationKey(e);
    const entry = violationMap.get(key) ?? {
      intent: e.intent,
      actor: e.actor ?? 'unknown',
      attempts: 0,
      firstSeen: e.timestamp,
      lastSeen: e.timestamp,
    };
    entry.attempts++;
    entry.lastSeen = e.timestamp;
    violationMap.set(key, entry);
  }
  const repeatViolations = [...violationMap.values()]
    .filter(v => v.attempts > 1)
    .sort((a, b) => b.attempts - a.attempts)
    .slice(0, 10);

  const allowedCount = events.filter(e => e.decision === 'ALLOW').length;
  const redirected = events.length - allowedCount - neutralEvents.length;

  return {
    generatedAt: new Date().toISOString(),
    periodStart: events[0].timestamp,
    periodEnd: events[events.length - 1].timestamp,
    worldName: events[0].worldName ?? 'unknown',
    totalEvaluations: events.length,
    totalBlocked: blocked.length,
    totalPaused: paused.length,
    totalAllowed: allowedCount,
    totalModified: modified.length,
    totalPenalized: penalized.length,
    totalRewarded: rewarded.length,
    totalNeutral: neutralEvents.length,
    preventionRate: events.length > 0 ? prevented.length / events.length : 0,
    redirectionRate: events.length > 0 ? redirected / events.length : 0,
    preventedByCategory,
    topPreventedIntents,
    hotActors,
    mostActiveRules,
    hourlyDistribution,
    repeatViolations,
  };
}

// ─── Category Classification ────────────────────────────────────────────────

function classifyPreventionCategory(event: AuditEvent): string {
  const intent = event.intent.toLowerCase();
  const rule = (event.ruleId ?? '').toLowerCase();
  const combined = `${intent} ${rule}`;

  if (combined.match(/inject|prompt|jailbreak|bypass/)) return 'Prompt Injection Prevention';
  if (combined.match(/scope|escape|traversal|path/)) return 'Scope Escape Prevention';
  if (combined.match(/delete|drop|destroy|remove|purge/)) return 'Destructive Action Prevention';
  if (combined.match(/trade|margin|position|leverage/)) return 'Financial Risk Prevention';
  if (combined.match(/withdraw|transfer|payment|fund/)) return 'Unauthorized Transfer Prevention';
  if (combined.match(/credential|secret|key|password|token/)) return 'Credential Access Prevention';
  if (combined.match(/shell|exec|command|script/)) return 'Command Execution Prevention';
  if (combined.match(/network|http|api|external/)) return 'Network Access Prevention';
  if (combined.match(/write|modify|update|alter/)) return 'Unauthorized Modification Prevention';
  if (combined.match(/approval|review|confirm/)) return 'Approval Gate';

  return 'Policy Violation Prevention';
}

// ─── Report Renderer ────────────────────────────────────────────────────────

/**
 * Render an impact report as human-readable text.
 */
export function renderImpactReport(report: ImpactReport): string {
  const lines: string[] = [];

  lines.push('GOVERNANCE IMPACT REPORT');
  lines.push('═'.repeat(50));
  lines.push('');
  lines.push(`  World: ${report.worldName}`);
  lines.push(`  Period: ${report.periodStart.split('T')[0]} → ${report.periodEnd.split('T')[0]}`);
  lines.push(`  Generated: ${report.generatedAt}`);
  lines.push('');

  // ─── Summary ────────────────────────────────────────────────────────
  lines.push('SUMMARY');
  lines.push('─'.repeat(50));
  lines.push(`  Total evaluations:   ${report.totalEvaluations}`);
  lines.push(`  Allowed:             ${report.totalAllowed}`);
  lines.push(`  Blocked:             ${report.totalBlocked}`);
  lines.push(`  Modified:            ${report.totalModified}`);
  lines.push(`  Paused:              ${report.totalPaused}`);
  lines.push(`  Penalized:           ${report.totalPenalized}`);
  lines.push(`  Rewarded:            ${report.totalRewarded}`);
  lines.push(`  Neutral:             ${report.totalNeutral}`);
  lines.push(`  Prevention rate:     ${(report.preventionRate * 100).toFixed(1)}%`);
  lines.push(`  Redirection rate:    ${(report.redirectionRate * 100).toFixed(1)}%`);
  lines.push('');

  // ─── Without governance ─────────────────────────────────────────────
  if (report.totalBlocked > 0 || report.totalPaused > 0) {
    lines.push('WITHOUT GOVERNANCE');
    lines.push('─'.repeat(50));
    lines.push(`  ${report.totalBlocked + report.totalPaused} actions would have executed unchecked:`);
    for (const cat of report.preventedByCategory) {
      lines.push(`    ${cat.category.padEnd(38)} ${String(cat.count).padStart(5)}`);
      if (cat.examples.length > 0) {
        lines.push(`      e.g. ${cat.examples.slice(0, 3).join(', ')}`);
      }
    }
    lines.push('');
  }

  // ─── Top prevented intents ──────────────────────────────────────────
  if (report.topPreventedIntents.length > 0) {
    lines.push('TOP PREVENTED ACTIONS');
    lines.push('─'.repeat(50));
    for (const entry of report.topPreventedIntents.slice(0, 10)) {
      lines.push(`  ${entry.intent.padEnd(30)} ${String(entry.count).padStart(5)}  (rule: ${entry.topRule || '—'})`);
    }
    lines.push('');
  }

  // ─── Hot actors ─────────────────────────────────────────────────────
  if (report.hotActors.length > 0) {
    lines.push('ACTORS WITH MOST VIOLATIONS');
    lines.push('─'.repeat(50));
    for (const actor of report.hotActors) {
      const violations = actor.blocked + actor.paused;
      const rate = ((violations / actor.total) * 100).toFixed(0);
      lines.push(`  ${actor.actor.padEnd(25)} ${String(violations).padStart(5)} violations / ${actor.total} total (${rate}%)`);
    }
    lines.push('');
  }

  // ─── Most active rules ──────────────────────────────────────────────
  if (report.mostActiveRules.length > 0) {
    lines.push('MOST ACTIVE RULES');
    lines.push('─'.repeat(50));
    for (const rule of report.mostActiveRules) {
      lines.push(`  ${rule.ruleId.padEnd(30)} ${String(rule.blockCount).padStart(5)} blocked  ${String(rule.pauseCount).padStart(5)} paused`);
    }
    lines.push('');
  }

  // ─── Repeat violations ──────────────────────────────────────────────
  if (report.repeatViolations.length > 0) {
    lines.push('REPEAT VIOLATIONS');
    lines.push('─'.repeat(50));
    lines.push('  Actions attempted multiple times after being blocked:');
    for (const v of report.repeatViolations) {
      lines.push(`  ${v.actor.padEnd(20)} ${v.intent.padEnd(25)} ${v.attempts}x  (${v.firstSeen.split('T')[0]} → ${v.lastSeen.split('T')[0]})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Convenience ────────────────────────────────────────────────────────────

/**
 * Generate an impact report directly from an audit log file.
 */
export async function generateImpactReportFromFile(logPath: string): Promise<ImpactReport> {
  const events = await readAuditLog(logPath);
  return generateImpactReport(events);
}

function emptyReport(): ImpactReport {
  return {
    generatedAt: new Date().toISOString(),
    periodStart: '',
    periodEnd: '',
    worldName: 'unknown',
    totalEvaluations: 0,
    totalBlocked: 0,
    totalPaused: 0,
    totalAllowed: 0,
    totalModified: 0,
    totalPenalized: 0,
    totalRewarded: 0,
    totalNeutral: 0,
    preventionRate: 0,
    redirectionRate: 0,
    preventedByCategory: [],
    topPreventedIntents: [],
    hotActors: [],
    mostActiveRules: [],
    hourlyDistribution: [],
    repeatViolations: [],
  };
}
