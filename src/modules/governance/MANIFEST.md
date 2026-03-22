# for-governance/ — Extraction Manifest

These 10 items from neuroverse-os are **genuinely new capabilities** that the
governance repo (`neuroverse-governance`) doesn't have yet. Everything else in
neuroverse-os was either already extracted into the governance repo or is
browser/UI-specific.

## What's here

| # | Folder | Source | What it adds |
|---|--------|--------|--------------|
| 1 | `01-contradictions/` | `packages/runtime/src/contradictions.ts` | World definition contradiction detection. Governance repo's `validate-engine.ts` doesn't do this. |
| 2 | `02-completeness/` | `packages/runtime/src/completeness.ts` | World definition completeness checking. Same gap. |
| 3 | `03-zip-loader/` | `packages/neuroverse-evaluator/src/` | `.nv-world.zip` archive loader. Governance repo only loads from directories or markdown. |
| 4 | `04-enforcement/` | `packages/compiler/src/enforcement/` | Enforcement registry — rule priority and conflict resolution logic. |
| 5 | `05-composition/` | `src/world-engine/CompositionEngine.ts` + `composition/` | Multi-world composition. Governance repo can't combine worlds. |
| 6 | `06-simulation-compiler/` | `src/simulator/compiler/` | Multi-language guard code generation (TS, JS, Python). Governance repo only outputs JSON. |
| 7 | `07-prebaked-kernels/` | `src/simulator/templates/` | Prebaked kernel configurations. Convert to `.nv-world.md` for worlds collection. |
| 8 | `08-expansion-patterns/` | `src/simulator/patterns/` | Rule expansion patterns — shorthand rules that expand into detailed specs. Could enhance `neuroverse init-world`. |
| 9 | `09-governance-kernels/` | `neuroverseos-governance-kernels/` | Reference implementations of the three-layer governance model (Kernel/SoftShell/Steward). Includes `kernel.json`, `enforcement.js`, and templates. |
| 10 | `10-drift-monitor/` | `openclaw-plugin/drift-monitor.ts` | Config drift detection. Rest of openclaw-plugin was already ported. |

## What was skipped (and why)

- **`packages/governance/`** — the governance repo IS this, evolved
- **`packages/runtime/`** (except contradictions + completeness) — already in governance repo as `guard-engine`, `simulate-engine`, `session`, etc.
- **`src/world-engine/`** (except CompositionEngine) — already extracted as `guard-engine`, `simulate-engine`, `bootstrap-parser`, `validate-engine`, etc.
- **`src/simulator/`** (except compiler, templates, patterns) — UI builder flow, not engine
- **`src/components/governance/`** — React UI snapshot button, not relevant to headless engine
- **`src/experience-space/`** — Spaces product UI (17 React components)
- **`openclaw-plugin/`** (except drift-monitor) — already ported (governance repo's `condition-engine.ts` header says "Ported from the OpenClaw governance plugin")
- **All app chrome** (`kernel/`, `components/`, `db/`, `auth/`, etc.)

## Integration notes

- Items 1-2 (contradictions, completeness) → extend `validate-engine.ts`
- Item 3 (zip loader) → new loader alongside existing directory/markdown loaders
- Item 4 (enforcement) → new module, may require architectural decisions
- Item 5 (composition) → new capability, standalone module
- Item 6 (simulation compiler) → extend `bootstrap-emitter.ts` or new emitter
- Items 7-8 (kernels, patterns) → content/templates, low-risk additions
- Item 9 (governance kernels) → reference templates for the worlds collection
- Item 10 (drift monitor) → standalone utility module
