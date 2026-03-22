# Focus Room — Thinking Space Kernel

## Overview

The Focus Room is a general-purpose thinking space kernel that enforces focused, on-topic reasoning within user-defined boundaries. It is designed for single-topic exploration, advisory sessions, and structured reflection.

## What This Kernel Enforces

### Input Boundaries

| Rule | Action | Purpose |
|------|--------|---------|
| Off-topic drift | BLOCK | Prevents deviation from the declared focus topic |
| Identity override | BLOCK | Prevents attempts to override kernel identity or bypass governance |
| External tool request | BLOCK | Thinking spaces are closed environments with no external tool access |

### Output Boundaries

| Rule | Action | Purpose |
|------|--------|---------|
| Scope escape | BLOCK | Model must not offer to operate outside the defined thinking space |
| Authority claim | BLOCK | Model speaks as the world, not as itself — no meta-identity references |

## Enforcement Level

**Standard** — Both input and output boundaries are enforced. Violations produce a calm, non-punitive response from the kernel's response vocabulary.

## Runner Compatibility

This kernel is designed for the **Thinking Space Player** (browser-based). It does not require SoftShell and does not support agent execution or tool access.

## Artifact Type

This is a **compiled governance snapshot**. It was produced by the NeuroVerse governance compiler and is not intended to be modified. The enforcement logic in `enforcement.js` is standalone and zero-dependency.

## Files

| File | Purpose |
|------|---------|
| `kernel.json` | Static governance rules and boundary definitions |
| `enforcement.js` | Standalone enforcement logic — flat, zero-dependency |
| `metadata.json` | Provenance, classification, and capability declarations |
| `README.md` | This file |
