# Governance Templates

This directory contains compiled governance artifacts organized by category. Each template provides a complete set of enforcement logic for a specific domain.

## Categories

### Thinking

Kernels for browser-based thinking spaces — focused reasoning environments with no tool access or agent execution.

| Template | Domain | Enforcement | Runner |
|----------|--------|-------------|--------|
| [Focus Room](./thinking/focus-room/) | Custom | Standard | Thinking Space Player |

### Agents

Kernels for autonomous agent systems — governed execution environments requiring SoftShell and explicit human approval for destructive actions.

| Template | Domain | Enforcement | Runner |
|----------|--------|-------------|--------|
| [Safety-First Agent](./agents/safety-first-agent/) | Safety | Strict | SoftShell |
| [Privacy Guardian](./agents/privacy-guardian/) | Privacy | Strict | SoftShell |
| [Multi-Agent Coordination](./agents/multi-agent-coordination/) | Coordination | Strict | SoftShell |

### Simulations

Kernels for multi-agent simulation environments — adversarial or collaborative role-based sessions within the Thinking Space Player.

| Template | Domain | Enforcement | Runner |
|----------|--------|-------------|--------|
| [Pitch Tank](./simulations/pitch-tank/) | Pitch Tank | Standard | Thinking Space Player |

## Artifact Structure

Each template contains four files:

| File | Purpose |
|------|---------|
| `kernel.json` | Static governance rules — patterns, boundaries, constraints |
| `enforcement.js` | Standalone enforcement logic — flat, zero-dependency |
| `metadata.json` | Provenance, type classification, enforcement level |
| `README.md` | Human-readable description of what the kernel enforces |

## Important

These are compiled artifacts. They are not source code. They cannot be used to create, modify, or extend governance logic. See [GOVERNANCE_SCOPE.md](../GOVERNANCE_SCOPE.md) for boundary definitions.
