# NeuroVerse Governance — Agent Integration Guide

## What This Package Does

Enforces governance rules on AI agent actions. Define what an agent
can and cannot do, then enforce it at runtime. Deterministic — same
event + same rules = same verdict. No LLM in the evaluation loop.

## Quick Start for Agents

### Install

```bash
npm install @neuroverseos/governance
```

### Enforce a plan

```javascript
const { evaluatePlan, parsePlanMarkdown } = require('@neuroverseos/governance');

const plan = parsePlanMarkdown(planMarkdownString);
const verdict = evaluatePlan({ intent: 'send email', tool: 'smtp' }, plan.plan);
// -> { allowed: false, status: 'OFF_PLAN', reason: 'Action does not match any plan step.' }
```

### Enforce a world

```javascript
const { evaluateGuard, loadWorld } = require('@neuroverseos/governance');

const world = await loadWorld('./world/');
const verdict = evaluateGuard({ intent: 'delete user', tool: 'db' }, world);
// -> { status: 'BLOCK', reason: 'destructive database operation' }
```

### Enforce both (plan on top of world)

```javascript
const verdict = evaluateGuard(event, world, { plan });
// Plan rules AND world rules both apply
// Plan can only restrict, never expand
```

## Available Commands

```
neuroverse plan compile <plan.md>        Parse plan markdown into plan.json (with embeddings)
neuroverse plan check --plan plan.json   Check action against plan (stdin)
neuroverse plan status --plan plan.json  Show plan progress
neuroverse plan advance <step_id>        Mark a step as completed
neuroverse plan derive <plan.md>         Generate a full world from a plan
neuroverse guard --world <dir>           Check action against world (stdin)
neuroverse validate --world <dir>        Static analysis on world files
```

## Plan Markdown Format

Plans are written in simple markdown that any LLM can produce:

```markdown
---
plan_id: product_launch
objective: Launch the NeuroVerse governance plugin
sequential: false
---

# Steps
- Write announcement blog post [tag: content, marketing]
- Publish GitHub release [tag: deploy] [verify: github_release_created]
- Post on Product Hunt (after: publish_github_release) [tag: marketing]

# Constraints
- No spending above $500
- All external posts require human review [type: approval]
```

## Governance Model

```
Safety checks  ->  Plan enforcement  ->  Role rules  ->  Guards  ->  Kernel
(country laws)    (mom's trip rules)    (driving laws)  (domain)    (boundaries)
```

Plans are temporary guard overlays. They define task scope.
Worlds are permanent governance. They define domain rules.
Both layers must pass for an action to be allowed.

## Adapters

- OpenClaw: `import from '@neuroverseos/governance/adapters/openclaw'`
- LangChain: `import from '@neuroverseos/governance/adapters/langchain'`
- OpenAI: `import from '@neuroverseos/governance/adapters/openai'`
- Express: `import from '@neuroverseos/governance/adapters/express'`

## Exit Codes

- 0 = ALLOW / ON_PLAN
- 1 = BLOCK / OFF_PLAN
- 2 = PAUSE / CONSTRAINT_VIOLATED
- 3 = ERROR
- 4 = PLAN_COMPLETE
