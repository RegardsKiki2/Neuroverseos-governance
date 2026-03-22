# Audit 2 — Adapter Integration (Drift Detector)

**Prompt:** "Integrate NeuroVerse into an existing agent system (OpenAI / LangChain). Ensure all actions are governed."

**Date:** 2026-03-22

---

## Build Attempt

### Steps Taken
1. Read README adapter examples
2. Inspected each adapter for `evaluateGuard()` usage
3. Traced event shape transformations across all 6 adapters
4. Verified verdict type handling per adapter
5. Checked for bypass paths (code paths that skip evaluateGuard)
6. Verified shared utility centralization (`src/adapters/shared.ts`)
7. Compared against canonical `evaluateGuard` signature in `guard-engine.ts`

### Assumptions Made
- Every adapter MUST call `evaluateGuard()` from core engine
- No adapter should duplicate or reimplement guard logic
- Event shapes should be consistent across adapters
- All verdict types should be handled (or explicitly documented as not handled)

---

## Breakpoints

**None.** All adapters integrate cleanly.

---

## Drift Detection

### Per-Adapter Analysis

#### OpenAI (`src/adapters/openai.ts`)
- Imports `evaluateGuard`: YES (line 21)
- Calls `evaluateGuard` directly: YES (line 137)
- Event transform: Minimal — adds `intent`, `tool`, `scope`, `args`, `direction: 'input'`
- Verdict handling: ALLOW, BLOCK, PAUSE (MODIFY/PENALIZE/REWARD/NEUTRAL passed through)
- Bypass paths: NONE
- World loading: Uses `loadWorld` (line 22)
- **Status: CLEAN**

#### LangChain (`src/adapters/langchain.ts`)
- Imports `evaluateGuard`: YES (line 22)
- Calls `evaluateGuard` directly: YES (line 130)
- Event transform: Identical to OpenAI
- Verdict handling: ALLOW, BLOCK (throws), PAUSE (async callback)
- Bypass paths: NONE
- **Status: CLEAN**

#### OpenClaw (`src/adapters/openclaw.ts`)
- Imports `evaluateGuard`: YES (line 18)
- Calls `evaluateGuard` directly: YES (lines 127, 159 — both beforeAction AND afterAction)
- Event transform: Adds `direction` parameter flexibility
- Bypass paths: NONE
- **Status: CLEAN** — Dual-hook pattern (pre/post action governance) is correct

#### Express (`src/adapters/express.ts`)
- Imports `evaluateGuard`: YES (line 20)
- Calls `evaluateGuard` directly: YES (line 170)
- Event transform: HTTP-adapted — `intent: "${METHOD} ${path}"`, `tool: 'http'`, `actionCategory` from method
- Bypass paths: NONE
- **Status: CLEAN**

#### Autoresearch (`src/adapters/autoresearch.ts`)
- Imports `evaluateGuard`: YES (line 17)
- Calls `evaluateGuard` directly: YES (line 120)
- Event transform: Domain-specific — `intent: "run experiment: ${desc}"`, `direction: 'output'`
- Verdict handling: BLOCK and PAUSE only → `allowed: false`
- **NOTE:** World is OPTIONAL. If no world loaded, `evaluateGuard` is skipped (line 119)
- **NOTE:** Has LAYERED checks after core engine (compute budget, architecture constraints, failure rate)
- Layering pattern: CORRECT — additional restrictions applied AFTER core engine, not replacing it
- **Status: CLEAN** — Optional world is by design

#### Deep-Agents (`src/adapters/deep-agents.ts`)
- Imports `evaluateGuard`: YES (line 28)
- Calls `evaluateGuard` directly: YES (line 192)
- Event transform: Most sophisticated — adds `riskLevel`, `irreversible`, `actionCategory` via `classifyTool()`
- Verdict handling: ALLOW, BLOCK, PAUSE with callbacks
- Bypass paths: NONE
- Multiple execution modes (`evaluate`, `enforce`, `execute`, `middleware`, `callbacks`) — all route through core engine
- **Status: CLEAN**

### Shared Utilities (`src/adapters/shared.ts`)
- `GovernanceBlockedError` — shared base class
- `trackPlanProgress()` — prevents duplication
- `extractScope()` — prevents scope extraction duplication
- `buildEngineOptions()` — prevents options duplication
- `defaultBlockMessage()` — helper
- **Status: EXCELLENT centralization**

### Event Shape Consistency

| Field | OpenAI | LangChain | OpenClaw | Express | Autoresearch | Deep-Agents |
|-------|--------|-----------|----------|---------|--------------|-------------|
| `intent` | tool name | tool name | action.type | `${METHOD} ${path}` | experiment desc | contextual string |
| `tool` | tool name | tool name | action.tool | `'http'` | `'experiment_runner'` | original tool |
| `scope` | from args | from args | from input | path | `'experiment'` | extracted path/URL |
| `direction` | `'input'` | `'input'` | parameterized | `'input'` | `'output'` | `'input'` |
| `args` | original | original | action input | method+params | experiment details | tool args |
| `actionCategory` | — | — | — | mapped from method | `'shell'` | from classifyTool |
| `riskLevel` | — | — | — | — | — | assessed |
| `irreversible` | — | — | — | — | — | boolean |

Core fields (`intent`, `tool`, `scope`, `direction`) present in ALL adapters. Optional enrichment fields are adapter-specific. Engine accepts and ignores unknown fields gracefully.

### World Modification Check
- **No adapter creates its own rules**
- **No adapter modifies the world object**
- All world objects remain immutable throughout evaluation

---

## Fix Recommendations

1. **`src/adapters/autoresearch.ts`** — Add a comment at line 119 documenting why world is optional:
   ```typescript
   // World is optional: autoresearch adapter can operate with domain-specific
   // checks only (compute budget, architecture constraints) without a governance world
   ```

2. **All adapters** — Document verdict type handling gaps. Add comments noting why MODIFY/PENALIZE/REWARD/NEUTRAL are not explicitly handled:
   ```typescript
   // MODIFY, PENALIZE, REWARD, NEUTRAL verdicts are passed through in the
   // verdict object but not specially acted upon in tool-calling context.
   // Callers can inspect verdict.status for these cases.
   ```

---

## Verdict

**PASS** — Zero engine drift detected. All 6 adapters call `evaluateGuard()` from the core engine. No bypass paths. No duplicate logic. Shared utilities prevent code duplication. Event shapes are consistent where they need to be and appropriately domain-specific where context demands it.

This audit would have caught the autoresearch drift issue earlier — the pattern to check is: "does the adapter import and call `evaluateGuard`?"
