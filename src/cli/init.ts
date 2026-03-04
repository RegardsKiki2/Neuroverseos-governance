/**
 * CLI Harness: neuroverse init
 *
 * Scaffolds an empty .nv-world.md template in the current directory.
 *
 * Usage:
 *   neuroverse init
 *   neuroverse init --name "My Governance World"
 *   neuroverse init --output ./worlds/my-world.nv-world.md
 *
 * Flags:
 *   --name <name>     World name (default: "My World")
 *   --output <path>   Output path (default: ./world.nv-world.md)
 */

// ─── Template ────────────────────────────────────────────────────────────────

function generateTemplate(name: string): string {
  const worldId = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

  return `---
world_id: ${worldId}
name: ${name}
version: 1.0.0
runtime_mode: SIMULATION
default_profile: baseline
alternative_profile: alternative
---

# Thesis

Replace this with your world's structural claim — the testable hypothesis that simulation can confirm or refute.

# Invariants

- \`invariant_one\` — Replace with a structural truth that must always hold (structural, immutable)
- \`invariant_two\` — Replace with another non-negotiable constraint (structural, immutable)

# State

## example_variable
- type: number
- min: 0
- max: 100
- step: 5
- default: 50
- label: Example Variable
- description: Replace with what this variable represents

## example_enum
- type: enum
- options: option_a, option_b, option_c
- default: option_a
- label: Example Enum
- description: Replace with what this choice represents

# Assumptions

## baseline
- name: Baseline Scenario
- description: The default conditions under which the model operates
- example_param: default_value

## alternative
- name: Alternative Scenario
- description: What changes under different conditions
- example_param: changed_value

# Rules

## rule-001: Example Rule (structural)
Replace with a description of what this rule detects and why it matters.

When example_variable < 20 [state]
Then effective_margin *= 0.30
Collapse: effective_margin < 0.03

> trigger: Replace with what triggers this rule
> rule: Replace with the causal mechanism
> shift: Replace with what changes structurally
> effect: Replace with the quantitative impact

## rule-002: Example Advantage (advantage)
Replace with a description of a positive reinforcement rule.

When example_variable > 80 [state]
Then effective_margin *= 1.15

> trigger: Replace with what triggers this advantage
> rule: Replace with why this helps
> shift: Replace with the structural improvement
> effect: Replace with the quantitative benefit

# Gates

- THRIVING: effective_margin >= 40
- STABLE: effective_margin >= 20
- COMPRESSED: effective_margin >= 10
- CRITICAL: effective_margin > 3
- MODEL_COLLAPSES: effective_margin <= 3

# Outcomes

## effective_margin
- type: number
- range: 0-100
- display: percentage
- label: Effective Margin
- primary: true
`;
}

// ─── Argument Parsing ────────────────────────────────────────────────────────

interface CliArgs {
  name: string;
  outputPath: string;
}

function parseArgs(argv: string[]): CliArgs {
  let name = 'My World';
  let outputPath = './world.nv-world.md';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--name' && i + 1 < argv.length) {
      name = argv[++i];
    } else if (arg === '--output' && i + 1 < argv.length) {
      outputPath = argv[++i];
    }
  }

  return { name, outputPath };
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  try {
    const args = parseArgs(argv);
    const { writeFile } = await import('fs/promises');
    const { existsSync } = await import('fs');

    // Don't overwrite existing files
    if (existsSync(args.outputPath)) {
      process.stderr.write(`File already exists: ${args.outputPath}\n`);
      process.stderr.write('Use a different --output path or remove the existing file.\n');
      process.exit(1);
      return;
    }

    const template = generateTemplate(args.name);
    await writeFile(args.outputPath, template, 'utf-8');

    const result = {
      created: args.outputPath,
      worldName: args.name,
      nextSteps: [
        `Edit ${args.outputPath} — replace placeholder content with your governance spec`,
        `neuroverse bootstrap --input ${args.outputPath} --output ./world/ --validate`,
        'neuroverse validate --world ./world/',
        'echo \'{"intent":"test action"}\' | neuroverse guard --world ./world/',
      ],
    };

    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(0);
  } catch (e) {
    process.stderr.write(`Init failed: ${e}\n`);
    process.exit(3);
  }
}
