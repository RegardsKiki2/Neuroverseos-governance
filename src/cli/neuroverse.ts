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
neuroverse — Turn ideas into worlds.

Commands:
  build          Build a world from markdown (derive + compile in one step)
  explain        Human-readable summary of a compiled world
  simulate       Step-by-step state evolution
  improve        Actionable suggestions for strengthening a world
  init           Scaffold a new .nv-world.md template
  init-world     Generate a governed world from a template (e.g., autoresearch)
  infer-world    Scan a repo and infer a governance world from its structure
  validate       Static analysis on world files
  guard          Runtime governance evaluation (stdin → stdout)
  test           Run guard simulation suite against a world
  redteam        Adversarial containment testing (agent escape detection)
  doctor         Environment sanity check
  playground     Interactive web demo (opens in browser)
  plan           Plan enforcement (compile, check, status, advance, derive)
  run            Governed runtime (pipe mode or interactive chat)
  mcp            MCP governance server (for Claude, Cursor, etc.)
  worlds         List available worlds (alias for world list)
  trace          Runtime action audit log
  impact         Counterfactual governance impact report
  decision-flow  Intent → Rule → Outcome visualization (behavioral governance)
  equity-penalties  Fortune 500 equity PENALIZE/REWARD simulation
  world          World management (status, diff, snapshot, rollback)
  derive         AI-assisted synthesis of .nv-world.md from markdown
  bootstrap      Compile .nv-world.md → world JSON files
  configure-ai   Configure AI provider credentials

Usage:
  neuroverse build <input.md> [--output <dir>]
  neuroverse explain <world-path-or-id> [--json]
  neuroverse simulate <world-path-or-id> [--steps N] [--set key=value] [--profile name]
  neuroverse improve <world-path-or-id> [--json]
  neuroverse init [--name "World Name"] [--output path]
  neuroverse init-world autoresearch [--context "topic"] [--dataset "name"] [--goal "goal"]
  neuroverse infer-world ./repo [--output path] [--json] [--dry-run]
  neuroverse validate --world <dir> [--format full|summary|findings]
  neuroverse guard --world <dir> [--trace] [--level basic|standard|strict]
  neuroverse test --world <dir> [--fuzz] [--count N]
  neuroverse redteam --world <dir> [--level basic|standard|strict]
  neuroverse doctor [--world <dir>] [--json]
  neuroverse playground --world <dir> [--port 4242]
  neuroverse trace [--log <path>] [--summary] [--filter BLOCK] [--last 20]
  neuroverse impact [--log <path>] [--json]
  neuroverse world status <path>
  neuroverse world diff <path1> <path2>
  neuroverse world snapshot <path>
  neuroverse world rollback <path>
  neuroverse derive --input <path> [--output <path>] [--dry-run]
  neuroverse bootstrap --input <.md> --output <dir> [--validate]
  neuroverse decision-flow [--log <path>] [--json]
  neuroverse equity-penalties --world <dir> [--agents N] [--rounds N] [--json]
  neuroverse configure-ai --provider <name> --model <name> --api-key <key>

Examples:
  neuroverse build horror-notes.md
  neuroverse explain inherited_silence
  neuroverse simulate inherited_silence --steps 5
  neuroverse improve inherited_silence
  neuroverse build ./docs/ --output ./my-world/
  neuroverse init --name "Customer Service Governance"
  neuroverse validate --world ./world/ --format summary
  echo '{"intent":"delete user data"}' | neuroverse guard --world ./world/ --trace
  neuroverse plan compile plan.md --output plan.json
  echo '{"intent":"write blog"}' | neuroverse plan check --plan plan.json
  neuroverse plan status --plan plan.json
  neuroverse plan advance write_blog_post --plan plan.json
  neuroverse plan derive plan.md --output ./derived-world/
  neuroverse run --pipe --world ./world/ --plan plan.json
  neuroverse run --interactive --world ./world/ --provider openai
  neuroverse mcp --world ./world/ --plan plan.json
  neuroverse test --world ./world/ --fuzz --count 50
  neuroverse redteam --world ./world/ --level strict
  neuroverse doctor
  neuroverse playground --world ./world/
`.trim();

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const subArgs = args.slice(1);

  switch (command) {
    case 'build': {
      const { main: buildMain } = await import('./build');
      return buildMain(subArgs);
    }
    case 'explain': {
      const { main: explainMain } = await import('./explain');
      return explainMain(subArgs);
    }
    case 'simulate': {
      const { main: simulateMain } = await import('./simulate');
      return simulateMain(subArgs);
    }
    case 'improve': {
      const { main: improveMain } = await import('./improve');
      return improveMain(subArgs);
    }
    case 'init': {
      const { main: initMain } = await import('./init');
      return initMain(subArgs);
    }
    case 'init-world': {
      const { main: initWorldMain } = await import('./init-world');
      return initWorldMain(subArgs);
    }
    case 'infer-world': {
      const { main: inferWorldMain } = await import('./infer-world');
      return inferWorldMain(subArgs);
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
    case 'test': {
      const { main: testMain } = await import('./test');
      return testMain(subArgs);
    }
    case 'redteam': {
      const { main: redteamMain } = await import('./redteam');
      return redteamMain(subArgs);
    }
    case 'doctor': {
      const { main: doctorMain } = await import('./doctor');
      return doctorMain(subArgs);
    }
    case 'playground': {
      const { main: playgroundMain } = await import('./playground');
      return playgroundMain(subArgs);
    }
    case 'plan': {
      const { main: planMain } = await import('./plan');
      return planMain(subArgs);
    }
    case 'run': {
      const { main: runMain } = await import('./run');
      return runMain(subArgs);
    }
    case 'mcp': {
      const { startMcpServer } = await import('../runtime/mcp-server');
      return startMcpServer(subArgs);
    }
    case 'worlds': {
      const { main: worldMain } = await import('./world');
      return worldMain(['list', ...subArgs]);
    }
    case 'trace': {
      const { main: traceMain } = await import('./trace');
      return traceMain(subArgs);
    }
    case 'impact': {
      const { main: impactMain } = await import('./impact');
      return impactMain(subArgs);
    }
    case 'world': {
      const { main: worldMain } = await import('./world');
      return worldMain(subArgs);
    }
    case 'derive': {
      const { main: deriveMain } = await import('./derive');
      return deriveMain(subArgs);
    }
    case 'decision-flow': {
      const { main: decisionFlowMain } = await import('./decision-flow');
      return decisionFlowMain(subArgs);
    }
    case 'equity-penalties': {
      const { main: equityPenaltiesMain } = await import('./equity-penalties');
      return equityPenaltiesMain(subArgs);
    }
    case 'configure-ai': {
      const { main: configureAiMain } = await import('./configure-ai');
      return configureAiMain(subArgs);
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
