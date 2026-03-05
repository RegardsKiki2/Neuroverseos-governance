# NeuroVerse Governance

Turn AI prompt files into enforceable governance.

NeuroVerse converts messy prompt instructions like:

```
AGENTS.md   SYSTEM.md   TOOLS.md
```

into a **governed world** with validation and runtime enforcement.

Instead of trusting prompts, agents operate under **explicit rules that can be linted, audited, and enforced**.

As AI agents become more autonomous, prompt instructions alone are not enough. NeuroVerse introduces a governance layer that converts human-readable rules into enforceable system constraints.

## Install

```bash
npm install neuroverse-governance
```

Run the CLI:

```bash
npx neuroverse --help
```

## Quick Example

Input prompt files:

```
AGENTS.md
SYSTEM.md
TOOLS.md
```

Run:

```bash
neuroverse derive --input ./docs
```

Output: `derived.nv-world.md`

Then compile:

```bash
neuroverse bootstrap --input derived.nv-world.md --output ./world --validate
```

Now every agent action can be evaluated:

```bash
echo '{"intent":"execute_trade"}' | neuroverse guard --world ./world
```

Result: `ALLOW`, `PAUSE`, or `BLOCK` — with full governance evidence.

## Core Idea

Most AI systems today rely on prompt files that describe rules and constraints — but cannot **enforce** them.

NeuroVerse converts those documents into a governance constitution your agents must follow.

```
prompt files
     ↓
AI synthesis (derive)
     ↓
governed world (.nv-world.md)
     ↓
bootstrap → deterministic world JSON
     ↓
validator → governance linting
     ↓
guard → runtime enforcement
```

Even the synthesis step is governed by a **DerivationWorld**, which constrains how AI converts markdown into governance structure.

## Workflow

### 1. Derive governance from prompt files

Convert markdown instructions into a structured world file:

```bash
neuroverse derive --input ./docs
```

Output: `derived.nv-world.md`

> **Tip:** `derive` works best on structured notes or bullet points rather than long narrative paragraphs. See [Writing Good Input](#writing-good-input-for-derive) below.

### 2. Compile the world

```bash
neuroverse bootstrap \
  --input ./derived.nv-world.md \
  --output ./world \
  --validate
```

This generates deterministic world JSON files used by the runtime.

### 3. Validate governance

```bash
neuroverse validate --world ./world
```

Detects:
- Contradictory rules
- Unenforced invariants
- Missing roles
- Unused state variables

Think of this as **linting for AI governance**.

### 4. Enforce rules at runtime

```bash
echo '{"intent":"execute_trade"}' | neuroverse guard --world ./world
```

Output: `ALLOW`, `PAUSE`, or `BLOCK` — each with traceable governance evidence.

## Commands

```
neuroverse init           Scaffold a new .nv-world.md template
neuroverse bootstrap      Compile .nv-world.md → world JSON files
neuroverse validate       Static analysis of world files
neuroverse guard          Runtime governance evaluation
neuroverse derive         AI-assisted synthesis of .nv-world.md
neuroverse configure-ai   Configure AI provider credentials
```

## Example Pipeline

```bash
# Derive governance from markdown docs
neuroverse derive --input ./docs

# Compile to world JSON
neuroverse bootstrap --input derived.nv-world.md --output ./world --validate

# Lint the governance
neuroverse validate --world ./world

# Enforce at runtime
echo '{"intent":"delete_user_data"}' | neuroverse guard --world ./world
```

## AI Provider Setup

To use `neuroverse derive`, configure your AI provider:

```bash
neuroverse configure-ai \
  --provider openai \
  --model gpt-4.1-mini \
  --api-key YOUR_API_KEY
```

Config is stored at `~/.neuroverse/config.json` (permissions `0600`).

Verify your connection:

```bash
neuroverse configure-ai --test
```

## Programmatic API

```typescript
import {
  evaluateGuard,
  validateWorld,
  parseWorldMarkdown,
  deriveWorld,
  extractWorldMarkdown,
} from 'neuroverse-governance';
```

All engine functions are pure, deterministic, and side-effect free (except `deriveWorld` which calls an AI provider).

## Writing Good Input for `derive`

`neuroverse derive` works best on **structured notes or bullet points** rather than long narrative paragraphs.

**Structured input (works well):**

```markdown
- Agent receives customer support requests
- Agent must not access billing data without manager approval
- Escalation required for refund requests over $500
- Agent cannot delete customer accounts
- Response time must stay under 30 seconds
```

From this, `derive` can generate clear invariants, state variables, and rules.

**Vague input (produces weak governance):**

```markdown
The agent should probably be helpful and try not to do anything
too dangerous. Maybe we need some kind of approval process for
big decisions but I'm not sure yet.
```

This produces ambiguous rules and may result in a `DERIVATION_REJECTED` gate.

### When Derivation Is Rejected

If you see `DERIVATION_REJECTED`, the validator detected contradictions or missing constraints. The CLI **still writes the draft file** — open `derived.nv-world.md` and refine your rules until the world passes validation.

This is not a failure. The validator prevented a logically inconsistent world, which is the whole point of governance.

## Related Projects

NeuroVerse Governance is part of the **NeuroVerse OS** ecosystem for governed AI systems.

- **NeuroVerse OS** — Runtime engine for governed worlds
- **Governance CLI** — This package
- **World Configurator** — Visual world authoring tool
- **Agent Plugins** — Framework integrations

## License

Apache 2.0
