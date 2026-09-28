#!/usr/bin/env node
/**
 * Rulebook guard: the govern-my-chatbot skill's own governance, enforced by
 * code outside Claude.
 *
 * The skill's first rule is that nothing goes into a creator's rulebook
 * without their approval. Asking Claude to follow that rule would be a wish;
 * this hook makes it a rule. Claude Code runs it around every file write or
 * edit:
 *
 *   pre  — if the file is a rulebook (*.nv-world.md), Claude Code must ask
 *          the creator before the change happens, even if they've told
 *          Claude Code to accept edits automatically.
 *   post — after a rulebook changes, the creator is told, and Claude is
 *          reminded to explain the change and re-run the fire drill.
 *
 * Every other file is ignored. The hook reads nothing but the tool request
 * Claude Code sends it, writes nothing to disk, and makes no network calls.
 * If it can't read the request, it stays out of the way.
 */

const phase = process.argv[2];

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', () => {
  let request;
  try {
    request = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const filePath = request?.tool_input?.file_path ?? '';
  if (!String(filePath).endsWith('.nv-world.md')) process.exit(0);

  const name = String(filePath).split(/[\\/]/).pop();

  if (phase === 'pre') {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
          permissionDecisionReason:
            `This changes your chatbot's rulebook (${name}). Nothing goes into your ` +
            'rulebook without your approval. Read the change, then say yes only if ' +
            "it's what you want.",
        },
      }),
    );
  } else if (phase === 'post') {
    process.stdout.write(
      JSON.stringify({
        systemMessage:
          `Your rulebook changed (${name}). Run the fire drill to make sure your ` +
          'rules still hold: npm run check-rules',
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext:
            `The creator's rulebook ${filePath} was just changed. Tell them in plain ` +
            'words what changed and why, then run `npm run check-rules` if the ' +
            'project has it and walk them through the result.',
        },
      }),
    );
  }
  process.exit(0);
});
