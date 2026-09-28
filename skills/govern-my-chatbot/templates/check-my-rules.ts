/**
 * Fire drill: checks the chatbot's rulebook against governance/tests.md.
 *
 *   npm run check-rules
 *
 * 1. Reads the rulebook and shows how every part of it is enforced, with a
 *    warning for any rule that is only "asked" (prompt-only).
 * 2. Runs every test through the same meaning checks the chatbot uses.
 *    Needs the API key: there are no word lists to fall back on.
 *
 * No chatbot replies are generated here. The "Try in the app" messages are
 * listed for the creator to try and judge by hand.
 *
 * Output is written for the creator, in plain language.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  checkMoments,
  checkRules,
  describeEnforcement,
  parseChatRulebook,
  type ChatRulebook,
} from '@neuroverseos/governance/chat';
import { claudeAvailable, claudeJudge } from './claude-models';

const GOVERNANCE_DIR = 'governance';

let passed = 0;
let failed = 0;
let notChecked = 0;

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
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/^## /m)
    .slice(1)
    .map((block) => {
      const [title, ...rest] = block.split('\n');
      return { title: title.trim(), items: rest.filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim()) };
    });
}

async function hardMoment(rulebook: ChatRulebook, expected: string | null, messages: string[]) {
  if (expected && !rulebook.moments.some((m) => m.id === expected)) {
    failed++;
    console.log(`  ✗ tests.md mentions "${expected}", but your rulebook has no hard moment with that name.`);
    return;
  }
  for (const message of messages) {
    try {
      const { momentId, why } = await checkMoments(claudeJudge, rulebook.moments, message);
      if (momentId === expected) {
        passed++;
        console.log(`  ✓ "${message}" → ${expected ?? 'goes to the chatbot'}`);
      } else {
        failed++;
        console.log(
          expected
            ? `  ✗ "${message}" was ${momentId ? `seen as "${momentId}"` : 'NOT recognized'} (${why}). ` +
                `Make the "${expected}" situation clearer, or add an example like this one.`
            : `  ✗ "${message}" was caught as "${momentId}" (${why}). Make that situation description more specific.`,
        );
      }
    } catch (err) {
      notChecked++;
      console.log(`  ○ "${message}" — couldn't check: ${(err as Error).message}`);
    }
  }
}

async function replies(rulebook: ChatRulebook, expected: string | null, drafts: string[]) {
  const checked = rulebook.rules.filter((r) => r.check === 'meaning');
  if (expected) {
    const rule = rulebook.rules.find((r) => r.id === expected);
    if (!rule) {
      failed++;
      console.log(`  ✗ tests.md mentions rule "${expected}", but your rulebook has no rule with that id.`);
      return;
    }
    if (rule.check !== 'meaning') {
      failed++;
      console.log(`  ✗ "${expected}" is prompt-only, so nothing checks it. Remove its prompt-only mark to have it checked.`);
      return;
    }
  }
  for (const draft of drafts) {
    try {
      const broken = await checkRules(claudeJudge, checked, draft, '(test)');
      if (expected ? broken.some((b) => b.ruleId === expected) : broken.length === 0) {
        passed++;
        console.log(`  ✓ "${draft}" → ${expected ? `breaks ${expected}` : 'allowed'}`);
      } else {
        failed++;
        console.log(
          expected
            ? `  ✗ "${draft}" was NOT caught breaking ${expected}. Make that rule's wording clearer about the behavior.`
            : `  ✗ "${draft}" was caught for ${broken[0].ruleId} (${broken[0].why}), but it's a good reply.`,
        );
      }
    } catch (err) {
      notChecked++;
      console.log(`  ○ "${draft}" — couldn't check: ${(err as Error).message}`);
    }
  }
}

async function main() {
  const path = findRulebook();
  const { rulebook, issues } = parseChatRulebook(readFileSync(path, 'utf8'));

  for (const i of issues.filter((x) => x.severity === 'error')) console.log(`✗ ${i.message}`);
  if (!rulebook || issues.some((i) => i.severity === 'error')) {
    console.log(`\n✗ Your rulebook (${path}) can't be used until these are fixed.`);
    process.exit(1);
  }

  console.log(`✓ Rulebook loaded: ${path}\n`);
  console.log('How each part of your rulebook is enforced:');
  for (const line of describeEnforcement(rulebook)) {
    console.log(`  ${line.enforcedBy.startsWith('prompt') ? '⚠' : '•'} ${line.ref}: ${line.enforcedBy}`);
  }
  const warnings = issues.filter((i) => i.severity === 'warning');
  if (warnings.length) {
    console.log('\nWarnings:');
    for (const w of warnings) console.log(`  ⚠ ${w.message}`);
  }

  if (!claudeAvailable()) {
    console.log(
      '\n○ The fire drill checks by meaning, which needs your API key. There are no word lists to ' +
        'fall back on. Set ANTHROPIC_API_KEY in your .env file, then run this again.',
    );
    process.exit(2);
  }

  console.log('\nRunning the fire drill (each test is a small AI call)...\n');
  const tests = readFileSync(join(GOVERNANCE_DIR, 'tests.md'), 'utf8');
  const manual: string[] = [];

  for (const { title, items } of sections(tests)) {
    let m: RegExpMatchArray | null;
    if ((m = title.match(/^Hard moment:\s*(.+)$/i))) {
      console.log(`Should get your "${m[1].trim()}" response:`);
      await hardMoment(rulebook, m[1].trim(), items);
    } else if (/^Not a hard moment$/i.test(title)) {
      console.log('Should go to the chatbot:');
      await hardMoment(rulebook, null, items);
    } else if ((m = title.match(/^Breaks:\s*(.+)$/i))) {
      console.log(`Replies that should be caught breaking ${m[1].trim()}:`);
      await replies(rulebook, m[1].trim(), items);
    } else if (/^Keeps every rule$/i.test(title)) {
      console.log('Good replies that should be allowed:');
      await replies(rulebook, null, items);
    } else if (/^Try in the app$/i.test(title)) {
      manual.push(...items);
      continue;
    } else {
      console.log(`(Skipping unknown section "${title}" in tests.md)`);
      continue;
    }
    console.log('');
  }

  if (manual.length) {
    console.log('Try these in the app and judge the replies yourself:');
    for (const item of manual) console.log(`  • ${item}`);
    console.log('');
  }

  console.log(`${passed} passed · ${failed} failed · ${notChecked} couldn't be checked`);
  if (failed > 0) console.log('✗ Fix the rulebook, then run this again.');
  else if (notChecked > 0) console.log('○ Some checks couldn\'t run. Run this again in a moment.');
  else console.log('✓ All checks passed.');
  process.exit(failed === 0 && notChecked === 0 ? 0 : 1);
}

main();
