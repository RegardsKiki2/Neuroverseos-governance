/**
 * Derive Contract — AI-Assisted World Synthesis Types
 *
 * Defines the input/output contract for `neuroverse derive`.
 *
 * Input:  Arbitrary markdown files/directories
 * Output: .nv-world.md file constrained by DerivationWorld
 *
 * Exit codes:
 *   0 = SUCCESS          (valid file written)
 *   1 = VALIDATION_FAIL  (output failed parseWorldMarkdown)
 *   2 = INPUT_ERROR      (missing input, empty dir, unreadable)
 *   3 = PROVIDER_ERROR   (no config, API failure, timeout)
 */

// ─── Exit Codes ──────────────────────────────────────────────────────────────

export const DERIVE_EXIT_CODES = {
  SUCCESS: 0,
  VALIDATION_FAIL: 1,
  INPUT_ERROR: 2,
  PROVIDER_ERROR: 3,
} as const;

export type DeriveExitCode = (typeof DERIVE_EXIT_CODES)[keyof typeof DERIVE_EXIT_CODES];

// ─── Configure-AI Exit Codes ────────────────────────────────────────────────

export const CONFIGURE_AI_EXIT_CODES = {
  SUCCESS: 0,
  VALIDATION_FAIL: 1,
  ERROR: 3,
} as const;

export type ConfigureAiExitCode = (typeof CONFIGURE_AI_EXIT_CODES)[keyof typeof CONFIGURE_AI_EXIT_CODES];

// ─── Derive Result ──────────────────────────────────────────────────────────

export interface DeriveResult {
  success: boolean;
  outputPath: string;
  sectionsDetected: string[];
  validationErrors: number;
  validationWarnings: number;
  findings: DeriveFinding[];
  gate?: string;
  durationMs: number;
}

export interface DeriveFinding {
  severity: 'error' | 'warning';
  section: string;
  message: string;
  line?: number;
}

// ─── Source Collection ──────────────────────────────────────────────────────

export interface CollectedSource {
  filename: string;
  content: string;
}

// ─── AI Provider ────────────────────────────────────────────────────────────

export interface AIProviderConfig {
  provider: string;
  model: string;
  apiKey: string;
  endpoint: string | null;
}

export interface AIProvider {
  complete(systemPrompt: string, userPrompt: string): Promise<string>;
}
