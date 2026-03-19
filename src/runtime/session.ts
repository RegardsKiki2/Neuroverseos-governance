/**
 * Session Manager — Governed Runtime Session
 *
 * Orchestrates a governed AI session:
 *   1. Load world + plan
 *   2. Connect to model
 *   3. Intercept tool calls
 *   4. Evaluate with guard engine
 *   5. Execute or block
 *   6. Track plan progress
 *
 * The session manager is thin orchestration, not a framework.
 * All intelligence lives in the guard engine and plan engine.
 */

import { evaluateGuard } from '../engine/guard-engine';
import { evaluatePlan, advancePlan, getPlanProgress } from '../engine/plan-engine';
import { loadWorld } from '../loader/world-loader';
import { formatVerdict } from '../engine/verdict-formatter';
import type { GuardEvent, GuardVerdict, GuardEngineOptions, AgentBehaviorState } from '../contracts/guard-contract';
import type { PlanDefinition, PlanProgress } from '../contracts/plan-contract';
import type { WorldDefinition } from '../types';
import type { ModelAdapter, ToolCall, ModelResponse } from './model-adapter';
import { createAgentState, applyConsequence, applyReward, tickAgentStates } from '../engine/decision-flow-engine';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SessionConfig {
  /** Path to world directory. */
  worldPath?: string;

  /** Pre-loaded world definition (alternative to worldPath). */
  world?: WorldDefinition;

  /** Plan definition (pre-loaded). */
  plan?: PlanDefinition;

  /** Enforcement level override. */
  level?: 'basic' | 'standard' | 'strict';

  /** Include trace in verdicts. */
  trace?: boolean;

  /** Called when a verdict is produced. */
  onVerdict?: (verdict: GuardVerdict, event: GuardEvent) => void;

  /** Called when plan progress changes. */
  onPlanProgress?: (progress: PlanProgress) => void;

  /** Called when the plan is complete. */
  onPlanComplete?: () => void;

  /** Called when a tool is executed successfully. */
  onToolResult?: (toolName: string, result: string) => void;

  /** Tool executor — runs the actual tool. */
  toolExecutor?: (name: string, args: Record<string, unknown>) => Promise<string>;
}

export interface SessionState {
  /** Whether the session is active. */
  active: boolean;

  /** Loaded world. */
  world: WorldDefinition;

  /** Active plan (mutable as steps complete). */
  plan?: PlanDefinition;

  /** Current plan progress. */
  progress?: PlanProgress;

  /** Total actions evaluated. */
  actionsEvaluated: number;

  /** Total actions allowed. */
  actionsAllowed: number;

  /** Total actions blocked. */
  actionsBlocked: number;

  /** Total actions paused. */
  actionsPaused: number;

  /** Total actions modified. */
  actionsModified: number;

  /** Total actions penalized. */
  actionsPenalized: number;

  /** Total actions rewarded. */
  actionsRewarded: number;

  /** Agent behavior states — tracks cooldowns, influence, rewards per agent. */
  agentStates: Map<string, AgentBehaviorState>;
}

// ─── Default Tool Executor ──────────────────────────────────────────────────

/**
 * Default tool executor — returns a descriptive message.
 * In production, this would actually execute tools.
 */
async function defaultToolExecutor(name: string, args: Record<string, unknown>): Promise<string> {
  return `Tool "${name}" executed successfully with args: ${JSON.stringify(args)}`;
}

// ─── Session Manager ────────────────────────────────────────────────────────

export class SessionManager {
  private config: SessionConfig;
  private state: SessionState;
  private engineOptions: GuardEngineOptions;
  private executor: (name: string, args: Record<string, unknown>) => Promise<string>;

  constructor(config: SessionConfig) {
    this.config = config;
    this.executor = config.toolExecutor ?? defaultToolExecutor;
    this.engineOptions = {
      trace: config.trace ?? false,
      level: config.level,
      plan: config.plan,
    };

    // State is initialized in start()
    this.state = {
      active: false,
      world: config.world as WorldDefinition,
      plan: config.plan,
      progress: config.plan ? getPlanProgress(config.plan) : undefined,
      actionsEvaluated: 0,
      actionsAllowed: 0,
      actionsBlocked: 0,
      actionsPaused: 0,
      actionsModified: 0,
      actionsPenalized: 0,
      actionsRewarded: 0,
      agentStates: new Map(),
    };
  }

  /**
   * Initialize the session — load world from disk if needed.
   */
  async start(): Promise<SessionState> {
    if (this.config.worldPath && !this.config.world) {
      this.state.world = await loadWorld(this.config.worldPath);
    }

    if (!this.state.world) {
      throw new Error('No world provided. Use --world or pass a world definition.');
    }

    this.state.active = true;
    return this.getState();
  }

  /**
   * Evaluate a single event against governance.
   * Returns the verdict without executing anything.
   */
  evaluate(event: GuardEvent): GuardVerdict {
    this.engineOptions.plan = this.state.plan;
    this.engineOptions.agentStates = this.state.agentStates;
    const verdict = evaluateGuard(event, this.state.world, this.engineOptions);

    this.state.actionsEvaluated++;
    if (verdict.status === 'ALLOW') this.state.actionsAllowed++;
    if (verdict.status === 'BLOCK') this.state.actionsBlocked++;
    if (verdict.status === 'PAUSE') this.state.actionsPaused++;
    if (verdict.status === 'MODIFY') this.state.actionsModified++;
    if (verdict.status === 'PENALIZE') this.state.actionsPenalized++;
    if (verdict.status === 'REWARD') this.state.actionsRewarded++;

    // Apply behavioral consequences/rewards to agent state
    if (event.roleId) {
      let agentState = this.state.agentStates.get(event.roleId) ?? createAgentState(event.roleId);

      if (verdict.status === 'PENALIZE' && verdict.consequence) {
        agentState = applyConsequence(agentState, verdict.consequence, verdict.ruleId ?? 'unknown');
      }
      if (verdict.status === 'REWARD' && verdict.reward) {
        agentState = applyReward(agentState, verdict.reward, verdict.ruleId ?? 'unknown');
      }

      this.state.agentStates.set(event.roleId, agentState);
    }

    this.config.onVerdict?.(verdict, event);
    return verdict;
  }

  /**
   * Advance all agent states by one round.
   * Call this at the end of each simulation round to decrement cooldowns.
   */
  tickRound(): void {
    this.state.agentStates = tickAgentStates(this.state.agentStates);
  }

  /**
   * Get the behavior state for a specific agent.
   */
  getAgentState(agentId: string): AgentBehaviorState | undefined {
    return this.state.agentStates.get(agentId);
  }

  /**
   * Evaluate and execute a tool call.
   * Returns the execution result or block reason.
   */
  async executeToolCall(toolCall: ToolCall): Promise<{
    allowed: boolean;
    verdict: GuardVerdict;
    result?: string;
  }> {
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch {
      args = { raw: toolCall.function.arguments };
    }

    const event: GuardEvent = {
      intent: toolCall.function.name,
      tool: toolCall.function.name,
      args,
      direction: 'input',
    };

    const verdict = this.evaluate(event);

    if (verdict.status === 'BLOCK' || verdict.status === 'PENALIZE') {
      return { allowed: false, verdict };
    }

    if (verdict.status === 'PAUSE') {
      return { allowed: false, verdict };
    }

    // ALLOW, REWARD, MODIFY, NEUTRAL — execute the tool (MODIFY may change args)
    const result = await this.executor(toolCall.function.name, args);
    this.config.onToolResult?.(toolCall.function.name, result);

    // Track plan progress
    if (this.state.plan) {
      const planVerdict = evaluatePlan(event, this.state.plan);
      if (planVerdict.matchedStep) {
        const advResult = advancePlan(this.state.plan, planVerdict.matchedStep);
        if (advResult.success && advResult.plan) {
          this.state.plan = advResult.plan;
          this.engineOptions.plan = this.state.plan;
        }
        this.state.progress = getPlanProgress(this.state.plan);
        this.config.onPlanProgress?.(this.state.progress);

        if (this.state.progress.completed === this.state.progress.total) {
          this.config.onPlanComplete?.();
        }
      }
    }

    return { allowed: true, verdict, result };
  }

  /**
   * Process a model response — evaluate and execute all tool calls.
   * Returns results for each tool call.
   */
  async processModelResponse(
    response: ModelResponse,
    model: ModelAdapter,
  ): Promise<ModelResponse> {
    if (response.toolCalls.length === 0) {
      return response;
    }

    // Process each tool call
    for (const toolCall of response.toolCalls) {
      const { allowed, verdict, result } = await this.executeToolCall(toolCall);

      if (allowed && result) {
        // Send tool result back to model
        const nextResponse = await model.sendToolResult(toolCall.id, result);

        // If the model wants to make more tool calls, process them recursively
        if (nextResponse.toolCalls.length > 0) {
          return this.processModelResponse(nextResponse, model);
        }
        return nextResponse;
      } else {
        // Send block message back to model
        const reason = verdict.reason ?? 'Action blocked by governance.';
        const nextResponse = await model.sendBlockedResult(toolCall.id, reason);

        if (nextResponse.toolCalls.length > 0) {
          return this.processModelResponse(nextResponse, model);
        }
        return nextResponse;
      }
    }

    return response;
  }

  /** Get current session state. */
  getState(): SessionState {
    return { ...this.state };
  }

  /** Stop the session. */
  stop(): SessionState {
    this.state.active = false;
    return this.getState();
  }
}

// ─── Pipe Mode ──────────────────────────────────────────────────────────────

/**
 * Run in pipe mode — read JSON lines from stdin, evaluate each,
 * write verdicts to stdout. Works with any language or framework.
 *
 * Usage:
 *   my_agent | neuroverse run --pipe --world ./world/ --plan plan.json
 *
 * Each line of stdin should be a GuardEvent JSON.
 * Each line of stdout will be a GuardVerdict JSON.
 */
export async function runPipeMode(config: SessionConfig): Promise<void> {
  const session = new SessionManager(config);
  await session.start();

  const state = session.getState();
  process.stderr.write(`[neuroverse] Pipe mode active\n`);
  process.stderr.write(`[neuroverse] World: ${state.world.world.name}\n`);
  if (state.plan) {
    process.stderr.write(`[neuroverse] Plan: ${state.plan.plan_id} (${state.plan.objective})\n`);
  }

  return new Promise((resolve, reject) => {
    let buffer = '';

    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const event: GuardEvent = JSON.parse(trimmed);
          if (!event.intent) {
            process.stderr.write(`[neuroverse] Warning: event missing "intent" field\n`);
            continue;
          }

          const verdict = session.evaluate(event);
          process.stdout.write(JSON.stringify(verdict) + '\n');
        } catch (err) {
          process.stderr.write(`[neuroverse] Error parsing line: ${err}\n`);
        }
      }
    });

    process.stdin.on('end', () => {
      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const event: GuardEvent = JSON.parse(buffer.trim());
          if (event.intent) {
            const verdict = session.evaluate(event);
            process.stdout.write(JSON.stringify(verdict) + '\n');
          }
        } catch {
          // ignore
        }
      }

      const finalState = session.stop();
      process.stderr.write(
        `[neuroverse] Session complete: ${finalState.actionsEvaluated} evaluated, ` +
        `${finalState.actionsAllowed} allowed, ${finalState.actionsBlocked} blocked, ` +
        `${finalState.actionsPaused} paused\n`,
      );
      resolve();
    });

    process.stdin.on('error', reject);
  });
}

// ─── Interactive Mode ───────────────────────────────────────────────────────

/**
 * Run an interactive governed chat session.
 *
 * Usage:
 *   neuroverse run --world ./world/ --plan plan.json --provider openai
 */
export async function runInteractiveMode(
  config: SessionConfig,
  model: ModelAdapter,
): Promise<void> {
  const session = new SessionManager(config);
  await session.start();

  const state = session.getState();

  // Print session banner
  process.stdout.write('\n');
  process.stdout.write(`  World: ${state.world.world.name}\n`);
  if (state.plan) {
    process.stdout.write(`  Plan: ${state.plan.plan_id}\n`);
    process.stdout.write(`  Goal: ${state.plan.objective}\n`);
    process.stdout.write(`  Steps: ${state.progress?.total ?? 0}\n`);
  }
  process.stdout.write(`  Type "exit" to end session.\n`);
  process.stdout.write('\n');

  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
  });

  const printProgress = () => {
    const s = session.getState();
    if (s.progress) {
      process.stdout.write(
        `  [plan: ${s.progress.completed}/${s.progress.total} (${s.progress.percentage}%)]\n`,
      );
    }
  };

  rl.prompt();

  rl.on('line', async (input: string) => {
    const trimmed = input.trim();

    if (!trimmed) {
      rl.prompt();
      return;
    }

    if (trimmed === 'exit' || trimmed === 'quit') {
      const finalState = session.stop();
      process.stdout.write('\n');
      process.stdout.write(`  Session complete.\n`);
      process.stdout.write(`  Actions: ${finalState.actionsEvaluated} evaluated`);
      process.stdout.write(`, ${finalState.actionsAllowed} allowed`);
      process.stdout.write(`, ${finalState.actionsBlocked} blocked\n`);
      if (finalState.progress) {
        process.stdout.write(
          `  Plan: ${finalState.progress.completed}/${finalState.progress.total} steps completed\n`,
        );
      }
      process.stdout.write('\n');
      rl.close();
      return;
    }

    if (trimmed === 'status') {
      const s = session.getState();
      process.stdout.write(`\n  World: ${s.world.world.name}\n`);
      process.stdout.write(`  Actions: ${s.actionsEvaluated} evaluated\n`);
      process.stdout.write(`  Allowed: ${s.actionsAllowed} | Blocked: ${s.actionsBlocked} | Modified: ${s.actionsModified} | Paused: ${s.actionsPaused}\n`);
      process.stdout.write(`  Penalized: ${s.actionsPenalized} | Rewarded: ${s.actionsRewarded}\n`);
      if (s.progress && s.plan) {
        process.stdout.write(`  Plan: ${s.plan.plan_id} — ${s.progress.completed}/${s.progress.total} (${s.progress.percentage}%)\n`);
        for (const step of s.plan.steps) {
          const icon = step.status === 'completed' ? '[x]' : '[ ]';
          process.stdout.write(`    ${icon} ${step.label}\n`);
        }
      }
      process.stdout.write('\n');
      rl.prompt();
      return;
    }

    try {
      // Send to model
      const response = await model.chat(trimmed);

      // If model made tool calls, process them with governance
      if (response.toolCalls.length > 0) {
        const finalResponse = await session.processModelResponse(response, model);
        if (finalResponse.content) {
          process.stdout.write(`\n${finalResponse.content}\n\n`);
        }
        printProgress();
      } else if (response.content) {
        process.stdout.write(`\n${response.content}\n\n`);
      }
    } catch (err) {
      process.stderr.write(`\n  Error: ${err}\n\n`);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    session.stop();
  });

  return new Promise((resolve) => {
    rl.on('close', resolve);
  });
}
