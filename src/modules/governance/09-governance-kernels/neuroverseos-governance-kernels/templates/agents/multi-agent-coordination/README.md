# Multi-Agent Coordination — Agent Governance Kernel

## Overview

The Multi-Agent Coordination kernel enforces governance boundaries for systems with multiple autonomous agents operating in a shared environment. It ensures that each agent declares a role, operates strictly within its declared authority, and cannot delegate, impersonate, or bypass coordination protocols without explicit human approval.

## What This Kernel Enforces

### Input Boundaries

| Rule | Action | Purpose |
|------|--------|---------|
| Impersonate agent | BLOCK | Agents cannot impersonate or assume the identity of other agents |
| Bypass coordination | BLOCK | Coordination protocols cannot be bypassed in a multi-agent system |
| Override agent permissions | BLOCK | Agent permissions are declared at build time and cannot be modified at runtime |

### Output Boundaries

| Rule | Action | Purpose |
|------|--------|---------|
| Undeclared delegation | BLOCK | Agents cannot delegate tasks without explicit coordination permissions |
| Cross-boundary claim | BLOCK | Agents must not claim to have operated outside their declared scope |
| Coordination bypass claim | BLOCK | Agents must not discourage coordination or claim sole authority |

### Execution Boundaries (PAUSE)

| Capability Claim | Condition | Purpose |
|------------------|-----------|---------|
| `agent-trigger` | Always | Triggering actions in another agent requires human approval |
| `shared-write` | Always | Writing to shared resources requires human approval |
| `network-post` | Always | All outbound communication requires human approval |

### Coordination Rules

- **Role Admission**: Mandatory — every agent must declare a valid role via `agent.declare`
- **Communication Model**: Explicit permission matrix — agent-to-agent communication is governed by declared permissions
- **Blast Radius**: Contained per role — each agent's impact is bounded to its declared scope
- **Shared State**: Read-only unless approved — writes to shared resources require human authorization

## Enforcement Level

**Strict** — Input, output, and execution boundaries are all enforced. Role admission is mandatory. All cross-agent actions require explicit UI approval. Blast radius is contained per role.

## Runner Compatibility

This kernel requires the **SoftShell** runner. It is designed for multi-agent systems where coordination governance is critical. Each agent instance must complete a mandatory role admission handshake (`agent.declare`) before any actions are processed.

## Artifact Type

This is a **compiled governance snapshot**. It was produced by the NeuroVerse governance compiler and is not intended to be modified. The enforcement logic in `enforcement.js` is standalone and zero-dependency.

## Files

| File | Purpose |
|------|---------|
| `kernel.json` | Static governance rules, boundary definitions, coordination rules, and execution pause rules |
| `enforcement.js` | Standalone enforcement logic with role admission check — flat, zero-dependency |
| `metadata.json` | Provenance, classification, and capability declarations |
| `README.md` | This file |
