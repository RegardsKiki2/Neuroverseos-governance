/**
 * CLI: neuroverse decision-flow
 *
 * Visualizes the Decision Flow — Intent → Rule → Outcome.
 * Shows what agents wanted vs what governance made them do.
 *
 * Usage:
 *   neuroverse decision-flow [--log <path>] [--json]
 *
 * Reads audit events and renders the flow visualization:
 *   LEFT:   Intent Pool (what agents wanted)
 *   CENTER: Rule Obstacles (what intercepted)
 *   RIGHT:  Outcome Pool (what actually happened)
 *
 * Headline metric: "X% of agent intent was redirected by governance"
 */

import { readAuditLog } from '../engine/audit-logger';
import { generateDecisionFlow, renderDecisionFlow } from '../engine/decision-flow-engine';

export async function main(args: string[]): Promise<void> {
  let logPath = '.neuroverse/audit.ndjson';
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--log' && args[i + 1]) {
      logPath = args[++i];
    }
    if (args[i] === '--json') {
      jsonOutput = true;
    }
    if (args[i] === '--help' || args[i] === '-h') {
      process.stdout.write(`
neuroverse decision-flow — Visualize Intent → Rule → Outcome

Usage:
  neuroverse decision-flow [--log <path>] [--json]

Options:
  --log <path>   Path to audit log (default: .neuroverse/audit.ndjson)
  --json         Output as JSON instead of text

Shows:
  - What agents WANTED to do (Intent Pool)
  - What rules INTERCEPTED (Rule Obstacles)
  - What actually HAPPENED (Outcome Pool)
  - Behavioral economy (penalties vs rewards)

Headline metric: "X% of agent intent was redirected by governance"
`.trim() + '\n');
      return;
    }
  }

  const events = await readAuditLog(logPath);

  if (events.length === 0) {
    process.stderr.write('No audit events found. Run governed actions first.\n');
    process.stderr.write(`Looking in: ${logPath}\n`);
    process.exit(1);
  }

  const flow = generateDecisionFlow(events);

  if (jsonOutput) {
    process.stdout.write(JSON.stringify(flow, null, 2) + '\n');
  } else {
    process.stdout.write(renderDecisionFlow(flow) + '\n');
  }
}
