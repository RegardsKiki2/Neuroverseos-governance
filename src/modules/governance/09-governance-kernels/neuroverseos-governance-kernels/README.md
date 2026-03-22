# NeuroVerse OS — Governance Kernels

This repository contains compiled governance artifacts for the NeuroVerse cognitive operating system.

These artifacts are static snapshots of enforcement logic. They are not source code. They cannot be executed, modified, or extended from this repository.

## Governance Layers

NeuroVerse enforces behavioral boundaries through three governance layers:

**Kernel** — The enforcement layer. Kernels define what is allowed and what is forbidden within a Thinking Space. Every Thinking Space ships with a kernel. Kernels are compiled, versioned, and auditable. They operate at the boundary between user input and model output.

**SoftShell** — The operational governance layer for agent systems. SoftShell governs local agent execution through three enforcement levels: Basic (observe), Standard (plan), and Strict (execute). It enforces a mandatory role-admission gate and requires explicit human approval for all paused actions.

**Steward** — The interpretive layer. The Steward reasons over structured kernel events and provides contextual framing. It operates in three modes: Invisible (silent), Framing (attribution), and Direct (rare intervention). The Steward cannot modify kernel enforcement or bypass safety constraints.

## What This Repository Contains

- Compiled kernel snapshots for domain-specific governance
- Static enforcement logic derived from compiled TypeScript modules
- Metadata describing each artifact's provenance and enforcement level

## What This Repository Does Not Contain

- Source code for the NeuroVerse compiler or runtime
- Editable governance templates
- Tools, scripts, or executables
- API endpoints or service configurations

## Artifact Structure

Each template folder contains:

| File | Purpose |
|---|---|
| `kernel.json` | Static governance rules — patterns, boundaries, constraints |
| `enforcement.js` | Standalone enforcement logic — flat, zero-dependency |
| `metadata.json` | Provenance, type classification, enforcement level |
| `README.md` | Human-readable description of what the kernel enforces |

## License

AGPL-3.0. See [LICENSE](./LICENSE).
