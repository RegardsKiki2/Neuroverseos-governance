/**
 * neuroverse impact — Counterfactual Governance Impact Report
 *
 * Shows what governance prevented and proves its value.
 * Answers: "What would have happened without governance?"
 *
 * Usage:
 *   neuroverse impact [--log <path>] [--json]
 *
 * Options:
 *   --log <path>   Path to audit log (default: .neuroverse/audit.ndjson)
 *   --json         Output as JSON instead of formatted text
 */

import { readAuditLog } from '../engine/audit-logger';
import { generateImpactReport, renderImpactReport } from '../engine/impact-report';

const USAGE = `
neuroverse impact — Counterfactual governance impact report

Usage:
  neuroverse impact [options]

Options:
  --log <path>   Path to audit log (default: .neuroverse/audit.ndjson)
  --json         Raw JSON output

Shows what governance prevented: blocked actions, risk categories,
repeat violations, and actor behavior patterns.
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

  const report = generateImpactReport(events);

  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(renderImpactReport(report) + '\n');
  }
}
