#!/usr/bin/env node
/**
 * neuroverse — CLI Governance Tool
 *
 * Unified entrypoint that routes to subcommands.
 *
 * Usage:
 *   neuroverse init                    Scaffold a new .nv-world.md template
 *   neuroverse bootstrap               Compile .nv-world.md → world JSON files
 *   neuroverse validate                 Static analysis on world files
 *   neuroverse guard                    Runtime governance evaluation
 *
 * Run any command with --help for usage details.
 */

const USAGE = `
neuroverse — CLI Governance Tool

Commands:
  init        Scaffold a new .nv-world.md template
  bootstrap   Compile .nv-world.md → world JSON files
  validate    Static analysis on world files
  guard       Runtime governance evaluation (stdin → stdout)

Usage:
  neuroverse init [--name "World Name"] [--output path]
  neuroverse bootstrap --input <.md> --output <dir> [--validate]
  neuroverse validate --world <dir> [--format full|summary|findings]
  neuroverse guard --world <dir> [--trace] [--level basic|standard|strict]

Examples:
  neuroverse init --name "Customer Service Governance"
  neuroverse bootstrap --input ./world.nv-world.md --output ./world/ --validate
  neuroverse validate --world ./world/ --format summary
  echo '{"intent":"delete user data"}' | neuroverse guard --world ./world/ --trace
`.trim();

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const subArgs = args.slice(1);

  switch (command) {
    case 'init': {
      const { main: initMain } = await import('./init');
      return initMain(subArgs);
    }
    case 'bootstrap': {
      const { main: bootstrapMain } = await import('./bootstrap');
      return bootstrapMain(subArgs);
    }
    case 'validate': {
      const { main: validateMain } = await import('./validate');
      return validateMain(subArgs);
    }
    case 'guard': {
      const { main: guardMain } = await import('./guard');
      return guardMain(subArgs);
    }
    case '--help':
    case '-h':
    case 'help':
    case undefined: {
      process.stdout.write(USAGE + '\n');
      process.exit(0);
      break;
    }
    default: {
      process.stderr.write(`Unknown command: "${command}"\n\n`);
      process.stdout.write(USAGE + '\n');
      process.exit(1);
    }
  }
}

main().catch(e => {
  process.stderr.write(`Fatal: ${e}\n`);
  process.exit(3);
});
