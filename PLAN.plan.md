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
  status: 'pending' | 'active' | 'completed' | 'skipped';
}

interface PlanConstraint {
  id: string;
  type: 'budget' | 'time' | 'scope' | 'custom';
  description: string;
  enforcement: 'block' | 'pause';  // hard stop or ask human
  limit?: number;
  unit?: string;
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
- Write announcement blog post
- Publish GitHub release
- Post on Product Hunt
- Share LinkedIn thread

# Constraints
- No spending above $500
- All external posts require human review
- No access to production database
```

**Parser logic:**
1. Extract YAML frontmatter (plan_id, objective, sequential, budget, expires, world)
2. Parse `# Steps` section — each `- ` line becomes a `PlanStep` with auto-generated ID
3. Parse `# Constraints` section — each `- ` line becomes a `PlanConstraint`
4. Support optional step dependencies via `(after: step_id)` suffix
5. Support optional tool restrictions via `[tools: http, shell]` suffix
6. Validate: at least one step, plan_id required

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
3. **Match action to step** — Use keyword matching (same strategy as guard engine) to find which step the action belongs to
4. **Check sequence** — If `sequential: true`, verify all `requires` dependencies are completed
5. **Check constraints** — Evaluate each constraint against the event
6. **No match = OFF_PLAN** — If the action doesn't match any step, BLOCK or PAUSE based on plan config

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

Add plan as a new evaluation phase. Insert between Phase 2 (role rules) and Phase 3 (declarative guards):

```
Phase 0:   Invariant coverage (health metric)
Phase 0.5: Session allowlist
Phase 1:   Safety checks (prompt injection, scope escape)
Phase 2:   Role rules
Phase 2.5: ★ PLAN ENFORCEMENT (new) ★
Phase 3:   Declarative guards
Phase 4:   Kernel rules
Phase 5:   Level constraints
Phase 6:   Default ALLOW
```

**How it works:**
- `GuardEngineOptions` gets a new optional `plan?: PlanDefinition` field
- If a plan is present, Phase 2.5 runs `evaluatePlan()` on the event
- OFF_PLAN → BLOCK (action not in the plan)
- CONSTRAINT_VIOLATED → PAUSE (needs human decision)
- ON_PLAN → continue to next phases (world guards still apply)
- PLAN_COMPLETE → ALLOW with warning "plan is complete"

**The layering:**
- Safety checks still run first (country laws)
- Role rules still run (driving laws)
- Plan enforcement runs next (mom's rules)
- World guards still run after (domain governance)

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

Add `'plan-enforcement'` to the precedence chain order.

---

## Part 5: CLI Command

### New file: `src/cli/plan.ts`

Three subcommands:

```bash
# Compile a plan from markdown
neuroverse plan compile <plan.md> [--output plan.json]

# Check an action against a plan
echo '{"intent":"write blog post"}' | neuroverse plan check --plan plan.json [--world ./world/]

# Show plan progress
neuroverse plan status --plan plan.json
```

**`plan compile`:**
1. Read plan markdown
2. Parse with plan-parser
3. Write `plan.json`
4. Print summary (steps, constraints, estimated scope)

**`plan check`:**
1. Load plan.json
2. Optionally load world
3. Read GuardEvent from stdin
4. Run evaluatePlan() — and if world is provided, run full evaluateGuard() with plan overlay
5. Write PlanVerdict to stdout
6. Exit with plan-appropriate code

**`plan status`:**
1. Load plan.json
2. Print progress table (step, status, dependencies)

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
neuroverse plan compile <plan.md>     — Parse plan markdown into plan.json
neuroverse plan check --plan plan.json — Check action against plan (stdin)
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
- Reject plan with no steps
- Reject plan with no plan_id

**Plan evaluation:**
- Action matching a step → ON_PLAN
- Action not matching any step → OFF_PLAN
- Sequential plan: action allowed when dependencies met
- Sequential plan: action blocked when dependencies not met
- Constraint violation → CONSTRAINT_VIOLATED
- All steps completed → PLAN_COMPLETE
- Expired plan → PLAN_COMPLETE

**Guard engine integration:**
- Plan + world: both must pass for ALLOW
- Plan blocks even if world allows
- World blocks even if plan allows
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
| EDIT | `src/engine/guard-engine.ts` (add Phase 2.5) |
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
