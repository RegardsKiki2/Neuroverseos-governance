/**
 * neuroverse behavioral — Behavioral Analysis from Audit Log
 *
 * Reads an audit log, classifies how agents adapted to governance,
 * detects network-level behavioral patterns, and generates a narrative.
 *
 * Usage:
 *   neuroverse behavioral [--log <path>] [--json]
 */

import { readAuditLog } from '../engine/audit-logger';
import {
  adaptationFromVerdict,
  detectBehavioralPatterns,
  generateAdaptationNarrative,
} from '../engine/behavioral-engine';

const USAGE = `
neuroverse behavioral — Behavioral analysis from audit log

Usage:
  neuroverse behavioral [options]

Options:
  --log <path>   Path to audit log (default: .neuroverse/audit.ndjson)
  --json         Raw JSON output

Classifies agent adaptations, detects network-level patterns
(coordinated silence, misinfo suppression, reward cascades),
and generates a human-readable narrative.
`.trim();

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--log' && argv[i + 1]) args.log = argv[++i];
  }
  return args;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);

  if (args.help) {
    process.stdout.write(USAGE + '\n');
    process.exit(0);
  }

  const logPath = (args.log as string) ?? '.neuroverse/audit.ndjson';
  const events = await readAuditLog(logPath);

  if (events.length === 0) {
    process.stderr.write(`No audit events found in ${logPath}\n`);
    process.stderr.write('Run governance evaluations with audit logging enabled to generate events.\n');
    process.exit(0);
  }

  // Build adaptations from audit events
  const adaptations = events.map(event => {
    const agentId = event.actor ?? 'unknown';
    const intended = event.intent;
    const executed = event.decision === 'BLOCK' ? 'idle' : intended;
    // Construct a minimal verdict for the adapter
    const verdict = {
      status: event.decision as any,
      reason: event.reason,
      ruleId: event.ruleId,
      evidence: { worldId: event.worldId, worldName: event.worldName, worldVersion: event.worldVersion, evaluatedAt: Date.now(), invariantsSatisfied: 0, invariantsTotal: 0, guardsMatched: [], rulesMatched: [], enforcementLevel: 'standard' },
    };
    return adaptationFromVerdict(agentId, intended, executed, verdict);
  });

  const uniqueAgents = new Set(adaptations.map(a => a.agentId)).size;
  const patterns = detectBehavioralPatterns(adaptations, uniqueAgents);
  const narrative = generateAdaptationNarrative(patterns);

  if (args.json) {
    process.stdout.write(JSON.stringify({ adaptations: adaptations.length, agents: uniqueAgents, patterns, narrative }, null, 2) + '\n');
  } else {
    process.stdout.write('\nBehavioral Analysis\n');
    process.stdout.write('───────────────────\n\n');
    process.stdout.write(`  Events analyzed:  ${events.length}\n`);
    process.stdout.write(`  Agents observed:  ${uniqueAgents}\n`);
    process.stdout.write(`  Adaptations:      ${adaptations.length}\n`);
    process.stdout.write(`  Patterns found:   ${patterns.length}\n\n`);

    if (patterns.length > 0) {
      process.stdout.write('Patterns Detected\n');
      process.stdout.write('─────────────────\n');
      for (const p of patterns) {
        process.stdout.write(`  ${p.type} (${p.agentsAffected} agents)\n`);
        process.stdout.write(`    ${p.description}\n\n`);
      }
    }

    if (narrative) {
      process.stdout.write('Narrative\n');
      process.stdout.write('─────────\n');
      process.stdout.write(`  ${narrative}\n\n`);
    }

    // Shift breakdown
    const shiftCounts: Record<string, number> = {};
    for (const a of adaptations) {
      const key = a.shiftType ?? `${a.intendedAction}→${a.executedAction}`;
      shiftCounts[key] = (shiftCounts[key] ?? 0) + 1;
    }
    const sortedShifts = Object.entries(shiftCounts).sort((a, b) => b[1] - a[1]);
    if (sortedShifts.length > 0) {
      process.stdout.write('Shift Breakdown\n');
      process.stdout.write('───────────────\n');
      for (const [shift, count] of sortedShifts.slice(0, 10)) {
        process.stdout.write(`  ${shift}: ${count}\n`);
      }
      process.stdout.write('\n');
    }
  }
}
