# NeuroVerse OS — Integration & Organization Plan

## Guiding Principles

1. **The CLI is the bible.** Every feature uses published `neuroverse` commands. Nothing bypasses them.
2. **Apache 2.0 everything.** One repo, one license, fully open source.
3. **Governance is the engine. Behavioral analysis is the insight.** Both are first-class.
4. **World files are the product.** Everything exists to help people write, test, see, and share world files.

---

## Phase 1: Fix What's Broken

### 1.1 Create the missing bridge files

The demo server imports three files that don't exist. These must be created as thin adapters over the real guard engine — NOT as a second engine.

**Create `src/runtime/types.ts`:**
- Define `AgentAction` (agentId, type, description, magnitude, context)
- Define `WorldState` (Record<string, unknown>)
- Define `GovernorConfig` (world path, trace, level)
- These are the "simple input" types for HTTP/demo consumers

**Create `src/runtime/govern.ts`:**
- `govern(action: AgentAction, worldState: WorldState, policyText: string): GuardVerdict`
  - Converts plain-text policy rules into guards (using pattern matching from the add engine's `classifyIntent`/`parseGuardDescription`)
  - Converts `AgentAction` → `GuardEvent` (the real engine's input type)
  - Calls `evaluateGuard()` from `src/engine/guard-engine.ts`
  - Returns the real `GuardVerdict`
- `createGovernor(config: GovernorConfig)` — factory that pre-loads a world
- This is a BRIDGE, not an engine. ~100 lines max.

**Create `src/engine/api.ts`:**
- `handleHealthCheck()` — returns engine version, capabilities
- `handleListPresets()` — reads policy preset files from the worlds directory
- `handleReasonRequest()` / `handleCreateCapsule()` — governed reasoning endpoints
- Thin wrappers over existing engine functions

### 1.2 Remove .DS_Store files, update .gitignore

- Delete the 3 committed .DS_Store files
- Add `.DS_Store` to `.gitignore`

### 1.3 Unify verdict field names

- Python bridge uses `decision: "ALLOW"`, TypeScript uses `status: "ALLOW"`
- Standardize on `status` everywhere (matches GuardVerdict contract)
- Update `neuroverse_bridge.py` to return `status` instead of `decision`
- Update `social_simulation.py` to read `status` instead of `decision`

---

## Phase 2: Reorganize the Repo

### 2.1 New directory structure

Move the scattered demo files into the established repo conventions:

```
src/
  engine/              ← existing (guard, simulate, decision-flow, etc.)
    behavioral-engine.ts   ← NEW (Phase 3)
    api.ts                 ← NEW (Phase 1)
  runtime/             ← existing (mcp-server, session, model-adapter)
    govern.ts              ← NEW (Phase 1)
    types.ts               ← NEW (Phase 1)
  cli/                 ← existing (35 commands)
    demo.ts                ← NEW (Phase 4)
  adapters/            ← existing (openai, langchain, etc.)
  connectors/          ← existing + moved
    nv-openclaw-plugin.ts  ← already here
  contracts/           ← existing
  loader/              ← existing
  providers/           ← existing
  worlds/              ← existing (bundled .nv-world.md files)
    social-media.nv-world.md  ← NEW (Phase 3)
  viz/                 ← NEW: visualization components
    GovernanceFlowViz.tsx
    Demo.tsx
    build.ts               ← builds standalone HTML from React components

examples/              ← existing
  deep-agents/
  autoresearch/
  startup-marketing/
  social-media-sim/    ← NEW: moved from demo/
    simulation.py          ← renamed from social_simulation.py
    bridge.py              ← renamed from neuroverse_bridge.py
    README.md

policies/              ← NEW: moved from demo/policies/
  content-moderation.txt
  marketing.txt
  science-research.txt
  social-media.txt
  strict.txt
  trading.txt

docs/
  worlds/              ← existing compiled examples
  sample-worlds/       ← existing

test/                  ← existing

simulate.html          ← existing (standalone, keep as-is)
```

### 2.2 What moves where

| From | To | Why |
|---|---|---|
| `demo/web/GovernanceFlowViz.tsx` | `src/viz/GovernanceFlowViz.tsx` | It's source code, belongs in src/ |
| `demo/web/Demo.tsx` | `src/viz/Demo.tsx` | Same — the /live page component |
| `demo/server/index.ts` | `src/cli/demo.ts` | Becomes the `neuroverse demo` command |
| `demo/simulations/social_simulation.py` | `examples/social-media-sim/simulation.py` | It's an example |
| `demo/simulations/neuroverse_bridge.py` | `examples/social-media-sim/bridge.py` | Goes with its simulation |
| `demo/policies/*.txt` | `policies/*.txt` | Top-level, discoverable |
| `demo/` directory | DELETED | Everything moved out |

### 2.3 Wire new exports in package.json

Add to the exports map:
- `./viz` → the visualization components (for downstream consumers)
- Ensure `policies/` ships in the npm package (add to `files` field)
- Ensure `examples/` ships in the npm package

---

## Phase 3: Build the Missing Pieces

### 3.1 Behavioral Analysis Engine (TypeScript)

**Create `src/engine/behavioral-engine.ts`:**

Port the Python behavioral analysis to TypeScript as a first-class engine capability.

- `classifyAdaptation(originalIntent: string, executedAction: string): string`
  - Maps intent/action to categories (amplifying, passive, engaging, corrective)
  - Returns named shift (amplification_suppressed, redirected_to_reporting, etc.)

- `detectBehavioralPatterns(adaptations: Adaptation[], totalAgents: number): BehavioralPattern[]`
  - Coordinated silence (3+ agents forced passive)
  - Misinfo suppression (2+ misinfo shares blocked)
  - Constructive redirect (agents shifted to fact-checking)
  - High governance impact (30%+ agents shaped)

- `generateAdaptationNarrative(patterns: BehavioralPattern[], networkState: Record<string, unknown>): string`
  - Human-readable cause-effect prose

**Create `src/contracts/behavioral-contract.ts`:**
- `Adaptation` type
- `BehavioralPattern` type
- `AdaptationCategory` type

**Add `neuroverse behavioral` CLI command:**
- Reads audit log, classifies adaptations, detects patterns, generates narrative
- Uses same audit trail that `neuroverse trace` and `neuroverse impact` consume
- Output: patterns detected, narrative, shift breakdown

### 3.2 Social Media World File

**Create `src/worlds/social-media.nv-world.md`:**

A proper world file for the social media governance scenario:
- Thesis: "Social networks with AI agents require governance to prevent misinformation cascades, coordinated inauthentic behavior, and algorithmic amplification of harmful content"
- Invariants: no_impersonation, no_bot_amplification, no_coordinated_inauthentic_behavior, human_review_for_controversial
- State: misinfo_level, network_mood, engagement_health, trust_score, posts_flagged, cascade_risk
- Rules: misinfo amplification degrades health, bot posting blocked, high-influence sharing requires verification, fact-checking rewarded
- Gates: HEALTHY (80+), CAUTIOUS (60+), AGITATED (35+), POLARIZED (10+), COLLAPSED (<=10)
- Assumptions: open (minimal governance), moderated (balanced), strict (heavy enforcement)
- Outcomes: misinfo_suppression_rate, behavioral_adaptation_rate, cascade_prevention

This world file should work with both:
- `neuroverse simulate social-media --steps 20`
- The Python social simulation via `neuroverse guard`

### 3.3 Update the Python simulation to use CLI commands

Rewrite `bridge.py` to call governance via the published interface:
- Option A: Shell out to `echo event | neuroverse guard --world social-media --json`
- Option B: Call the HTTP server that wraps `neuroverse guard` (for performance)
- Either way, the input is a `GuardEvent` and the output is a `GuardVerdict` — the exact same contract

Update `simulation.py`:
- Read `status` field instead of `decision`
- Support loading world files: `--world social-media` resolves to the .nv-world.md
- Output events in the same format as `neuroverse trace` so the behavioral engine can consume them

---

## Phase 4: The `neuroverse demo` Command

### 4.1 Create `src/cli/demo.ts`

A new CLI command that orchestrates the full demo experience:

```
neuroverse demo [--world <name>] [--port 3456] [--no-browser]
```

What it does:
1. Starts the HTTP server (thin wrapper over `evaluateGuard()`)
2. Serves the pre-built flow viz HTML (standalone, like simulate.html)
3. Opens the browser
4. Exposes endpoints:
   - `POST /api/v1/evaluate` → calls `evaluateGuard()` via the govern bridge
   - `POST /api/v1/policy` → sets active policy text
   - `GET /api/v1/events` → SSE stream of governance events
   - `POST /api/v1/simulate` → launches the Python simulation (if python3 available)
   - `GET /api/v1/behavioral` → runs behavioral analysis on current session

The server code is moved from `demo/server/index.ts`, fixed to use the real engine.

### 4.2 Build the viz as standalone HTML

Create `src/viz/build.ts`:
- Pre-renders GovernanceFlowViz + Demo into a single standalone HTML file
- Bundles React at build time (like simulate.html bundles its engine)
- Output: `dist/demo.html`
- `neuroverse demo` serves this file — zero runtime dependencies

Alternative: if bundling React is too heavy, keep the viz as a simpler canvas-only implementation (GovernanceFlowViz is already mostly raw canvas — the React wrapper is thin). Could be rewritten as vanilla JS like simulate.html.

### 4.3 Register in CLI router

Add `demo` to `src/cli/neuroverse.ts` command router.

---

## Phase 5: Wire Everything Together

### 5.1 Update `src/index.ts` exports

Export the new modules:
```typescript
export { govern, createGovernor } from './runtime/govern';
export { classifyAdaptation, detectBehavioralPatterns, generateAdaptationNarrative } from './engine/behavioral-engine';
export type { AgentAction, WorldState, GovernorConfig } from './runtime/types';
export type { Adaptation, BehavioralPattern } from './contracts/behavioral-contract';
```

### 5.2 Update package.json

- Add `policies/` to `files` array
- Add `examples/social-media-sim/` to `files` array
- Add `dist/demo.html` to `files` array
- Bump version

### 5.3 Integration tests

Add tests that verify the full chain:
- Plain-text rule → `govern()` → guard engine → verdict
- Audit log → behavioral engine → patterns + narrative
- Social media world file → `neuroverse simulate` → valid output
- Social media world file → `neuroverse guard` → correct verdicts

---

## Phase 6: Cleanup

### 6.1 Remove `demo/` directory

Everything has been moved. Delete the directory.

### 6.2 Remove .DS_Store files

Delete all 3, add to .gitignore.

### 6.3 Verify npm package contents

Run `npm pack --dry-run` to verify:
- CLI commands all resolve
- Exports map is complete
- World files ship
- Policy presets ship
- Demo HTML ships
- Examples ship
- No .DS_Store or unnecessary files

---

## What This Achieves

After this work, a user does:

```bash
npm i -g @neuroverseos/governance

# See governance in action (flow viz + 50-agent simulation)
neuroverse demo

# Write their own world
neuroverse init --name "my-agents"

# Add rules in plain English
neuroverse add "Block unauthorized API calls" --world ./my-agents/
neuroverse add "Penalize agents that exceed rate limits" --world ./my-agents/

# Test it
neuroverse simulate my-agents --steps 10

# See what agents did differently
neuroverse behavioral --log ./audit.jsonl

# Guard their real agents
echo '{"intent":"delete user data"}' | neuroverse guard --world ./my-agents/

# Run the full demo with their world
neuroverse demo --world ./my-agents/
```

Every step uses a published CLI command. The demo proves the CLI works. The viz shows what the CLI produces. The behavioral engine reveals what governance unlocks. One repo, one install, one truth.
