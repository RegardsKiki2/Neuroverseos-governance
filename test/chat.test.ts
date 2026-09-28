import { describe, it, expect, vi } from 'vitest';
import {
  parseChatRulebook,
  describeEnforcement,
  governTurn,
  buildInstructions,
  parseJudgeJson,
  JudgeUnavailableError,
  DEFAULT_UNAVAILABLE_RESPONSE,
  type ChatRulebook,
  type JudgeModel,
  type GenerateReply,
} from '../src/chat';

const RULEBOOK = `---
world_id: test-coach
name: Test Coach
version: 1.0.0
---

# Thesis

The Test Coach teaches the Bridge Model to first-generation professionals.

# Invariants

- \`no_promises\` — The coach never promises results or invents outcomes. (structural, immutable)
- \`honest_ai\` — The coach never claims to be a human. (structural, immutable)
- \`warm_signoff\` — The coach signs off warmly. (prompt, immutable)

# Lenses
- policy: locked

## test-coach
- name: Test Coach
- formality: casual
- verbosity: concise
- emotion: warm
- confidence: balanced

> behavior_shaping: Ask what happened before giving any advice.
> value_emphasis: Mention the weather now and then. [check: prompt]

# Escalations

## crisis
- situation: The person may be in danger or thinking about self-harm, however indirectly they say it.
- example: I don't see a way forward anymore.
- example: Everyone would be better off without me.
- example: I've been giving my things away.

> response: I'm really glad you told me. Please reach out to someone who can help right now.

## legal
- situation: The person needs legal advice.
- example: Should I get a lawyer?

> response: That's a legal question, and it's outside what I can help with.

# Responses

- unavailable: I can't answer safely right now. Please try again soon.
`;

function load(markdown = RULEBOOK): ChatRulebook {
  const { rulebook, issues } = parseChatRulebook(markdown);
  expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  return rulebook!;
}

/** A judge that answers the moment check and the rule check from fixed functions. */
function fakeJudge(
  moment: (user: string) => string,
  rules: (user: string) => string,
): JudgeModel & { calls: { system: string; user: string }[] } {
  const calls: { system: string; user: string }[] = [];
  const fn = (async (p: { system: string; user: string }) => {
    calls.push(p);
    return p.user.startsWith('Situations:') ? moment(p.user) : rules(p.user);
  }) as JudgeModel & { calls: typeof calls };
  fn.calls = calls;
  return fn;
}

const noMoment = () => '{"moment": "none", "why": "everyday message"}';
const noBroken = () => '{"broken": []}';

describe('parseChatRulebook', () => {
  it('reads rules, habits, hard moments, persona, and responses', () => {
    const rb = load();
    expect(rb.id).toBe('test-coach');
    expect(rb.purpose).toContain('Bridge Model');
    expect(rb.rules.map((r) => [r.id, r.kind, r.check])).toEqual([
      ['no_promises', 'rule', 'meaning'],
      ['honest_ai', 'rule', 'meaning'],
      ['warm_signoff', 'rule', 'prompt'],
      ['test-coach_directive_0', 'habit', 'meaning'],
      ['test-coach_directive_1', 'habit', 'prompt'],
    ]);
    expect(rb.rules[4].text).toBe('Mention the weather now and then.');
    expect(rb.moments).toHaveLength(2);
    expect(rb.moments[0]).toMatchObject({ id: 'crisis', examples: expect.arrayContaining(["I've been giving my things away."]) });
    expect(rb.moments[0].response).toContain("I'm really glad you told me");
    expect(rb.persona?.emotion).toBe('warm');
    expect(rb.responses.unavailable).toBe("I can't answer safely right now. Please try again soon.");
    expect(rb.responses.fallback).toContain('get this right');
  });

  it('flags every prompt-only rule, thin examples, and legacy trigger words', () => {
    const { issues } = parseChatRulebook(RULEBOOK.replace('## legal\n', '## legal\n- triggers: lawyer, sue\n'));
    const warnings = issues.filter((i) => i.severity === 'warning');
    expect(warnings.map((w) => w.ref)).toEqual(
      expect.arrayContaining(['warm_signoff', 'test-coach_directive_1', 'legal']),
    );
    expect(warnings.find((w) => w.ref === 'warm_signoff')!.message).toContain('nothing checks');
    expect(warnings.some((w) => w.message.includes('Trigger words are not used'))).toBe(true);
    expect(warnings.some((w) => w.message.includes('1 example phrasing'))).toBe(true);
  });

  it('errors on a hard moment with no situation or response', () => {
    const broken = RULEBOOK.replace('- situation: The person needs legal advice.\n', '').replace(
      "> response: That's a legal question, and it's outside what I can help with.",
      '',
    );
    const { issues } = parseChatRulebook(broken);
    const errors = issues.filter((i) => i.severity === 'error').map((i) => i.message);
    expect(errors.some((e) => e.includes('no "- situation:"'))).toBe(true);
    expect(errors.some((e) => e.includes('no "> response:"'))).toBe(true);
  });

  it('warns when there are no hard moments at all', () => {
    const { issues } = parseChatRulebook(RULEBOOK.split('# Escalations')[0]);
    expect(issues.some((i) => i.message.includes('No hard moments'))).toBe(true);
  });

  it('uses the default unavailable response when none is given', () => {
    const rb = load(RULEBOOK.split('# Responses')[0]);
    expect(rb.responses.unavailable).toBe(DEFAULT_UNAVAILABLE_RESPONSE);
  });

  it('describes how each part is enforced', () => {
    const lines = describeEnforcement(load());
    expect(lines.find((l) => l.ref === 'crisis')!.enforcedBy).toContain('fixed response');
    expect(lines.find((l) => l.ref === 'no_promises')!.enforcedBy).toBe('meaning check on every reply');
    expect(lines.find((l) => l.ref === 'warm_signoff')!.enforcedBy).toBe('prompt only (asked, not checked)');
  });
});

describe('governTurn', () => {
  it('sends the fixed response for a hard moment and never calls the chatbot', async () => {
    const generate = vi.fn<GenerateReply>();
    const judge = fakeJudge(() => '{"moment": "crisis", "why": "no way forward"}', noBroken);
    const turn = await governTurn({ rulebook: load(), message: 'nothing matters now', generate, judge });
    expect(turn.outcome).toBe('moment');
    expect(turn.reply).toContain("I'm really glad you told me");
    expect(turn.moment).toEqual({ id: 'crisis', why: 'no way forward' });
    expect(generate).not.toHaveBeenCalled();
  });

  it('gives the judge the situations, examples, and earlier messages', async () => {
    const judge = fakeJudge(noMoment, noBroken);
    await governTurn({
      rulebook: load(),
      message: 'hi',
      history: [{ role: 'user', content: 'earlier thing' }, { role: 'assistant', content: 'reply' }],
      generate: async () => 'Hello!',
      judge,
    });
    const momentPrompt = judge.calls[0].user;
    expect(momentPrompt).toContain('situation: The person may be in danger');
    expect(momentPrompt).toContain('"Everyone would be better off without me."');
    expect(momentPrompt).toContain('earlier thing');
    expect(momentPrompt).not.toContain('- reply');
  });

  it('sends a clean draft and checks only meaning-checked rules', async () => {
    const judge = fakeJudge(noMoment, noBroken);
    const turn = await governTurn({ rulebook: load(), message: 'hi', generate: async () => 'Hello!', judge });
    expect(turn.outcome).toBe('clean');
    expect(turn.reply).toBe('Hello!');
    const rulePrompt = judge.calls[1].user;
    expect(rulePrompt).toContain('no_promises');
    expect(rulePrompt).toContain('test-coach_directive_0');
    expect(rulePrompt).not.toContain('warm_signoff');
    expect(rulePrompt).not.toContain('weather');
  });

  it('retries a draft that broke a rule, naming the rule, and sends the fixed draft', async () => {
    const drafts = ["You'll definitely get the job.", "Let's look at what's in your control."];
    const systems: string[] = [];
    const generate: GenerateReply = async ({ system }) => {
      systems.push(system);
      return drafts.shift()!;
    };
    const judge = fakeJudge(noMoment, (user) =>
      user.includes('definitely') ? '{"broken": [{"rule": "no_promises", "why": "promises an outcome"}]}' : noBroken(),
    );
    const turn = await governTurn({ rulebook: load(), message: 'will I get it?', generate, judge });
    expect(turn.outcome).toBe('fixed');
    expect(turn.reply).toBe("Let's look at what's in your control.");
    expect(turn.rejectedDrafts).toEqual(["You'll definitely get the job."]);
    expect(turn.broken).toEqual([{ ruleId: 'no_promises', why: 'promises an outcome' }]);
    expect(systems[1]).toContain('never promises results');
    expect(systems[1]).toContain('promises an outcome');
  });

  it('sends the fallback when every draft breaks a rule', async () => {
    const judge = fakeJudge(noMoment, () => '{"broken": [{"rule": "honest_ai", "why": "claims to be human"}]}');
    const turn = await governTurn({ rulebook: load(), message: 'are you real?', generate: async () => 'I am a person.', judge });
    expect(turn.outcome).toBe('fallback');
    expect(turn.reply).toContain('get this right');
    expect(turn.rejectedDrafts).toHaveLength(2);
  });

  it('treats an empty draft as broken, never sends it', async () => {
    const judge = fakeJudge(noMoment, noBroken);
    const turn = await governTurn({ rulebook: load(), message: 'hi', generate: async () => '  ', judge });
    expect(turn.outcome).toBe('fallback');
  });

  describe('fails closed (Option A): nothing unchecked is ever sent', () => {
    const unavailable = "I can't answer safely right now. Please try again soon.";

    it('when the moment check errors — the chatbot is never called', async () => {
      const generate = vi.fn<GenerateReply>();
      const judge: JudgeModel = async () => {
        throw new Error('network down');
      };
      const turn = await governTurn({ rulebook: load(), message: 'hi', generate, judge });
      expect(turn.outcome).toBe('unavailable');
      expect(turn.reply).toBe(unavailable);
      expect(generate).not.toHaveBeenCalled();
    });

    it('when the judge answers with garbage', async () => {
      const turn = await governTurn({
        rulebook: load(),
        message: 'hi',
        generate: async () => 'Hello!',
        judge: async () => 'I think it is fine',
      });
      expect(turn.outcome).toBe('unavailable');
    });

    it('when the judge names a situation that does not exist', async () => {
      const judge = fakeJudge(() => '{"moment": "made_up", "why": "?"}', noBroken);
      const turn = await governTurn({ rulebook: load(), message: 'hi', generate: async () => 'Hello!', judge });
      expect(turn.outcome).toBe('unavailable');
    });

    it('when the reply check fails — the unchecked draft is not sent', async () => {
      const judge = fakeJudge(noMoment, () => {
        throw new Error('timeout');
      });
      const turn = await governTurn({ rulebook: load(), message: 'hi', generate: async () => 'Unchecked draft', judge });
      expect(turn.outcome).toBe('unavailable');
      expect(turn.reply).not.toContain('Unchecked draft');
    });

    it('when the chatbot itself fails', async () => {
      const judge = fakeJudge(noMoment, noBroken);
      const turn = await governTurn({
        rulebook: load(),
        message: 'hi',
        generate: async () => {
          throw new Error('model error');
        },
        judge,
      });
      expect(turn.outcome).toBe('unavailable');
    });
  });

  it('keeps the user\'s words out of the trace', async () => {
    const judge = fakeJudge(noMoment, () => '{"broken": [{"rule": "no_promises", "why": "promises an outcome"}]}');
    const turn = await governTurn({
      rulebook: load(),
      message: 'my secret personal story',
      generate: async () => 'draft',
      judge,
    });
    expect(JSON.stringify(turn.trace)).not.toContain('my secret personal story');
  });

  it('passes history and context to the chatbot', async () => {
    let seen: { system: string; messages: unknown[] } | undefined;
    const judge = fakeJudge(noMoment, noBroken);
    await governTurn({
      rulebook: load(),
      message: 'next',
      history: [{ role: 'user', content: 'first' }, { role: 'assistant', content: 'answer' }],
      context: { Current_Mode: 'reflection' },
      generate: async (req) => {
        seen = req;
        return 'ok';
      },
      judge,
    });
    expect(seen!.messages).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'answer' },
      { role: 'user', content: 'next' },
    ]);
    expect(seen!.system).toContain('Current_Mode: reflection');
  });
});

describe('buildInstructions', () => {
  it('includes purpose, rules, persona, and habits but not hard moments', () => {
    const text = buildInstructions(load());
    expect(text).toContain('You are Test Coach.');
    expect(text).toContain('Bridge Model');
    expect(text).toContain('never claims to be a human');
    expect(text).toContain('Emotional tone: warm');
    expect(text).toContain('Ask what happened before giving any advice.');
    expect(text).not.toContain('glad you told me');
  });
});

describe('parseJudgeJson', () => {
  it('reads JSON inside code fences or prose', () => {
    expect(parseJudgeJson('```json\n{"moment": "none"}\n```')).toEqual({ moment: 'none' });
    expect(parseJudgeJson('Here you go: {"broken": []} done')).toEqual({ broken: [] });
  });

  it('throws JudgeUnavailableError on anything else', () => {
    expect(() => parseJudgeJson('no json here')).toThrow(JudgeUnavailableError);
    expect(() => parseJudgeJson('{not json}')).toThrow(JudgeUnavailableError);
  });
});
