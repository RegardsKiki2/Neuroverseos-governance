/**
 * Autoresearch Adapter — Bridge between NeuroVerse governance and autoresearch loops
 *
 * This adapter translates autoresearch experiment events into GuardEvents
 * that can be evaluated by the NeuroVerse governance engine.
 *
 * Usage:
 *   import { AutoresearchGovernor } from '@neuroverseos/governance/adapters';
 *
 *   const governor = new AutoresearchGovernor({ worldPath: './world/' });
 *   const verdict = await governor.evaluateExperiment(experiment);
 *   const state = governor.updateState(experimentResult);
 */

import type { GuardEvent, GuardVerdict, GuardEngineOptions } from '../contracts/guard-contract';
import type { WorldDefinition } from '../types';
import { evaluateGuard } from '../engine/guard-engine';
import { loadWorldFromDirectory } from '../loader/world-loader';

// ─── Autoresearch Types ─────────────────────────────────────────────────────

export interface ExperimentProposal {
  experiment_id: number;
  architecture: string;
  description: string;
  estimated_minutes?: number;
  hyperparameters?: Record<string, unknown>;
}

export interface ExperimentResult {
  experiment_id: number;
  architecture: string;
  dataset: string;
  metric_name: string;
  metric_value: number;
  training_config: Record<string, unknown>;
  wall_clock_minutes: number;
  timestamp: string;
  success: boolean;
  error?: string;
}

export interface ResearchState {
  experiments_run: number;
  best_result: ExperimentResult | null;
  architectures_tested: string[];
  experiment_log: ExperimentResult[];
  total_compute_minutes: number;
  keep_count: number;
}

export interface AutoresearchGovernorConfig {
  world?: WorldDefinition;
  worldPath?: string;
  metric: string;
  optimize: 'minimize' | 'maximize';
  computeBudgetMinutes: number;
  dataset: string;
  context: string;
  constraints?: string[];
}

// ─── Governor ────────────────────────────────────────────────────────────────

export class AutoresearchGovernor {
  private config: AutoresearchGovernorConfig;
  private state: ResearchState;
  private world?: WorldDefinition;
  private engineOptions: GuardEngineOptions;

  constructor(config: AutoresearchGovernorConfig) {
    this.config = config;
    this.world = config.world;
    this.engineOptions = { trace: true };
    this.state = {
      experiments_run: 0,
      best_result: null,
      architectures_tested: [],
      experiment_log: [],
      total_compute_minutes: 0,
      keep_count: 0,
    };
  }

  /**
   * Convert an experiment proposal into a GuardEvent for governance evaluation.
   */
  proposalToGuardEvent(proposal: ExperimentProposal): GuardEvent {
    return {
      intent: `run experiment: ${proposal.description}`,
      tool: 'experiment_runner',
      scope: 'experiment',
      roleId: 'experiment_runner',
      direction: 'output',
      actionCategory: 'shell',
      args: {
        experiment_id: String(proposal.experiment_id),
        architecture: proposal.architecture,
        estimated_minutes: String(proposal.estimated_minutes || 5),
      },
    };
  }

  /**
   * Evaluate an experiment proposal against governance rules.
   * Routes through the guard engine when a world is loaded,
   * then layers on research-specific checks (budget, constraints, drift).
   */
  evaluateProposal(proposal: ExperimentProposal): {
    allowed: boolean;
    reason: string;
    warnings: string[];
    verdict?: GuardVerdict;
  } {
    const warnings: string[] = [];
    const event = this.proposalToGuardEvent(proposal);

    // Route through the governance engine when a world is loaded
    if (this.world) {
      const verdict = evaluateGuard(event, this.world, this.engineOptions);
      if (verdict.status === 'BLOCK' || verdict.status === 'PAUSE') {
        return {
          allowed: false,
          reason: verdict.reason ?? `Governance ${verdict.status}: ${verdict.ruleId ?? 'unknown rule'}`,
          warnings,
          verdict,
        };
      }
    }

    // Research-specific checks (layered on top of world governance)

    // Check compute budget
    const estimatedMinutes = proposal.estimated_minutes || 5;
    if (this.state.total_compute_minutes + estimatedMinutes > this.config.computeBudgetMinutes) {
      return {
        allowed: false,
        reason: `Compute budget exhausted: ${this.state.total_compute_minutes}/${this.config.computeBudgetMinutes} minutes used`,
        warnings,
      };
    }

    // Check architecture constraints
    if (this.config.constraints) {
      for (const constraint of this.config.constraints) {
        const lower = constraint.toLowerCase();
        const archLower = proposal.architecture.toLowerCase();
        const descLower = proposal.description.toLowerCase();

        if (lower.startsWith('no ')) {
          const forbidden = lower.slice(3).trim();
          if (archLower.includes(forbidden) || descLower.includes(forbidden)) {
            return {
              allowed: false,
              reason: `Architecture constraint violated: ${constraint}`,
              warnings,
            };
          }
        }
      }
    }

    // Warn on high failure rate
    const failureCount = this.state.experiment_log.filter(e => !e.success).length;
    if (failureCount > 5) {
      warnings.push(`High failure rate: ${failureCount} failed experiments. Consider investigating root cause.`);
    }

    // Warn on context drift
    const recentArchitectures = this.state.experiment_log.slice(-5).map(e => e.architecture);
    const uniqueRecent = new Set(recentArchitectures).size;
    if (recentArchitectures.length >= 5 && uniqueRecent === 1) {
      warnings.push('Research may be stuck: last 5 experiments used the same architecture.');
    }

    return { allowed: true, reason: 'Experiment approved', warnings };
  }

  /**
   * Record an experiment result and update research state.
   */
  recordResult(result: ExperimentResult): {
    kept: boolean;
    improvement: number | null;
    state: ResearchState;
  } {
    this.state.experiments_run++;
    this.state.total_compute_minutes += result.wall_clock_minutes;
    this.state.experiment_log.push(result);

    if (!this.state.architectures_tested.includes(result.architecture)) {
      this.state.architectures_tested.push(result.architecture);
    }

    if (!result.success) {
      return { kept: false, improvement: null, state: { ...this.state } };
    }

    // Check if this result improves on the best
    let kept = false;
    let improvement: number | null = null;

    if (this.state.best_result === null) {
      kept = true;
      this.state.best_result = result;
      this.state.keep_count++;
    } else {
      const prev = this.state.best_result.metric_value;
      const curr = result.metric_value;

      if (this.config.optimize === 'minimize') {
        kept = curr < prev;
        improvement = kept ? prev - curr : null;
      } else {
        kept = curr > prev;
        improvement = kept ? curr - prev : null;
      }

      if (kept) {
        this.state.best_result = result;
        this.state.keep_count++;
      }
    }

    return { kept, improvement, state: { ...this.state } };
  }

  /**
   * Export current state as a state snapshot compatible with the world file.
   */
  toWorldState(): Record<string, number> {
    const successfulExperiments = this.state.experiment_log.filter(e => e.success);
    const failedCount = this.state.experiment_log.filter(e => !e.success).length;
    const keepRate = this.state.experiments_run > 0
      ? Math.round((this.state.keep_count / this.state.experiments_run) * 100)
      : 0;

    // Calculate improvement rate over last 10 experiments
    let improvementRate = 0;
    if (successfulExperiments.length >= 2) {
      const recent = successfulExperiments.slice(-10);
      let improvements = 0;
      for (let i = 1; i < recent.length; i++) {
        const prev = recent[i - 1].metric_value;
        const curr = recent[i].metric_value;
        if (this.config.optimize === 'minimize' ? curr < prev : curr > prev) {
          improvements++;
        }
      }
      improvementRate = Math.round((improvements / (recent.length - 1)) * 100);
    }

    return {
      experiments_run: this.state.experiments_run,
      best_metric_value: this.state.best_result?.metric_value ?? (this.config.optimize === 'minimize' ? 100 : -1000),
      keep_rate: keepRate,
      compute_used_minutes: Math.round(this.state.total_compute_minutes),
      compute_budget_minutes: this.config.computeBudgetMinutes,
      failed_experiments: failedCount,
      metric_improvement_rate: improvementRate,
      research_context_drift: 0, // would need NLP to compute properly
    };
  }

  /**
   * Get a summary of the current research state.
   */
  getSummary(): {
    experiments_run: number;
    best_result: ExperimentResult | null;
    keep_rate: number;
    compute_remaining_minutes: number;
    architectures_tested: string[];
  } {
    return {
      experiments_run: this.state.experiments_run,
      best_result: this.state.best_result,
      keep_rate: this.state.experiments_run > 0
        ? Math.round((this.state.keep_count / this.state.experiments_run) * 100)
        : 0,
      compute_remaining_minutes: this.config.computeBudgetMinutes - this.state.total_compute_minutes,
      architectures_tested: [...this.state.architectures_tested],
    };
  }

  /**
   * Load state from a persisted research context file.
   */
  loadState(state: ResearchState): void {
    this.state = { ...state };
  }

  /**
   * Export state for persistence.
   */
  exportState(): ResearchState {
    return { ...this.state };
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create an AutoresearchGovernor with a world loaded from disk.
 */
export async function createAutoresearchGovernor(
  worldPath: string,
  config: Omit<AutoresearchGovernorConfig, 'world' | 'worldPath'>,
): Promise<AutoresearchGovernor> {
  const world = await loadWorldFromDirectory(worldPath);
  return new AutoresearchGovernor({ ...config, world, worldPath });
}
