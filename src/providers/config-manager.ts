/**
 * Config Manager — AI provider configuration
 *
 * Stores provider credentials at:
 *   $XDG_CONFIG_HOME/neuroverse/config.json
 *   or ~/.neuroverse/config.json
 *
 * File permissions: 0600 (read/write owner only)
 * API keys are NEVER logged or printed.
 */

import { readFile, writeFile, mkdir, chmod } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import type { AIProviderConfig } from '../contracts/derive-contract';

// ─── Config Path ────────────────────────────────────────────────────────────

export function getConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return join(xdg, 'neuroverse');
  return join(homedir(), '.neuroverse');
}

export function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

// ─── Load ───────────────────────────────────────────────────────────────────

export async function loadConfig(): Promise<AIProviderConfig | null> {
  try {
    const raw = await readFile(getConfigPath(), 'utf-8');
    const parsed = JSON.parse(raw);

    if (!parsed.provider || !parsed.model || !parsed.apiKey) {
      return null;
    }

    return {
      provider: parsed.provider,
      model: parsed.model,
      apiKey: parsed.apiKey,
      endpoint: parsed.endpoint ?? null,
    };
  } catch {
    return null;
  }
}

// ─── Save ───────────────────────────────────────────────────────────────────

export async function saveConfig(config: AIProviderConfig): Promise<void> {
  const dir = getConfigDir();
  await mkdir(dir, { recursive: true });

  const configPath = getConfigPath();
  const content = JSON.stringify(
    {
      provider: config.provider,
      model: config.model,
      apiKey: config.apiKey,
      endpoint: config.endpoint,
    },
    null,
    2,
  );

  await writeFile(configPath, content, { mode: 0o600 });
  // Ensure permissions even if file existed
  await chmod(configPath, 0o600);
}

// ─── Redacted Dump ──────────────────────────────────────────────────────────

export function redactConfig(config: AIProviderConfig): Record<string, string | null> {
  return {
    provider: config.provider,
    model: config.model,
    apiKey: config.apiKey ? `${config.apiKey.slice(0, 4)}...${config.apiKey.slice(-4)}` : '(not set)',
    endpoint: config.endpoint,
  };
}
