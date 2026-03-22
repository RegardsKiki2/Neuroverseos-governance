/**
 * Drift Monitor — Background service tracking governance health
 *
 * Tracks:
 *   - Block frequency (are we blocking too much? too little?)
 *   - Manual overrides (humans overriding PAUSE decisions)
 *   - Tool friction (which tools cause the most governance friction?)
 *   - Rule friction (which rules fire most often?)
 *
 * Can also read from audit.jsonl for historical analysis.
 * Stored in .neuroverse/state.json — separate from MEMORY.md.
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import type { GovernanceEngine } from './governance-engine';
import type { AuditEntry, AuditDecisionEntry } from './types';

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export interface DriftState {
  totalActions: number;
  allowCount: number;
  pauseCount: number;
  blockCount: number;
  overrideCount: number;
  toolFriction: Record<string, { blocks: number; pauses: number; allows: number }>;
  ruleFriction: Record<string, number>;
  lastUpdated: number;
  sessionStart: number;
}

export interface DriftStats {
  totalActions: number;
  allowCount: number;
  pauseCount: number;
  blockCount: number;
  blockRate: number;
  pauseRate: number;
  overrideRate: number;
  driftSignals: string[];
}

export interface DriftProposal {
  type: 'add_guard' | 'modify_threshold' | 'add_role' | 'add_invariant';
  reason: string;
  suggestion: string;
  evidence: string;
}

export interface DriftMonitorConfig {
  statePath: string;
  auditPath: string;
  engine: GovernanceEngine;
}

// ────────────────────────────────────────────────────────────────────────
// Monitor
// ────────────────────────────────────────────────────────────────────────

export class DriftMonitor {
  private config: DriftMonitorConfig;
  private state: DriftState;
  private saveInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: DriftMonitorConfig) {
    this.config = config;
    this.state = this.loadState();
  }

  start(): void {
    this.saveInterval = setInterval(() => this.saveState(), 30_000);
  }

  stop(): void {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }
    this.saveState();
  }

  /**
   * Record an action and its governance verdict.
   */
  recordAction(tool: string, verdict: 'ALLOW' | 'PAUSE' | 'BLOCK', ruleId?: string): void {
    this.state.totalActions++;

    switch (verdict) {
      case 'ALLOW':
        this.state.allowCount++;
        break;
      case 'PAUSE':
        this.state.pauseCount++;
        break;
      case 'BLOCK':
        this.state.blockCount++;
        break;
    }

    // Tool friction
    if (!this.state.toolFriction[tool]) {
      this.state.toolFriction[tool] = { blocks: 0, pauses: 0, allows: 0 };
    }
    const tf = this.state.toolFriction[tool];
    if (verdict === 'BLOCK') tf.blocks++;
    else if (verdict === 'PAUSE') tf.pauses++;
    else tf.allows++;

    // Rule friction
    if (ruleId) {
      this.state.ruleFriction[ruleId] = (this.state.ruleFriction[ruleId] ?? 0) + 1;
    }

    this.state.lastUpdated = Date.now();
  }

  /**
   * Record when a human overrides a PAUSE decision.
   */
  recordOverride(): void {
    this.state.overrideCount++;
  }

  /**
   * Get current drift statistics.
   */
  getStats(): DriftStats {
    const total = this.state.totalActions || 1;
    const blockRate = this.state.blockCount / total;
    const pauseRate = this.state.pauseCount / total;
    const overrideRate = this.state.pauseCount > 0
      ? this.state.overrideCount / this.state.pauseCount
      : 0;

    const driftSignals: string[] = [];

    if (blockRate > 0.3) {
      driftSignals.push(`High block rate (${(blockRate * 100).toFixed(1)}%) — governance may be too strict`);
    }

    if (overrideRate > 0.5 && this.state.pauseCount >= 5) {
      driftSignals.push(`High override rate (${(overrideRate * 100).toFixed(1)}%) — world rules may need amendment`);
    }

    for (const [tool, friction] of Object.entries(this.state.toolFriction)) {
      const toolTotal = friction.blocks + friction.pauses + friction.allows;
      const toolBlockRate = friction.blocks / Math.max(toolTotal, 1);
      if (toolBlockRate > 0.5 && toolTotal >= 3) {
        driftSignals.push(`Tool "${tool}" blocked ${(toolBlockRate * 100).toFixed(0)}% of the time`);
      }
    }

    if (total > 20 && blockRate === 0 && pauseRate === 0) {
      driftSignals.push('Zero blocks or pauses — governance may be too permissive');
    }

    return {
      totalActions: this.state.totalActions,
      allowCount: this.state.allowCount,
      pauseCount: this.state.pauseCount,
      blockCount: this.state.blockCount,
      blockRate,
      pauseRate,
      overrideRate,
      driftSignals,
    };
  }

  /**
   * Generate amendment proposals based on drift patterns.
   */
  generateProposals(): DriftProposal[] {
    const proposals: DriftProposal[] = [];
    const stats = this.getStats();

    // High override rate → suggest loosening specific guards
    if (stats.overrideRate > 0.5 && this.state.pauseCount >= 5) {
      const topRule = Object.entries(this.state.ruleFriction)
        .sort(([, a], [, b]) => b - a)[0];

      if (topRule) {
        proposals.push({
          type: 'modify_threshold',
          reason: `Rule "${topRule[0]}" triggered ${topRule[1]} times with ${(stats.overrideRate * 100).toFixed(0)}% override rate`,
          suggestion: topRule[0],
          evidence: `${(stats.overrideRate * 100).toFixed(0)}% of pauses were manually overridden`,
        });
      }
    }

    // Tool constantly blocked → suggest more nuanced guard
    for (const [tool, friction] of Object.entries(this.state.toolFriction)) {
      const total = friction.blocks + friction.pauses + friction.allows;
      if (friction.blocks > 5 && friction.blocks / total > 0.7) {
        proposals.push({
          type: 'add_guard',
          reason: `Tool "${tool}" is blocked ${friction.blocks} out of ${total} times`,
          suggestion: `Add granular guard for "${tool}" that allows safe patterns and blocks dangerous ones`,
          evidence: `${tool}: ${friction.blocks} blocks, ${friction.pauses} pauses, ${friction.allows} allows`,
        });
      }
    }

    // Zero governance firing → suggest adding guards
    if (this.state.totalActions > 20 && stats.blockRate === 0 && stats.pauseRate === 0) {
      proposals.push({
        type: 'add_guard',
        reason: 'No governance constraints have fired in over 20 actions',
        suggestion: 'Consider adding guards for destructive operations, external communication, or production access',
        evidence: `${this.state.totalActions} actions with 0 blocks and 0 pauses`,
      });
    }

    return proposals;
  }

  /**
   * Rebuild stats from the audit log (for historical analysis).
   */
  rebuildFromAudit(): void {
    if (!existsSync(this.config.auditPath)) return;

    try {
      const raw = readFileSync(this.config.auditPath, 'utf-8');
      const lines = raw.split('\n').filter(l => l.trim());

      // Reset state
      this.state = this.freshState();

      let decisionCount = 0;

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);

          // Decision entries
          if (entry.type === 'decision') {
            const dec = entry as AuditDecisionEntry;
            if (dec.decision === 'allow-once' || dec.decision === 'allow-always') {
              decisionCount++;
            }
            continue;
          }

          // Verdict entries
          const verdict = entry as AuditEntry;
          this.recordAction(verdict.tool, verdict.status, verdict.ruleId ?? undefined);
        } catch {
          continue;
        }
      }

      this.state.overrideCount = decisionCount;
      this.saveState();
    } catch {
      // Silent failure
    }
  }

  // ── Persistence ────────────────────────────────────────────────

  private loadState(): DriftState {
    if (existsSync(this.config.statePath)) {
      try {
        return JSON.parse(readFileSync(this.config.statePath, 'utf-8'));
      } catch {
        // Corrupted state — start fresh
      }
    }
    return this.freshState();
  }

  private freshState(): DriftState {
    return {
      totalActions: 0,
      allowCount: 0,
      pauseCount: 0,
      blockCount: 0,
      overrideCount: 0,
      toolFriction: {},
      ruleFriction: {},
      lastUpdated: Date.now(),
      sessionStart: Date.now(),
    };
  }

  private saveState(): void {
    try {
      writeFileSync(this.config.statePath, JSON.stringify(this.state, null, 2));
    } catch {
      // Silent failure — don't crash on state save
    }
  }
}
