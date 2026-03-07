/**
 * neuroverse doctor — Environment sanity check
 *
 * Verifies the NeuroVerse environment is correctly configured:
 *   - Node.js version
 *   - Package version
 *   - AI provider configuration
 *   - World file detection
 *   - Engine availability
 *   - Adapter availability
 *
 * Usage:
 *   neuroverse doctor
 *   neuroverse doctor --world ./world/
 *   neuroverse doctor --json
 *
 * Exit codes:
 *   0 = all checks pass
 *   1 = one or more checks failed
 */

import { loadConfig } from '../providers/config-manager';

interface DoctorCheck {
  label: string;
  status: 'pass' | 'fail' | 'warn';
  value: string;
  detail?: string;
}

const PACKAGE_VERSION = '0.2.0';
const MIN_NODE_VERSION = 18;

export async function main(argv: string[]): Promise<void> {
  const json = argv.includes('--json');
  let worldPath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--world' && i + 1 < argv.length) {
      worldPath = argv[++i];
    }
  }

  const checks: DoctorCheck[] = [];

  // 1. Node version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1), 10);
  checks.push({
    label: 'Node version',
    status: major >= MIN_NODE_VERSION ? 'pass' : 'fail',
    value: nodeVersion,
    detail: major < MIN_NODE_VERSION ? `Requires Node >= ${MIN_NODE_VERSION}` : undefined,
  });

  // 2. NeuroVerse version
  checks.push({
    label: 'NeuroVerse version',
    status: 'pass',
    value: PACKAGE_VERSION,
  });

  // 3. AI provider configured
  try {
    const config = await loadConfig();
    if (config?.provider && config?.apiKey) {
      checks.push({
        label: 'AI provider configured',
        status: 'pass',
        value: `${config.provider}${config.model ? ` (${config.model})` : ''}`,
      });
    } else {
      checks.push({
        label: 'AI provider configured',
        status: 'warn',
        value: 'not configured',
        detail: 'Run: neuroverse configure-ai --provider openai --model gpt-4.1-mini --api-key <key>',
      });
    }
  } catch {
    checks.push({
      label: 'AI provider configured',
      status: 'warn',
      value: 'not configured',
      detail: 'Run: neuroverse configure-ai',
    });
  }

  // 4. World file detection
  if (worldPath) {
    try {
      const { existsSync } = await import('fs');
      const { join } = await import('path');
      const hasWorld = existsSync(join(worldPath, 'world.json'));
      checks.push({
        label: 'World file detected',
        status: hasWorld ? 'pass' : 'fail',
        value: hasWorld ? worldPath : 'not found',
        detail: hasWorld ? undefined : `No world.json found in ${worldPath}`,
      });
    } catch {
      checks.push({
        label: 'World file detected',
        status: 'fail',
        value: 'error reading path',
      });
    }
  } else {
    // Try common locations
    const { existsSync } = await import('fs');
    const { join } = await import('path');
    const candidates = ['./world', './.neuroverse', './worlds'];
    let found: string | undefined;
    for (const dir of candidates) {
      if (existsSync(join(dir, 'world.json'))) {
        found = dir;
        break;
      }
    }
    checks.push({
      label: 'World file detected',
      status: found ? 'pass' : 'warn',
      value: found ?? 'none found',
      detail: found ? undefined : 'Build a world: neuroverse build <input.md>',
    });
  }

  // 5. Guard engine
  try {
    const { evaluateGuard } = await import('../engine/guard-engine');
    checks.push({
      label: 'Guard engine',
      status: typeof evaluateGuard === 'function' ? 'pass' : 'fail',
      value: 'loaded',
    });
  } catch {
    checks.push({ label: 'Guard engine', status: 'fail', value: 'failed to load' });
  }

  // 6. Validation engine
  try {
    const { validateWorld } = await import('../engine/validate-engine');
    checks.push({
      label: 'Validation engine',
      status: typeof validateWorld === 'function' ? 'pass' : 'fail',
      value: 'loaded',
    });
  } catch {
    checks.push({ label: 'Validation engine', status: 'fail', value: 'failed to load' });
  }

  // 7. Adapters
  const adapterNames = ['openai', 'express', 'langchain', 'openclaw'];
  const loadedAdapters: string[] = [];
  for (const name of adapterNames) {
    try {
      await import(`../adapters/${name}`);
      loadedAdapters.push(name);
    } catch {
      // Adapter not available — optional dependency
    }
  }
  checks.push({
    label: 'Adapters',
    status: loadedAdapters.length > 0 ? 'pass' : 'warn',
    value: loadedAdapters.length > 0 ? loadedAdapters.join(', ') : 'none',
  });

  // Output
  if (json) {
    const hasFailure = checks.some(c => c.status === 'fail');
    process.stdout.write(JSON.stringify({
      status: hasFailure ? 'fail' : 'pass',
      checks,
    }, null, 2) + '\n');
    process.exit(hasFailure ? 1 : 0);
    return;
  }

  // Human output
  process.stderr.write('\nNeuroVerse Environment Check\n');
  process.stderr.write('────────────────────────────\n');

  const maxLabel = Math.max(...checks.map(c => c.label.length));

  for (const check of checks) {
    const icon = check.status === 'pass' ? 'ok' : check.status === 'warn' ? '!!' : 'FAIL';
    const pad = ' '.repeat(maxLabel - check.label.length);
    process.stderr.write(`  ${check.label}${pad}  ${icon}  ${check.value}\n`);
    if (check.detail) {
      process.stderr.write(`  ${' '.repeat(maxLabel)}      ${check.detail}\n`);
    }
  }

  const hasFailure = checks.some(c => c.status === 'fail');
  process.stderr.write('\n');
  if (hasFailure) {
    process.stderr.write('Some checks failed. Fix the issues above and re-run.\n');
  } else {
    process.stderr.write('System ready.\n');
  }
  process.stderr.write('\n');

  process.exit(hasFailure ? 1 : 0);
}
