/**
 * Chat governance — reading and validating a chatbot rulebook.
 *
 * A chatbot rulebook is a .nv-world.md file with these sections:
 *
 *   # Thesis        what the chatbot exists to do
 *   # Invariants    lines it never crosses (rules)
 *   # Lenses        its persona, and `>` lines for how it behaves (habits)
 *   # Escalations   hard moments: situation, example phrasings, fixed response
 *   # Responses     optional: `- unavailable:` and `- fallback:` wording
 *
 * Every rule and habit is checked by meaning on every reply unless it is
 * explicitly marked prompt-only: `(prompt)` at the end of an invariant, or
 * `[check: prompt]` anywhere in a rule or habit. Validation lists every
 * prompt-only rule, so "just asking the AI" is always a visible choice.
 *
 * Pure: no file system, no network. Runs in Node.js, Deno, and browsers.
 */

import { parseWorldMarkdown } from '../engine/bootstrap-parser';
import type {
  ChatRule,
  ChatRulebook,
  EnforcementLine,
  HardMoment,
  RulebookIssue,
} from './types';

export const DEFAULT_UNAVAILABLE_RESPONSE =
  "I'm having trouble right now, so I can't answer safely. Please try again in a moment.";

export const DEFAULT_FALLBACK_RESPONSE =
  "I want to make sure I get this right for you. Could you tell me a bit more about what you're working on?";

const PROMPT_TAG = /\s*\[check:\s*prompt\]\s*/i;
const MIN_EXAMPLES = 3;

/** Split a markdown document into its `# Heading` sections. */
function sections(markdown: string): Map<string, string> {
  const out = new Map<string, string>();
  const withoutComments = markdown.replace(/<!--[\s\S]*?-->/g, '');
  const parts = withoutComments.split(/^# /m).slice(1);
  for (const part of parts) {
    const newline = part.indexOf('\n');
    const title = (newline === -1 ? part : part.slice(0, newline)).trim().toLowerCase();
    out.set(title, newline === -1 ? '' : part.slice(newline + 1));
  }
  return out;
}

function parseMoments(section: string | undefined, issues: RulebookIssue[]): HardMoment[] {
  if (!section) return [];
  return section
    .split(/^## /m)
    .slice(1)
    .map((block) => {
      const lines = block.split('\n');
      const id = lines[0].trim();
      const field = (name: string) =>
        lines
          .map((l) => l.trim())
          .filter((l) => l.toLowerCase().startsWith(`- ${name}:`))
          .map((l) => l.slice(name.length + 3).trim());

      if (field('triggers').length > 0) {
        issues.push({
          severity: 'warning',
          ref: id,
          message:
            `Hard moment "${id}" has a "triggers:" line. Trigger words are not used: ` +
            'moments are recognized by meaning. Turn them into "- example:" lines.',
        });
      }

      const response = lines
        .map((l) => l.trim())
        .filter((l) => l.startsWith('>'))
        .map((l) => l.replace(/^>\s?/, '').replace(/^response:\s*/i, ''))
        .join(' ')
        .trim();

      return {
        id,
        situation: field('situation')[0] ?? '',
        examples: field('example'),
        response,
      };
    });
}

function parseResponses(section: string | undefined) {
  const get = (name: string) =>
    section
      ?.split('\n')
      .map((l) => l.trim())
      .find((l) => l.toLowerCase().startsWith(`- ${name}:`))
      ?.slice(name.length + 3)
      .trim();
  return {
    unavailable: get('unavailable') || DEFAULT_UNAVAILABLE_RESPONSE,
    fallback: get('fallback') || DEFAULT_FALLBACK_RESPONSE,
  };
}

/** Check a rulebook for problems and prompt-only rules. */
export function validateChatRulebook(rulebook: ChatRulebook): RulebookIssue[] {
  const issues: RulebookIssue[] = [];

  if (!rulebook.purpose.trim()) {
    issues.push({ severity: 'error', message: 'The # Thesis section is empty: say what the chatbot exists to do.' });
  }

  if (rulebook.moments.length === 0) {
    issues.push({
      severity: 'warning',
      message:
        'No hard moments in # Escalations. Every chatbot should at least define what happens ' +
        'when someone may be in crisis.',
    });
  }

  for (const m of rulebook.moments) {
    if (!m.situation) {
      issues.push({ severity: 'error', ref: m.id, message: `Hard moment "${m.id}" has no "- situation:" description.` });
    }
    if (!m.response) {
      issues.push({ severity: 'error', ref: m.id, message: `Hard moment "${m.id}" has no "> response:" wording.` });
    }
    if (m.examples.length < MIN_EXAMPLES) {
      issues.push({
        severity: 'warning',
        ref: m.id,
        message:
          `Hard moment "${m.id}" has ${m.examples.length} example phrasing(s). Add at least ` +
          `${MIN_EXAMPLES}, including indirect ones: they teach the checker what this moment sounds like.`,
      });
    }
  }

  for (const r of rulebook.rules) {
    if (r.check === 'prompt') {
      issues.push({
        severity: 'warning',
        ref: r.id,
        message: `"${r.text}" is prompt-only: the chatbot is asked to follow it, but nothing checks.`,
      });
    }
  }

  return issues;
}

/**
 * Read a chatbot rulebook from its markdown. Returns the rulebook (null if it
 * can't be read) and every issue found, including validation warnings.
 */
export function parseChatRulebook(markdown: string): { rulebook: ChatRulebook | null; issues: RulebookIssue[] } {
  const issues: RulebookIssue[] = [];
  const { world, issues: parseIssues } = parseWorldMarkdown(markdown);

  for (const i of parseIssues) {
    // Simulation sections (State, Rules, Gates, ...) don't apply to chatbots.
    if (i.severity === 'error') issues.push({ severity: 'error', message: `${i.section}: ${i.message}` });
  }
  if (!world || issues.some((i) => i.severity === 'error')) return { rulebook: null, issues };

  const rules: ChatRule[] = [];
  for (const inv of world.invariants) {
    const prompt = inv.enforcement === 'prompt' || PROMPT_TAG.test(inv.label);
    rules.push({ id: inv.id, text: inv.label.replace(PROMPT_TAG, ' ').trim(), kind: 'rule', check: prompt ? 'prompt' : 'meaning' });
  }

  const lens = world.lenses[0];
  for (const d of lens?.directives ?? []) {
    const prompt = PROMPT_TAG.test(d.instruction);
    rules.push({ id: d.id, text: d.instruction.replace(PROMPT_TAG, ' ').trim(), kind: 'habit', check: prompt ? 'prompt' : 'meaning' });
  }

  const s = sections(markdown);
  const rulebook: ChatRulebook = {
    id: world.frontmatter.world_id,
    name: world.frontmatter.name,
    purpose: world.thesis ?? '',
    rules,
    moments: parseMoments(s.get('escalations'), issues),
    persona: lens && {
      name: lens.name,
      formality: lens.formality,
      verbosity: lens.verbosity,
      emotion: lens.emotion,
      confidence: lens.confidence,
    },
    responses: parseResponses(s.get('responses')),
  };

  issues.push(...validateChatRulebook(rulebook));
  return { rulebook, issues };
}

/** How each part of the rulebook is enforced, in plain words. */
export function describeEnforcement(rulebook: ChatRulebook): EnforcementLine[] {
  return [
    ...rulebook.moments.map((m) => ({
      ref: m.id,
      what: m.situation,
      enforcedBy: 'fixed response (checked by meaning before the chatbot)' as const,
    })),
    ...rulebook.rules.map((r) => ({
      ref: r.id,
      what: r.text,
      enforcedBy:
        r.check === 'meaning' ? ('meaning check on every reply' as const) : ('prompt only (asked, not checked)' as const),
    })),
  ];
}
