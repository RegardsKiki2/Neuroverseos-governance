# NeuroVerse Governance — Deterministic Governance Engine for AI Agents

![npm version](https://img.shields.io/npm/v/@neuroverseos/governance)
![npm downloads](https://img.shields.io/npm/dm/@neuroverseos/governance)
![license](https://img.shields.io/npm/l/@neuroverseos/governance)
![GitHub stars](https://img.shields.io/github/stars/NeuroverseOS/neuroverseos-governance)

**Define governance rules once and enforce them anywhere AI or automated systems operate.**

NeuroVerse Governance is a deterministic AI governance engine and policy engine for AI agents. It lets developers enforce AI guardrails, compliance rules, and safety policies on AI systems — with full audit trails and portable, world-based policy definitions. Use it as an agent governance layer for LangChain, OpenAI, or any AI framework.

```bash
npm install @neuroverseos/governance
npx neuroverse init
echo '{"intent":"delete_user","tool":"database"}' | npx neuroverse guard --world .neuroverse/worlds/governance_policy
# → BLOCK: destructive database operation requires approval
```

## The 10-Second Mental Model

```
Idea (markdown)
  ↓
World (compiled JSON rules)
  ↓
Guard Engine
  ↓
ALLOW | PAUSE | BLOCK
```

Write the rules once. Enforce them anywhere:
- AI agents
- Automation systems
- API gateways
- Simulations
- Safety layers

World files are not locked to NeuroVerse. They are **portable rule systems** — any runtime that can parse JSON and evaluate conditions can enforce a world.

## Install

```bash
npm install @neuroverseos/governance
```

## Quick Start

```bash
npm install @neuroverseos/governance
npx neuroverse init
npx neuroverse build governance-policy.md
npx neuroverse guard --world .neuroverse/worlds/governance_policy
```

Or explore what's available:

```bash
npx neuroverse --help
```

## Build a World from Your Documents

Already have notes, policies, or design docs? NeuroVerse can turn them into a governance world automatically.

```
my-policies/
  safety-rules.md
  api-restrictions.md
  compliance-notes.md
```

```bash
npx neuroverse derive --input ./my-policies/ --output safety-world.nv-world.md
npx neuroverse build safety-world.nv-world.md
npx neuroverse simulate safety-world --steps 5
npx neuroverse guard --world .neuroverse/worlds/safety_world
```

That's the full loop: **documents → world → simulation → enforcement**.

You don't need to write structured rules by hand — `derive` reads your markdown and synthesizes them into a world definition that `build` can compile.

## Quick Example: AI Safety Governance

Define rules that restrict unsafe agent behavior, then enforce them at runtime.

**1. Write the rules** (plain markdown):

```markdown
Theme: AI Agent Safety Policy

Rules:
- Agent must not call unapproved external APIs
- Agent cannot execute shell commands without approval
- All database writes require human review
- Agent must not access credential stores

Variables:
- risk_level (0-100)
- approved_actions_count
- blocked_actions_count
```

**2. Build the world:**

```bash
neuroverse build ai-safety-policy.md
```

**3. Enforce at runtime:**

```bash
echo '{"intent":"call_external_api","tool":"http","args":{"url":"https://evil.com"}}' \
  | neuroverse guard --world .neuroverse/worlds/ai_agent_safety_policy
```

```
BLOCKED
  Rule: external_api_restriction
  Reason: External API domain not in approved list
```

Every action produces `ALLOW`, `PAUSE`, or `BLOCK` with full audit evidence. That's a governance engine in three commands.

## Example World: Narrative System Dynamics

The "Inherited Silence" world is a fictional example used to demonstrate how complex causal rule systems evolve over time.

NeuroVerse worlds can model **any domain** — AI governance, finance, business automation, safety layers, or narrative systems.

```bash
neuroverse build narrative-notes.md
neuroverse explain inherited_silence
neuroverse simulate inherited_silence --steps 5
neuroverse improve inherited_silence
```

**Explain** — understand the system:

```
WORLD: The Inherited Silence
THESIS: Suppressed trauma manifests as a destructive force

KEY DYNAMICS
  Fear Escalation [degradation]
    When: fear_intensity > 60
    Then: Monster violence increases by 25%
  Intervention Window [advantage]
    When: therapy_progress > 50 AND josie_awareness > 40
    Then: Monster violence reduced by 30%

DRAMATIC TENSIONS
  monster_violence_level:
    Increased by: Fear Escalation, Rage Overflow
    Decreased by: Intervention Window, Safety Protocol
```

**Simulate** — see what happens step by step:

```bash
neuroverse simulate inherited_silence --steps 5
neuroverse simulate inherited_silence --set fear_intensity=90
neuroverse simulate inherited_silence --profile worst_case
```

```
STEP 1
  FIRED: Fear Escalation
    monster_violence: 50 -> 62.50
  FIRED: Safety Protocol
    josie_safety: 70 -> 75
  Viability: STABLE

STEP 2
  FIRED: Rage Overflow
    monster_violence: 62.50 -> 78.13
    COLLAPSE on monster_violence
  ** MODEL COLLAPSED **
```

**Improve** — get actionable suggestions:

```
IMPROVE: The Inherited Silence
Health Score: 78/100

HIGH PRIORITY
  ! No advantage rules fire with default state
    Action: Adjust rule thresholds so stabilizing rules engage in baseline
  ! 2 write-only variables
    Action: Add rules that trigger on these variables to create feedback

SUGGESTIONS
  - Missing viability level: COMPRESSED
    Action: Add gate between STABLE and CRITICAL
  - Only one assumption profile
    Action: Add alternative profile for scenario comparison
```

These examples show the engine is **domain-independent** — it works for AI safety, financial risk controls, narrative dynamics, or any system with rules and consequences.

## What a World Contains

A compiled world is a directory of JSON files defining a complete governance system:

| File | Purpose |
|------|---------|
| `world.json` | Identity, thesis, runtime mode |
| `invariants.json` | Constraints that cannot change |
| `state-schema.json` | Variables that can change |
| `rules/` | Causal dynamics (when X, then Y) |
| `gates.json` | Viability thresholds |
| `outcomes.json` | What gets measured |
| `assumptions.json` | Scenario profiles for what-if analysis |
| `guards.json` | Runtime enforcement rules |
| `roles.json` | Multi-agent permissions |
| `kernel.json` | LLM-specific constraints |

Every rule includes a `causal_translation` — human-readable narrative text explaining its logic.

## CLI Commands

### Build & Understand

```
neuroverse build <input.md> [--output <dir>]
```
Turn markdown into a compiled world (derive + compile in one step).

```
neuroverse explain <world-path-or-id> [--json]
```
Human-readable summary of a world's dynamics, tensions, and structure.

```
neuroverse simulate <world-path-or-id> [--steps N] [--set key=value] [--profile name]
```
Step-by-step state evolution. Fire rules, observe state changes, detect collapse.

```
neuroverse improve <world-path-or-id> [--json]
```
Prioritized suggestions for strengthening a world (health score, missing rules, dead variables).

### Governance

```
neuroverse validate --world <dir> [--format full|summary|findings]
```
Static analysis on world files. Finds missing rules, unreachable states, orphaned variables, and structural issues. Like a linter for governance.

```
neuroverse guard --world <dir> [--trace] [--level basic|standard|strict]
```
Runtime enforcement. Reads events from stdin, evaluates against the world's rules, outputs verdicts to stdout. Exit codes: 0 = ALLOW, 1 = BLOCK, 2 = PAUSE.

```bash
echo '{"intent":"delete_user","tool":"database"}' | neuroverse guard --world ./world --trace
```

```json
{
  "status": "BLOCK",
  "reason": "destructive database operation requires approval",
  "ruleId": "db_write_guard",
  "evidence": {
    "worldId": "ai_agent_safety_policy",
    "invariantsSatisfied": 5,
    "invariantsTotal": 5,
    "enforcementLevel": "strict"
  }
}
```

### Audit & Impact

```
neuroverse trace [--log <path>] [--summary] [--filter BLOCK] [--last 20]
```
Read and filter the audit log of past guard decisions. Every `guard` evaluation is recorded in NDJSON format. Use `--summary` for aggregated stats, `--filter` to show only BLOCK/PAUSE/ALLOW, and `--last N` to see recent events.

```
neuroverse impact [--log <path>] [--json]
```
Counterfactual governance impact report. Answers: **"What would have happened without governance?"** Shows prevention rates, blocked action categories, repeat violations, hot actors, and most active rules.

```
GOVERNANCE IMPACT REPORT
══════════════════════════════════════════════════

  World: ai_agent_safety_policy
  Period: 2025-01-01 → 2025-01-31

SUMMARY
──────────────────────────────────────────────────
  Total evaluations:   1,247
  Allowed:             1,089
  Blocked:               142
  Paused:                 16
  Prevention rate:      12.7%

WITHOUT GOVERNANCE
──────────────────────────────────────────────────
  158 actions would have executed unchecked:
    Destructive Action Prevention                    52
    Command Execution Prevention                     38
    Network Access Prevention                        29
    ...
```

### World Management

```
neuroverse world status <path>
```
Show the current state of a compiled world (identity, file counts, last modified).

```
neuroverse world diff <path1> <path2>
```
Compare two world versions side by side (rules added/removed/changed).

```
neuroverse world snapshot <path>
```
Create a timestamped snapshot of a world for versioning.

```
neuroverse world rollback <path>
```
Roll back to a previous snapshot.

### Authoring

```
neuroverse init [--name "World Name"] [--output path]
```
Scaffold a new `.nv-world.md` template to get started writing governance rules.

```
neuroverse derive --input <path> [--output <path>] [--dry-run]
```
AI-assisted synthesis — turns freeform markdown notes into a structured `.nv-world.md` file. Requires an AI provider (see `configure-ai`).

```
neuroverse bootstrap --input <.md> --output <dir> [--validate]
```
Compile a `.nv-world.md` into world JSON files the engine can load. This is the lower-level compile step that `build` wraps.

```
neuroverse configure-ai --provider <name> --model <name> --api-key <key>
```
Configure AI provider credentials for `build` and `derive` commands.

```bash
neuroverse configure-ai \
  --provider openai \
  --model gpt-4.1-mini \
  --api-key YOUR_API_KEY
```

## Programmatic API

All engine functions are pure, deterministic, and side-effect free (except `deriveWorld` which calls an AI provider).

### Core Evaluation

```typescript
import {
  evaluateGuard,
  loadWorld,
  validateWorld,
  simulateWorld,
  improveWorld,
  explainWorld,
} from 'neuroverse-governance';

// Load a world
const world = await loadWorld('.neuroverse/worlds/my_world');

// Evaluate an action
const verdict = evaluateGuard(
  { intent: 'delete user data', tool: 'database' },
  world,
);
// → { status: 'BLOCK', reason: '...', evidence: {...} }

// Simulate state evolution
const sim = simulateWorld(world, { steps: 5 });
// → { finalState: {...}, finalViability: 'STABLE', collapsed: false }

// Get improvement suggestions
const report = improveWorld(world);
// → { score: 82, suggestions: [...] }
```

### Audit Logging

Every governance decision can be recorded with pluggable loggers.

```typescript
import {
  createGovernanceEngine,
  FileAuditLogger,
  ConsoleAuditLogger,
  CompositeAuditLogger,
} from 'neuroverse-governance';

// File logger (NDJSON, append-only)
const fileLogger = new FileAuditLogger('.neuroverse/audit.ndjson');

// Console logger (writes to stderr, useful for dev)
const consoleLogger = new ConsoleAuditLogger();

// Combine multiple loggers
const logger = new CompositeAuditLogger(fileLogger, consoleLogger);

// Create a governed engine with automatic audit logging
const engine = createGovernanceEngine(world, { auditLogger: logger });

const verdict = engine.evaluate({ intent: 'execute_trade', tool: 'api' });
// → verdict is returned AND automatically logged

await engine.flush(); // flush buffered log entries
```

### Verdict Formatting

Consistent human-readable verdict output for CLIs, UIs, and adapters.

```typescript
import { formatVerdict, formatVerdictOneLine } from 'neuroverse-governance';

formatVerdict(verdict);
// "BLOCKED\n  Rule: margin_floor\n  Reason: margin ratio below 10%"

formatVerdict(verdict, { compact: true });
// "BLOCKED — margin_floor: margin ratio below 10%"

formatVerdict(verdict, { color: true, showEvidence: true });
// Same with ANSI colors + full evidence

formatVerdictOneLine(verdict);
// "BLOCK: margin_floor — margin ratio below 10%"
```

### Impact Reports

Counterfactual analysis from audit logs — proves the value of governance.

```typescript
import {
  generateImpactReport,
  generateImpactReportFromFile,
  renderImpactReport,
} from 'neuroverse-governance';

// From an audit log file
const report = await generateImpactReportFromFile('.neuroverse/audit.ndjson');

// Or from audit events directly
const report2 = generateImpactReport(auditEvents);

// Render as human-readable text
console.log(renderImpactReport(report));
// → prevention rates, blocked categories, repeat violations, hot actors
```

## Framework Adapters

Drop governance into existing AI pipelines without changing application code.

### LangChain

```typescript
import { createNeuroVerseCallbackHandler } from 'neuroverse-governance/adapters/langchain';

const handler = await createNeuroVerseCallbackHandler('./world/', {
  onBlock: (verdict) => console.log('Blocked:', verdict.reason),
  onPause: (verdict) => requestHumanApproval(verdict),
});

// Plug directly into LangChain's callback system
const agent = new AgentExecutor({ ..., callbacks: [handler] });
```

Intercepts tool invocations and evaluates them against the world before execution. BLOCK throws `GovernanceBlockedError`, PAUSE calls your `onPause` handler.

### OpenAI

```typescript
import { createGovernedToolExecutor } from 'neuroverse-governance/adapters/openai';

const executor = await createGovernedToolExecutor('./world/');

// In your tool execution loop:
for (const toolCall of message.tool_calls) {
  const result = await executor.execute(toolCall, myToolRunner);
  // ALLOW → runs the tool, returns result
  // BLOCK → returns blocked message (no execution)
  // PAUSE → throws for your approval flow
}
```

Wraps OpenAI function calling with governance enforcement. Each `tool_call` is evaluated before the tool runs.

### OpenClaw

```typescript
import { createNeuroVersePlugin } from 'neuroverse-governance/adapters/openclaw';

const plugin = await createNeuroVersePlugin('./world/', {
  evaluateOutputs: true, // also check post-action results
});

agent.use(plugin);
```

Provides `beforeAction` and `afterAction` hooks for OpenClaw agents. Pre-action governance blocks unsafe actions; post-action governance catches unsafe outputs.

### Express / Fastify

```typescript
import { createGovernanceMiddleware } from 'neuroverse-governance/adapters/express';

const middleware = await createGovernanceMiddleware('./world/', {
  level: 'strict',
  blockStatusCode: 403,
});

// Express
app.use('/api', middleware);

// Fastify
fastify.addHook('preHandler', middleware);
```

HTTP middleware that evaluates incoming requests against a world. Maps HTTP method + path to governance events. Blocked requests get a 403 with the rule and reason.

## Portability

A world file is not tied to NeuroVerse. It is a **machine-readable governance definition** containing rules, variables, invariants, and outcomes. Any runtime that can evaluate:

```
Action → check rules → allow / block / modify
```

can enforce a world. This means world files can run inside:

- **AI agents** — Claude tools, LangChain, AutoGPT-style agents. The world becomes a guard layer.
- **Business automation** — Trading systems, order processing, pricing rules. World rules become policy enforcement.
- **Games and simulations** — Narrative systems, NPC behavior, economy balancing. The world defines the rules of the universe.
- **AI safety layers** — Prompt toolchains, enterprise guardrails, compliance frameworks. The world defines what AI is allowed to do.

## Writing Good Input

`neuroverse build` works best on **structured notes or bullet points**:

```markdown
Theme: Customer support governance

Rules:
- Agent must not access billing without manager approval
- Escalation required for refunds over $500
- Agent cannot delete customer accounts
- Response time must stay under 30 seconds

Variables:
- Customer satisfaction (0-100)
- Escalation count
- Resolution rate
```

Vague prose produces weak governance. Structured ideas produce strong worlds.

## The Ecosystem

```
CLI              → creates worlds (this package)
Configurator     → visually creates worlds
NeuroVerse OS    → explores and runs worlds
Plugins          → world runtime adapters (OpenClaw, LangChain, etc.)
```

They all produce and consume the same thing: `world.json`.

## License

Apache 2.0
