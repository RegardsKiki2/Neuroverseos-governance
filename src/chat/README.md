# Chatbot Governance (`@neuroverseos/governance/chat`)

Governs a chatbot turn by turn. Every incoming message and every outgoing reply is checked **by meaning** against the creator's rulebook: no word lists. If a check can't run, nothing unchecked is sent.

```
message ─► ① hard moments (meaning check) ── match ──► creator's fixed response; the chatbot is never called
             │ none
             ▼
           ② instructions built from the rulebook
             ▼
           chatbot drafts a reply
             ▼
           ③ every rule and habit (meaning check) ── broken ──► retry with the rule named, then the creator's fallback
             │ passed
             ▼
           reply sent

any check fails ─► the creator's "unavailable" response. Nothing unchecked ever reaches the user.
```

The rulebook is a `.nv-world.md` file. Hard moments are described as situations, with example phrasings that teach the judge what the moment sounds like; they are never matched literally:

```markdown
# Escalations

## crisis
- situation: The person may be in danger or thinking about self-harm, however indirectly they say it.
- example: I don't see a way forward anymore.
- example: Everyone would be better off without me.
- example: I've been giving my things away.

> response: I'm really glad you told me. Please reach out to someone who can help right now: ...

# Responses

- unavailable: I'm having trouble right now, so I can't answer safely. Please try again in a moment.
```

Every invariant and every lens `>` habit is checked by meaning on every reply. A rule is prompt-only only if it's marked so, `(prompt)` on an invariant or `[check: prompt]` on any rule, and validation lists every prompt-only rule as a warning, so "just asking the AI" is always a visible choice.

```typescript
import { parseChatRulebook, governTurn, describeEnforcement } from '@neuroverseos/governance/chat';

const { rulebook, issues } = parseChatRulebook(markdown);   // issues: errors + prompt-only warnings
console.table(describeEnforcement(rulebook!));              // how each rule is enforced

const turn = await governTurn({
  rulebook: rulebook!,
  message,
  history,                                   // earlier turns
  context: { Current_Mode: 'reflection' },   // runtime context slots
  generate: ({ system, messages }) => callYourChatModel(system, messages),
  judge: ({ system, user }) => callYourJudgeModel(system, user),  // separate call; returns JSON text
});

send(turn.reply);  // turn.outcome: 'moment' | 'clean' | 'fixed' | 'fallback' | 'unavailable'
log(turn.trace);   // audit trail, never contains the user's words
```

Provider-agnostic (`generate` and `judge` are your model calls, any provider) and runtime-agnostic (no file system or network access of its own; runs in Node.js, Deno, and browsers).
