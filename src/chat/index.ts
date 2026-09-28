/**
 * @neuroverseos/governance/chat — governance for chatbots.
 *
 * Every incoming message and every outgoing reply is checked by meaning
 * against the creator's rulebook. No word lists. If a check can't run,
 * nothing unchecked is sent.
 *
 *   import { parseChatRulebook, governTurn } from '@neuroverseos/governance/chat';
 *
 *   const { rulebook, issues } = parseChatRulebook(markdown);
 *   const turn = await governTurn({ rulebook, message, history, generate, judge });
 *   send(turn.reply);
 *
 * Provider-agnostic (`generate` and `judge` are your model calls) and
 * runtime-agnostic (no file system or network access of its own).
 */

export {
  parseChatRulebook,
  validateChatRulebook,
  describeEnforcement,
  DEFAULT_UNAVAILABLE_RESPONSE,
  DEFAULT_FALLBACK_RESPONSE,
} from './rulebook';
export { checkMoments, checkRules, parseJudgeJson, JudgeUnavailableError } from './judge';
export { governTurn, buildInstructions, type GovernTurnOptions } from './pipeline';
export type {
  CheckMethod,
  ChatRule,
  HardMoment,
  ChatPersona,
  ChatResponses,
  ChatRulebook,
  RulebookIssue,
  EnforcementLine,
  ChatMessage,
  JudgeModel,
  GenerateReply,
  TurnOutcome,
  TurnTraceEntry,
  TurnResult,
} from './types';
