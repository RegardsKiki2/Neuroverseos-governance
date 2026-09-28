# Govern My Chatbot — a Claude skill

**You know what you want your chatbot to do. But how do you program it to
stay within your guidelines?**

Telling an AI "please don't do that" isn't enough; it can be talked out of
anything. This skill helps you turn your guidelines into rules your chatbot
actually has to follow, whether it's a coach, tutor, mentor, or assistant
that teaches **your** model. You don't need to know how to code.

Claude will teach you as it goes, so by the end you understand how your
chatbot stays within your guidelines and can change them yourself. Claude will:

1. **Explain what governance is** and why it matters for the people you serve.
2. **Interview you** one question at a time, in plain language, about your
   model, the people it serves, how the coach should sound, what it must
   always and never do, and what happens in hard moments.
3. **Write your rulebook**: a file (`governance/<your-model>.nv-world.md`)
   that holds every rule you approved, in your own words.
4. **Build the rules into your app** so they're enforced by code, not just
   requested in a prompt. That includes fixed responses for crisis moments,
   checks on every AI reply, and a list of tricky test messages.
5. **Show you the rules working**, live.
6. **Hand you the controls.** You change a rule, add a test, and run the
   checks yourself, and you keep a cheat sheet for later.

The rulebook uses the open-source
[`@neuroverseos/governance`](https://www.npmjs.com/package/@neuroverseos/governance)
format.

## How to use it

**With Claude Code** (terminal, desktop app, or claude.ai/code): install it
as a plugin by typing these two commands into Claude Code:

```
/plugin marketplace add NeuroverseOS/Neuroverseos-governance
/plugin install govern-my-chatbot@neuroverseos
```

Then tell Claude: *"Use the govern-my-chatbot skill. I want to build a coach for my model."*

Or copy it in by hand: create `.claude/skills/govern-my-chatbot/` in your project
and copy `SKILL.md` and the `templates/` folder into it.

**With Claude on claude.ai** (to do the interview and rulebook before you code):

1. Download this folder as a zip.
2. In Claude's settings, find **Skills** and upload the zip.
3. Start a chat: *"Help me govern the chatbot I'm building."*

## What's in here

| File | What it is |
|---|---|
| `SKILL.md` | The instructions Claude follows: the interview, how to write the rulebook, and how to wire it in |
| `templates/coach.nv-world.md` | An example rulebook for a first-gen career coach. It shows the shape only; Claude replaces everything with your answers |
| `templates/governance.ts` | Reference code that loads the rulebook and enforces it around every AI reply |
| `templates/tests.md` | Starter "fire drill": messages that should and shouldn't set off the crisis and legal responses |
| `templates/check-my-rules.ts` | Runs the fire drill with `npm run check-rules` and explains the results in plain language |
| `templates/HOW-TO-CHANGE-MY-COACH.md` | Your cheat sheet for changing and testing your rules later |
