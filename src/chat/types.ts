/**
 * Chat governance — types.
 *
 * Governs a chatbot turn by turn: every incoming message and every outgoing
 * reply is checked by MEANING against the creator's rulebook. There are no
 * word lists. If a meaning check can't run, nothing unchecked is sent
 * (fail closed).
 */

/** How a rule is enforced. */
export type CheckMethod =
  /** A separate judge model checks every reply against this rule. */
  | 'meaning'
  /** The chatbot is asked to follow it; nothing checks. Flagged by validation. */
  | 'prompt';

export interface ChatRule {
  id: string;
  text: string;
  /** 'rule' = a line it never crosses (# Invariants); 'habit' = how it behaves (# Lenses). */
  kind: 'rule' | 'habit';
  check: CheckMethod;
}

/**
 * A hard moment: a situation where the chatbot must not improvise. When a
 * message matches the situation (by meaning), the creator's response is sent
 * and the chatbot is never called.
 */
export interface HardMoment {
  id: string;
  /** What is happening, in plain words. The judge reads messages against this. */
  situation: string;
  /** Example phrasings. They teach the judge; they are never matched literally. */
  examples: string[];
  /** The creator's exact words, sent instead of a chatbot reply. */
  response: string;
}

export interface ChatPersona {
  name: string;
  formality: string;
  verbosity: string;
  emotion: string;
  confidence: string;
}

export interface ChatResponses {
  /** Sent when a meaning check can't run. Nothing unchecked is ever sent instead. */
  unavailable: string;
  /** Sent when every draft broke a rule. */
  fallback: string;
}

export interface ChatRulebook {
  id: string;
  name: string;
  /** What the chatbot exists to do (# Thesis). */
  purpose: string;
  rules: ChatRule[];
  moments: HardMoment[];
  persona?: ChatPersona;
  responses: ChatResponses;
}

export interface RulebookIssue {
  severity: 'error' | 'warning';
  message: string;
  /** The rule or moment id the issue is about, if any. */
  ref?: string;
}

/** One line of how the rulebook is enforced, for showing to the creator. */
export interface EnforcementLine {
  ref: string;
  what: string;
  enforcedBy: 'fixed response (checked by meaning before the chatbot)' | 'meaning check on every reply' | 'prompt only (asked, not checked)';
}

// ─── The turn pipeline ──────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * The judge: a model call that returns text containing a JSON object.
 * Provider-agnostic. It should be a different call from the chatbot itself,
 * with no access to the chatbot's instructions.
 */
export type JudgeModel = (prompt: { system: string; user: string }) => Promise<string>;

/** The chatbot: generates a reply from instructions and the conversation. */
export type GenerateReply = (request: { system: string; messages: ChatMessage[] }) => Promise<string>;

export type TurnOutcome =
  /** A hard moment matched; the creator's response was sent. */
  | 'moment'
  /** The first draft passed every meaning check. */
  | 'clean'
  /** A draft broke a rule; a retry passed. */
  | 'fixed'
  /** Every draft broke a rule; the creator's fallback was sent. */
  | 'fallback'
  /** A check (or the chatbot) couldn't run; the unavailable response was sent. */
  | 'unavailable';

/** An audit record of what happened in a turn. Never contains the user's words. */
export interface TurnTraceEntry {
  step: 'moment_check' | 'generate' | 'rule_check';
  result: 'matched' | 'none' | 'passed' | 'broken' | 'ok' | 'failed';
  ref?: string;
  why?: string;
}

export interface TurnResult {
  reply: string;
  outcome: TurnOutcome;
  moment?: { id: string; why: string };
  /** Rules broken by drafts that were not sent. */
  broken: { ruleId: string; why: string }[];
  /** Drafts that broke a rule and were never sent. */
  rejectedDrafts: string[];
  trace: TurnTraceEntry[];
}
