# Audit 3 — Visualization (Visual Interface Audit)

**Prompt:** "Build a visual interface that shows governance decisions in real time."

**Date:** 2026-03-22

---

## Build Attempt

### Steps Taken
1. Read README visualization sections
2. Searched for all visualization-related code
3. Inspected `src/viz/` directory (React components)
4. Inspected `simulate.html` (standalone browser app)
5. Inspected `src/cli/playground.ts` (inline HTML server)
6. Inspected `src/cli/demo.ts` (API server + React app)
7. Inspected `src/cli/decision-flow.ts` (CLI text output)
8. Inspected `src/browser.ts` (browser bundle)
9. Checked `vite.config.ts` (build config)
10. Checked for orphaned visual code

### Assumptions Made
- "Build a visual interface" means: find the existing visual systems, understand their architecture, extend or connect them
- Each visual system should use the real engine, not duplicated logic

---

## Breakpoints

### 1. Three Separate Visualization Entry Points
A developer trying to build a visual interface encounters three different starting points with no guidance on which to use:

| Entry Point | Command | Port | Technology |
|-------------|---------|------|------------|
| Playground | `neuroverse playground` | 4242 | Inline HTML/CSS/JS |
| Demo | `neuroverse demo` | 3456 | React + Vite + SSE |
| Simulate | Open `simulate.html` | N/A | Standalone HTML + browser.global.js |

**Confusion:** Which one should I extend? The README mentions `playground` but not `demo`. The `demo` command is more capable but less documented.

### 2. Decision Flow Has No Visual Rendering
The README promises "Decision Flow Visualization" but `generateDecisionFlow()` only produces:
- ASCII text output (via `renderDecisionFlow`)
- JSON data structure (for custom visualization)
- **No actual visual rendering** in any web UI

### 3. `Demo.tsx` Component Appears Orphaned
- `src/viz/Demo.tsx` exists (170 lines) but is not imported by `src/viz/app.tsx`
- Appears to be legacy code with similar UI patterns to app.tsx
- A developer would find this file and be confused about its role

### 4. Behavioral CLI Command Not Routed
- `src/cli/behavioral.ts` exists but is not wired into the CLI router in `neuroverse.ts`
- Behavioral analysis IS available via `/api/v1/behavioral` HTTP endpoint in demo server
- But running `neuroverse behavioral` would fail or route unexpectedly

---

## Drift Detection

### README vs Reality

| README Promise | Reality | Status |
|----------------|---------|--------|
| `neuroverse playground` opens web UI | YES — inline HTML at localhost:4242 | MATCH |
| 14 preset attack buttons | YES — in playground.ts | MATCH |
| Decision Flow Visualization section | Data structure only, no visual rendering | PARTIAL MISMATCH |
| `generateDecisionFlow` exported | YES — but only produces data, not visuals | MATCH (export) / MISMATCH (implied visual) |

### Architecture Issues

**Fragmentation Score: 3/5 (Moderately Fragmented)**

#### What Each System Does

**Playground** (port 4242):
- Single-page form with text input
- 14 preset attack buttons
- Multi-phase pipeline trace visualization
- Color-coded verdict badges
- NO simulation, NO rules editor, NO flow visualization

**Demo** (port 3456):
- Full "Governance Observation Deck" React app
- Policy editor with rule presets
- Canvas-based particle flow visualization (`GovernanceFlowViz.tsx`)
- SSE event streaming
- Simulation control (agents slider, steps slider)
- Three view modes: Visual, Split, Feed
- `/api/v1/evaluate`, `/api/v1/simulate`, `/api/v1/behavioral`, `/api/v1/events`

**Simulate.html** (standalone):
- State evolution simulation
- SVG progress ring (viability score)
- Step-by-step animation
- State configuration sliders
- Uses `dist/browser.global.js` (real `simulateWorld()`)
- NO HTTP calls, pure browser execution

**Decision Flow** (CLI only):
- ASCII text output
- Intent clusters → Rule obstacles → Outcome clusters
- Behavioral economy metrics
- NO web visualization

### Engine Logic Duplication
- **Playground**: Calls `evaluateGuard()` directly via HTTP — CLEAN
- **Demo**: Calls `evaluateGuard()` via `govern()` wrapper — CLEAN
- **Simulate.html**: Calls `simulateWorld()` via browser bundle — CLEAN (uses real engine)
- **Decision Flow**: Reads audit logs, no live evaluation — CLEAN

**No engine logic duplication in any visual system.** All use the real engine.

### HTML/CSS Duplication
- Playground and simulate.html have ~1,400 combined lines of inline HTML/CSS/JS
- Similar UI patterns (styled cards, status badges, trace details)
- Independent implementations — no code sharing
- **Moderate duplication** in presentation layer

---

## Fix Recommendations

### File: `src/viz/Demo.tsx`
**Action:** Delete or integrate. If legacy, remove to prevent confusion.

### File: `src/cli/neuroverse.ts`
**Action:** Verify `behavioral` command routing. If `src/cli/behavioral.ts` exists, wire it into the switch statement or delete it.

### File: `README.md` (lines 481-498)
**Action:** Clarify that "Decision Flow Visualization" produces data structures and ASCII text, not a web-based visual. Or add visual rendering to the demo app.

### File: `README.md`
**Action:** Document the `demo` command alongside `playground`. Developers should know both exist and when to use each:
- `playground` — lightweight, single-action trace debugging
- `demo` — full observation deck with simulation, policy editing, flow visualization

### File: `simulate.html`
**Action:** Consider integrating into the demo app as a tab/route rather than maintaining as a standalone file. This reduces fragmentation.

---

## Verdict

**PARTIAL PASS** — No engine logic duplication in visual systems (good). But the visualization layer is fragmented across 3-4 independent implementations with no unified entry point. A developer trying to "build a visual interface" would be confused by the multiple starting points and the gap between the decision-flow data structure and actual visual rendering.

**Key gap:** The decision-flow visualization exists as data but has no visual rendering in any web UI. This is the most impactful missing piece for a governance observation dashboard.
