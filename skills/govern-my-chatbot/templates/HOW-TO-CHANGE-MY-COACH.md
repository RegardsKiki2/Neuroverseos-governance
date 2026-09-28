# How to change my coach

<!-- Claude: personalize this — replace every [bracketed] item with the
     creator's real file names, model name, and escalation names. -->

Your coach follows **one file**: `governance/[my-coach].nv-world.md`, your
rulebook. To change how the coach behaves, change the rulebook. You don't need
to change the code, and don't try to fix it by asking the AI to behave
differently.

## Where things live in the rulebook

| I want to change… | Look under… | Example line |
|---|---|---|
| What the coach is for, or my model's steps | `# Thesis` | Plain paragraphs |
| A line it must never cross | `# Invariants` | ``- `no_guarantees` — The coach never promises results. (structural, immutable)`` |
| How it sounds (tone, length, warmth) | `# Lenses` → the `formality`, `verbosity`, `emotion`, `confidence` lines | `- emotion: warm` |
| A habit or a word to avoid | `# Lenses` → lines starting with `>` | `> content_filtering: Never say "just be confident."` |
| What it does in a hard moment | `# Escalations` → `## [crisis]` etc. | `> response:` is the exact words people see |
| What words set off a hard-moment response | `# Escalations` → the `- triggers:` line | Phrases separated by commas |

Only change the words. Leave the symbols (`-`, `>`, `#`, and the backticks
around ids) as they are; the app uses them to read the file.

## Every time I change something

1. **Edit** the rulebook and save.
2. **Add a test** in `governance/tests.md` if you added a trigger or a hard moment:
   a message that *should* be caught, and one that shouldn't.
3. **Run the fire drill:** open the terminal in your project folder and type
   `npm run check-rules`
   - ✓ means that check passed.
   - ✗ tells you what went wrong and what to change.
4. **Try it in the app.** Send a message or two and read the replies. Does it
   sound like your coach?
5. **Save your change** (ask Claude to commit it if you use git).

## The four layers, in one breath

- **Front desk:** checks each message *before* the AI sees it. Hard moments get
  your exact words; the AI is never involved.
- **Instructions:** your rulebook is handed to the AI fresh on every message.
- **Editor:** reads every AI reply before it's sent and catches forbidden
  things like promises, fake contacts, or claiming to be human.
- **Fire drill:** `npm run check-rules`, before every launch and every change.

## Ask Claude for help

> "Use the govern-my-chatbot skill. My coach did [what happened] and I wanted
> [what you wanted]. Help me find the rule and change it."
