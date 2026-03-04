/**
 * CLI Harness: neuroverse configure-ai
 *
 * Configure AI provider credentials for derive command.
 *
 * Usage:
 *   neuroverse configure-ai --provider openai --model gpt-4.1-mini --api-key sk-...
 *   neuroverse configure-ai --show
 *   neuroverse configure-ai --test
 *
 * Flags:
 *   --provider <name>    Provider name (openai, local)
 *   --model <name>       Model identifier
 *   --api-key <key>      API key (never logged)
 *   --endpoint <url>     Custom endpoint URL
 *   --show               Show current config (key redacted)
 *   --test               Test connection to configured provider
 *
 * Exit codes:
 *   0 = SUCCESS
 *   1 = VALIDATION_FAIL  (bad key format, unreachable endpoint)
 *   3 = ERROR            (filesystem failure)
 */

import { CONFIGURE_AI_EXIT_CODES } from '../contracts/derive-contract';
import { loadConfig, saveConfig, redactConfig, getConfigPath } from '../providers/config-manager';
import { createProvider } from '../providers/ai-provider';
import type { AIProviderConfig } from '../contracts/derive-contract';

// ─── Argument Parsing ────────────────────────────────────────────────────────

interface CliArgs {
  provider?: string;
  model?: string;
  apiKey?: string;
  endpoint?: string;
  show: boolean;
  test: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let provider: string | undefined;
  let model: string | undefined;
  let apiKey: string | undefined;
  let endpoint: string | undefined;
  let show = false;
  let test = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--provider' && i + 1 < argv.length) {
      provider = argv[++i];
    } else if (arg === '--model' && i + 1 < argv.length) {
      model = argv[++i];
    } else if (arg === '--api-key' && i + 1 < argv.length) {
      apiKey = argv[++i];
    } else if (arg === '--endpoint' && i + 1 < argv.length) {
      endpoint = argv[++i];
    } else if (arg === '--show') {
      show = true;
    } else if (arg === '--test') {
      test = true;
    }
  }

  return { provider, model, apiKey, endpoint, show, test };
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  try {
    const args = parseArgs(argv);

    // --show: display current config
    if (args.show) {
      const config = await loadConfig();
      if (!config) {
        process.stdout.write(JSON.stringify({
          configured: false,
          configPath: getConfigPath(),
        }, null, 2) + '\n');
      } else {
        process.stdout.write(JSON.stringify({
          configured: true,
          configPath: getConfigPath(),
          ...redactConfig(config),
        }, null, 2) + '\n');
      }
      process.exit(CONFIGURE_AI_EXIT_CODES.SUCCESS);
      return;
    }

    // --test: verify connection
    if (args.test) {
      const config = await loadConfig();
      if (!config) {
        process.stderr.write(JSON.stringify({
          error: 'No configuration found. Run: neuroverse configure-ai --provider ... --model ... --api-key ...',
        }, null, 2) + '\n');
        process.exit(CONFIGURE_AI_EXIT_CODES.VALIDATION_FAIL);
        return;
      }

      try {
        const provider = createProvider(config);
        await provider.complete('You are a test. Respond with only: OK', 'Test connection.');
        process.stdout.write(JSON.stringify({
          success: true,
          message: 'Connection test passed',
          ...redactConfig(config),
        }, null, 2) + '\n');
        process.exit(CONFIGURE_AI_EXIT_CODES.SUCCESS);
      } catch (e) {
        process.stderr.write(JSON.stringify({
          success: false,
          error: `Connection test failed: ${e instanceof Error ? e.message : String(e)}`,
        }, null, 2) + '\n');
        process.exit(CONFIGURE_AI_EXIT_CODES.VALIDATION_FAIL);
      }
      return;
    }

    // Save config — require at least one field
    if (!args.provider && !args.model && !args.apiKey && !args.endpoint) {
      process.stderr.write(JSON.stringify({
        error: 'Provide at least one of: --provider, --model, --api-key, --endpoint',
        usage: 'neuroverse configure-ai --provider openai --model gpt-4.1-mini --api-key sk-...',
      }, null, 2) + '\n');
      process.exit(CONFIGURE_AI_EXIT_CODES.VALIDATION_FAIL);
      return;
    }

    // Merge with existing config
    const existing = await loadConfig();
    const config: AIProviderConfig = {
      provider: args.provider ?? existing?.provider ?? 'openai',
      model: args.model ?? existing?.model ?? '',
      apiKey: args.apiKey ?? existing?.apiKey ?? '',
      endpoint: args.endpoint ?? existing?.endpoint ?? null,
    };

    if (!config.model) {
      process.stderr.write(JSON.stringify({
        error: 'Model is required. Use --model <name>',
      }, null, 2) + '\n');
      process.exit(CONFIGURE_AI_EXIT_CODES.VALIDATION_FAIL);
      return;
    }

    if (!config.apiKey) {
      process.stderr.write(JSON.stringify({
        error: 'API key is required. Use --api-key <key>',
      }, null, 2) + '\n');
      process.exit(CONFIGURE_AI_EXIT_CODES.VALIDATION_FAIL);
      return;
    }

    await saveConfig(config);

    process.stdout.write(JSON.stringify({
      success: true,
      configPath: getConfigPath(),
      ...redactConfig(config),
    }, null, 2) + '\n');
    process.exit(CONFIGURE_AI_EXIT_CODES.SUCCESS);
  } catch (e) {
    process.stderr.write(JSON.stringify({
      error: 'Configuration failed',
      detail: e instanceof Error ? e.message : String(e),
    }, null, 2) + '\n');
    process.exit(CONFIGURE_AI_EXIT_CODES.ERROR);
  }
}
