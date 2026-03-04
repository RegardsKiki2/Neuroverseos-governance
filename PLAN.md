# Implementation Plan: `derive` + `configure-ai` CLI Commands

## Architecture Summary

Add two new CLI commands that form the **optional AI layer** on top of the existing deterministic core:

- `neuroverse derive` — Takes arbitrary markdown, calls user's AI provider, outputs a valid `.nv-world.md`
- `neuroverse configure-ai` — Interactive config for AI provider credentials stored in `~/.neuroverse/config.json`

The existing deterministic commands (`init`, `bootstrap`, `validate`, `guard`) remain untouched.

---

## Step 1: Define the AI Provider Contract

**New file:** `src/contracts/derive-contract.ts`

Defines:
- `DeriveResult` — output contract (success, output path, issues, token usage)
- `DeriveExitCode` / `DERIVE_EXIT_CODES` — 0=SUCCESS, 1=FAIL, 3=ERROR
- `AIProviderConfig` — provider name, model, API key, endpoint
- `AIProviderResponse` — raw LLM response wrapper
- `DeriveOptions` — input paths, provider override, output path, dry-run flag

---

## Step 2: Create the Provider Abstraction

**New file:** `src/providers/ai-provider.ts`

A thin abstraction over HTTP-based LLM APIs. No SDK dependencies — just `fetch()`.

Supported providers:
- `openai` — `https://api.openai.com/v1/chat/completions`
- `anthropic` — `https://api.anthropic.com/v1/messages`
- `local` — user-specified endpoint (ollama, LM Studio, etc.)

Each provider implements:
```ts
interface AIProvider {
  complete(systemPrompt: string, userPrompt: string): Promise<string>;
}
```

Uses native `fetch()` (Node 18+). No new dependencies.

---

## Step 3: Create the Config Manager

**New file:** `src/providers/config-manager.ts`

Manages `~/.neuroverse/config.json`:
```json
{
  "provider": "openai",
  "model": "gpt-4.1-mini",
  "apiKey": "sk-...",
  "endpoint": null
}
```

Functions:
- `loadConfig()` — reads config from disk, returns null if missing
- `saveConfig(config)` — writes config with 0600 permissions
- `getConfigPath()` — returns `~/.neuroverse/config.json`

---

## Step 4: Create the Derive Prompt

**New file:** `src/engine/derive-prompt.ts`

Contains the system prompt that instructs the LLM to:
1. Read arbitrary markdown input files
2. Extract governance-relevant structure (thesis, invariants, rules, etc.)
3. Output a valid `.nv-world.md` file in the exact DSL format

The prompt includes the full `.nv-world.md` DSL spec as examples. The output is deterministically validated by running `parseWorldMarkdown()` on the LLM's response.

Functions:
- `buildDeriveSystemPrompt()` — returns the system prompt
- `buildDeriveUserPrompt(inputContents: string[])` — concatenates input files
- `validateDeriveOutput(output: string)` — runs `parseWorldMarkdown()` and returns issues

---

## Step 5: Create the Derive Engine

**New file:** `src/engine/derive-engine.ts`

The core derive logic (pure, testable):
1. Build prompts from input files
2. Call AI provider
3. Extract `.nv-world.md` content from response
4. Validate output with `parseWorldMarkdown()`
5. Return `DeriveResult`

```ts
export async function deriveWorld(
  inputContents: Array<{ path: string; content: string }>,
  provider: AIProvider,
  options?: { validate?: boolean }
): Promise<DeriveResult>
```

---

## Step 6: Create CLI Command — `neuroverse derive`

**New file:** `src/cli/derive.ts`

```
neuroverse derive \
  --input ./docs \
  --provider openai \
  --model gpt-4.1-mini \
  --output ./derived.nv-world.md
```

Flags:
- `--input <path>` — file, directory, or comma-separated list (required)
- `--output <path>` — output `.nv-world.md` path (default: `./derived.nv-world.md`)
- `--provider <name>` — override provider from config (`openai`, `anthropic`, `local`)
- `--model <name>` — override model from config
- `--endpoint <url>` — override endpoint (for `local` provider)
- `--validate` — run `parseWorldMarkdown()` on output and report issues
- `--dry-run` — show prompt that would be sent, don't call AI

Behavior:
1. Load config from `~/.neuroverse/config.json`
2. Override with CLI flags
3. If no provider configured, print error suggesting `neuroverse configure-ai`
4. Read all input files (glob directories for `.md` files)
5. Call derive engine
6. Write output
7. Exit with appropriate code

---

## Step 7: Create CLI Command — `neuroverse configure-ai`

**New file:** `src/cli/configure-ai.ts`

Interactive prompts via stdin:
```
neuroverse configure-ai
```

Prompts:
1. Provider? (openai / anthropic / local)
2. Model? (suggests defaults per provider)
3. API Key? (masked input, or endpoint URL for local)
4. Save to `~/.neuroverse/config.json`

Also supports non-interactive mode:
```
neuroverse configure-ai --provider openai --model gpt-4.1-mini --api-key sk-...
```

---

## Step 8: Wire Commands into Router

**Edit:** `src/cli/neuroverse.ts`

Add two new cases to the switch:
- `'derive'` → `import('./derive')`
- `'configure-ai'` → `import('./configure-ai')`

Update USAGE string to include both commands.

---

## Step 9: Export Derive Engine from Library

**Edit:** `src/index.ts`

Add exports:
- `deriveWorld` from derive engine
- Types from derive contract
- `DERIVE_EXIT_CODES`

This lets programmatic consumers use derive without the CLI.

---

## Step 10: Add Tests

**New file:** `test/derive.test.ts`

Tests:
- Derive prompt construction from various inputs
- Output validation (valid `.nv-world.md` passes, malformed fails)
- Config manager (load/save/missing)
- Provider abstraction (mock fetch)
- CLI argument parsing
- Dry-run mode (no API call)

---

## Step 11: Build, Test, Commit

1. Verify `npm run build` succeeds
2. Verify `npm test` passes (existing + new)
3. Verify `npm pack` includes new files
4. Commit and push

---

## File Summary

| Action | File |
|--------|------|
| NEW | `src/contracts/derive-contract.ts` |
| NEW | `src/providers/ai-provider.ts` |
| NEW | `src/providers/config-manager.ts` |
| NEW | `src/engine/derive-prompt.ts` |
| NEW | `src/engine/derive-engine.ts` |
| NEW | `src/cli/derive.ts` |
| NEW | `src/cli/configure-ai.ts` |
| EDIT | `src/cli/neuroverse.ts` |
| EDIT | `src/index.ts` |
| NEW | `test/derive.test.ts` |

## Key Design Decisions

1. **No new dependencies** — Uses native `fetch()` for HTTP calls. Zero npm additions.
2. **Provider abstraction is thin** — Just enough to call OpenAI/Anthropic/local. Not a framework.
3. **LLM output is validated** — `parseWorldMarkdown()` is run on every derive output. If the LLM produces invalid `.nv-world.md`, the user gets clear errors.
4. **Config uses filesystem** — `~/.neuroverse/config.json` with restrictive permissions. No cloud. No accounts.
5. **Derive is strictly separated** — Never called by `bootstrap`. The pipeline is: `derive` (optional) → `bootstrap` (deterministic) → `validate` → `guard`.
