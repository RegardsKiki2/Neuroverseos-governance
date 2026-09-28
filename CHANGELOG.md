# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Chatbot governance (`@neuroverseos/governance/chat`)** — governs a chatbot turn by turn, checking every incoming message and every outgoing reply by meaning against the creator's rulebook, with no word lists. `parseChatRulebook` reads a `.nv-world.md` chatbot rulebook: `# Invariants` (rules), `# Lenses` `>` lines (habits), `# Escalations` (hard moments as a `situation` plus `example` phrasings and a fixed `response`), and optional `# Responses` (`unavailable`, `fallback`). `governTurn` runs the turn: a meaning check for hard moments (fixed response, chatbot never called), instructions built from the rulebook, then a meaning check of every draft against every rule and habit, with a retry naming the broken rules and the creator's fallback. Fails closed: if any check or the chatbot can't run, or the judge's answer is malformed, the `unavailable` response is sent and nothing unchecked reaches the user. Every rule is meaning-checked unless explicitly marked prompt-only (`(prompt)` or `[check: prompt]`); `validateChatRulebook` warns on every prompt-only rule, and `describeEnforcement` lists how each part is enforced. Provider-agnostic (`generate` and `judge` are caller-supplied model calls) and runtime-agnostic (Node.js, Deno, browsers). Turn traces never contain the user's words.

## [0.12.0] - 2026-04-19

### Added
- **Google Workspace adapter** (`@neuroverseos/governance/radiant` — `fetchGoogleWorkspaceActivity`, `formatGoogleWorkspaceSignalsForPrompt`). Reads the leader's Gmail sent folder + primary Calendar in the window, normalizes both into `Event[]`, emits signals for email volume + unique recipients + meeting load + organized-vs-attended + total meeting minutes. Takes a Google OAuth access token (scopes: `gmail.readonly`, `calendar.readonly`). Opens the entire non-engineering-leader market — every leader has Gmail + Calendar, almost none of them have GitHub.
- **Salesforce adapter** (`fetchSalesforceActivity`, `formatSalesforceSignalsForPrompt`). Reads recent Opportunity movement, OpportunityFieldHistory (stage/amount/close-date transitions), Tasks + Calls, and Chatter FeedItems by the leader. Takes a Salesforce OAuth access token + instance URL. Emits signals for opportunities moved, stage transitions, amount changes, closed-won/lost, total pipeline represented, top-active stages. Opens the sales-leader market without requiring admin consent — individual reps/managers can authorize directly.

### Notes
- The adapter priority order (Google Workspace → Salesforce → Microsoft Teams) reflects auth friction: Google and Salesforce can be authorized by an individual user without tenant-admin consent; Teams / MS Graph typically requires enterprise admin approval for most real companies, so it ships later even though Microsoft's seat count is larger.

## [0.11.0] - 2026-04-18

### Added
- **Observe mode (`mode: 'observe'` on `evaluateGuard`)** — runs every evaluation layer identically to enforce mode, then coerces any non-ALLOW verdict to ALLOW before returning. The original status is preserved on `GuardVerdict.shadowStatus` and `shadowReason`. Nothing is blocked, paused, or modified; the caller passes the action through and reads the shadow fields to know what WOULD have happened. This is the primitive behind Bevia/Radiant's "Mirror Mode" framing: see where your team crosses what you said you lead by, without imposing enforcement.
- **`auditBehavior(event, world)` and `auditBehaviors(events, world)`** helpers (`@neuroverseos/governance`) — consume an `AuditableEvent` (loose shape covering commits, PRs, chat messages, etc.), wrap it into a synthetic `GuardEvent`, and evaluate in observe mode. Return `Crossing` records shaped for behavioral audit logs: `eventId`, `timestamp`, `shadowStatus`, `shadowReason`, `ruleId`, `excerpt`, `wouldHaveBlocked`, plus the full verdict.
- **`neuroverse audit` CLI** — observe-mode counterpart to `neuroverse guard`. Always exits 0. Supports `--multi` to evaluate a JSON array of events and `--crossings-only` to filter down to just the interesting ones. Useful for replaying past activity through a new world to preview its behavior before flipping it to enforce.
- **Radiant `GovernanceAudit.crossings`** (`@neuroverseos/governance/radiant`) — `auditGovernance` now evaluates in observe mode and emits a `crossings: Crossing[]` array alongside the existing human/cyber/joint buckets. Bevia surfaces these as "moments the team bumped against your worldmodel" in the dashboard and in `radiant_team_read` MCP responses.

### Changed
- **Internal `evaluateGuard` refactor** — the body of the public `evaluateGuard` was renamed `evaluateGuardCore` and wrapped with a thin public function that applies observe-mode transformation. No behavior change for existing callers; `evaluateGuard(event, world)` without the new `mode` option returns exactly the same verdict as before.
- **`GovernanceAudit` shape** — added `crossings` field. Non-breaking additive change; existing consumers reading only `totalEvents`, `human`, `cyber`, `joint`, or `summary` are unaffected.

## [0.10.0] - 2026-04-18

### Added
- **Linear adapter** (`@neuroverseos/governance/radiant` — `fetchLinearActivity`, `formatLinearSignalsForPrompt`) — the sixth Radiant source. Reads issues, cycles, and comments via the Linear GraphQL API and surfaces the gap between stated intent (what the team planned) and shipped outcome (what the GitHub adapter observes). Signals: issues created / completed / open / stalled, cycle completion rate, unique assignees, comment volume, top active projects. Auto-activates when `LINEAR_API_KEY` is set in the environment.
- **`--entire-org` required in the weekly workflow example** — `examples/radiant-weekly-workflow.yml` now reflects the consent-first posture: org-wide reads must opt in via `--entire-org` or Radiant narrows scope by default.

### Changed
- **Mind Palace** (was: Memory Palace) — internal terminology now matches the published package.

## [0.5.0] - 2026-04-06

### Added
- **World signing** — `neuroverse keygen`, `neuroverse sign`, `neuroverse verify` for cryptographic world artifact signing using Ed25519. SHA-256 manifest covers all files; any change invalidates the signature.
- **Schema migration** — `neuroverse migrate` detects world schema version and applies declarative migrations. Supports `--dry-run`, `--backup`, and `--target`. Ships with 1.0.0 → 1.1.0 migration.
- **Trace dashboard** — `trace.html` is a standalone HTML dashboard for visualizing governance audit logs. Drag-and-drop NDJSON, see timeline, rule frequency, blocked intents, and filterable event table. Zero dependencies.
- **Audit logging in CLI** — `neuroverse guard --log <path>` and `neuroverse run --log <path>` write JSONL audit trails for every verdict.
- **Policy golden tests** — `test/world-policy.test.ts` is a copy-and-adapt template for teams to write enforceable contract tests ("this intent must always BLOCK/ALLOW").
- **Simulation parity tests** — `test/simulation-parity.test.ts` documents and tests the architectural boundary between `simulateWorld()` and `evaluateGuard()`.

### Fixed
- **Runtime hardening** — bounded agent state map (10K max with LRU eviction) and bounded pipe buffer (1MB max) in session manager. Closes both findings from the production audit.

### Removed
- Bevia app and all internal planning/strategy documents (pricing, brainstorms, handoff specs)

## [0.2.2] - 2026-03-22

### Added
- **Behavioral governance engine** — classifies agent adaptations, detects network-level patterns (coordinated silence, misinfo suppression, reward cascades), generates prose narratives
- **Decision flow engine** — intent-to-rule-to-outcome visualization showing governance value as the gap between what agents wanted and what actually happened
- **Impact reporting** — counterfactual governance analysis from audit logs
- **Input validation** — guard engine rejects inputs exceeding 100KB, MCP server enforces 10MB buffer limit
- **World loader warnings** — corrupt JSON files now warn on stderr instead of silently returning undefined
- **CI pipeline** — GitHub Actions workflow testing Node 18/20/22, type checking, and example world validation
- **SECURITY.md** — vulnerability disclosure policy

### Fixed
- **Autoresearch adapter** — now routes through `evaluateGuard()` instead of custom evaluation logic
- **Playground XSS** — error messages escaped before DOM insertion
- **MCP server buffer overflow** — Content-Length validated, buffer size capped at 10MB
- **Playground request body limit** — POST requests capped at 1MB

### Changed
- README rewritten to teach governance as a concept before showing API
- Validation documentation updated from 9 to 12 checks (reflecting actual implementation)
- Pipeline documentation updated to show all phases including invariants, cooldown, and allowlist

## [0.2.1] - 2026-03-15

### Added
- **Incremental authoring** — `neuroverse add` command for adding rules, invariants, and guards to existing worlds
- **Deep agents adapter** — governance integration for multi-agent orchestration systems
- **Equity penalties** — PENALIZE/REWARD/NEUTRAL behavioral enforcement with per-agent state tracking
- **Decision flow visualization** — `neuroverse decision-flow` command
- **Adapter deduplication** — shared utilities extracted to `adapters/shared.ts`

## [0.2.0] - 2026-03-01

### Added
- **Plan enforcement** — compile plan markdown into enforceable constraints, track progress, verified completion mode
- **MCP server** — JSON-RPC 2.0 governance server for Claude, Cursor, Windsurf
- **Red team command** — 28 adversarial attacks across 6 categories with containment scoring
- **Playground** — interactive web UI at localhost:4242 with visual trace pipeline
- **World management** — `neuroverse world` command with status, diff, snapshot, rollback
- **AI-assisted world synthesis** — `neuroverse derive` and `neuroverse build` commands
- **OpenAI adapter** — governed tool executor for function calling
- **LangChain adapter** — callback handler with plan progress tracking
- **OpenClaw adapter** — plugin with beforeAction/afterAction hooks
- **Express adapter** — governance middleware returning 403 on BLOCK

### Changed
- Guard engine expanded to multi-phase pipeline (safety, plan, roles, guards, kernel, level)
- Validate engine expanded from 3 to 12 static analysis checks

## [0.1.0] - 2026-02-01

### Added
- **Core guard engine** — deterministic evaluation of GuardEvents against WorldDefinitions
- **Bootstrap pipeline** — compile `.nv-world.md` markdown into world JSON files
- **Validate engine** — structural completeness, referential integrity, guard coverage
- **Simulate engine** — step-by-step state evolution with assumption profiles
- **CLI** — `neuroverse init`, `bootstrap`, `validate`, `guard`, `test`, `explain`, `simulate`, `improve`
- **World loader** — load WorldDefinition from directory of JSON files
- **303 tests** across 5 test suites
- Zero runtime dependencies
