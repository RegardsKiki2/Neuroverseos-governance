/**
 * Fire drill: checks the chatbot's rulebook against governance/tests.md.
 *
 *   npm run check-rules
 *
 * Checks the front desk and the editor, and says which layer caught each
 * message: the meaning check (the main one) or the word check (the backstop).
 *
 * With an Anthropic API key set, both layers run and every test counts.
 * Without one, only the word checks run; tests that need the meaning check
 * are listed as "not checked" rather than passed or failed.
 *
 * No chatbot replies are generated here. The "Try in the app" messages are
 * listed for the creator to try and judge by hand.
 *
 * Output is written for the creator, in plain language.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { editor, frontDesk, loadRulebook, type MeaningChecks, type Rulebook } from './governance';
import { claudeAvailable, claudeChecks } from './claude-checks';

const GOVERNANCE_DIR = 'governance';

function findRulebook(): string {
  const arg = process.argv[2];
  if (arg) return arg;
  const files = readdirSync(GOVERNANCE_DIR).filter((f) => f.endsWith('.nv-world.md'));
  if (files.length !== 1) {
    console.error(
      `Expected exactly one rulebook (*.nv-world.md) in ${GOVERNANCE_DIR}/, found ${files.length}. ` +
        'Pass the path instead: npm run check-rules -- governance/my-chatbot.nv-world.md',
    );
    process.exit(1);
  }
  return join(GOVERNANCE_DIR, files[0]);
}

function sections(markdown: string): { title: string; items: string[] }[] {
  return markdown
    .split(/^## /m)
    .slice(1)
    .map((block) => {
      const [title, ...rest] = block.split('\n');
      const items = rest.filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim());
      return { title: title.trim(), items };
    });
}

let passed = 0;
let failed = 0;
let notChecked = 0;

const tag = (by: string) => (by === 'meaning' ? 'by meaning' : 'by words');

async function frontDeskShouldCatch(rulebook: Rulebook, name: string, messages: string[], checks: MeaningChecks) {
  if (!rulebook.escalations.some((e) => e.id === name)) {
    failed++;
    console.log(`  ✗ tests.md mentions "${name}", but your rulebook has no hard moment with that name.`);
    return;
  }
  for (const message of messages) {
    const { result, meaningCheck } = await frontDesk(rulebook, message, checks);
    if (result?.escalationId === name) {
      passed++;
      console.log(`  ✓ "${message}" → ${name} (${tag(result.caughtBy)})`);
    } else if (result) {
      failed++;
      console.log(`  ✗ "${message}" went to ${result.escalationId} instead of ${name}.`);
    } else if (meaningCheck !== 'ran') {
      notChecked++;
      console.log(`  ○ "${message}" — no trigger words; needs the meaning check (${meaningCheck === 'failed' ? 'it failed to run' : 'no API key set'}).`);
    } else {
      failed++;
      console.log(`  ✗ "${message}" was NOT caught — the AI would have answered it. Make the "${name}" situation description clearer.`);
    }
  }
}

async function frontDeskShouldLetThrough(rulebook: Rulebook, messages: string[], checks: MeaningChecks) {
  for (const message of messages) {
    const { result } = await frontDesk(rulebook, message, checks);
    if (!result) {
      passed++;
      console.log(`  ✓ "${message}" → goes to the chatbot`);
    } else {
      failed++;
      console.log(
        `  ✗ "${message}" was caught as ${result.escalationId} (${tag(result.caughtBy)}: ${result.why}). ` +
          (result.caughtBy === 'words'
            ? 'Make that hard moment\'s trigger phrases more specific.'
            : 'Make that hard moment\'s situation description more specific.'),
      );
    }
  }
}

async function editorShouldCatch(rulebook: Rulebook, ruleId: string, replies: string[], checks: MeaningChecks) {
  if (!rulebook.invariants.some((r) => r.id === ruleId) && ruleId !== 'unapproved_resource') {
    failed++;
    console.log(`  ✗ tests.md mentions rule "${ruleId}", but your rulebook has no rule with that id.`);
    return;
  }
  for (const reply of replies) {
    const { findings, meaningCheck } = await editor(rulebook, reply, '(test)', checks);
    const hit = findings.find((f) => f.ruleId === ruleId);
    if (hit) {
      passed++;
      console.log(`  ✓ "${reply}" → breaks ${ruleId} (${tag(hit.caughtBy)})`);
    } else if (meaningCheck !== 'ran') {
      notChecked++;
      console.log(`  ○ "${reply}" — needs the meaning check (${meaningCheck === 'failed' ? 'it failed to run' : 'no API key set'}).`);
    } else {
      failed++;
      console.log(`  ✗ "${reply}" was NOT caught breaking ${ruleId}. Make that rule's wording clearer about the behavior.`);
    }
  }
}

async function editorShouldLetThrough(rulebook: Rulebook, replies: string[], checks: MeaningChecks) {
  for (const reply of replies) {
    const { findings } = await editor(rulebook, reply, '(test)', checks);
    if (findings.length === 0) {
      passed++;
      console.log(`  ✓ "${reply}" → allowed`);
    } else {
      failed++;
      const f = findings[0];
      console.log(`  ✗ "${reply}" was caught for ${f.ruleId} (${tag(f.caughtBy)}: ${f.why}), but it's a good reply.`);
    }
  }
}

async function main() {
  const rulebookPath = findRulebook();
  let rulebook: Rulebook;
  try {
    rulebook = loadRulebook(rulebookPath);
  } catch (err) {
    console.error(`✗ Your rulebook (${rulebookPath}) couldn't be read:\n  ${(err as Error).message}`);
    process.exit(1);
  }

  const checks: MeaningChecks = claudeAvailable() ? claudeChecks : {};
  console.log(`✓ Rulebook loaded: ${rulebookPath}`);
  console.log(
    `  ${rulebook.invariants.length} never-break rules, ` +
      `${rulebook.lens?.directives.length ?? 0} personality rules, ` +
      `${rulebook.escalations.length} hard moments (${rulebook.escalations.map((e) => e.id).join(', ')})`,
  );
  console.log(
    claudeAvailable()
      ? '  Meaning checks: ON (each test makes a small AI call)\n'
      : '  Meaning checks: OFF (no ANTHROPIC_API_KEY set) — only the word backstop is tested\n',
  );

  const tests = readFileSync(join(GOVERNANCE_DIR, 'tests.md'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const manual: string[] = [];

  for (const { title, items } of sections(tests)) {
    let m: RegExpMatchArray | null;
    if ((m = title.match(/^Front desk should catch:\s*(.+)$/i))) {
      console.log(`Front desk should catch — ${m[1]}:`);
      await frontDeskShouldCatch(rulebook, m[1].trim(), items, checks);
    } else if (/^Front desk should let through$/i.test(title)) {
      console.log('Front desk should let these through to the chatbot:');
      await frontDeskShouldLetThrough(rulebook, items, checks);
    } else if ((m = title.match(/^Editor should catch:\s*(.+)$/i))) {
      console.log(`Editor should catch replies that break ${m[1]}:`);
      await editorShouldCatch(rulebook, m[1].trim(), items, checks);
    } else if (/^Editor should let through$/i.test(title)) {
      console.log('Editor should let these good replies through:');
      await editorShouldLetThrough(rulebook, items, checks);
    } else if (/^Try in the app$/i.test(title)) {
      manual.push(...items);
      continue;
    } else {
      console.log(`(Skipping unknown section "${title}" in tests.md)`);
      continue;
    }
    console.log('');
  }

  if (manual.length > 0) {
    console.log('Try these in the app and judge the replies yourself:');
    for (const item of manual) console.log(`  • ${item}`);
    console.log('');
  }

  console.log(`${passed} passed · ${failed} failed · ${notChecked} not checked`);
  if (failed > 0) console.log('✗ Fix the rulebook, then run this again.');
  else if (notChecked > 0) console.log('○ Everything checked passed. Set ANTHROPIC_API_KEY to run the meaning checks too.');
  else console.log('✓ All checks passed.');
  process.exit(failed === 0 ? 0 : 1);
}

main();
