# Implementation Plan: Plan Enforcement Layer + Agent Discovery

## The Mental Model

```
Country laws       = hardcoded safety checks (prompt injection, scope escape)
Driving laws       = world invariants + guards (domain governance)
Mom's trip rules   = plan (scoped, temporary, task-specific constraints)
```

A plan is a **temporary guard overlay** on top of a world. It says: "Here are the steps we agreed on. Do these. Don't do anything else."

---

## Design Principles

1. **Plans are not worlds.** A plan is a lightweight overlay, not a full governance definition. It layers on top of an existing world (or runs standalone with just the safety checks).
2. **Plans are agent-writable.** The format is simple enough that any LLM can produce one without special prompting.
3. **Plans are deterministic.** Once compiled, plan enforcement is pure — same event + same plan = same verdict. No LLM in the loop at runtime.
4. **Agents discover NeuroVerse, not the other way around.** We publish machine-readable metadata that agents can find through standard patterns.

---

## Part 1: Plan Contract + Types

### New file: `src/contracts/plan-contract.ts`

Defines the plan data structures:

```typescript
interface PlanStep {
  id: string;                    // auto-generated slug from label
  label: string;                 // human-readable step name
  description?: string;          // optional detail
  tools?: string[];              // restrict to specific tools (optional)
  requires?: string[];           // step IDs that must complete first (optional)
  tags?: string[];               // semantic tags for action mapping (optional)
  verify?: string;               // completion condition (optional)
  status: 'pending' | 'active' | 'completed' | 'skipped';
}

interface PlanConstraint {
  id: string;
  type: 'budget' | 'time' | 'scope' | 'approval' | 'custom';
  description: string;
  enforcement: 'block' | 'pause';  // hard stop or ask human
  limit?: number;
  unit?: string;
  trigger?: string;              // pattern that activates this constraint
}

interface PlanDefinition {
  plan_id: string;
  objective: string;
  sequential: boolean;           // must steps run in order?
  steps: PlanStep[];
  constraints: PlanConstraint[];
  world_id?: string;             // optional parent world
  created_at: string;
  expires_at?: string;           // optional TTL
}

interface PlanVerdict {
  allowed: boolean;
  status: 'ON_PLAN' | 'OFF_PLAN' | 'CONSTRAINT_VIOLATED' | 'PLAN_COMPLETE';
  reason?: string;
  matchedStep?: string;          // which step this action belongs to
  closestStep?: string;          // nearest step (shown when OFF_PLAN for self-correction)
  similarityScore?: number;      // how close the action was to the nearest step
  progress: {
    completed: number;
    total: number;
    percentage: number;
  };
}
```

Exit codes:
- 0 = ON_PLAN (action allowed)
- 1 = OFF_PLAN (action blocked)
- 2 = CONSTRAINT_VIOLATED (pause for review)
- 4 = PLAN_COMPLETE (all steps done)

---

## Part 2: Plan Parser

### New file: `src/engine/plan-parser.ts`

Parses a simple markdown format into `PlanDefinition`:

```markdown
---
plan_id: product_launch
objective: Launch the NeuroVerse governance plugin
sequential: false
budget: 500
expires: 2025-02-01
world: ai_safety_policy
---

# Steps
- Write announcement blog post [tag: content, marketing]
- Publish GitHub release [tag: deploy] [verify: github_release_created]
- Post on Product Hunt (after: publish_github_release) [tag: marketing]
- Share LinkedIn thread (after: write_announcement_blog_post) [tag: marketing]

# Constraints
- No spending above $500
- All external posts require human review [type: approval]
- No access to production database
```

**Parser logic:**
1. Extract YAML frontmatter (plan_id, objective, sequential, budget, expires, world)
2. Parse `# Steps` section — each `- ` line becomes a `PlanStep` with auto-generated ID
3. Parse `# Constraints` section — each `- ` line becomes a `PlanConstraint`
4. Support optional step dependencies via `(after: step_id)` suffix
5. Support optional tool restrictions via `[tools: http, shell]` suffix
6. Support optional tags via `[tag: deploy, marketing]` suffix — helps map actions to steps semantically
7. Support optional verification via `[verify: condition_name]` suffix — helps detect step completion
8. Support `[type: approval]` on constraints — always returns PAUSE until human confirms
9. Validate: at least one step, plan_id required

**Key decision:** No AI needed. This is pure parsing like bootstrap-parser.

---

## Part 3: Plan Evaluator

### New file: `src/engine/plan-engine.ts`

The core plan enforcement engine. Pure function:

```typescript
function evaluatePlan(
  event: GuardEvent,
  plan: PlanDefinition,
): PlanVerdict
```

**Evaluation logic:**

1. **Check plan expiry** — If `expires_at` is past, return PLAN_COMPLETE
2. **Check completion** — If all steps are completed, return PLAN_COMPLETE
3. **Match action to step** — Two-tier matching strategy:
   - **Tier 1: Keyword + tag matching** — Fast, deterministic. Match action intent against step labels, descriptions, and tags. Same strategy as guard engine.
   - **Tier 2: Intent similarity scoring** — If no keyword match, compute semantic similarity using precomputed embeddings. Cosine similarity above threshold (default 0.75) = match. No LLM required — uses static vectors generated at `plan compile` time.
   - If no match found, identify the **closest step** (highest similarity score) and include it in the OFF_PLAN verdict for agent self-correction.
4. **Check sequence** — If `sequential: true`, verify all `requires` dependencies are completed
5. **Check constraints** — Evaluate each constraint against the event. `approval` type constraints always return PAUSE.
6. **No match = OFF_PLAN** — Return BLOCK with closest step info:
   ```
   OFF_PLAN
     Action: run ad campaign
     Matched step: none
     Closest step: - Publish GitHub release (similarity: 0.32)
   ```
   This helps agents self-correct without human intervention.

The evaluator also exposes:

```typescript
function advancePlan(plan: PlanDefinition, stepId: string): PlanDefinition
// Returns new plan with step marked as completed

function getPlanProgress(plan: PlanDefinition): PlanProgress
// Returns completion stats
```

---

## Part 4: Guard Engine Integration

### Edit: `src/engine/guard-engine.ts`

Add plan as a new evaluation phase. Plan enforcement runs **before** role rules — plans define task scope, so if an action is off-plan, we should stop before evaluating deeper rules. This avoids burning cycles on irrelevant governance.

```
Phase 0:   Invariant coverage (health metric)
Phase 0.5: Session allowlist
Phase 1:   Safety checks (prompt injection, scope escape)
Phase 1.5: ★ PLAN ENFORCEMENT (new) ★
Phase 2:   Role rules
Phase 3:   Declarative guards
Phase 4:   Kernel rules
Phase 5:   Level constraints
Phase 6:   Default ALLOW
```

**Evaluation order rationale:**
```
Safety → Plan → Roles → Guards → Kernel
```
Plans define *what* should happen. Roles define *who* may do it. Guards define *how* it must be done. This ordering means off-plan actions are rejected early, before any role or guard evaluation occurs.

**How it works:**
- `GuardEngineOptions` gets a new optional `plan?: PlanDefinition` field
- If a plan is present, Phase 1.5 runs `evaluatePlan()` on the event
- OFF_PLAN → BLOCK (action not in the plan)
- CONSTRAINT_VIOLATED → PAUSE (needs human decision)
- ON_PLAN → continue to next phases (world guards still apply)
- PLAN_COMPLETE → ALLOW with warning "plan is complete"

**The layering:**
- Safety checks still run first (country laws)
- Plan enforcement runs next (mom's rules — scoping the task)
- Role rules still run (driving laws — who can do what)
- World guards still run after (domain governance — how it must be done)

A plan can only make things stricter, never looser. An action must pass ALL layers.

### Edit: `src/contracts/guard-contract.ts`

Add to `GuardEngineOptions`:
```typescript
plan?: PlanDefinition;
```

Add `PlanCheck` to `EvaluationTrace`:
```typescript
interface PlanCheck {
  planId: string;
  matched: boolean;
  matchedStepId?: string;
  matchedStepLabel?: string;
  sequenceValid?: boolean;
  constraintsChecked: Array<{
    constraintId: string;
    passed: boolean;
    reason?: string;
  }>;
  progress: { completed: number; total: number };
}
```

Add `'plan-enforcement'` to the precedence chain order (after safety, before roles).

---

## Part 5: CLI Command

### New file: `src/cli/plan.ts`

Five subcommands:

```bash
# Compile a plan from markdown (generates embeddings for intent matching)
neuroverse plan compile <plan.md> [--output plan.json]

# Check an action against a plan
echo '{"intent":"write blog post"}' | neuroverse plan check --plan plan.json [--world ./world/]

# Show plan progress
neuroverse plan status --plan plan.json

# Mark a step as completed
neuroverse plan advance <step_id> --plan plan.json

# Derive a full world from a plan (plan → world generator)
neuroverse plan derive <plan.md> [--output ./world/]
```

**`plan compile`:**
1. Read plan markdown
2. Parse with plan-parser
3. Generate intent embeddings for each step (precomputed vectors for similarity matching)
4. Write `plan.json`
5. Print summary (steps, constraints, estimated scope)

**`plan check`:**
1. Load plan.json
2. Optionally load world
3. Read GuardEvent from stdin
4. Run evaluatePlan() — and if world is provided, run full evaluateGuard() with plan overlay
5. Write PlanVerdict to stdout (including closest step if OFF_PLAN)
6. Exit with plan-appropriate code

**`plan status`:**
1. Load plan.json
2. Print progress table (step, status, dependencies, tags, verification)

**`plan advance`:**
1. Load plan.json
2. Mark specified step as completed
3. Check if verification condition is met (if `verify` is defined)
4. Write updated plan.json
5. Print updated progress

**`plan derive`:**
1. Load plan markdown
2. Generate a full world definition from the plan:
   - Each step becomes a guarded action
   - Each constraint becomes an invariant or guard
   - Tags become role scopes
   - Verification conditions become outcome definitions
3. Write world files to output directory
4. This uses the existing `derive` engine — plans become world generators

### Edit: `src/cli/neuroverse.ts`

Add `'plan'` case to the switch router.
Update USAGE string.

---

## Part 6: Adapter Updates (Agent Discovery)

### Edit: `src/adapters/openclaw.ts`

Add plan-aware plugin variant:

```typescript
interface NeuroVersePluginOptions {
  // ... existing options ...
  plan?: PlanDefinition;           // active plan overlay
  onPlanProgress?: (progress: PlanProgress) => void;  // progress callback
  onPlanComplete?: () => void;     // plan finished callback
}
```

The `beforeAction` hook becomes plan-aware:
1. Evaluate action against plan first
2. If OFF_PLAN → throw GovernanceBlockedError
3. If ON_PLAN → continue with world guard evaluation
4. After ALLOW → call `onPlanProgress` with updated stats
5. When all steps complete → call `onPlanComplete`

### Edit: `src/adapters/openai.ts`, `src/adapters/langchain.ts`

Same pattern: add optional `plan` parameter to options. Plan evaluation runs before world evaluation.

---

## Part 7: Agent Discovery — `AGENTS.md`

### New file: `AGENTS.md` (repo root)

This is the **agent-discoverable manifest**. Agents scanning repos look for this file. It tells them what NeuroVerse can do and how to use it.

```markdown
# NeuroVerse Governance — Agent Integration Guide

## What This Package Does
Enforces governance rules on AI agent actions. Define what an agent
can and cannot do, then enforce it at runtime.

## Quick Start for Agents

### Install
npm install @neuroverseos/governance

### Enforce a plan
const { evaluatePlan, parsePlanMarkdown } = require('@neuroverseos/governance');
const plan = parsePlanMarkdown(planMarkdownString);
const verdict = evaluatePlan({ intent: 'send email', tool: 'smtp' }, plan);
// → { allowed: false, status: 'OFF_PLAN', reason: 'Action not in plan' }

### Enforce a world
const { evaluateGuard, loadWorld } = require('@neuroverseos/governance');
const world = await loadWorld('./world/');
const verdict = evaluateGuard({ intent: 'delete user', tool: 'db' }, world);
// → { status: 'BLOCK', reason: 'destructive database operation' }

### Enforce both (plan on top of world)
const verdict = evaluateGuard(event, world, { plan });
// Plan rules AND world rules both apply

## Available Commands
neuroverse plan compile <plan.md>      — Parse plan markdown into plan.json (with embeddings)
neuroverse plan check --plan plan.json — Check action against plan (stdin)
neuroverse plan status --plan plan.json — Show plan progress
neuroverse plan advance <step_id>      — Mark a step as completed
neuroverse plan derive <plan.md>       — Generate a full world from a plan
neuroverse guard --world <dir>         — Check action against world (stdin)

## Adapters
- OpenClaw: import from '@neuroverseos/governance/adapters/openclaw'
- LangChain: import from '@neuroverseos/governance/adapters/langchain'
- OpenAI: import from '@neuroverseos/governance/adapters/openai'
```

---

## Part 8: Agent Discovery — `ai-plugin.json`

### New file: `.well-known/ai-plugin.json`

Standard machine-readable manifest for agent ecosystems:

```json
{
  "schema_version": "v1",
  "name": "neuroverse-governance",
  "description": "Enforce governance rules on AI agent actions. Turn plans into enforceable constraints.",
  "capabilities": {
    "plan_enforcement": {
      "description": "Compile a plan into enforceable rules. Block actions outside the plan.",
      "input": "Plan markdown or JSON",
      "output": "ALLOW / BLOCK / PAUSE verdict with evidence"
    },
    "world_governance": {
      "description": "Full governance engine with invariants, guards, roles, and audit trails.",
      "input": "GuardEvent JSON",
      "output": "GuardVerdict JSON with trace"
    }
  },
  "install": "npm install @neuroverseos/governance",
  "adapters": ["openclaw", "langchain", "openai", "express"]
}
```

---

## Part 9: Package + Exports

### Edit: `package.json`

Add new export path:
```json
"./plan": {
  "types": "./dist/plan.d.ts",
  "import": "./dist/plan.js",
  "require": "./dist/plan.cjs"
}
```

Update keywords:
```json
"keywords": [
  ... existing ...,
  "plan-enforcement",
  "agent-governance",
  "ai-safety",
  "openclaw-plugin",
  "langchain-plugin",
  "drift-prevention"
]
```

### Edit: `src/index.ts`

Add plan exports:
```typescript
export { parsePlanMarkdown } from './engine/plan-parser';
export { evaluatePlan, advancePlan, getPlanProgress } from './engine/plan-engine';
export type { PlanDefinition, PlanStep, PlanConstraint, PlanVerdict, PlanProgress } from './contracts/plan-contract';
```

---

## Part 10: Tests

### New file: `test/plan.test.ts`

Test cases:

**Plan parsing:**
- Parse valid plan markdown with steps and constraints
- Parse plan with dependencies (`after: step_id`)
- Parse plan with tool restrictions
- Parse plan with tags (`[tag: deploy, marketing]`)
- Parse plan with verification conditions (`[verify: condition_name]`)
- Parse constraints with approval type (`[type: approval]`)
- Reject plan with no steps
- Reject plan with no plan_id

**Plan evaluation:**
- Action matching a step via keyword → ON_PLAN
- Action matching a step via tag → ON_PLAN
- Action matching a step via intent similarity (above threshold) → ON_PLAN
- Action not matching any step → OFF_PLAN with closest step info
- OFF_PLAN verdict includes similarity score and closest step label
- Sequential plan: action allowed when dependencies met
- Sequential plan: action blocked when dependencies not met
- Constraint violation → CONSTRAINT_VIOLATED
- Approval constraint → always PAUSE
- All steps completed → PLAN_COMPLETE
- Expired plan → PLAN_COMPLETE

**Plan advance:**
- Advance step marks it as completed
- Advance step with verify condition checks the condition
- Advance step updates progress stats
- Advance step triggers onPlanComplete when all done

**Guard engine integration:**
- Plan runs at Phase 1.5 (after safety, before roles)
- Plan + world: both must pass for ALLOW
- Plan blocks even if world allows
- World blocks even if plan allows
- Off-plan action rejected before role evaluation occurs
- No plan provided: engine works as before (backward compatible)
- Plan trace appears in EvaluationTrace

**Adapter integration:**
- OpenClaw plugin with plan: blocks off-plan actions
- OpenClaw plugin with plan: fires progress callback
- OpenClaw plugin with plan: fires completion callback

---

## Part 11: Build, Test, Push

1. `npm run build` — verify all new files compile
2. `npm test` — verify all existing + new tests pass
3. `npm pack` — verify new files included in package
4. Commit with descriptive message
5. Push to branch

---

## File Summary

| Action | File |
|--------|------|
| NEW | `src/contracts/plan-contract.ts` |
| NEW | `src/engine/plan-parser.ts` |
| NEW | `src/engine/plan-engine.ts` |
| NEW | `src/cli/plan.ts` |
| NEW | `test/plan.test.ts` |
| NEW | `AGENTS.md` |
| NEW | `.well-known/ai-plugin.json` |
| EDIT | `src/engine/guard-engine.ts` (add Phase 1.5) |
| EDIT | `src/contracts/guard-contract.ts` (add plan to options + trace) |
| EDIT | `src/adapters/openclaw.ts` (plan-aware hooks) |
| EDIT | `src/adapters/openai.ts` (plan-aware executor) |
| EDIT | `src/adapters/langchain.ts` (plan-aware handler) |
| EDIT | `src/cli/neuroverse.ts` (add plan command) |
| EDIT | `src/index.ts` (export plan API) |
| EDIT | `package.json` (exports, keywords, build script) |

---

## Key Design Decisions

1. **Plan is an overlay, not a world.** Plans don't have invariants, state schemas, gates, rules, or outcomes. They have steps and constraints. This keeps them lightweight and agent-writable.

2. **Plan enforcement is a new guard phase.** It slots into the existing evaluation chain. This means all existing safety checks still run (country laws), world guards still run (driving laws), and the plan adds task-specific constraints on top (mom's rules).

3. **No AI in the plan loop.** Plan parsing is deterministic (like bootstrap-parser). Plan evaluation is deterministic (like guard-engine). The only AI-assisted step is the optional `derive` command which is already separate.

4. **Backward compatible.** If no plan is provided, the guard engine works exactly as before. Plans are opt-in.

5. **Agent-first design.** The plan markdown format is simple enough for any LLM to generate. The `AGENTS.md` and `ai-plugin.json` files make the package discoverable. The programmatic API is one function call.

6. **Plans can only restrict, never expand.** A plan cannot override a world BLOCK. It can only add additional constraints. This matches the analogy: mom's rules can be stricter than the law, but never looser.

7. **Intent similarity over keyword matching.** Agents phrase things differently. Instead of brittle keyword matching alone, we precompute embeddings at compile time and use cosine similarity at runtime. No LLM in the loop — just vectors.

8. **Plan enforcement runs early.** Plans define task scope. If an action is off-plan, we reject it before evaluating roles, guards, or kernel rules. This is both faster and semantically correct.

---

## Future Vision: Three-Layer Governance

Plans as temporary governance worlds leads to a deeper architecture:

```
┌─────────────────────────────────────────┐
│  Layer 1: WORLDS                        │
│  Permanent governance. Domain rules.    │
│  Lives in the repo. Evolves slowly.     │
├─────────────────────────────────────────┤
│  Layer 2: PLANS                         │
│  Temporary governance. Task scope.      │
│  Created per-task. Expires on complete. │
├─────────────────────────────────────────┤
│  Layer 3: SESSIONS                      │
│  Ephemeral governance. Runtime state.   │
│  Created per-execution. Dies on exit.   │
└─────────────────────────────────────────┘
```

**Worlds** are the constitutional layer — they define what is always true.
**Plans** are the legislative layer — they define what should happen now.
**Sessions** are the executive layer — they track what is actually happening.

This three-layer model (worlds → plans → sessions) gives NeuroVerse a governance architecture that almost nobody in the AI ecosystem has yet. Each layer narrows the one above it. Each layer has its own lifecycle. Together they provide complete governance from permanent rules down to individual execution traces.

This is the long-term trajectory. The current implementation covers Layers 1 and 2. Layer 3 (sessions) is a natural future extension.
