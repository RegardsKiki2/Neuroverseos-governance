# NeuroVerse Guard for n8n

Stop AI automations before they do something stupid.

The NeuroVerse Guard node evaluates an agent's intent against your governance rules and routes the workflow based on the result.

**Outputs:**
- **ALLOW** — continue execution
- **BLOCK** — stop the action
- **PAUSE** — require human approval

Deterministic. Sub-millisecond. No LLM calls. Full audit trail.

## Installation

In n8n, go to **Settings → Community Nodes** and install:

```
n8n-nodes-neuroverse
```

Or install via CLI:

```bash
cd ~/.n8n
npm install n8n-nodes-neuroverse
```

## How It Works

The NeuroVerse Guard evaluates every action against your governance world — a portable set of rules, invariants, guards, and roles defined in a `.nv-world.zip` file.

```typescript
import { loadWorld, evaluateGuard } from '@neuroverseos/governance';

const world = await loadWorld('./policy.nv-world.zip');
const verdict = evaluateGuard({ intent: 'Delete user account', tool: 'admin-api' }, world);
// verdict.status → 'ALLOW' | 'BLOCK' | 'PAUSE'
```

Three functions. No network. No LLM. Deterministic.

## Node Configuration

| Field | Description |
|-------|-------------|
| **World Source** | Load from a file path or base64-encoded zip |
| **World File Path** | Path to your `.nv-world.zip` or extracted directory |
| **World File (Base64)** | Base64-encoded zip — useful in Docker/cloud environments |
| **Intent** | What the agent is trying to do |
| **Tool** | Which tool/API the agent is calling (optional) |
| **Enforcement Level** | Basic, Standard, or Strict |

### Outputs

The node has three separate output connections on the canvas:

| Output | When | Contains |
|--------|------|----------|
| **ALLOW** | Action is permitted | Original data + verdict |
| **BLOCK** | Action violates rules | Original data + verdict.reason + verdict.evidence |
| **PAUSE** | Action needs human review | Original data + verdict.reason + verdict.evidence |

Wire each output to different downstream nodes to handle each case visually.

## Example Workflow

Import `example-workflow.json` from this repo to see a complete governance flow:

```
Webhook Trigger → Simulate Agent Action → NeuroVerse Guard
                                              ↓    ↓    ↓
                                           ALLOW BLOCK PAUSE
                                              ↓    ↓    ↓
                                           Execute Log  Request
                                           Action  +    Approval
                                                  Alert
```

The example accepts a POST request with `intent` and `tool`, runs it through the guard, and returns the appropriate response (200 for ALLOW, 403 for BLOCK, 202 for PAUSE).

## Building Your World File

A world file contains your governance rules: invariants that must always hold, guards that intercept specific actions, roles with permissions, and kernel rules for system-level constraints.

**[Build your world file free at neuroverseos.com](https://neuroverseos.com)** — upload your docs or start from a template.

## Verdict Object

Every output includes a `verdict` object:

```json
{
  "verdict": {
    "status": "BLOCK",
    "reason": "Action violates invariant: margin_floor_15_percent",
    "ruleId": "guard-pricing-change",
    "evidence": {
      "matchedGuard": "pricing-change-guard",
      "invariantRef": "margin_floor_15_percent",
      "evaluationChain": ["safety", "roles", "guards", "kernel", "level"]
    }
  }
}
```

## License

Apache-2.0
