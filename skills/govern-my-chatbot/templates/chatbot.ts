/**
 * The governed chatbot: your rulebook + NeuroVerse chat governance + Claude.
 *
 * Call reply() from your app's server for every message:
 *
 *   const turn = await reply(message, history);
 *   send(turn.reply);
 *
 * Every message and every reply is checked by meaning against your
 * rulebook. Hard moments get your exact words and the chatbot is never
 * called. If a check can't run, your "unavailable" wording is sent:
 * nothing unchecked ever reaches the user.
 *
 * Server-side only: the API key must never reach the browser.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  governTurn,
  parseChatRulebook,
  type ChatMessage,
  type ChatRulebook,
  type TurnResult,
} from '@neuroverseos/governance/chat';
import { claudeJudge, claudeReply } from './claude-models';

const GOVERNANCE_DIR = 'governance';

/** Finds and reads governance/*.nv-world.md. Refuses to run with an unreadable rulebook. */
export function loadRulebook(path?: string): ChatRulebook {
  const file =
    path ??
    (() => {
      const found = readdirSync(GOVERNANCE_DIR).filter((f) => f.endsWith('.nv-world.md'));
      if (found.length !== 1) {
        throw new Error(`Expected exactly one rulebook (*.nv-world.md) in ${GOVERNANCE_DIR}/, found ${found.length}.`);
      }
      return join(GOVERNANCE_DIR, found[0]);
    })();

  const { rulebook, issues } = parseChatRulebook(readFileSync(file, 'utf8'));
  const errors = issues.filter((i) => i.severity === 'error');
  if (!rulebook || errors.length > 0) {
    // Refuse to run ungoverned: a broken rulebook stops the app.
    throw new Error(`Rulebook ${file} can't be used: ${errors.map((e) => e.message).join('; ')}`);
  }
  return rulebook;
}

let rulebook: ChatRulebook | undefined;

/** One governed turn. `history` is the earlier conversation, oldest first. */
export async function reply(message: string, history: ChatMessage[] = []): Promise<TurnResult> {
  rulebook ??= loadRulebook();
  const turn = await governTurn({ rulebook, message, history, generate: claudeReply, judge: claudeJudge });
  // Log what happened and which rule, never what the person said. (The
  // checker's "why" is left out too: it could quote the person.)
  console.info(
    `[governance] ${turn.outcome}`,
    JSON.stringify(turn.trace.map(({ step, result, ref }) => ({ step, result, ref }))),
  );
  return turn;
}
