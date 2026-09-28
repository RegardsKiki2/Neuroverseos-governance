/**
 * The two Claude calls the governance needs:
 *
 *   claudeJudge  — the checker. Reads messages and replies against the
 *                  creator's rulebook and answers in JSON. A separate call
 *                  from the chatbot, with none of its instructions.
 *   claudeReply  — the chatbot itself.
 *
 * Plug them into governTurn() from @neuroverseos/governance/chat.
 *
 * Needs an Anthropic API key (ANTHROPIC_API_KEY), set up by the creator
 * themselves in a .env file or their terminal — never pasted into a chat,
 * never written into code.
 *
 * Requires: npm install @anthropic-ai/sdk
 */

import Anthropic from '@anthropic-ai/sdk';
import type { GenerateReply, JudgeModel } from '@neuroverseos/governance/chat';

/** The chatbot's own model. */
export const CHAT_MODEL = 'claude-opus-5-5';
/** The checker: fast and inexpensive, used on every message and reply. */
export const CHECK_MODEL = 'claude-haiku-4-5';

// Read ANTHROPIC_API_KEY from a .env file in the project, if there is one.
// (The creator puts their key there themselves; .env must be in .gitignore.)
try {
  process.loadEnvFile();
} catch {
  // No .env file: the key may be set in the terminal instead, or not at all.
}

let client: Anthropic | undefined;
function anthropic(): Anthropic {
  client ??= new Anthropic();
  return client;
}

/** True when an API key is available, so the checks and the chatbot can run. */
export function claudeAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function text(content: ReadonlyArray<{ type: string; text?: unknown }>): string {
  return content
    .flatMap((block) => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : []))
    .join('')
    .trim();
}

/**
 * The checker. Any failure (an error, a refusal) throws, and governTurn
 * treats that as "couldn't check": nothing unchecked is sent.
 */
export const claudeJudge: JudgeModel = async ({ system, user }) => {
  const response = await anthropic().messages.create({
    model: CHECK_MODEL,
    max_tokens: 1024,
    system,
    messages: [{ role: 'user', content: user }],
  });
  if (response.stop_reason === 'refusal') {
    throw new Error('the checker declined to answer');
  }
  return text(response.content);
};

/**
 * The chatbot. Uses server-side fallbacks so that if the model declines a
 * request, the API retries it on Anthropic's recommended fallback model.
 */
export const claudeReply: GenerateReply = async ({ system, messages }) => {
  const response = await anthropic().beta.messages.create({
    model: CHAT_MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium' },
    system,
    messages,
  });
  if (response.stop_reason === 'refusal') {
    throw new Error('the chatbot declined to answer');
  }
  return text(response.content);
};
