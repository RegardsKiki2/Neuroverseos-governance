# Privacy Guardian — Agent Governance Kernel

## Overview

The Privacy Guardian kernel enforces data privacy boundaries for autonomous agent execution. It prevents agents from accessing, transmitting, or storing personally identifiable information (PII) or sensitive data without explicit human authorization. The agent operates under fail-closed semantics with strict enforcement.

## What This Kernel Enforces

### Input Boundaries

| Rule | Action | Purpose |
|------|--------|---------|
| PII request | BLOCK | Direct requests for personally identifiable information are forbidden |
| Bulk data export | BLOCK | Bulk data extraction requests are forbidden without explicit authorization |
| Disable privacy | BLOCK | Privacy enforcement cannot be disabled during an active session |

### Output Boundaries

| Rule | Action | Purpose |
|------|--------|---------|
| PII disclosure | BLOCK | Agent must not disclose personally identifiable information in responses |
| Data retention claim | BLOCK | Agent must not claim to retain or store user data |
| Privacy dismissal | BLOCK | Agent must never minimize the importance of data privacy |

### Execution Boundaries (PAUSE)

| Capability Claim | Condition | Purpose |
|------------------|-----------|---------|
| `data-read` | Contains PII | Reading data that may contain PII requires human approval |
| `network-post` | Always | All outbound data transmission requires human approval |
| `file-write` | Always | All data persistence actions require human approval |

## Enforcement Level

**Strict** — Input, output, and execution boundaries are all enforced. All paused actions must be resolved via explicit UI interaction. No data leaves the agent boundary without human authorization.

## Runner Compatibility

This kernel requires the **SoftShell** runner. It is designed for agent systems operating in data-sensitive environments. The agent must complete a mandatory role admission handshake (`agent.declare`) before any actions are processed.

## Artifact Type

This is a **compiled governance snapshot**. It was produced by the NeuroVerse governance compiler and is not intended to be modified. The enforcement logic in `enforcement.js` is standalone and zero-dependency.

## Files

| File | Purpose |
|------|---------|
| `kernel.json` | Static governance rules, boundary definitions, and execution pause rules |
| `enforcement.js` | Standalone enforcement logic — flat, zero-dependency |
| `metadata.json` | Provenance, classification, and capability declarations |
| `README.md` | This file |
