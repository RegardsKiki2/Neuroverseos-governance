/**
 * Audit Logger — Runtime Governance Telemetry
 *
 * Records every action evaluated by the governance engine.
 * Provides the governance paper trail: what happened, why, and when.
 *
 * Architecture:
 *   - AuditEvent is the atomic record (one per evaluateGuard call)
 *   - AuditLogger is the pluggable interface (file, database, stream)
 *   - FileAuditLogger is the built-in file-based implementation
 *   - createGovernanceEngine wraps evaluateGuard with automatic logging
 *
 * INVARIANTS:
 *   - Logging never blocks or fails the governance decision
 *   - Every AuditEvent includes the full verdict + evidence
 *   - Events are append-only (immutable log)
 */

import type { GuardEvent, GuardVerdict, GuardEngineOptions } from '../contracts/guard-contract';
import type { WorldDefinition } from '../types';
import { evaluateGuard } from './guard-engine';

// ─── Audit Event ────────────────────────────────────────────────────────────

/**
 * A single governance evaluation record.
 * One of these is produced for every call to evaluateGuard.
 */
export interface AuditEvent {
  /** ISO 8601 timestamp */
  timestamp: string;

  /** World identity */
  worldId: string;
  worldName: string;
  worldVersion: string;

  /** The action that was evaluated */
  intent: string;
  tool?: string;
  scope?: string;
  actor?: string;
  direction?: 'input' | 'output';

  /** The governance decision */
  decision: 'ALLOW' | 'BLOCK' | 'PAUSE';
  reason?: string;
  ruleId?: string;
  warning?: string;

  /** Which rules/guards matched */
  guardsMatched: string[];
  rulesMatched: string[];

  /** Invariant health */
  invariantsSatisfied: number;
  invariantsTotal: number;

  /** Enforcement level used */
  enforcementLevel: string;

  /** Evaluation duration in milliseconds (if trace was enabled) */
  durationMs?: number;

  /** Full event args (optional, for detailed audit) */
  args?: Record<string, unknown>;
}

/**
 * Summary of governance activity over a set of audit events.
 */
export interface AuditSummary {
  totalActions: number;
  allowed: number;
  blocked: number;
  paused: number;

  /** Unique actors seen */
  actors: string[];

  /** Actions grouped by intent */
  topIntents: { intent: string; count: number; blocked: number; paused: number }[];

  /** Most frequently triggered rules */
  topRules: { ruleId: string; count: number }[];

  /** Time range */
  firstEvent: string;
  lastEvent: string;
}

// ─── Audit Logger Interface ─────────────────────────────────────────────────

/**
 * Pluggable audit logger interface.
 * Implement this to send audit events to any destination.
 */
export interface AuditLogger {
  /** Append an audit event. Must not throw. */
  log(event: AuditEvent): void | Promise<void>;

  /** Flush any buffered events. */
  flush?(): void | Promise<void>;
}

// ─── File Audit Logger ──────────────────────────────────────────────────────

/**
 * Append-only file logger using newline-delimited JSON (NDJSON).
 * Each line is a self-contained JSON audit event.
 *
 * Log file location defaults to .neuroverse/audit.ndjson
 */
export class FileAuditLogger implements AuditLogger {
  private logPath: string;
  private buffer: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushIntervalMs: number;

  constructor(logPath: string, options?: { flushIntervalMs?: number }) {
    this.logPath = logPath;
    this.flushIntervalMs = options?.flushIntervalMs ?? 1000;
  }

  log(event: AuditEvent): void {
    this.buffer.push(JSON.stringify(event));

    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        void this.flush();
      }, this.flushIntervalMs);
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const lines = this.buffer.splice(0).join('\n') + '\n';

    try {
      const { appendFile, mkdir } = await import('fs/promises');
      const { dirname } = await import('path');
      await mkdir(dirname(this.logPath), { recursive: true });
      await appendFile(this.logPath, lines, 'utf-8');
    } catch {
      // Never let logging break governance
    }
  }
}

// ─── Console Audit Logger ───────────────────────────────────────────────────

/**
 * Simple logger that writes to stderr. Useful for development.
 */
export class ConsoleAuditLogger implements AuditLogger {
  log(event: AuditEvent): void {
    const icon = event.decision === 'ALLOW' ? '✓' : event.decision === 'BLOCK' ? '✗' : '⏸';
    const ts = event.timestamp.split('T')[1]?.replace('Z', '') ?? event.timestamp;
    process.stderr.write(
      `[${ts}] ${icon} ${event.decision.padEnd(5)} ${event.actor ?? '—'} → ${event.intent}${event.reason ? ` (${event.reason})` : ''}\n`,
    );
  }
}

// ─── Composite Logger ───────────────────────────────────────────────────────

/**
 * Sends events to multiple loggers. Useful for file + console, file + webhook, etc.
 */
export class CompositeAuditLogger implements AuditLogger {
  private loggers: AuditLogger[];

  constructor(...loggers: AuditLogger[]) {
    this.loggers = loggers;
  }

  log(event: AuditEvent): void {
    for (const logger of this.loggers) {
      try {
        logger.log(event);
      } catch {
        // Never let one logger break others
      }
    }
  }

  async flush(): Promise<void> {
    await Promise.all(
      this.loggers.map(l => l.flush?.()).filter(Boolean),
    );
  }
}

// ─── Verdict → AuditEvent ───────────────────────────────────────────────────

/**
 * Convert a GuardEvent + GuardVerdict into an AuditEvent.
 */
export function verdictToAuditEvent(event: GuardEvent, verdict: GuardVerdict): AuditEvent {
  return {
    timestamp: new Date().toISOString(),
    worldId: verdict.evidence.worldId,
    worldName: verdict.evidence.worldName,
    worldVersion: verdict.evidence.worldVersion,
    intent: event.intent,
    tool: event.tool,
    scope: event.scope,
    actor: event.roleId,
    direction: event.direction,
    decision: verdict.status,
    reason: verdict.reason,
    ruleId: verdict.ruleId,
    warning: verdict.warning,
    guardsMatched: verdict.evidence.guardsMatched,
    rulesMatched: verdict.evidence.rulesMatched,
    invariantsSatisfied: verdict.evidence.invariantsSatisfied,
    invariantsTotal: verdict.evidence.invariantsTotal,
    enforcementLevel: verdict.evidence.enforcementLevel,
    durationMs: verdict.trace?.durationMs,
    args: event.args,
  };
}

// ─── Governed Engine ────────────────────────────────────────────────────────

export interface GovernanceEngineOptions extends GuardEngineOptions {
  /** Audit logger instance. If provided, every evaluation is logged. */
  auditLogger?: AuditLogger;

  /** Include args in audit events. Default: false (privacy). */
  auditArgs?: boolean;
}

/**
 * Create a governed evaluation function that wraps evaluateGuard
 * with automatic audit logging.
 *
 * Usage:
 *   const engine = createGovernanceEngine(world, {
 *     auditLogger: new FileAuditLogger('.neuroverse/audit.ndjson'),
 *   });
 *
 *   const verdict = engine.evaluate(event);
 */
export function createGovernanceEngine(
  world: WorldDefinition,
  options: GovernanceEngineOptions = {},
) {
  const { auditLogger, auditArgs, ...engineOptions } = options;

  return {
    /**
     * Evaluate a governance event and log the result.
     */
    evaluate(event: GuardEvent): GuardVerdict {
      const verdict = evaluateGuard(event, world, engineOptions);

      if (auditLogger) {
        const auditEvent = verdictToAuditEvent(event, verdict);
        if (!auditArgs) {
          delete auditEvent.args;
        }
        auditLogger.log(auditEvent);
      }

      return verdict;
    },

    /** Flush the audit logger. */
    async flush(): Promise<void> {
      await auditLogger?.flush?.();
    },

    /** The underlying world definition. */
    world,
  };
}

// ─── Log Reader ─────────────────────────────────────────────────────────────

/**
 * Read audit events from an NDJSON log file.
 *
 * @param logPath - Path to the audit log file
 * @param filter - Optional filter function
 * @returns Array of matching audit events
 */
export async function readAuditLog(
  logPath: string,
  filter?: (event: AuditEvent) => boolean,
): Promise<AuditEvent[]> {
  const { readFile } = await import('fs/promises');

  let content: string;
  try {
    content = await readFile(logPath, 'utf-8');
  } catch {
    return [];
  }

  const events: AuditEvent[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const event = JSON.parse(trimmed) as AuditEvent;
      if (!filter || filter(event)) {
        events.push(event);
      }
    } catch {
      // Skip malformed lines
    }
  }

  return events;
}

/**
 * Summarize a set of audit events.
 */
export function summarizeAuditEvents(events: AuditEvent[]): AuditSummary {
  const allowed = events.filter(e => e.decision === 'ALLOW').length;
  const blocked = events.filter(e => e.decision === 'BLOCK').length;
  const paused = events.filter(e => e.decision === 'PAUSE').length;

  // Unique actors
  const actorSet = new Set<string>();
  for (const e of events) {
    if (e.actor) actorSet.add(e.actor);
  }

  // Intent counts
  const intentMap = new Map<string, { count: number; blocked: number; paused: number }>();
  for (const e of events) {
    const entry = intentMap.get(e.intent) ?? { count: 0, blocked: 0, paused: 0 };
    entry.count++;
    if (e.decision === 'BLOCK') entry.blocked++;
    if (e.decision === 'PAUSE') entry.paused++;
    intentMap.set(e.intent, entry);
  }
  const topIntents = [...intentMap.entries()]
    .map(([intent, data]) => ({ intent, ...data }))
    .sort((a, b) => b.count - a.count);

  // Rule counts
  const ruleMap = new Map<string, number>();
  for (const e of events) {
    if (e.ruleId) {
      ruleMap.set(e.ruleId, (ruleMap.get(e.ruleId) ?? 0) + 1);
    }
    for (const g of e.guardsMatched) {
      ruleMap.set(g, (ruleMap.get(g) ?? 0) + 1);
    }
  }
  const topRules = [...ruleMap.entries()]
    .map(([ruleId, count]) => ({ ruleId, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalActions: events.length,
    allowed,
    blocked,
    paused,
    actors: [...actorSet],
    topIntents,
    topRules,
    firstEvent: events[0]?.timestamp ?? '',
    lastEvent: events[events.length - 1]?.timestamp ?? '',
  };
}
