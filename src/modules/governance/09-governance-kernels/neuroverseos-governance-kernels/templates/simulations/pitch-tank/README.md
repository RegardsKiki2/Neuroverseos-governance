# Pitch Tank — Simulation Governance Kernel

## Overview

The Pitch Tank is an adversarial multi-agent simulation kernel designed for pressure-testing pitches, ideas, and proposals. Multiple evaluator roles challenge a pitch from distinct perspectives. Each role maintains strict identity boundaries — no generic praise, no breaking character, no merging perspectives.

## What This Kernel Enforces

### Input Boundaries

| Rule | Action | Purpose |
|------|--------|---------|
| Skip evaluation | BLOCK | Evaluation cannot be softened or skipped |
| Override role | BLOCK | Evaluator roles are fixed for the session and cannot be overridden |
| Merge perspectives | BLOCK | Each evaluator provides an independent perspective |

### Output Boundaries

| Rule | Action | Purpose |
|------|--------|---------|
| Generic praise | BLOCK | Evaluators must provide substantive critique, not generic encouragement |
| Break character | BLOCK | Evaluators must maintain their assigned identity throughout the session |
| Cross-role speaking | BLOCK | Each evaluator speaks only for their own perspective |

## Simulation Rules

- **Multi-Agent**: Yes — multiple evaluator roles operate simultaneously
- **Role Persistence**: Session-locked — roles cannot be changed mid-session
- **Interaction Model**: Adversarial — evaluators challenge rather than validate
- **Purpose**: Pressure-testing — the goal is to find weaknesses, not confirm strengths

## Enforcement Level

**Standard** — Input and output boundaries are enforced. Role persistence is session-locked. There are no execution boundaries because this is a thinking-only simulation with no tool access.

## Runner Compatibility

This kernel is designed for the **Thinking Space Player** (browser-based). It does not require SoftShell. It supports multi-agent role simulation within a single thinking session.

## Artifact Type

This is a **compiled governance snapshot**. It was produced by the NeuroVerse governance compiler and is not intended to be modified. The enforcement logic in `enforcement.js` is standalone and zero-dependency.

## Files

| File | Purpose |
|------|---------|
| `kernel.json` | Static governance rules, boundary definitions, and simulation rules |
| `enforcement.js` | Standalone enforcement logic with role persistence validation — flat, zero-dependency |
| `metadata.json` | Provenance, classification, and capability declarations |
| `README.md` | This file |
