/**
 * neuroverse world — World Management Commands
 *
 * Manage world definitions at runtime: status, update, rollback.
 *
 * Usage:
 *   neuroverse world status <path>           Show world identity and health
 *   neuroverse world diff <path1> <path2>    Compare two world versions
 *   neuroverse world snapshot <path>         Save a timestamped snapshot
 *   neuroverse world rollback <path>         Restore the previous snapshot
 *
 * Examples:
 *   neuroverse world status ./my-world/
 *   neuroverse world snapshot ./my-world/
 *   neuroverse world rollback ./my-world/
 */

import { loadWorld } from '../loader/world-loader';
import { validateWorld } from '../engine/validate-engine';
import type { WorldDefinition } from '../types';

const USAGE = `
neuroverse world — World management

Usage:
  neuroverse world status <path>           Show world identity and health
  neuroverse world diff <path1> <path2>    Compare two world versions
  neuroverse world snapshot <path>         Save a timestamped snapshot
  neuroverse world rollback <path>         Restore the previous snapshot

Options:
  --json    Output as JSON
`.trim();

function parseArgs(argv: string[]) {
  const subcommand = argv[0];
  const paths: string[] = [];
  const flags: Record<string, boolean> = {};

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') flags.json = true;
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else paths.push(arg);
  }

  return { subcommand, paths, flags };
}

// ─── Status ─────────────────────────────────────────────────────────────────

async function worldStatus(worldPath: string, json: boolean): Promise<void> {
  const world = await loadWorld(worldPath);
  const report = validateWorld(world);

  if (json) {
    process.stdout.write(JSON.stringify({
      world: world.world,
      metadata: world.metadata,
      guards: world.guards?.guards.length ?? 0,
      invariants: world.invariants.length,
      rules: world.rules.length,
      roles: world.roles?.roles.length ?? 0,
      kernel: world.kernel ? {
        allowedInputs: world.kernel.allowed_inputs?.length ?? 0,
        forbiddenInputs: world.kernel.forbidden_inputs?.length ?? 0,
        allowedOutputs: world.kernel.allowed_outputs?.length ?? 0,
        forbiddenOutputs: world.kernel.forbidden_outputs?.length ?? 0,
      } : null,
      validation: report.summary,
    }, null, 2) + '\n');
    return;
  }

  const lines: string[] = [];
  lines.push('WORLD STATUS');
  lines.push('─'.repeat(40));
  lines.push(`  Name:       ${world.world.name}`);
  lines.push(`  ID:         ${world.world.id}`);
  lines.push(`  Version:    ${world.world.version}`);
  lines.push(`  Created:    ${world.metadata.created_at || '—'}`);
  lines.push(`  Modified:   ${world.metadata.last_modified || '—'}`);
  lines.push(`  Authoring:  ${world.metadata.authoring_method}`);
  lines.push('');
  lines.push('COMPONENTS');
  lines.push('─'.repeat(40));
  lines.push(`  Invariants:  ${world.invariants.length}`);
  lines.push(`  Guards:      ${world.guards?.guards.length ?? 0}`);
  lines.push(`  Rules:       ${world.rules.length}`);
  lines.push(`  Roles:       ${world.roles?.roles.length ?? 0}`);

  if (world.kernel) {
    const k = world.kernel;
    const totalRules = (k.allowed_inputs?.length ?? 0) +
      (k.forbidden_inputs?.length ?? 0) +
      (k.allowed_outputs?.length ?? 0) +
      (k.forbidden_outputs?.length ?? 0);
    lines.push(`  Kernel:      ${totalRules} rules`);
  }

  lines.push('');
  lines.push('HEALTH');
  lines.push('─'.repeat(40));

  const sev = report.summary;
  const healthIcon = sev.errors === 0 && sev.warnings === 0
    ? 'HEALTHY'
    : sev.errors > 0
      ? 'ISSUES FOUND'
      : 'WARNINGS';

  lines.push(`  Status:    ${healthIcon}`);
  lines.push(`  Errors:    ${sev.errors}`);
  lines.push(`  Warnings:  ${sev.warnings}`);
  lines.push(`  Info:      ${sev.info}`);

  if (report.findings.length > 0) {
    lines.push('');
    lines.push('  Top findings:');
    for (const f of report.findings.slice(0, 5)) {
      const icon = f.severity === 'error' ? '!' : f.severity === 'warning' ? '?' : '-';
      lines.push(`    [${icon}] ${f.message}`);
    }
  }

  process.stdout.write(lines.join('\n') + '\n');
}

// ─── Diff ───────────────────────────────────────────────────────────────────

async function worldDiff(path1: string, path2: string, json: boolean): Promise<void> {
  const world1 = await loadWorld(path1);
  const world2 = await loadWorld(path2);

  const diff = computeWorldDiff(world1, world2);

  if (json) {
    process.stdout.write(JSON.stringify(diff, null, 2) + '\n');
    return;
  }

  const lines: string[] = [];
  lines.push('WORLD DIFF');
  lines.push('═'.repeat(50));
  lines.push(`  A: ${world1.world.name} v${world1.world.version}`);
  lines.push(`  B: ${world2.world.name} v${world2.world.version}`);
  lines.push('');

  for (const change of diff.changes) {
    const icon = change.type === 'added' ? '+' : change.type === 'removed' ? '-' : '~';
    lines.push(`  [${icon}] ${change.component}: ${change.description}`);
  }

  if (diff.changes.length === 0) {
    lines.push('  No differences found.');
  }

  process.stdout.write(lines.join('\n') + '\n');
}

interface WorldDiff {
  changes: { type: 'added' | 'removed' | 'changed'; component: string; description: string }[];
}

function computeWorldDiff(a: WorldDefinition, b: WorldDefinition): WorldDiff {
  const changes: WorldDiff['changes'] = [];

  // Version
  if (a.world.version !== b.world.version) {
    changes.push({ type: 'changed', component: 'version', description: `${a.world.version} → ${b.world.version}` });
  }

  // Invariants
  const aInvIds = new Set(a.invariants.map(i => i.id));
  const bInvIds = new Set(b.invariants.map(i => i.id));
  for (const id of bInvIds) {
    if (!aInvIds.has(id)) changes.push({ type: 'added', component: 'invariant', description: id });
  }
  for (const id of aInvIds) {
    if (!bInvIds.has(id)) changes.push({ type: 'removed', component: 'invariant', description: id });
  }

  // Guards
  const aGuardIds = new Set((a.guards?.guards ?? []).map(g => g.id));
  const bGuardIds = new Set((b.guards?.guards ?? []).map(g => g.id));
  for (const id of bGuardIds) {
    if (!aGuardIds.has(id)) changes.push({ type: 'added', component: 'guard', description: id });
  }
  for (const id of aGuardIds) {
    if (!bGuardIds.has(id)) changes.push({ type: 'removed', component: 'guard', description: id });
  }

  // Rules
  const aRuleIds = new Set(a.rules.map(r => r.id));
  const bRuleIds = new Set(b.rules.map(r => r.id));
  for (const id of bRuleIds) {
    if (!aRuleIds.has(id)) changes.push({ type: 'added', component: 'rule', description: id });
  }
  for (const id of aRuleIds) {
    if (!bRuleIds.has(id)) changes.push({ type: 'removed', component: 'rule', description: id });
  }

  // Roles
  const aRoleIds = new Set((a.roles?.roles ?? []).map(r => r.id));
  const bRoleIds = new Set((b.roles?.roles ?? []).map(r => r.id));
  for (const id of bRoleIds) {
    if (!aRoleIds.has(id)) changes.push({ type: 'added', component: 'role', description: id });
  }
  for (const id of aRoleIds) {
    if (!bRoleIds.has(id)) changes.push({ type: 'removed', component: 'role', description: id });
  }

  // Guard count changes
  const aGuardCount = a.guards?.guards.length ?? 0;
  const bGuardCount = b.guards?.guards.length ?? 0;
  if (aGuardCount !== bGuardCount && changes.filter(c => c.component === 'guard').length === 0) {
    changes.push({ type: 'changed', component: 'guards', description: `${aGuardCount} → ${bGuardCount}` });
  }

  return { changes };
}

// ─── Snapshot ───────────────────────────────────────────────────────────────

async function worldSnapshot(worldPath: string): Promise<void> {
  const { readdir, readFile, mkdir, writeFile } = await import('fs/promises');
  const { join } = await import('path');

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const snapshotDir = join(worldPath, '.snapshots', timestamp);

  await mkdir(snapshotDir, { recursive: true });

  // Copy all JSON files
  const files = await readdir(worldPath);
  let copied = 0;
  for (const file of files) {
    if (file.endsWith('.json')) {
      const content = await readFile(join(worldPath, file), 'utf-8');
      await writeFile(join(snapshotDir, file), content, 'utf-8');
      copied++;
    }
  }

  // Copy rules directory if present
  try {
    const rulesDir = join(worldPath, 'rules');
    const ruleFiles = await readdir(rulesDir);
    await mkdir(join(snapshotDir, 'rules'), { recursive: true });
    for (const file of ruleFiles) {
      if (file.endsWith('.json')) {
        const content = await readFile(join(rulesDir, file), 'utf-8');
        await writeFile(join(snapshotDir, 'rules', file), content, 'utf-8');
        copied++;
      }
    }
  } catch {
    // No rules dir — fine
  }

  process.stdout.write(`Snapshot saved: ${snapshotDir}\n`);
  process.stdout.write(`Files: ${copied}\n`);
}

// ─── Rollback ───────────────────────────────────────────────────────────────

async function worldRollback(worldPath: string): Promise<void> {
  const { readdir, readFile, writeFile } = await import('fs/promises');
  const { join } = await import('path');

  const snapshotsDir = join(worldPath, '.snapshots');

  let snapshots: string[];
  try {
    snapshots = (await readdir(snapshotsDir)).sort();
  } catch {
    process.stderr.write('No snapshots found. Run `neuroverse world snapshot` first.\n');
    process.exit(1);
    return;
  }

  if (snapshots.length === 0) {
    process.stderr.write('No snapshots found. Run `neuroverse world snapshot` first.\n');
    process.exit(1);
    return;
  }

  const latest = snapshots[snapshots.length - 1];
  const snapshotDir = join(snapshotsDir, latest);

  // First, take a backup of current state
  const backupTimestamp = 'pre-rollback-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupDir = join(snapshotsDir, backupTimestamp);

  // Save current state as backup
  const { mkdir } = await import('fs/promises');
  await mkdir(backupDir, { recursive: true });
  const currentFiles = await readdir(worldPath);
  for (const file of currentFiles) {
    if (file.endsWith('.json')) {
      const content = await readFile(join(worldPath, file), 'utf-8');
      await writeFile(join(backupDir, file), content, 'utf-8');
    }
  }

  // Restore from snapshot
  const snapshotFiles = await readdir(snapshotDir);
  let restored = 0;
  for (const file of snapshotFiles) {
    if (file.endsWith('.json')) {
      const content = await readFile(join(snapshotDir, file), 'utf-8');
      await writeFile(join(worldPath, file), content, 'utf-8');
      restored++;
    }
  }

  // Restore rules if present
  try {
    const rulesDir = join(snapshotDir, 'rules');
    const ruleFiles = await readdir(rulesDir);
    await mkdir(join(worldPath, 'rules'), { recursive: true });
    for (const file of ruleFiles) {
      if (file.endsWith('.json')) {
        const content = await readFile(join(rulesDir, file), 'utf-8');
        await writeFile(join(worldPath, 'rules', file), content, 'utf-8');
        restored++;
      }
    }
  } catch {
    // No rules in snapshot
  }

  process.stdout.write(`Rolled back to: ${latest}\n`);
  process.stdout.write(`Restored: ${restored} files\n`);
  process.stdout.write(`Backup saved: ${backupDir}\n`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { subcommand, paths, flags } = parseArgs(argv);

  if (flags.help || !subcommand) {
    process.stdout.write(USAGE + '\n');
    process.exit(0);
  }

  switch (subcommand) {
    case 'status': {
      if (!paths[0]) {
        process.stderr.write('Usage: neuroverse world status <path>\n');
        process.exit(1);
      }
      return worldStatus(paths[0], !!flags.json);
    }
    case 'diff': {
      if (!paths[0] || !paths[1]) {
        process.stderr.write('Usage: neuroverse world diff <path1> <path2>\n');
        process.exit(1);
      }
      return worldDiff(paths[0], paths[1], !!flags.json);
    }
    case 'snapshot': {
      if (!paths[0]) {
        process.stderr.write('Usage: neuroverse world snapshot <path>\n');
        process.exit(1);
      }
      return worldSnapshot(paths[0]);
    }
    case 'rollback': {
      if (!paths[0]) {
        process.stderr.write('Usage: neuroverse world rollback <path>\n');
        process.exit(1);
      }
      return worldRollback(paths[0]);
    }
    default: {
      process.stderr.write(`Unknown world subcommand: "${subcommand}"\n\n`);
      process.stdout.write(USAGE + '\n');
      process.exit(1);
    }
  }
}
