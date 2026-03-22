# NeuroVerse Governance — Agent Integration Guide

## What This Package Does

Runtime containment for AI agents. Define what an agent can and cannot do, then enforce it at every action. Deterministic — same event + same rules = same verdict. No LLM in the evaluation loop.

## Quick Start for Agents

### Install

```bash
npm install @neuroverseos/governance
```

### Enforce a world (permanent rules)

```typescript
import { evaluateGuard, loadWorld } from '@neuroverseos/governance';

const world = await loadWorld('./world/');
const verdict = evaluateGuard({ intent: 'delete user', tool: 'db' }, world);
// → { status: 'BLOCK', reason: 'destructive database operation' }
```

### Enforce a plan (temporary task scope)

```typescript
import { evaluatePlan, parsePlanMarkdown } from '@neuroverseos/governance';

const plan = parsePlanMarkdown(planMarkdownString);
const verdict = evaluatePlan({ intent: 'send email', tool: 'smtp' }, plan.plan);
// → { allowed: false, status: 'OFF_PLAN', reason: 'Action does not match any plan step.' }
```

### Enforce both (plan on top of world)

```typescript
const verdict = evaluateGuard(event, world, { plan });
// Plan rules AND world rules both apply
// Plan can only restrict, never expand
```

### Guard with trace (see what fired)

```typescript
const verdict = evaluateGuard(event, world, { trace: true, level: 'strict' });
// verdict.trace contains:
//   safetyChecks, planCheck, roleChecks, guardChecks, kernelRuleChecks, levelChecks, invariantChecks
```

## Guard Event Input

The `GuardEvent` is what you send to the engine:

```typescript
{
  intent: string;           // Required — what the agent wants to do
  tool?: string;            // Tool being called (e.g., 'database', 'filesystem')
  scope?: string;           // Resource path or domain (e.g., '/etc/passwd', 'production')
  roleId?: string;          // Agent role for multi-agent governance
  direction?: 'input' | 'output';  // Is this an incoming request or outgoing response?
  actionCategory?: 'read' | 'write' | 'delete' | 'network' | 'shell' | 'browser' | 'other';
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  irreversible?: boolean;   // Flag destructive actions for stricter checking
  payload?: string;         // Raw content for injection detection
  args?: Record<string, unknown>;  // Tool arguments (supports dot-notation access in rules)
}
```

## Guard Verdict Output

```typescript
{
  status: 'ALLOW' | 'BLOCK' | 'PAUSE' | 'MODIFY' | 'PENALIZE' | 'REWARD' | 'NEUTRAL';
  reason?: string;          // Why the action was blocked/paused
  ruleId?: string;          // Which rule decided
  warning?: string;         // Advisory for ALLOW verdicts
  consequence?: object;     // Details when PENALIZE (cooldown, influence reduction)
  reward?: object;          // Details when REWARD (priority boost, influence increase)
  evidence: {               // Always present — audit trail
    worldId: string;
    worldName: string;
    worldVersion: string;
    timestamp: number;
    invariantCoverage: { satisfied: number; total: number };
    matchedGuards: string[];
    matchedRules: string[];
    enforcementLevel: string;
  };
  trace?: EvaluationTrace;  // Full pipeline trace when trace: true
}
```

## Available Commands

```
neuroverse init                         Scaffold a .nv-world.md template
neuroverse bootstrap --input <.md> --output <dir>  Compile to world JSON
neuroverse build <input.md>             Derive + compile in one step
neuroverse validate --world <dir>       9 static analysis checks
neuroverse guard --world <dir>          Evaluate action (stdin → verdict)
neuroverse test --world <dir>           14 standard + fuzz guard tests
neuroverse redteam --world <dir>        28 adversarial attacks, containment score
neuroverse doctor                       Environment sanity check
neuroverse playground --world <dir>     Interactive web demo at localhost:4242
neuroverse explain <world>              Human-readable world summary
neuroverse simulate <world>             State evolution simulation
neuroverse improve <world>              Actionable improvement suggestions
neuroverse impact --log <path>          Counterfactual impact report
neuroverse plan compile <plan.md>       Parse plan markdown into plan.json
neuroverse plan check --plan plan.json  Check action against plan (stdin)
neuroverse plan status --plan plan.json Show plan progress
neuroverse plan advance <step_id>       Mark a step as completed
neuroverse plan derive <plan.md>        Generate a full world from a plan
neuroverse run --world <dir>            Governed runtime (pipe or interactive)
neuroverse mcp --world <dir>            MCP governance server
neuroverse trace --log <path>           Action audit log
neuroverse world status|diff|snapshot|rollback  World management
neuroverse worlds                       List available worlds
neuroverse derive --input <path>        AI-assisted world synthesis
neuroverse configure-ai                 Configure AI provider credentials
```

## Plan Markdown Format

Plans are written in simple markdown that any LLM can produce:

```markdown
---
plan_id: product_launch
objective: Launch the NeuroVerse governance plugin
sequential: false
completion: verified
---

# Steps
- Write announcement blog post [tag: content, marketing]
- Publish GitHub release [tag: deploy] [verify: github_release_created]
- Post on Product Hunt (after: publish_github_release) [tag: marketing]

# Constraints
- No spending above $500
- All external posts require human review [type: approval]
```

### Completion modes

- `completion: trust` (default) — caller says "done", step advances
- `completion: verified` — steps with `[verify: ...]` require evidence to advance

```typescript
// Trust mode — just advance
const result = advancePlan(plan, 'write_announcement_blog_post');
// → { success: true, plan: <updated> }

// Verified mode — evidence required for steps with verify
const result = advancePlan(plan, 'publish_github_release', {
  type: 'github_release_created',
  proof: 'https://github.com/org/repo/releases/v1.0',
});
// → { success: true, plan: <updated>, evidence: { ... } }

// Verified mode — missing evidence
const result = advancePlan(plan, 'publish_github_release');
// → { success: false, reason: 'Step requires evidence (verify: github_release_created)' }
```

## Governance Model

```
Safety checks  →  Plan enforcement  →  Role rules  →  Guards  →  Kernel  →  Level
(country laws)    (mom's trip rules)   (driving laws)  (domain)   (boundaries) (strictness)
```

Plans are temporary guard overlays. They define task scope.
Worlds are permanent governance. They define domain rules.
Both layers must pass for an action to be allowed.

## Evaluation Pipeline

Every action passes through 6 phases:

1. **Safety** — prompt injection, scope escape, data exfil detection (always on, 12 pattern categories)
2. **Plan** — is the action within the current mission scope?
3. **Roles** — does the actor have permission? (role-based access control)
4. **Guards** — do domain-specific rules allow it?
5. **Kernel** — does it violate LLM boundary rules? (input/output forbidden patterns)
6. **Level** — does enforcement strictness allow it? (basic, standard, strict)

First BLOCK wins. If nothing blocks, ALLOW.

## Adapters

### OpenAI

```typescript
import { createGovernedToolExecutor } from '@neuroverseos/governance/adapters/openai';

const executor = await createGovernedToolExecutor('./world/', { trace: true, plan });
const result = await executor.execute(toolCall, myToolRunner);
// ALLOW → runs tool  |  BLOCK → returns blocked  |  PAUSE → throws
```

### LangChain

```typescript
import { createNeuroVerseCallbackHandler } from '@neuroverseos/governance/adapters/langchain';

const handler = await createNeuroVerseCallbackHandler('./world/', {
  plan,
  onBlock: (verdict) => console.log('Blocked:', verdict.reason),
});
const agent = new AgentExecutor({ ..., callbacks: [handler] });
```

### OpenClaw

```typescript
import { createNeuroVersePlugin } from '@neuroverseos/governance/adapters/openclaw';

const plugin = await createNeuroVersePlugin('./world/', { plan });
agent.use(plugin.hooks());
```

### Express / Fastify

```typescript
import { createGovernanceMiddleware } from '@neuroverseos/governance/adapters/express';

const middleware = await createGovernanceMiddleware('./world/', { level: 'strict' });
app.use('/api', middleware);
// Returns 403 on BLOCK
```

### MCP Server

```bash
neuroverse mcp --world ./world --plan plan.json
```

Exposes governed tools over Model Context Protocol. Works with Claude, Cursor, and any MCP client.

## Exit Codes

| Code | Status | Meaning |
|------|--------|---------|
| 0 | ALLOW | Action permitted |
| 1 | BLOCK | Action denied |
| 2 | PAUSE | Held for human approval |
| 3 | ERROR | Evaluation failed |
| 4 | MODIFY | Action transformed |
| 5 | PENALIZE | Consequence applied |
| 6 | REWARD | Incentive applied |
| 7 | NEUTRAL | Informational only |

## Containment Testing

```bash
# Standard guard test suite (14 tests + optional fuzz)
neuroverse test --world ./world --fuzz --count 50

# Adversarial red team (28 attacks, 6 categories)
neuroverse redteam --world ./world --level strict
# → Containment score: 91%
```

Red team categories: prompt injection (8), tool escalation (4), scope escape (5), data exfiltration (3), identity manipulation (3), constraint bypass (3).
