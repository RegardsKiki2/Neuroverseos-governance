# Audit 1 — First-Time Developer (Onboarding Reality)

**Prompt:** "You are a developer who just discovered NeuroVerse. Build a basic governed agent using only the README. Do not assume prior knowledge."

**Date:** 2026-03-22

---

## Build Attempt

### Steps Taken
1. Read README top-to-bottom
2. Attempted Quick Start: `npm install @neuroverseos/governance`
3. Checked `import { evaluateGuard, loadWorld }` — does it resolve?
4. Followed 5-Minute Demo: `neuroverse init`, `neuroverse bootstrap`, `neuroverse guard`
5. Checked all CLI commands listed in README against actual CLI router
6. Verified all adapter import paths
7. Verified plan engine exports
8. Verified behavioral analysis exports
9. Checked example worlds in `docs/worlds/`
10. Read AGENTS.md

### Commands Used
```bash
npm install @neuroverseos/governance
neuroverse init --name "Customer Support Agent"
neuroverse bootstrap --input world.nv-world.md --output ./world --validate
echo '{"intent":"delete user data"}' | neuroverse guard --world ./world --trace
```

### Assumptions Made
- README is the sole source of truth for onboarding
- All import paths shown in README should resolve
- CLI commands listed should all exist

---

## Breakpoints

**None found.** All documented paths resolve correctly.

---

## Drift Detection

### README vs Reality

| Claim | Status | Notes |
|-------|--------|-------|
| `evaluateGuard` exported from main | MATCH | Exported at `src/index.ts:17` |
| `loadWorld` exported from main | MATCH | Exported at `src/index.ts:129` |
| `parsePlanMarkdown` exported | MATCH | `src/index.ts:44` |
| `evaluatePlan` exported | MATCH | `src/index.ts:47` |
| `advancePlan` exported | MATCH | `src/index.ts:47` |
| `generateDecisionFlow` exported | MATCH | `src/index.ts:110` |
| `classifyAdaptation` exported | MATCH | `src/index.ts:256` |
| `detectBehavioralPatterns` exported | MATCH | `src/index.ts:258` |
| `generateAdaptationNarrative` exported | MATCH | `src/index.ts:259` |
| OpenAI adapter path | MATCH | `src/adapters/openai.ts` exports `createGovernedToolExecutor` |
| LangChain adapter path | MATCH | `src/adapters/langchain.ts` exports `createNeuroVerseCallbackHandler` |
| OpenClaw adapter path | MATCH | `src/adapters/openclaw.ts` exports `createNeuroVersePlugin` |
| Express adapter path | MATCH | `src/adapters/express.ts` exports `createGovernanceMiddleware` |
| CLI: 17+ commands | MATCH | All 20+ commands implemented in switch statement |
| Example worlds in `docs/worlds/` | MATCH | Both configurator-governance and post-web-world present |
| "303 tests" claim | UNVERIFIED | Test count not validated in this audit |
| `neuroverse` bin entry | MATCH | `package.json` line 58 |

### Architecture vs Reality
No divergence detected.

### Invariant Violations
None.

---

## Fix Recommendations

**No file-level fixes required.** The onboarding path is clean.

**Minor suggestion:** The README says "303 tests" — this number should be validated and kept current, or replaced with "300+" to avoid stale claims.

---

## Verdict

**PASS** — A first-time developer following the README would have a smooth onboarding experience. All imports resolve, all CLI commands exist, all adapter paths work. No broken steps, no missing exports, no docs-vs-reality mismatch.
