# Governance Scope

This document defines the boundary of what this repository contains and what it does not.

## In Scope

This repository publishes compiled governance artifacts. These artifacts represent static snapshots of enforcement logic that has been compiled from source modules. They describe:

- Input boundary rules (what user inputs are forbidden)
- Output boundary rules (what model outputs are forbidden)
- Domain-specific constraint patterns
- Enforcement metadata and provenance

## Out of Scope

This repository does not contain, reference, or enable:

- The NeuroVerse compiler
- The NeuroVerse runtime or any runner
- Any mechanism for creating, modifying, or extending governance artifacts
- API endpoints, webhooks, or service integrations
- Authentication, authorization, or session management
- Database schemas or storage configurations

## Governance Layers Referenced

Two governance layers beyond the Kernel are referenced in documentation for descriptive purposes only:

**SoftShell** — The operational governance layer for local agent execution. SoftShell enforces role-admission gates, enforcement levels, and human-approval invariants for agent actions.

**Steward** — The interpretive intelligence layer that reasons over kernel events. The Steward provides contextual framing without modifying enforcement logic.

Neither SoftShell nor the Steward is distributed, configured, or operable from this repository.

## Boundary Statement

These artifacts are the output of a compilation process. The compilation process itself is not distributed. No artifact in this repository can be used to derive, reconstruct, or approximate the compiler, the runtime, or the enforcement engine.
