# How to change my chatbot

<!-- Claude: personalize this — replace every [bracketed] item with the
     creator's real file names, model name, and hard-moment names. -->

My chatbot follows **one file**: `governance/[my-chatbot].nv-world.md`, my
rulebook. To change how it behaves, I change the rulebook. I don't change the
code, and I don't try to fix it by asking the AI to behave differently.

Claude can't change my rulebook without my approval: Claude Code will stop
and ask me first, every time.

## Rules are about behavior, not words

A rule isn't a list of banned words. "Never promise results" is about
meaning: the chatbot can break it without ever saying "guarantee". So I write
rules about **what the chatbot does** in a situation, and the meaning check
holds it to that.

## Where things live in the rulebook

| I want to change… | Look under… | Example |
|---|---|---|
| What the chatbot is for, or my model's steps | `# Thesis` | Plain paragraphs |
| Something it must never do | `# Invariants` | ``- `ask_before_advising` — The chatbot asks what happened before it gives any advice. (structural, immutable)`` |
| How it sounds (tone, length, warmth) | `# Lenses` → the `formality`, `verbosity`, `emotion`, `confidence` lines | `- emotion: warm` |
| A habit it should have | `# Lenses` → lines starting with `>` | `> behavior_shaping: End every reply with one small next step.` |
| What a hard moment is | `# Escalations` → `## [crisis]` → `- situation:` | Describe what's happening, in plain words |
| What it says in a hard moment | `# Escalations` → `> response:` | My exact words, sent without the AI |
| Backstop words for a hard moment | `# Escalations` → `- triggers:` | Obvious phrases, caught instantly |

I only change the words. I leave the symbols (`-`, `>`, `#`, and the backticks
around ids) as they are; the app uses them to read the file.

## Every time I change something

1. **Ask Claude to make the change**, or edit the rulebook myself.
   Claude Code will ask me to approve any change to the rulebook.
2. **Add a test** in `governance/tests.md`: a message or reply that *should*
   be caught, and one that shouldn't. Include one that says it indirectly.
3. **Run the fire drill:** in the terminal, in my project folder:
   `npm run check-rules`
   - ✓ passed · ✗ failed (it says what to change) · ○ not checked (the
     meaning check needs my API key set)
4. **Try to break it:** `npx tsx break-it.ts "a message that might get past it"`
   Each attempt shows which layer stopped it, or that nothing did.
5. **Save my change** (ask Claude to commit it if I use git).

## The four layers, in one breath

- **Front desk:** checks each message *before* the AI sees it. If it's a hard
  moment, by meaning or by the backstop words, my exact response is sent and
  the AI is never involved.
- **Instructions:** my rulebook is handed to the AI fresh on every message.
- **Editor:** a separate check reads every reply before it's sent and asks
  "does this break a rule?" If it does, the AI tries again; if it still does,
  a safe fallback is sent instead.
- **Fire drill & break-it:** my tests, and my own attempts to break it,
  before every launch and every change.

## Ask Claude for help

> "Use the govern-my-chatbot skill. My chatbot did [what happened] and I
> wanted [what you wanted]. Help me find the rule and change it."
