# Safety-First Agent — Agent Governance Kernel

## Overview

The Safety-First Agent kernel enforces strict governance over autonomous agent execution. Every destructive or irreversible action requires explicit human approval via the SoftShell UI. The agent operates under fail-closed semantics — if governance is unavailable, all operations are blocked.

## What This Kernel Enforces

### Input Boundaries

| Rule | Action | Purpose |
|------|--------|---------|
| Bypass approval | BLOCK | Human approval for destructive actions cannot be bypassed |
| Elevate permissions | BLOCK | Agents cannot self-elevate beyond their declared authority |
| Disable governance | BLOCK | Governance cannot be disabled during an active session |

### Output Boundaries

| Rule | Action | Purpose |
|------|--------|---------|
| Unauthorized execution | BLOCK | Agent must not claim to have executed actions without approval |
| Authority overreach | BLOCK | Agent must not claim authority beyond its declared scope |
| Approval dismissal | BLOCK | Agent must never discourage human oversight |

### Execution Boundaries (PAUSE)

| Capability Claim | Condition | Purpose |
|------------------|-----------|---------|
| `file-write` | Always | All file writes require human approval |
| `file-delete` | Always | All file deletions require human approval |
| `network-post` | Always | All outbound network requests require human approval |

## Enforcement Level

**Strict** — Input, output, and execution boundaries are all enforced. All paused actions must be resolved via explicit UI interaction. There is no terminal, keyboard, or automated mechanism for approving execution.

## Runner Compatibility

This kernel requires the **SoftShell** runner. It is designed for agent systems and supports tool access and agent execution. The agent must complete a mandatory role admission handshake (`agent.declare`) before any actions are processed.

## Artifact Type

This is a **compiled governance snapshot**. It was produced by the NeuroVerse governance compiler and is not intended to be modified. The enforcement logic in `enforcement.js` is standalone and zero-dependency.

## Files

| File | Purpose |
|------|---------|
| `kernel.json` | Static governance rules, boundary definitions, and execution pause rules |
| `enforcement.js` | Standalone enforcement logic — flat, zero-dependency |
| `metadata.json` | Provenance, classification, and capability declarations |
| `README.md` | This file |
