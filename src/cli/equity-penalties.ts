/**
 * CLI: neuroverse equity-penalties
 *
 * Demonstrates the PENALIZE/REWARD behavioral enforcement system
 * using the Fortune 500 equity trading scenario.
 *
 * Usage:
 *   neuroverse equity-penalties --world <dir> [--agents N] [--rounds N] [--json]
 *
 * Simulates agents attempting to trade equities under governance rules:
 *   - Agents that try to SELL Fortune 500 equities → PENALIZED (frozen 1 round)
 *   - Agents that HOLD during volatility → REWARDED (+10% influence)
 *   - Agents that BUY non-F500 equities → ALLOWED
 *   - Agents that attempt unauthorized transfers → BLOCKED
 *
 * Shows the Decision Flow visualization and behavioral economy metrics.
 */

import { evaluateGuard } from '../engine/guard-engine';
import { loadWorld } from '../loader/world-loader';
import type { GuardEvent, GuardEngineOptions, AgentBehaviorState } from '../contracts/guard-contract';
import type { WorldDefinition } from '../types';
import {
  createAgentState,
  applyConsequence,
  applyReward,
  tickAgentStates,
  generateDecisionFlow,
  renderDecisionFlow,
} from '../engine/decision-flow-engine';
import { verdictToAuditEvent } from '../engine/audit-logger';
import type { AuditEvent } from '../engine/audit-logger';

// ─── Fortune 500 Simulation Scenarios ────────────────────────────────────────

interface SimAgent {
  id: string;
  name: string;
  strategy: 'aggressive' | 'conservative' | 'balanced';
}

interface SimAction {
  intent: string;
  tool: string;
  roleId: string;
  actionCategory: 'write' | 'read' | 'network';
}

const AGENTS: SimAgent[] = [
  { id: 'alpha', name: 'Alpha Fund', strategy: 'aggressive' },
  { id: 'beta', name: 'Beta Holdings', strategy: 'conservative' },
  { id: 'gamma', name: 'Gamma Capital', strategy: 'balanced' },
  { id: 'delta', name: 'Delta Quant', strategy: 'aggressive' },
  { id: 'epsilon', name: 'Epsilon Value', strategy: 'conservative' },
  { id: 'zeta', name: 'Zeta Momentum', strategy: 'aggressive' },
  { id: 'eta', name: 'Eta Growth', strategy: 'balanced' },
  { id: 'theta', name: 'Theta Macro', strategy: 'conservative' },
];

function generateActionsForRound(agents: SimAgent[], round: number): SimAction[] {
  const actions: SimAction[] = [];

  for (const agent of agents) {
    // Aggressive agents try to sell Fortune 500 equities
    if (agent.strategy === 'aggressive') {
      if (round % 2 === 0) {
        actions.push({
          intent: `sell Fortune 500 equity AAPL position for ${agent.name}`,
          tool: 'trade',
          roleId: agent.id,
          actionCategory: 'write',
        });
      } else {
        actions.push({
          intent: `sell Fortune 500 equity MSFT shares for ${agent.name}`,
          tool: 'trade',
          roleId: agent.id,
          actionCategory: 'write',
        });
      }
    }

    // Conservative agents hold positions
    if (agent.strategy === 'conservative') {
      actions.push({
        intent: `hold current position during market volatility for ${agent.name}`,
        tool: 'trade',
        roleId: agent.id,
        actionCategory: 'read',
      });
    }

    // Balanced agents mix strategies
    if (agent.strategy === 'balanced') {
      if (round % 3 === 0) {
        actions.push({
          intent: `sell Fortune 500 equity GOOGL for ${agent.name}`,
          tool: 'trade',
          roleId: agent.id,
          actionCategory: 'write',
        });
      } else if (round % 3 === 1) {
        actions.push({
          intent: `buy non-F500 small cap equity for ${agent.name}`,
          tool: 'trade',
          roleId: agent.id,
          actionCategory: 'write',
        });
      } else {
        actions.push({
          intent: `hold position during volatility for ${agent.name}`,
          tool: 'trade',
          roleId: agent.id,
          actionCategory: 'read',
        });
      }
    }
  }

  return actions;
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function main(args: string[]): Promise<void> {
  let worldPath = '';
  let agentCount = 8;
  let rounds = 5;
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--world' && args[i + 1]) {
      worldPath = args[++i];
    }
    if (args[i] === '--agents' && args[i + 1]) {
      agentCount = Math.min(parseInt(args[++i], 10), AGENTS.length);
    }
    if (args[i] === '--rounds' && args[i + 1]) {
      rounds = parseInt(args[++i], 10);
    }
    if (args[i] === '--json') {
      jsonOutput = true;
    }
    if (args[i] === '--help' || args[i] === '-h') {
      process.stdout.write(`
neuroverse equity-penalties — Behavioral enforcement simulation

Usage:
  neuroverse equity-penalties --world <dir> [--agents N] [--rounds N] [--json]

Options:
  --world <dir>  Path to world directory (required)
  --agents N     Number of agents (default: 8, max: 8)
  --rounds N     Number of simulation rounds (default: 5)
  --json         Output as JSON

Simulates Fortune 500 equity trading with PENALIZE/REWARD governance:
  - SELL F500 equity → PENALIZED (agent frozen 1 round)
  - HOLD during volatility → REWARDED (+10% influence)
  - BUY non-F500 → ALLOWED
  - Unauthorized actions → BLOCKED
`.trim() + '\n');
      return;
    }
  }

  if (!worldPath) {
    process.stderr.write('Error: --world <dir> is required\n');
    process.exit(1);
  }

  let world: WorldDefinition;
  try {
    world = await loadWorld(worldPath);
  } catch (e) {
    process.stderr.write(`Error loading world: ${e}\n`);
    process.exit(1);
    return;
  }

  const agents = AGENTS.slice(0, agentCount);
  let agentStates = new Map<string, AgentBehaviorState>();
  for (const agent of agents) {
    agentStates.set(agent.id, createAgentState(agent.id));
  }

  const allAuditEvents: AuditEvent[] = [];
  const engineOptions: GuardEngineOptions = {
    trace: false,
    level: 'standard',
    agentStates,
  };

  process.stdout.write('\n');
  process.stdout.write('EQUITY PENALTY SIMULATION\n');
  process.stdout.write('═'.repeat(60) + '\n');
  process.stdout.write(`  World: ${world.world.name}\n`);
  process.stdout.write(`  Agents: ${agents.length}\n`);
  process.stdout.write(`  Rounds: ${rounds}\n`);
  process.stdout.write('\n');

  for (let round = 0; round < rounds; round++) {
    process.stdout.write(`── Round ${round + 1} ──────────────────────────────────────────\n`);

    const actions = generateActionsForRound(agents, round);

    for (const action of actions) {
      const event: GuardEvent = {
        intent: action.intent,
        tool: action.tool,
        roleId: action.roleId,
        actionCategory: action.actionCategory,
        direction: 'input',
      };

      // Check if agent is frozen
      const agentState = agentStates.get(action.roleId);
      if (agentState && agentState.cooldownRemaining > 0) {
        process.stdout.write(`  ◌ ${action.roleId.padEnd(10)} FROZEN (${agentState.cooldownRemaining} rounds) — ${action.intent.slice(0, 40)}\n`);
        // Still record the event
        const frozenEvent: AuditEvent = {
          timestamp: new Date().toISOString(),
          worldId: world.world.world_id,
          worldName: world.world.name,
          worldVersion: world.world.version,
          intent: action.intent,
          tool: action.tool,
          actor: action.roleId,
          direction: 'input',
          decision: 'PENALIZE',
          reason: `Agent frozen for ${agentState.cooldownRemaining} more round(s)`,
          guardsMatched: [],
          rulesMatched: [],
          invariantsSatisfied: 0,
          invariantsTotal: 0,
          enforcementLevel: 'standard',
          originalIntent: action.intent,
          finalAction: 'blocked (agent frozen)',
        };
        allAuditEvents.push(frozenEvent);
        continue;
      }

      const verdict = evaluateGuard(event, world, engineOptions);

      // Apply behavioral consequences
      let state = agentStates.get(action.roleId) ?? createAgentState(action.roleId);
      if (verdict.status === 'PENALIZE' && verdict.consequence) {
        state = applyConsequence(state, verdict.consequence, verdict.ruleId ?? 'unknown');
      }
      if (verdict.status === 'REWARD' && verdict.reward) {
        state = applyReward(state, verdict.reward, verdict.ruleId ?? 'unknown');
      }
      agentStates.set(action.roleId, state);

      // Status icon
      const icon = verdict.status === 'ALLOW' ? '●' :
                   verdict.status === 'BLOCK' ? '○' :
                   verdict.status === 'PENALIZE' ? '◌' :
                   verdict.status === 'REWARD' ? '◉' :
                   verdict.status === 'MODIFY' ? '◐' :
                   verdict.status === 'NEUTRAL' ? '◯' : '◑';

      process.stdout.write(`  ${icon} ${action.roleId.padEnd(10)} ${verdict.status.padEnd(10)} ${action.intent.slice(0, 40)}\n`);
      if (verdict.consequence) {
        process.stdout.write(`    → ${verdict.consequence.description}\n`);
      }
      if (verdict.reward) {
        process.stdout.write(`    → ${verdict.reward.description}\n`);
      }

      // Record audit event
      allAuditEvents.push(verdictToAuditEvent(event, verdict));
    }

    // Tick all agent states
    agentStates = tickAgentStates(agentStates);
    engineOptions.agentStates = agentStates;

    process.stdout.write('\n');

    // Show agent states
    process.stdout.write('  Agent States:\n');
    for (const agent of agents) {
      const s = agentStates.get(agent.id);
      if (!s) continue;
      const frozen = s.cooldownRemaining > 0 ? ` [FROZEN ${s.cooldownRemaining}r]` : '';
      const influence = s.influence !== 1.0 ? ` influence=${s.influence.toFixed(2)}` : '';
      process.stdout.write(`    ${agent.id.padEnd(10)} penalties=${s.totalPenalties} rewards=${s.totalRewards}${frozen}${influence}\n`);
    }
    process.stdout.write('\n');
  }

  // Generate Decision Flow
  const flow = generateDecisionFlow(allAuditEvents);

  if (jsonOutput) {
    process.stdout.write(JSON.stringify({ flow, agentStates: Object.fromEntries(agentStates) }, null, 2) + '\n');
  } else {
    process.stdout.write(renderDecisionFlow(flow) + '\n');
  }
}
