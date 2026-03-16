---
world_id: coding-agent
name: Coding Agent Governance
version: 1.0.0
runtime_mode: COMPLIANCE
default_profile: standard
alternative_profile: strict
---

# Thesis

Autonomous coding agents that can read files, write code, execute shell commands, and interact with version control require a governance layer. Without enforceable rules, a single misguided tool call can delete data, leak secrets, break production, or escalate beyond its intended scope. This world defines the boundaries within which a coding agent operates safely.

# Invariants

- `no_system_destruction` — Agents must never execute commands that destroy system-level resources (recursive force-delete of root paths, disk formatting, fork bombs) (structural, immutable)
- `no_secret_exposure` — Agents must never read, log, or transmit credentials, API keys, private keys, or environment secrets outside the project boundary (structural, immutable)
- `no_unauthorized_push` — Agents must never push directly to main or master branches without explicit approval (structural, immutable)
- `no_scope_escape` — Agents must never access files or execute commands outside the declared project directory (structural, immutable)
- `no_pipe_to_shell` — Agents must never pipe downloaded content directly into a shell interpreter (structural, immutable)
- `changes_must_be_reversible` — Every file modification must be recoverable through version control; destructive operations require confirmation (prompt, immutable)

# State

## files_modified
- type: number
- min: 0
- max: 100000
- step: 1
- default: 0
- label: Files Modified
- description: Total number of files written or edited in this session

## files_deleted
- type: number
- min: 0
- max: 100000
- step: 1
- default: 0
- label: Files Deleted
- description: Total number of files deleted in this session

## shell_commands_run
- type: number
- min: 0
- max: 10000
- step: 1
- default: 0
- label: Shell Commands Run
- description: Total number of shell commands executed

## dangerous_commands_blocked
- type: number
- min: 0
- max: 10000
- step: 1
- default: 0
- label: Dangerous Commands Blocked
- description: Number of shell commands blocked by governance rules

## git_pushes
- type: number
- min: 0
- max: 100
- step: 1
- default: 0
- label: Git Pushes
- description: Number of git push operations executed

## sub_agents_spawned
- type: number
- min: 0
- max: 50
- step: 1
- default: 0
- label: Sub-Agents Spawned
- description: Number of sub-agent processes created

## scope_violations
- type: number
- min: 0
- max: 1000
- step: 1
- default: 0
- label: Scope Violations
- description: Number of attempted actions outside the declared project scope

# Assumptions

## standard
- name: Standard Development
- description: Normal development workflow. File reads are unrestricted. File writes within project scope are allowed. Shell commands are evaluated for safety. Git pushes require feature branches.
- file_read_policy: unrestricted
- file_write_policy: project_scope_only
- shell_policy: safety_evaluated
- git_policy: feature_branches_only
- network_policy: restricted

## strict
- name: Strict Lockdown
- description: High-security mode. All file writes require confirmation. All shell commands require approval. No network access. No git pushes without explicit authorization.
- file_read_policy: unrestricted
- file_write_policy: approval_required
- shell_policy: approval_required
- git_policy: approval_required
- network_policy: blocked

# Rules

## rule-001: Destructive Shell Command (structural)
Shell commands that can cause irreversible system damage must be blocked unconditionally.

When shell_commands_run > 0 [state] AND dangerous_commands_blocked > 0 [state]
Then agent_safety *= 0.50

> trigger: Agent attempted a destructive shell command (rm -rf, mkfs, dd, fork bomb, etc.).
> rule: Destructive commands cannot be undone. No amount of productivity justifies risking system integrity.
> shift: Agent safety score drops. Continued violations may halt the session.
> effect: Agent safety reduced by 50%.

## rule-002: Scope Escape Attempt (structural)
Accessing files or running commands outside the project directory is a governance violation.

When scope_violations > 0 [state]
Then agent_safety *= 0.40
Collapse: agent_safety < 0.10

> trigger: Agent attempted to access resources outside its declared project scope.
> rule: Agents operate within boundaries. Scope escape indicates either a misconfigured agent or a prompt injection attempt.
> shift: Agent safety drops sharply. Multiple violations halt the session.
> effect: Agent safety reduced to 40%.

## rule-003: Excessive File Deletion (degradation)
Deleting many files in a single session indicates potentially destructive behavior.

When files_deleted > 10 [state]
Then agent_safety *= 0.60

> trigger: More than 10 files deleted in a single session.
> rule: Bulk deletion is rarely intentional in normal development. This warrants review.
> shift: Agent safety degrades. Remaining deletions may require approval.
> effect: Agent safety reduced to 60%.

## rule-004: Uncontrolled Sub-Agent Spawning (degradation)
Too many sub-agents indicate either a runaway loop or poorly scoped task decomposition.

When sub_agents_spawned > 10 [state]
Then agent_safety *= 0.70

> trigger: More than 10 sub-agents spawned in a single session.
> rule: Each sub-agent inherits the parent's capabilities. Uncontrolled spawning multiplies risk.
> shift: Agent safety degrades. Further spawning may be blocked.
> effect: Agent safety reduced to 70%.

## rule-005: Clean Session (advantage)
A session with no violations and productive output validates the governance model.

When files_modified > 0 [state] AND scope_violations == 0 [state] AND dangerous_commands_blocked == 0 [state]
Then agent_safety *= 1.10

> trigger: Agent has modified files without triggering any governance violations.
> rule: Good behavior should be recognized. Clean sessions build trust in the agent's judgment.
> shift: Agent safety improves slightly. Trust accumulates over clean sessions.
> effect: Agent safety boosted by 10%.

## rule-006: Unauthorized Push to Protected Branch (structural)
Pushing to main or master without approval violates version control governance.

When git_pushes > 0 [state] AND scope_violations > 0 [state]
Then agent_safety *= 0.30
Collapse: agent_safety < 0.10

> trigger: Agent pushed to a protected branch without authorization.
> rule: Protected branches exist for a reason. Direct pushes bypass code review and CI/CD.
> shift: Agent safety drops critically. Session may be halted.
> effect: Agent safety reduced to 30%.

# Gates

- TRUSTED: agent_safety >= 90
- OPERATING: agent_safety >= 60
- CAUTIOUS: agent_safety >= 35
- RESTRICTED: agent_safety > 10
- HALTED: agent_safety <= 10

# Outcomes

## agent_safety
- type: number
- range: 0-100
- display: percentage
- label: Agent Safety Score
- primary: true

## files_modified
- type: number
- range: 0-100000
- display: integer
- label: Files Modified

## dangerous_commands_blocked
- type: number
- range: 0-10000
- display: integer
- label: Dangerous Commands Blocked

## scope_violations
- type: number
- range: 0-1000
- display: integer
- label: Scope Violations
