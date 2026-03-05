# NeuroVerse Governance

**Define the rules once. Run them anywhere AI operates.**

NeuroVerse turns written ideas into portable governance systems — structured rules, variables, and outcomes that both humans and AI must operate inside.

```
Idea (markdown)  →  World (JSON)  →  Enforcement (any runtime)
```

World files are not locked to NeuroVerse. They are **portable rule systems** that can govern AI anywhere — agents, business automation, games, safety layers. Any runtime that can parse JSON and evaluate conditions can enforce a world.

## Install

```bash
npm install neuroverse-governance
```

## The Workflow

```bash
neuroverse build story-notes.md        # idea in, world out
neuroverse explain inherited_silence   # understand what you built
neuroverse simulate inherited_silence  # step-by-step state evolution
neuroverse improve inherited_silence   # actionable suggestions
```

That's it. Write an idea, build a system.

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

## Commands

```
Build & Understand
  build          Turn markdown into a compiled world
  explain        Human-readable summary of a world
  simulate       Step-by-step state evolution
  improve        Prioritized suggestions for strengthening a world

Governance
  validate       Static analysis (lint for AI governance)
  guard          Runtime enforcement (action → allow/block/pause)

Authoring
  init           Scaffold a new .nv-world.md template
  derive         AI-assisted synthesis from markdown
  bootstrap      Compile .nv-world.md → world JSON
  configure-ai   Set up AI provider credentials
```

## Build: Idea → World

```bash
neuroverse build horror-notes.md
```

Input: any markdown — notes, bullet points, story outlines, policy docs.

Output:
```
World: The Inherited Silence
Theme: Suppressed trauma manifests as destructive force

Core dynamics:
  fear_intensity -> monster_violence -> danger_level

Structure:
  + Invariants (5)
  + State variables (10)
  + Rules (10)
  + Gates (5)
  + Outcomes (7)

World ready: inherited_silence
  .neuroverse/worlds/inherited_silence/
```

## Explain: Understand the System

```bash
neuroverse explain inherited_silence
```

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

## Simulate: See What Happens

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

## Improve: Actionable Suggestions

```bash
neuroverse improve inherited_silence
```

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

## Guard: Runtime Enforcement

```bash
echo '{"intent":"execute_trade","tool":"api"}' | neuroverse guard --world ./world
```

```json
{
  "status": "ALLOW",
  "evidence": {
    "worldId": "trading_governance_v1",
    "invariantsSatisfied": 5,
    "invariantsTotal": 5,
    "enforcementLevel": "standard"
  }
}
```

Every action produces `ALLOW`, `PAUSE`, or `BLOCK` with full audit evidence.

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

### Programmatic API

```typescript
import {
  evaluateGuard,
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

All engine functions are pure, deterministic, and side-effect free (except `deriveWorld` which calls an AI provider).

## AI Provider Setup

To use `neuroverse build` or `neuroverse derive`:

```bash
neuroverse configure-ai \
  --provider openai \
  --model gpt-4.1-mini \
  --api-key YOUR_API_KEY
```

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
