/**
 * neuroverse trace — Runtime Action Audit Log
 *
 * Reads and displays the governance audit log.
 * Shows what actions were evaluated, what decisions were made, and why.
 *
 * Usage:
 *   neuroverse trace [--log <path>] [--summary] [--filter <decision>] [--actor <id>] [--last <n>]
 *
 * Options:
 *   --log <path>         Path to audit log file (default: .neuroverse/audit.ndjson)
 *   --summary            Show aggregate summary instead of individual events
 *   --filter <decision>  Filter by decision: ALLOW, BLOCK, or PAUSE
 *   --actor <id>         Filter by actor/role ID
 *   --intent <pattern>   Filter by intent (substring match)
 *   --last <n>           Show only the last N events (default: all)
 *   --json               Output raw JSON instead of formatted text
 *
 * Examples:
 *   neuroverse trace
 *   neuroverse trace --summary
 *   neuroverse trace --filter BLOCK --last 20
 *   neuroverse trace --actor trading-agent-3
 *   neuroverse trace --log ./logs/audit.ndjson --json
 */

import type { AuditEvent } from '../engine/audit-logger';
import { readAuditLog, summarizeAuditEvents } from '../engine/audit-logger';

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--summary') {
      args.summary = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--log' && argv[i + 1]) {
      args.log = argv[++i];
    } else if (arg === '--filter' && argv[i + 1]) {
      args.filter = argv[++i].toUpperCase();
    } else if (arg === '--actor' && argv[i + 1]) {
      args.actor = argv[++i];
    } else if (arg === '--intent' && argv[i + 1]) {
      args.intent = argv[++i];
    } else if (arg === '--last' && argv[i + 1]) {
      args.last = argv[++i];
    }
  }
  return args;
}

const USAGE = `
neuroverse trace — Runtime action audit log

Usage:
  neuroverse trace [options]

Options:
  --log <path>         Path to audit log (default: .neuroverse/audit.ndjson)
  --summary            Show aggregate summary
  --filter <decision>  Filter: ALLOW, BLOCK, or PAUSE
  --actor <id>         Filter by actor/role ID
  --intent <pattern>   Filter by intent (substring)
  --last <n>           Show last N events
  --json               Raw JSON output
`.trim();

function formatEvent(event: AuditEvent): string {
  const ts = event.timestamp.split('T')[1]?.replace('Z', '').slice(0, 8) ?? event.timestamp;
  const icon = event.decision === 'ALLOW' ? '  ✓' : event.decision === 'BLOCK' ? '  ✗' : '  ⏸';

  const parts: string[] = [];
  parts.push(`  [${ts}] ${event.actor ?? 'unknown'}`);
  parts.push(`    Action: ${event.intent}${event.tool ? ` (tool: ${event.tool})` : ''}`);
  parts.push(`    Result:${icon} ${event.decision}`);

  if (event.guardsMatched.length > 0) {
    parts.push(`    Guards: ${event.guardsMatched.join(', ')}`);
  }
  if (event.rulesMatched.length > 0) {
    parts.push(`    Rules:  ${event.rulesMatched.join(', ')}`);
  }
  if (event.reason) {
    parts.push(`    Reason: ${event.reason}`);
  }
  if (event.warning) {
    parts.push(`    Warning: ${event.warning}`);
  }

  return parts.join('\n');
}

function formatSummary(events: AuditEvent[]): string {
  const summary = summarizeAuditEvents(events);

  const lines: string[] = [];
  lines.push('GOVERNANCE SUMMARY');
  lines.push('─'.repeat(40));
  lines.push('');
  lines.push(`  Total actions:  ${summary.totalActions}`);
  lines.push(`  Allowed:        ${summary.allowed}`);
  lines.push(`  Blocked:        ${summary.blocked}`);
  lines.push(`  Paused:         ${summary.paused}`);

  if (summary.actors.length > 0) {
    lines.push('');
    lines.push(`  Actors: ${summary.actors.join(', ')}`);
  }

  if (summary.firstEvent) {
    lines.push('');
    lines.push(`  First event: ${summary.firstEvent}`);
    lines.push(`  Last event:  ${summary.lastEvent}`);
  }

  if (summary.topIntents.length > 0) {
    lines.push('');
    lines.push('  Top actions:');
    for (const entry of summary.topIntents.slice(0, 10)) {
      const extra: string[] = [];
      if (entry.blocked > 0) extra.push(`${entry.blocked} blocked`);
      if (entry.paused > 0) extra.push(`${entry.paused} paused`);
      const suffix = extra.length > 0 ? ` (${extra.join(', ')})` : '';
      lines.push(`    ${entry.intent.padEnd(30)} ${String(entry.count).padStart(5)}${suffix}`);
    }
  }

  if (summary.topRules.length > 0) {
    lines.push('');
    lines.push('  Top triggered rules/guards:');
    for (const entry of summary.topRules.slice(0, 10)) {
      lines.push(`    ${entry.ruleId.padEnd(30)} ${String(entry.count).padStart(5)}`);
    }
  }

  return lines.join('\n');
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);

  if (args.help) {
    process.stdout.write(USAGE + '\n');
    process.exit(0);
  }

  const logPath = (args.log as string) ?? '.neuroverse/audit.ndjson';

  // Build filter
  const filterFn = (event: AuditEvent): boolean => {
    if (args.filter && event.decision !== args.filter) return false;
    if (args.actor && event.actor !== args.actor) return false;
    if (args.intent && !event.intent.includes(args.intent as string)) return false;
    return true;
  };

  let events = await readAuditLog(logPath, filterFn);

  if (events.length === 0) {
    process.stderr.write(`No audit events found in ${logPath}\n`);
    process.stderr.write('Run governance evaluations with audit logging enabled to generate events.\n');
    process.exit(0);
  }

  // Apply --last
  if (args.last) {
    const n = parseInt(args.last as string, 10);
    if (n > 0 && n < events.length) {
      events = events.slice(-n);
    }
  }

  // Summary mode
  if (args.summary) {
    if (args.json) {
      process.stdout.write(JSON.stringify(summarizeAuditEvents(events), null, 2) + '\n');
    } else {
      process.stdout.write(formatSummary(events) + '\n');
    }
    process.exit(0);
  }

  // Event list mode
  if (args.json) {
    process.stdout.write(JSON.stringify(events, null, 2) + '\n');
    process.exit(0);
  }

  process.stdout.write('ACTION TRACE\n');
  process.stdout.write('─'.repeat(40) + '\n');

  for (const event of events) {
    process.stdout.write('\n' + formatEvent(event) + '\n');
  }

  process.stdout.write('\n');
  process.stdout.write(`Total: ${events.length} events`);

  const blocked = events.filter(e => e.decision === 'BLOCK').length;
  const paused = events.filter(e => e.decision === 'PAUSE').length;
  if (blocked > 0 || paused > 0) {
    const parts: string[] = [];
    if (blocked > 0) parts.push(`${blocked} blocked`);
    if (paused > 0) parts.push(`${paused} paused`);
    process.stdout.write(` (${parts.join(', ')})`);
  }
  process.stdout.write('\n');
}
