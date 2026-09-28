/**
 * Fire drill: checks the coach's rulebook against governance/tests.md.
 *
 *   npm run check-rules
 *
 * No AI is called. This checks the parts of governance that are pure code:
 *   - the rulebook file can be read
 *   - every "Should trigger" message reaches the right fixed response
 *   - every "Should not trigger" message is left for the coach
 * and lists the "Try in the app" messages for the creator to judge by hand.
 *
 * Output is written for the creator, in plain language.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { loadRulebook, preCheck } from './governance';

const GOVERNANCE_DIR = 'governance';

function findRulebook(): string {
  const arg = process.argv[2];
  if (arg) return arg;
  const files = readdirSync(GOVERNANCE_DIR).filter((f) => f.endsWith('.nv-world.md'));
  if (files.length !== 1) {
    console.error(
      `Expected exactly one rulebook (*.nv-world.md) in ${GOVERNANCE_DIR}/, found ${files.length}. ` +
        'Pass the path instead: npm run check-rules -- governance/my-coach.nv-world.md',
    );
    process.exit(1);
  }
  return join(GOVERNANCE_DIR, files[0]);
}

function listUnder(markdown: string, heading: RegExp): { name: string; items: string[] }[] {
  return markdown
    .split(/^## /m)
    .slice(1)
    .map((block) => {
      const [title, ...rest] = block.split('\n');
      const match = title.trim().match(heading);
      if (!match) return null;
      const items = rest
        .filter((line) => line.startsWith('- '))
        .map((line) => line.slice(2).trim());
      return { name: (match[1] ?? '').trim(), items };
    })
    .filter((x): x is { name: string; items: string[] } => x !== null);
}

const rulebookPath = findRulebook();
let rulebook;
try {
  rulebook = loadRulebook(rulebookPath);
} catch (err) {
  console.error(`✗ Your rulebook (${rulebookPath}) couldn't be read:\n  ${(err as Error).message}`);
  process.exit(1);
}
console.log(`✓ Rulebook loaded: ${rulebookPath}`);
console.log(
  `  ${rulebook.invariants.length} never-break rules, ` +
    `${rulebook.lens?.directives.length ?? 0} personality rules, ` +
    `${rulebook.escalations.length} front-desk responses (${rulebook.escalations.map((e) => e.id).join(', ')})\n`,
);

const tests = readFileSync(join(GOVERNANCE_DIR, 'tests.md'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
let failures = 0;

console.log('Front desk — messages that SHOULD get your fixed response:');
for (const group of listUnder(tests, /^Should trigger:\s*(.+)$/i)) {
  if (!rulebook.escalations.some((e) => e.id === group.name)) {
    failures++;
    console.log(`  ✗ tests.md mentions "${group.name}", but your rulebook has no escalation with that name.`);
    continue;
  }
  for (const message of group.items) {
    const result = preCheck(rulebook, message);
    if (result?.escalationId === group.name) {
      console.log(`  ✓ "${message}" → ${group.name}`);
    } else {
      failures++;
      const got = result ? `went to ${result.escalationId} instead` : 'was NOT caught — the AI would have answered it';
      console.log(`  ✗ "${message}" ${got}. Add a trigger phrase to "${group.name}" in your rulebook.`);
    }
  }
}

console.log('\nFront desk — everyday messages that should NOT be caught:');
for (const group of listUnder(tests, /^Should not trigger()$/i)) {
  for (const message of group.items) {
    const result = preCheck(rulebook, message);
    if (!result) {
      console.log(`  ✓ "${message}" → goes to the coach`);
    } else {
      failures++;
      console.log(
        `  ✗ "${message}" was caught by ${result.escalationId}. ` +
          'Make that escalation\'s trigger phrases more specific.',
      );
    }
  }
}

const manual = listUnder(tests, /^Try in the app()$/i).flatMap((g) => g.items);
if (manual.length > 0) {
  console.log('\nTry these in the app and judge the replies yourself:');
  for (const item of manual) console.log(`  • ${item}`);
}

console.log(
  failures === 0
    ? '\n✓ All automatic checks passed.'
    : `\n✗ ${failures} check${failures === 1 ? '' : 's'} failed. Fix the rulebook, then run this again.`,
);
process.exit(failures === 0 ? 0 : 1);
