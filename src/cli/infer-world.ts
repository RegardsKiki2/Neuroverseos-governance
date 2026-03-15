/**
 * CLI Harness: neuroverse infer-world
 *
 * Scans an existing repository and infers a .nv-world.md governance file
 * from the structure, code, and configuration found within.
 *
 * Usage:
 *   neuroverse infer-world ./repo
 *   neuroverse infer-world ./repo --output ./research.nv-world.md
 *   neuroverse infer-world ./repo --json
 *
 * Flags:
 *   --output <path>   Output path (default: <repo>/inferred.nv-world.md)
 *   --json            Output detection results as JSON without writing a file
 *   --dry-run         Show what would be detected without writing
 *
 * Exit codes:
 *   0 = SUCCESS
 *   1 = NO_REPO
 *   2 = NOTHING_DETECTED
 *   3 = ERROR
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join, basename, resolve } from 'path';

// ─── Detection Types ─────────────────────────────────────────────────────────

interface DetectedEnvironment {
  type: 'research' | 'agent' | 'application' | 'unknown';
  confidence: number;
  dataset: string | null;
  metric: string | null;
  optimization: 'minimize' | 'maximize' | null;
  framework: string | null;
  architectures: string[];
  constraints: string[];
  hasExperimentLoop: boolean;
  hasProgram: boolean;
  goals: string[];
  files: FileSignal[];
}

interface FileSignal {
  path: string;
  signal: string;
  confidence: number;
}

// ─── File Scanning ───────────────────────────────────────────────────────────

const SCAN_PATTERNS: Record<string, { signal: string; confidence: number }> = {
  'program.md': { signal: 'experiment goals / agent instructions', confidence: 0.9 },
  'train.py': { signal: 'model training code', confidence: 0.8 },
  'train.js': { signal: 'model training code', confidence: 0.8 },
  'train.ts': { signal: 'model training code', confidence: 0.8 },
  'prepare.py': { signal: 'data preparation', confidence: 0.7 },
  'dataset.yaml': { signal: 'dataset configuration', confidence: 0.8 },
  'dataset.json': { signal: 'dataset configuration', confidence: 0.8 },
  'config.yaml': { signal: 'project configuration', confidence: 0.5 },
  'config.json': { signal: 'project configuration', confidence: 0.5 },
  'pyproject.toml': { signal: 'Python project', confidence: 0.4 },
  'requirements.txt': { signal: 'Python dependencies', confidence: 0.5 },
  'setup.py': { signal: 'Python package', confidence: 0.4 },
  'Makefile': { signal: 'build automation', confidence: 0.3 },
  'docker-compose.yml': { signal: 'containerized environment', confidence: 0.4 },
  'Dockerfile': { signal: 'containerized environment', confidence: 0.4 },
};

const RESEARCH_DIRECTORIES = ['experiments', 'results', 'notebooks', 'models', 'checkpoints', 'logs', 'data', 'eval'];

function scanRepo(repoPath: string): FileSignal[] {
  const signals: FileSignal[] = [];

  // Check top-level files
  let entries: string[];
  try {
    entries = readdirSync(repoPath);
  } catch {
    return signals;
  }

  for (const entry of entries) {
    const lower = entry.toLowerCase();
    const fullPath = join(repoPath, entry);

    // Check known file patterns (case-insensitive match)
    if (SCAN_PATTERNS[lower]) {
      signals.push({
        path: entry,
        signal: SCAN_PATTERNS[lower].signal,
        confidence: SCAN_PATTERNS[lower].confidence,
      });
    }
    // Also check exact match for case-sensitive patterns like Makefile
    if (entry !== lower && SCAN_PATTERNS[entry]) {
      signals.push({
        path: entry,
        signal: SCAN_PATTERNS[entry].signal,
        confidence: SCAN_PATTERNS[entry].confidence,
      });
    }

    // Check for README files (any case)
    if (lower === 'readme.md' || lower === 'readme.rst' || lower === 'readme.txt') {
      signals.push({ path: entry, signal: 'documentation', confidence: 0.3 });
    }

    // Check for package files
    if (lower === 'package.json' || lower === 'cargo.toml' || lower === 'go.mod') {
      signals.push({ path: entry, signal: 'project manifest', confidence: 0.4 });
    }

    // Check research directories
    try {
      if (statSync(fullPath).isDirectory() && RESEARCH_DIRECTORIES.includes(lower)) {
        signals.push({
          path: entry + '/',
          signal: `${lower} directory`,
          confidence: 0.6,
        });
      }
    } catch {
      // stat failed, skip
    }
  }

  return signals;
}

// ─── Content Analysis ────────────────────────────────────────────────────────

const DATASET_PATTERNS = [
  /dataset\s*[:=]\s*["']?([A-Za-z0-9_\-]+)/i,
  /--dataset\s+["']?([A-Za-z0-9_\-]+)/i,
  /load_dataset\(["']([^"']+)/i,
  /TinyStories/i,
  /OpenWebText/i,
  /WikiText/i,
  /C4/i,
  /The\s*Pile/i,
  /MNIST/i,
  /CIFAR/i,
  /ImageNet/i,
];

const METRIC_PATTERNS = [
  /val_bpb/i,
  /val_loss/i,
  /val_acc(?:uracy)?/i,
  /test_acc(?:uracy)?/i,
  /perplexity/i,
  /bleu/i,
  /rouge/i,
  /f1[_\s]?score/i,
  /auc/i,
  /mse/i,
  /rmse/i,
  /mae/i,
];

const ARCHITECTURE_PATTERNS = [
  /transformer/i,
  /RWKV/i,
  /SSM/i,
  /Mamba/i,
  /linear\s*attention/i,
  /GPT/i,
  /BERT/i,
  /ResNet/i,
  /CNN/i,
  /RNN/i,
  /LSTM/i,
  /GRU/i,
  /ViT/i,
  /diffusion/i,
  /autoencoder/i,
  /GAN/i,
];

const FRAMEWORK_PATTERNS: [RegExp, string][] = [
  [/import\s+torch|from\s+torch/i, 'PyTorch'],
  [/import\s+tensorflow|from\s+tensorflow/i, 'TensorFlow'],
  [/import\s+jax|from\s+jax/i, 'JAX'],
  [/from\s+transformers\s+import/i, 'HuggingFace Transformers'],
  [/import\s+keras|from\s+keras/i, 'Keras'],
  [/torch/i, 'PyTorch'],
];

function readFileContent(path: string, maxBytes: number = 50000): string | null {
  try {
    const stat = statSync(path);
    if (stat.size > maxBytes) {
      return readFileSync(path, { encoding: 'utf-8', flag: 'r' }).slice(0, maxBytes);
    }
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

function extractFromContent(repoPath: string, signals: FileSignal[]): Partial<DetectedEnvironment> {
  const result: Partial<DetectedEnvironment> = {
    architectures: [],
    constraints: [],
    goals: [],
  };

  const filesToRead = [
    'program.md', 'train.py', 'train.js', 'train.ts',
    'prepare.py', 'config.yaml', 'config.json',
    'dataset.yaml', 'dataset.json', 'README.md', 'readme.md',
  ];

  const allContent: string[] = [];

  for (const file of filesToRead) {
    const content = readFileContent(join(repoPath, file));
    if (content) {
      allContent.push(content);
    }
  }

  const combined = allContent.join('\n');
  if (!combined) return result;

  // Detect dataset
  for (const pattern of DATASET_PATTERNS) {
    const match = combined.match(pattern);
    if (match) {
      result.dataset = match[1] || match[0].trim();
      break;
    }
  }

  // Detect metrics
  for (const pattern of METRIC_PATTERNS) {
    const match = combined.match(pattern);
    if (match) {
      result.metric = match[0].trim().toLowerCase().replace(/\s+/g, '_');
      break;
    }
  }

  // Detect optimization direction
  if (result.metric) {
    const lossLike = /loss|bpb|perplexity|mse|rmse|mae|error/i.test(result.metric);
    result.optimization = lossLike ? 'minimize' : 'maximize';
  }

  // Detect architectures
  const archs = new Set<string>();
  for (const pattern of ARCHITECTURE_PATTERNS) {
    const match = combined.match(pattern);
    if (match) {
      archs.add(match[0].trim());
    }
  }
  result.architectures = [...archs];

  // Detect framework
  for (const [pattern, framework] of FRAMEWORK_PATTERNS) {
    if (pattern.test(combined)) {
      result.framework = framework;
      break;
    }
  }

  // Detect goals from program.md
  const programContent = readFileContent(join(repoPath, 'program.md'));
  if (programContent) {
    result.hasProgram = true;
    // Extract lines that look like goals
    const lines = programContent.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (
        (trimmed.startsWith('- ') || trimmed.startsWith('* ')) &&
        trimmed.length > 10 && trimmed.length < 200
      ) {
        result.goals!.push(trimmed.slice(2).trim());
      }
    }
  }

  // Detect experiment loop patterns
  result.hasExperimentLoop = /experiment|loop|iteration|epoch|trial|run|sweep/i.test(combined) &&
    /result|metric|eval|score|loss|accuracy/i.test(combined);

  return result;
}

// ─── Environment Classification ──────────────────────────────────────────────

function classifyEnvironment(signals: FileSignal[], extracted: Partial<DetectedEnvironment>): DetectedEnvironment {
  let type: DetectedEnvironment['type'] = 'unknown';
  let confidence = 0;

  const hasTrainCode = signals.some(s => s.signal.includes('training code'));
  const hasDataset = !!extracted.dataset;
  const hasMetric = !!extracted.metric;
  const hasExperimentLoop = !!extracted.hasExperimentLoop;
  const hasResearchDirs = signals.some(s =>
    ['experiments directory', 'results directory', 'notebooks directory', 'models directory'].includes(s.signal),
  );

  // Research environment detection
  const researchScore =
    (hasTrainCode ? 30 : 0) +
    (hasDataset ? 20 : 0) +
    (hasMetric ? 20 : 0) +
    (hasExperimentLoop ? 15 : 0) +
    (hasResearchDirs ? 10 : 0) +
    (extracted.hasProgram ? 15 : 0);

  if (researchScore >= 40) {
    type = 'research';
    confidence = Math.min(researchScore, 100);
  } else if (signals.length > 0) {
    type = 'application';
    confidence = 30;
  }

  return {
    type,
    confidence,
    dataset: extracted.dataset || null,
    metric: extracted.metric || null,
    optimization: extracted.optimization || null,
    framework: extracted.framework || null,
    architectures: extracted.architectures || [],
    constraints: extracted.constraints || [],
    hasExperimentLoop,
    hasProgram: !!extracted.hasProgram,
    goals: extracted.goals || [],
    files: signals,
  };
}

// ─── World File Generation ───────────────────────────────────────────────────

function generateWorldFromDetection(env: DetectedEnvironment, repoName: string): string {
  const worldId = repoName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

  const dataset = env.dataset || 'UNDETECTED';
  const metric = env.metric || 'val_loss';
  const optimization = env.optimization || 'minimize';
  const framework = env.framework || 'Unknown';
  const architectures = env.architectures.length > 0 ? env.architectures.join(', ') : 'not detected';

  const contextDescription = env.type === 'research'
    ? `ML research using ${framework} on ${dataset}`
    : `AI application with governance requirements`;

  const goals = env.goals.length > 0
    ? env.goals.slice(0, 3).map(g => `  - ${g}`).join('\n')
    : '  - Define research goals here';

  return `---
world_id: ${worldId}
name: ${repoName} Research World
version: 1.0.0
runtime_mode: SIMULATION
default_profile: inferred
alternative_profile: strict
---

# Thesis

${contextDescription}. Experiments must be reproducible, metrics must be tracked, and agents must operate within the declared research context. This world was inferred from repository structure — review and refine the constraints below.

# Invariants

- \`experiments_must_be_reproducible\` — Every experiment must log architecture, hyperparameters, dataset, and training config sufficient to reproduce results (structural, immutable)
- \`metrics_must_be_recorded\` — Every training run must produce the primary evaluation metric (${metric}); runs without metrics are invalid (structural, immutable)
- \`dataset_is_${dataset.toLowerCase().replace(/[^a-z0-9]+/g, '_')}\` — The dataset "${dataset}" must be used for training and evaluation (structural, immutable)
- \`compute_budget_enforced\` — Experiments must respect declared compute limits (structural, immutable)

# State

## experiments_run
- type: number
- min: 0
- max: 10000
- step: 1
- default: 0
- label: Experiments Run
- description: Total number of experiments completed

## best_metric_value
- type: number
- min: -1000
- max: 1000
- step: 0.01
- default: ${optimization === 'minimize' ? '100' : '-1000'}
- label: Best ${metric}
- description: Best value achieved for ${metric}

## keep_rate
- type: number
- min: 0
- max: 100
- step: 1
- default: 0
- label: Keep Rate
- description: Percentage of experiments that improved on the best result

## compute_used_minutes
- type: number
- min: 0
- max: 100000
- step: 1
- default: 0
- label: Compute Used (minutes)
- description: Total wall-clock training time consumed

## compute_budget_minutes
- type: number
- min: 0
- max: 100000
- step: 60
- default: 1440
- label: Compute Budget (minutes)
- description: Maximum allowed compute time

## failed_experiments
- type: number
- min: 0
- max: 10000
- step: 1
- default: 0
- label: Failed Experiments
- description: Number of experiments that failed to produce valid results

# Assumptions

## inferred
- name: Inferred Configuration
- description: Configuration inferred from repository structure. Framework: ${framework}. Architectures: ${architectures}.
- framework: ${framework.toLowerCase().replace(/\s+/g, '_')}
- dataset: ${dataset.toLowerCase()}
- metric: ${metric}

## strict
- name: Strict Configuration
- description: Conservative settings with tight compute limits and strict reproducibility requirements.
- framework: ${framework.toLowerCase().replace(/\s+/g, '_')}
- dataset: ${dataset.toLowerCase()}
- metric: ${metric}

# Rules

## rule-001: Compute Budget Exhausted (structural)
When compute budget is exceeded, the research loop must halt.

When compute_used_minutes > compute_budget_minutes [state]
Then research_viability *= 0.00
Collapse: research_viability < 0.05

> trigger: Compute usage exceeds declared budget.
> rule: Compute budget is a hard constraint. Exceeding it halts all experiments.
> shift: Research loop terminates. Final results are reported.
> effect: Research viability set to zero.

## rule-002: High Failure Rate (degradation)
Too many failed experiments indicate a systemic problem.

When failed_experiments > 5 [state] AND experiments_run > 0 [state]
Then research_viability *= 0.50

> trigger: More than 5 experiments have failed.
> rule: High failure rates waste compute and signal infrastructure problems.
> shift: Research viability degrades. Investigation needed.
> effect: Research viability reduced to 50%.

## rule-003: No Metrics Recorded (structural)
Experiments without metrics are invalid.

When experiments_run > 0 [state] AND best_metric_value == ${optimization === 'minimize' ? '100' : '-1000'} [state]
Then research_viability *= 0.30
Collapse: research_viability < 0.05

> trigger: Experiments ran but no metric improvement from default.
> rule: Research without measurement is not research.
> shift: Research viability drops sharply.
> effect: Research viability reduced to 30%.

## rule-004: Strong Progress (advantage)
Consistent metric improvement validates the research approach.

When keep_rate > 20 [state] AND experiments_run > 5 [state]
Then research_viability *= 1.20

> trigger: Keep rate above 20% after 5+ experiments.
> rule: Productive research should be encouraged.
> shift: Research viability improves.
> effect: Research viability boosted by 20%.

# Gates

- BREAKTHROUGH: research_viability >= 90
- PRODUCTIVE: research_viability >= 60
- ONGOING: research_viability >= 35
- STRUGGLING: research_viability > 10
- HALTED: research_viability <= 10

# Outcomes

## research_viability
- type: number
- range: 0-100
- display: percentage
- label: Research Viability
- primary: true

## best_metric_value
- type: number
- range: -1000-1000
- display: decimal
- label: Best ${metric}

## keep_rate
- type: number
- range: 0-100
- display: percentage
- label: Keep Rate
`;
}

// ─── Argument Parsing ────────────────────────────────────────────────────────

interface CliArgs {
  repoPath: string;
  outputPath: string;
  json: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let repoPath = '';
  let outputPath = '';
  let json = false;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--output' && i + 1 < argv.length) {
      outputPath = argv[++i];
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (!arg.startsWith('-') && !repoPath) {
      repoPath = arg;
    }
  }

  return { repoPath, outputPath, json, dryRun };
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  try {
    const args = parseArgs(argv);

    if (!args.repoPath) {
      process.stderr.write('Usage: neuroverse infer-world <repo-path> [options]\n\n');
      process.stderr.write('Scans an existing repository and generates a governance world file.\n\n');
      process.stderr.write('Options:\n');
      process.stderr.write('  --output <path>   Output file path\n');
      process.stderr.write('  --json            Output detection results as JSON\n');
      process.stderr.write('  --dry-run         Show detections without writing\n');
      process.stderr.write('\nExample:\n');
      process.stderr.write('  neuroverse infer-world ./my-research-repo\n');
      process.exit(1);
      return;
    }

    const repoPath = resolve(args.repoPath);

    if (!existsSync(repoPath)) {
      process.stderr.write(`Repository not found: ${repoPath}\n`);
      process.exit(1);
      return;
    }

    // Step 1: Scan for file signals
    process.stderr.write(`Scanning ${repoPath}...\n`);
    const signals = scanRepo(repoPath);

    if (signals.length === 0) {
      process.stderr.write('No recognizable project structure detected.\n');
      process.exit(2);
      return;
    }

    // Step 2: Extract content-level signals
    const extracted = extractFromContent(repoPath, signals);

    // Step 3: Classify environment
    const env = classifyEnvironment(signals, extracted);

    // JSON mode: output detection results
    if (args.json) {
      process.stdout.write(JSON.stringify(env, null, 2) + '\n');
      process.exit(0);
      return;
    }

    // Human-readable detection summary
    process.stderr.write('\n');
    process.stderr.write(`Detected: ${env.type} environment (${env.confidence}% confidence)\n`);
    if (env.dataset) process.stderr.write(`  Dataset:       ${env.dataset}\n`);
    if (env.metric) process.stderr.write(`  Metric:        ${env.metric} (${env.optimization})\n`);
    if (env.framework) process.stderr.write(`  Framework:     ${env.framework}\n`);
    if (env.architectures.length > 0) process.stderr.write(`  Architectures: ${env.architectures.join(', ')}\n`);
    if (env.hasExperimentLoop) process.stderr.write(`  Experiment loop detected\n`);
    if (env.hasProgram) process.stderr.write(`  Program file found (agent instructions)\n`);
    process.stderr.write('\n');
    process.stderr.write('  Files analyzed:\n');
    for (const s of env.files) {
      process.stderr.write(`    ${s.path} — ${s.signal}\n`);
    }
    process.stderr.write('\n');

    // Dry run: stop here
    if (args.dryRun) {
      process.stderr.write('Dry run — no files written.\n');
      process.exit(0);
      return;
    }

    // Step 4: Generate world file
    const repoName = basename(repoPath);
    const worldContent = generateWorldFromDetection(env, repoName);

    const outputPath = args.outputPath || join(repoPath, 'inferred.nv-world.md');

    if (existsSync(outputPath)) {
      process.stderr.write(`File already exists: ${outputPath}\n`);
      process.stderr.write('Use --output to specify a different path.\n');
      process.exit(1);
      return;
    }

    await writeFile(outputPath, worldContent, 'utf-8');

    process.stderr.write(`✓ World created: ${outputPath}\n\n`);
    process.stderr.write('Next steps:\n');
    process.stderr.write(`  Review and refine   Edit ${outputPath}\n`);
    process.stderr.write(`  Compile             neuroverse bootstrap --input ${outputPath} --output ./world/ --validate\n`);
    process.stderr.write(`  Simulate            neuroverse simulate ${outputPath} --steps 5\n`);
    process.stderr.write('\n');

    // Machine-readable output
    const result = {
      created: outputPath,
      environment: env,
      nextSteps: [
        `Edit ${outputPath} to refine inferred governance rules`,
        `neuroverse bootstrap --input ${outputPath} --output ./world/ --validate`,
        `neuroverse simulate ${outputPath} --steps 5`,
      ],
    };

    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(0);
  } catch (e) {
    process.stderr.write(`infer-world failed: ${e instanceof Error ? e.message : e}\n`);
    process.exit(3);
  }
}
