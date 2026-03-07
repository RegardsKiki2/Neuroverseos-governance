# NeuroVerseOS Governance

[![npm version](https://img.shields.io/npm/v/@neuroverseos/governance)](https://www.npmjs.com/package/@neuroverseos/governance)
[![license](https://img.shields.io/npm/l/@neuroverseos/governance)](LICENSE.md)

**Stop your AI agent before it does something stupid.**

NeuroVerse is a deterministic governance engine for AI agents. Define rules. Define plans. Prevent drift. No LLM in the evaluation loop — just pure, auditable enforcement.

```bash
npm install @neuroverseos/governance
```

---

## Three Ways to Use It

### 1. Run a governed agent

```bash
# Pipe mode — any agent, any language
my_agent | neuroverse run --world ./world --plan plan.json

# Interactive mode — governed chat session
neuroverse run --interactive --world ./world --provider openai
```

### 2. Use with Claude, Cursor, or any MCP client

```bash
neuroverse mcp --world ./world --plan plan.json
```

Every tool call goes through governance before execution.

### 3. Evaluate a single action

```bash
echo '{"intent":"delete user data","tool":"database"}' | neuroverse guard --world ./world
```

---

## The "Oh Shit" Moment

Your AI agent decides to clean up the production database:

```
$ echo '{"intent":"drop all customer tables","tool":"database"}' | neuroverse guard --world ./world

{
  "status": "BLOCK",
  "reason": "Destructive database operation on protected resource",
  "ruleId": "production_protection",
  "evidence": {
    "worldId": "startup_marketing",
    "invariantsSatisfied": 7,
    "invariantsTotal": 7,
    "enforcementLevel": "strict"
  }
}
```

**BLOCKED.** The agent never touches the database. That's what governance does.

Without NeuroVerse, that query runs. With NeuroVerse, it doesn't.

Another one — the agent tries to email your entire customer list to an external vendor:

```
$ echo '{"intent":"send customer list to ads vendor","tool":"email"}' | neuroverse guard --world ./world

{
  "status": "BLOCK",
  "reason": "Customer data must never be shared externally",
  "ruleId": "no_customer_data_leak"
}
```

**BLOCKED.** No customer data leaves the system.

---

## Example: Startup Marketing World

A ready-to-use example is included in [`examples/startup-marketing/`](examples/startup-marketing/).

**Rules:**
- Budget ≤ $1,000 per campaign
- No customer data shared externally
- External publications require human approval
- No production database access
- No deleting customer records

**Plan:** Launch a new product under budget with blog, social, and email.

```bash
# Try it right now
cd examples/startup-marketing

# Build the world
neuroverse build world.nv-world.md

# Compile the plan
neuroverse plan compile plan.md

# Test an on-plan action
echo '{"intent":"write blog post"}' | neuroverse plan check --plan plan.json
# → ON_PLAN ✓

# Test an off-plan action
echo '{"intent":"buy billboard ads"}' | neuroverse plan check --plan plan.json
# → OFF_PLAN ✗  Closest step: "Create social media launch thread"

# Test a dangerous action
echo '{"intent":"export customer emails to spreadsheet"}' | neuroverse guard --world .neuroverse/worlds/startup_marketing_governance
# → BLOCK: Customer data must never be shared externally
```

---

## Multiple Worlds (like Terraform workspaces)

Build different worlds for different environments:

```bash
# Build worlds from different rule sets
neuroverse build marketing-rules.md
neuroverse build deploy-rules.md
neuroverse build finance-rules.md

# See what's available
neuroverse worlds
# AVAILABLE WORLDS
# ────────────────────────────────────
#   → marketing_rules (active)
#     deploy_rules
#     finance_rules

# Switch context
neuroverse world use deploy_rules
# Active world: deploy_rules

# Now all commands use deploy rules — no --world flag needed
echo '{"intent":"deploy to prod"}' | neuroverse guard
# Using world: deploy_rules
# { "status": "PAUSE", "reason": "Production deploy requires approval" }

# Check which world is active
neuroverse world current
# Active world: deploy_rules
# Source: .neuroverse/active_world
```

Override per-command or in CI:

```bash
# Per-command override
neuroverse guard --world marketing_rules

# Environment variable (perfect for CI/agents)
NEUROVERSE_WORLD=finance_rules neuroverse guard
```

---

## How It Works

```
World (permanent rules)     Plan (mission scope)
        ↓                          ↓
              Guard Engine
                  ↓
        ALLOW | PAUSE | BLOCK
```

A **world** says: "Budget must never exceed $1,000. No production database access."
A **plan** says: "Write blog post. Publish release. Budget: $25."

The agent must satisfy both. Plans can only narrow, never expand.

### Evaluation chain (first-match-wins)

| Phase | Layer | Purpose |
|-------|-------|---------|
| 0 | Safety | Prompt injection, scope escape detection |
| 1.5 | Plan | Is this action in the plan? |
| 2 | Roles | Who may do this? |
| 3 | Guards | Domain-specific rules |
| 4 | Kernel | LLM boundary enforcement |
| 5 | Level | Enforcement strictness |
| 6 | Default | ALLOW |

---

## Quick Start

### Get started in 30 seconds

```bash
# Install
npm install -g @neuroverseos/governance

# Scaffold a new world
neuroverse init --name "My AI Agent"

# Write your rules, build, and enforce
neuroverse build my-rules.md
echo '{"intent":"do something"}' | neuroverse guard --world .neuroverse/worlds/my_ai_agent
```

### Use with your existing agent

```typescript
import { evaluateGuard, loadWorld } from '@neuroverseos/governance';

const world = await loadWorld('./world/');

// Before every tool call
const verdict = evaluateGuard(
  { intent: 'send email', tool: 'email', args: { to: 'customer@example.com' } },
  world
);

if (verdict.status === 'BLOCK') {
  console.log(`Blocked: ${verdict.reason}`);
  // Don't execute the tool
} else if (verdict.status === 'PAUSE') {
  // Request human approval
} else {
  // Safe to execute
}
```

---

## Plan Enforcement

Plans are temporary governance overlays — "mom's rules for this trip."

### Write a plan in markdown

```markdown
---
plan_id: product_launch
objective: Launch the NeuroVerse plugin
sequential: false
---

# Steps
- Write announcement blog post [tag: content]
- Publish GitHub release [tag: deploy] [verify: release_created]
- Post on Product Hunt (after: publish_github_release) [tag: marketing]

# Constraints
- No spending above $500
- All external posts require human review [type: approval]
```

### Plan CLI

```bash
neuroverse plan compile <plan.md>            # Markdown → plan.json
neuroverse plan check --plan plan.json       # Check action against plan
neuroverse plan status --plan plan.json      # Show progress
neuroverse plan advance <step> --plan plan.json  # Mark step done
neuroverse plan derive <plan.md>             # Generate a world from a plan
```

### Plan verdicts

| Status | Meaning |
|--------|---------|
| ON_PLAN | Action matches a plan step |
| OFF_PLAN | Not in the plan (includes closest step for self-correction) |
| CONSTRAINT_VIOLATED | Violates a plan constraint |
| PLAN_COMPLETE | All steps done |

### Programmatic API

```typescript
import { parsePlanMarkdown, evaluatePlan, advancePlan, getPlanProgress } from '@neuroverseos/governance';

const { plan } = parsePlanMarkdown(markdownString);
const verdict = evaluatePlan({ intent: 'write blog post' }, plan);
// → { status: 'ON_PLAN', matchedStep: 'write_announcement_blog_post' }

const updated = advancePlan(plan, 'write_announcement_blog_post');
const progress = getPlanProgress(updated);
// → { completed: 1, total: 3, percentage: 33 }
```

---

## Runtime: Governed Sessions

### Pipe mode (any language, any agent)

```bash
# Your agent pipes JSON events, NeuroVerse returns verdicts
my_python_agent | neuroverse run --world ./world --plan plan.json
```

Each line in: `{"intent": "write blog post"}`
Each line out: `{"status": "ALLOW", ...}`

### Interactive mode (governed chat)

```bash
neuroverse run --interactive --world ./world --provider openai --plan plan.json
```

Chat with an AI model. Every tool call is governed. Plan progress is tracked automatically.

### MCP Server (Claude, Cursor, Windsurf)

```bash
neuroverse mcp --world ./world --plan plan.json
```

Exposes governed tools over the Model Context Protocol:
- `governed_shell` — run shell commands (governed)
- `governed_read_file` / `governed_write_file` — file access (governed)
- `governed_http_request` — HTTP calls (governed)
- `governance_check` — test if an action would be allowed
- `governance_plan_status` — view plan progress

---

## Framework Adapters

### LangChain

```typescript
import { createNeuroVerseCallbackHandler } from '@neuroverseos/governance/adapters/langchain';

const handler = await createNeuroVerseCallbackHandler('./world/', {
  plan,
  onBlock: (verdict) => console.log('Blocked:', verdict.reason),
  onPlanProgress: (progress) => console.log(`${progress.percentage}% complete`),
  onPlanComplete: () => console.log('Plan finished!'),
});

const agent = new AgentExecutor({ ..., callbacks: [handler] });
```

### OpenAI

```typescript
import { createGovernedToolExecutor } from '@neuroverseos/governance/adapters/openai';

const executor = await createGovernedToolExecutor('./world/', { plan });

for (const toolCall of message.tool_calls) {
  const result = await executor.execute(toolCall, myToolRunner);
  // ALLOW → runs tool  |  BLOCK → returns blocked  |  PAUSE → throws for approval
}
```

### OpenClaw

```typescript
import { createNeuroVersePlugin } from '@neuroverseos/governance/adapters/openclaw';

const plugin = await createNeuroVersePlugin('./world/', {
  plan,
  onPlanProgress: (progress) => updateUI(progress),
});

agent.use(plugin);
```

### Express / Fastify

```typescript
import { createGovernanceMiddleware } from '@neuroverseos/governance/adapters/express';

const middleware = await createGovernanceMiddleware('./world/', { level: 'strict' });
app.use('/api', middleware);
```

---

## All CLI Commands

```bash
# Runtime
neuroverse run --world <dir> [--plan plan.json] [--pipe|--interactive] [--provider openai]
neuroverse mcp --world <dir> [--plan plan.json]

# Plan enforcement
neuroverse plan compile|check|status|advance|derive

# Build & understand
neuroverse build <input.md>
neuroverse explain <world>
neuroverse simulate <world> [--steps N]
neuroverse improve <world>

# Governance
neuroverse guard --world <dir> [--trace] [--level basic|standard|strict]
neuroverse validate --world <dir>

# Audit
neuroverse trace [--log <path>] [--filter BLOCK]
neuroverse impact [--log <path>]

# Authoring
neuroverse init [--name "World Name"]
neuroverse derive --input <path>
neuroverse bootstrap --input <.md> --output <dir>
neuroverse configure-ai --provider <name> --model <name>
```

---

## Architecture

```
src/
  runtime/
    session.ts              # SessionManager + pipe/interactive modes
    model-adapter.ts        # OpenAI-compatible chat client
    mcp-server.ts           # MCP governance server (JSON-RPC 2.0)
  engine/
    guard-engine.ts         # Core evaluation (6-phase chain)
    plan-engine.ts          # Plan enforcement (keyword + similarity)
    plan-parser.ts          # Markdown → PlanDefinition
    condition-engine.ts     # Field resolution & operators
    simulate-engine.ts      # State evolution
  cli/
    neuroverse.ts           # CLI router (16 commands)
    run.ts                  # neuroverse run (pipe + interactive)
    plan.ts                 # Plan subcommands
  adapters/
    openclaw.ts, openai.ts, langchain.ts, express.ts
  contracts/
    guard-contract.ts       # Guard event/verdict types
    plan-contract.ts        # Plan definition/verdict types
  loader/
    world-loader.ts         # Load WorldDefinition from disk

examples/
  startup-marketing/        # Ready-to-use example world + plan

test/                        # 234 tests
```

## Agent Discovery

This package includes machine-readable manifests for agent ecosystems:

- **`AGENTS.md`** — Agent-discoverable integration guide
- **`.well-known/ai-plugin.json`** — Standard capability manifest

## License

Apache 2.0
