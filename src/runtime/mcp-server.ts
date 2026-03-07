/**
 * NeuroVerse MCP Server — Governance as an MCP Tool Provider
 *
 * Implements the Model Context Protocol (MCP) over stdio.
 * Any MCP-compatible client (Claude Desktop, Cursor, etc.) can
 * connect to this server and get governed tool access.
 *
 * Architecture:
 *   MCP Client (Claude, Cursor, etc.)
 *     ↓ stdio (JSON-RPC)
 *   NeuroVerse MCP Server
 *     ↓ evaluateGuard()
 *   Tool Execution (shell, http, file, etc.)
 *
 * The server exposes governance-wrapped tools. Every tool call
 * passes through the guard engine before execution. Blocked
 * actions return the governance reason to the model.
 *
 * MCP Protocol: JSON-RPC 2.0 over stdio
 *   - initialize → capabilities
 *   - tools/list → available tools
 *   - tools/call → evaluate + execute
 */

import { evaluateGuard } from '../engine/guard-engine';
import { evaluatePlan, advancePlan, getPlanProgress } from '../engine/plan-engine';
import type { GuardEvent, GuardEngineOptions } from '../contracts/guard-contract';
import type { PlanDefinition } from '../contracts/plan-contract';
import type { WorldDefinition } from '../types';
import { loadWorld } from '../loader/world-loader';
import { resolveWorldPath } from '../loader/world-resolver';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

// ─── MCP Protocol Types ─────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

// ─── MCP Server Config ──────────────────────────────────────────────────────

export interface McpServerConfig {
  /** Path to world directory. */
  worldPath?: string;

  /** Pre-loaded world. */
  world?: WorldDefinition;

  /** Active plan. */
  plan?: PlanDefinition;

  /** Path to plan.json (loaded on start). */
  planPath?: string;

  /** Enforcement level. */
  level?: 'basic' | 'standard' | 'strict';

  /** Include trace in verdicts. */
  trace?: boolean;

  /** Enable shell tool. Default: true. */
  enableShell?: boolean;

  /** Enable file tools. Default: true. */
  enableFiles?: boolean;

  /** Enable HTTP tool. Default: true. */
  enableHttp?: boolean;

  /** Working directory for file/shell operations. */
  workingDir?: string;
}

// ─── Built-in Governed Tools ────────────────────────────────────────────────

const GOVERNED_TOOLS: McpToolDefinition[] = [
  {
    name: 'governed_shell',
    description: 'Execute a shell command. This command is evaluated against governance rules before execution.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
      },
      required: ['command'],
    },
  },
  {
    name: 'governed_read_file',
    description: 'Read a file. This action is evaluated against governance rules before execution.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to read' },
      },
      required: ['path'],
    },
  },
  {
    name: 'governed_write_file',
    description: 'Write content to a file. This action is evaluated against governance rules before execution.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to write' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'governed_list_directory',
    description: 'List files in a directory. This action is evaluated against governance rules.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path to list' },
      },
      required: ['path'],
    },
  },
  {
    name: 'governed_http_request',
    description: 'Make an HTTP request. This action is evaluated against governance rules before execution.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to request' },
        method: { type: 'string', description: 'HTTP method (GET, POST, PUT, DELETE)', default: 'GET' },
        body: { type: 'string', description: 'Request body (for POST/PUT)' },
        headers: { type: 'object', description: 'Request headers' },
      },
      required: ['url'],
    },
  },
  // Governance introspection tools — always available
  {
    name: 'governance_check',
    description: 'Check if an action would be allowed by governance rules without executing it.',
    inputSchema: {
      type: 'object',
      properties: {
        intent: { type: 'string', description: 'What the action intends to do' },
        tool: { type: 'string', description: 'Tool name (shell, http, file, etc.)' },
        scope: { type: 'string', description: 'Scope (file path, URL, etc.)' },
      },
      required: ['intent'],
    },
  },
  {
    name: 'governance_plan_status',
    description: 'Show current plan progress and remaining steps.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'governance_plan_advance',
    description: 'Mark a plan step as completed.',
    inputSchema: {
      type: 'object',
      properties: {
        step_id: { type: 'string', description: 'ID of the step to mark as completed' },
      },
      required: ['step_id'],
    },
  },
];

// ─── Tool Executors ─────────────────────────────────────────────────────────

function executeShell(command: string, workingDir?: string): string {
  try {
    const result = execSync(command, {
      cwd: workingDir,
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    return result;
  } catch (err: any) {
    return `Error: ${err.message}\n${err.stderr ?? ''}`;
  }
}

function executeReadFile(path: string, workingDir?: string): string {
  const fullPath = resolve(workingDir ?? '.', path);
  return readFileSync(fullPath, 'utf-8');
}

function executeWriteFile(path: string, content: string, workingDir?: string): string {
  const fullPath = resolve(workingDir ?? '.', path);
  writeFileSync(fullPath, content);
  return `File written: ${fullPath}`;
}

function executeListDir(path: string, workingDir?: string): string {
  const fullPath = resolve(workingDir ?? '.', path);
  const entries = readdirSync(fullPath);
  return entries.map(e => {
    try {
      const stat = statSync(join(fullPath, e));
      return `${stat.isDirectory() ? 'd' : '-'} ${e}`;
    } catch {
      return `? ${e}`;
    }
  }).join('\n');
}

async function executeHttpRequest(
  url: string, method: string, body?: string, headers?: Record<string, string>,
): Promise<string> {
  const response = await fetch(url, {
    method: method || 'GET',
    body: body || undefined,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
  const text = await response.text();
  return `HTTP ${response.status}\n${text}`;
}

// ─── MCP Server ─────────────────────────────────────────────────────────────

export class McpGovernanceServer {
  private world!: WorldDefinition;
  private plan?: PlanDefinition;
  private config: McpServerConfig;
  private engineOptions: GuardEngineOptions;
  private initialized = false;

  // Stats
  private actionsEvaluated = 0;
  private actionsAllowed = 0;
  private actionsBlocked = 0;

  constructor(config: McpServerConfig) {
    this.config = config;
    this.plan = config.plan;
    this.engineOptions = {
      trace: config.trace ?? false,
      level: config.level,
      plan: this.plan,
    };
  }

  /**
   * Start the MCP server — reads JSON-RPC from stdin, writes to stdout.
   */
  async start(): Promise<void> {
    // Load world
    if (this.config.worldPath) {
      this.world = await loadWorld(this.config.worldPath);
    } else if (this.config.world) {
      this.world = this.config.world;
    } else {
      throw new Error('No world provided');
    }

    // Load plan from path if needed
    if (this.config.planPath && !this.plan) {
      this.plan = JSON.parse(readFileSync(this.config.planPath, 'utf-8'));
      this.engineOptions.plan = this.plan;
    }

    process.stderr.write(`[neuroverse-mcp] Server starting\n`);
    process.stderr.write(`[neuroverse-mcp] World: ${this.world.world.name}\n`);
    if (this.plan) {
      process.stderr.write(`[neuroverse-mcp] Plan: ${this.plan.plan_id}\n`);
    }

    // Read JSON-RPC messages from stdin
    let buffer = '';

    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => {
      buffer += chunk;

      // MCP uses Content-Length headers (like LSP)
      while (buffer.length > 0) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) break;

        const header = buffer.slice(0, headerEnd);
        const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i);
        if (!contentLengthMatch) {
          // Try parsing as raw JSON (some clients skip headers)
          const newlineIdx = buffer.indexOf('\n');
          if (newlineIdx === -1) break;
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);
          if (line) this.handleRawLine(line);
          continue;
        }

        const contentLength = parseInt(contentLengthMatch[1], 10);
        const bodyStart = headerEnd + 4;
        const bodyEnd = bodyStart + contentLength;

        if (buffer.length < bodyEnd) break;

        const body = buffer.slice(bodyStart, bodyEnd);
        buffer = buffer.slice(bodyEnd);

        this.handleRawLine(body);
      }
    });

    process.stdin.on('end', () => {
      process.stderr.write(
        `[neuroverse-mcp] Server stopped. ` +
        `Evaluated: ${this.actionsEvaluated}, ` +
        `Allowed: ${this.actionsAllowed}, ` +
        `Blocked: ${this.actionsBlocked}\n`,
      );
    });

    // Keep process alive
    await new Promise(() => {});
  }

  private handleRawLine(line: string): void {
    try {
      const msg = JSON.parse(line);
      if (msg.method) {
        if (msg.id !== undefined) {
          this.handleRequest(msg as JsonRpcRequest);
        } else {
          this.handleNotification(msg as JsonRpcNotification);
        }
      }
    } catch (err) {
      process.stderr.write(`[neuroverse-mcp] Parse error: ${err}\n`);
    }
  }

  private send(msg: JsonRpcResponse | JsonRpcNotification): void {
    const json = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n`;
    process.stdout.write(header + json);
  }

  private sendResult(id: number | string, result: unknown): void {
    this.send({ jsonrpc: '2.0', id, result });
  }

  private sendError(id: number | string, code: number, message: string): void {
    this.send({ jsonrpc: '2.0', id, error: { code, message } });
  }

  // ─── Request Handlers ───────────────────────────────────────────────────

  private handleRequest(request: JsonRpcRequest): void {
    switch (request.method) {
      case 'initialize':
        this.handleInitialize(request);
        break;
      case 'tools/list':
        this.handleToolsList(request);
        break;
      case 'tools/call':
        this.handleToolsCall(request);
        break;
      case 'ping':
        this.sendResult(request.id, {});
        break;
      default:
        this.sendError(request.id, -32601, `Method not found: ${request.method}`);
    }
  }

  private handleNotification(notification: JsonRpcNotification): void {
    switch (notification.method) {
      case 'notifications/initialized':
        this.initialized = true;
        process.stderr.write(`[neuroverse-mcp] Client initialized\n`);
        break;
      case 'notifications/cancelled':
        // Acknowledge cancellation
        break;
      default:
        process.stderr.write(`[neuroverse-mcp] Unknown notification: ${notification.method}\n`);
    }
  }

  private handleInitialize(request: JsonRpcRequest): void {
    this.sendResult(request.id, {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: 'neuroverse-governance',
        version: '0.2.0',
      },
    });
  }

  private handleToolsList(request: JsonRpcRequest): void {
    const tools: McpToolDefinition[] = [];

    // Add governed tools based on config
    if (this.config.enableShell !== false) {
      tools.push(GOVERNED_TOOLS.find(t => t.name === 'governed_shell')!);
    }
    if (this.config.enableFiles !== false) {
      tools.push(GOVERNED_TOOLS.find(t => t.name === 'governed_read_file')!);
      tools.push(GOVERNED_TOOLS.find(t => t.name === 'governed_write_file')!);
      tools.push(GOVERNED_TOOLS.find(t => t.name === 'governed_list_directory')!);
    }
    if (this.config.enableHttp !== false) {
      tools.push(GOVERNED_TOOLS.find(t => t.name === 'governed_http_request')!);
    }

    // Always add governance introspection tools
    tools.push(GOVERNED_TOOLS.find(t => t.name === 'governance_check')!);
    tools.push(GOVERNED_TOOLS.find(t => t.name === 'governance_plan_status')!);
    if (this.plan) {
      tools.push(GOVERNED_TOOLS.find(t => t.name === 'governance_plan_advance')!);
    }

    this.sendResult(request.id, { tools });
  }

  private async handleToolsCall(request: JsonRpcRequest): Promise<void> {
    const params = request.params as { name: string; arguments?: Record<string, unknown> };
    const toolName = params.name;
    const args = params.arguments ?? {};

    try {
      const result = await this.executeTool(toolName, args);
      this.sendResult(request.id, result);
    } catch (err: any) {
      this.sendResult(request.id, {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      });
    }
  }

  // ─── Tool Execution with Governance ─────────────────────────────────────

  private async executeTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    // Governance introspection tools bypass the guard engine
    if (name === 'governance_check') {
      return this.toolGovernanceCheck(args);
    }
    if (name === 'governance_plan_status') {
      return this.toolPlanStatus();
    }
    if (name === 'governance_plan_advance') {
      return this.toolPlanAdvance(args);
    }

    // Build guard event
    const event = this.buildEvent(name, args);

    // Evaluate governance
    this.engineOptions.plan = this.plan;
    const verdict = evaluateGuard(event, this.world, this.engineOptions);

    this.actionsEvaluated++;

    if (verdict.status === 'BLOCK') {
      this.actionsBlocked++;
      let reason = `[GOVERNANCE BLOCKED] ${verdict.reason ?? 'Action blocked by governance rules.'}`;
      if (verdict.ruleId) reason += ` (Rule: ${verdict.ruleId})`;

      // Add plan context if relevant
      if (verdict.trace?.planCheck && !verdict.trace.planCheck.matched) {
        const pc = verdict.trace.planCheck;
        if (pc.closestStepLabel) {
          reason += `\nClosest plan step: "${pc.closestStepLabel}"`;
        }
      }

      process.stderr.write(`[neuroverse-mcp] BLOCKED: ${event.intent}\n`);
      return { content: [{ type: 'text', text: reason }], isError: true };
    }

    if (verdict.status === 'PAUSE') {
      this.actionsBlocked++;
      const reason = `[GOVERNANCE PAUSED] ${verdict.reason ?? 'Action requires human approval.'}`;
      process.stderr.write(`[neuroverse-mcp] PAUSED: ${event.intent}\n`);
      return { content: [{ type: 'text', text: reason }], isError: true };
    }

    // ALLOW — execute the tool
    this.actionsAllowed++;
    process.stderr.write(`[neuroverse-mcp] ALLOWED: ${event.intent}\n`);

    const result = await this.executeActualTool(name, args);

    // Track plan progress
    if (this.plan) {
      const planVerdict = evaluatePlan(event, this.plan);
      if (planVerdict.matchedStep) {
        this.plan = advancePlan(this.plan, planVerdict.matchedStep);
        this.engineOptions.plan = this.plan;
        const progress = getPlanProgress(this.plan);
        process.stderr.write(
          `[neuroverse-mcp] Plan: ${progress.completed}/${progress.total} (${progress.percentage}%)\n`,
        );
        if (progress.completed === progress.total) {
          process.stderr.write(`[neuroverse-mcp] Plan complete!\n`);
        }
      }
    }

    return result;
  }

  private buildEvent(toolName: string, args: Record<string, unknown>): GuardEvent {
    switch (toolName) {
      case 'governed_shell':
        return {
          intent: `execute shell command: ${args.command}`,
          tool: 'shell',
          scope: String(args.command ?? ''),
          actionCategory: 'shell',
          args,
          direction: 'input',
        };
      case 'governed_read_file':
        return {
          intent: `read file: ${args.path}`,
          tool: 'fs',
          scope: String(args.path ?? ''),
          actionCategory: 'read',
          args,
          direction: 'input',
        };
      case 'governed_write_file':
        return {
          intent: `write file: ${args.path}`,
          tool: 'fs',
          scope: String(args.path ?? ''),
          actionCategory: 'write',
          args,
          direction: 'input',
        };
      case 'governed_list_directory':
        return {
          intent: `list directory: ${args.path}`,
          tool: 'fs',
          scope: String(args.path ?? ''),
          actionCategory: 'read',
          args,
          direction: 'input',
        };
      case 'governed_http_request':
        return {
          intent: `http ${args.method ?? 'GET'} ${args.url}`,
          tool: 'http',
          scope: String(args.url ?? ''),
          actionCategory: 'network',
          args,
          direction: 'input',
        };
      default:
        return {
          intent: `${toolName}: ${JSON.stringify(args)}`,
          tool: toolName,
          args,
          direction: 'input',
        };
    }
  }

  private async executeActualTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const workingDir = this.config.workingDir;

    switch (name) {
      case 'governed_shell': {
        const output = executeShell(String(args.command), workingDir);
        return { content: [{ type: 'text', text: output }] };
      }
      case 'governed_read_file': {
        const content = executeReadFile(String(args.path), workingDir);
        return { content: [{ type: 'text', text: content }] };
      }
      case 'governed_write_file': {
        const result = executeWriteFile(String(args.path), String(args.content), workingDir);
        return { content: [{ type: 'text', text: result }] };
      }
      case 'governed_list_directory': {
        const listing = executeListDir(String(args.path), workingDir);
        return { content: [{ type: 'text', text: listing }] };
      }
      case 'governed_http_request': {
        const result = await executeHttpRequest(
          String(args.url),
          String(args.method ?? 'GET'),
          args.body as string | undefined,
          args.headers as Record<string, string> | undefined,
        );
        return { content: [{ type: 'text', text: result }] };
      }
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
  }

  // ─── Governance Introspection Tools ─────────────────────────────────────

  private toolGovernanceCheck(args: Record<string, unknown>): McpToolResult {
    const event: GuardEvent = {
      intent: String(args.intent ?? ''),
      tool: args.tool as string | undefined,
      scope: args.scope as string | undefined,
      direction: 'input',
    };

    this.engineOptions.plan = this.plan;
    const verdict = evaluateGuard(event, this.world, this.engineOptions);

    const lines = [
      `Verdict: ${verdict.status}`,
      verdict.reason ? `Reason: ${verdict.reason}` : null,
      verdict.ruleId ? `Rule: ${verdict.ruleId}` : null,
      verdict.warning ? `Warning: ${verdict.warning}` : null,
    ].filter(Boolean).join('\n');

    return { content: [{ type: 'text', text: lines }] };
  }

  private toolPlanStatus(): McpToolResult {
    if (!this.plan) {
      return { content: [{ type: 'text', text: 'No active plan.' }] };
    }

    const progress = getPlanProgress(this.plan);
    const lines = [
      `Plan: ${this.plan.plan_id}`,
      `Objective: ${this.plan.objective}`,
      `Progress: ${progress.completed}/${progress.total} (${progress.percentage}%)`,
      '',
      'Steps:',
      ...this.plan.steps.map(s => {
        const icon = s.status === 'completed' ? '[x]' : s.status === 'active' ? '[>]' : '[ ]';
        return `  ${icon} ${s.label} (${s.id})`;
      }),
    ];

    if (this.plan.constraints.length > 0) {
      lines.push('', 'Constraints:');
      for (const c of this.plan.constraints) {
        lines.push(`  - ${c.description} [${c.type}]`);
      }
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }

  private toolPlanAdvance(args: Record<string, unknown>): McpToolResult {
    if (!this.plan) {
      return { content: [{ type: 'text', text: 'No active plan.' }], isError: true };
    }

    const stepId = String(args.step_id ?? '');
    const step = this.plan.steps.find(s => s.id === stepId);

    if (!step) {
      const ids = this.plan.steps.map(s => s.id).join(', ');
      return {
        content: [{ type: 'text', text: `Step "${stepId}" not found. Available: ${ids}` }],
        isError: true,
      };
    }

    if (step.status === 'completed') {
      return { content: [{ type: 'text', text: `Step "${stepId}" is already completed.` }] };
    }

    this.plan = advancePlan(this.plan, stepId);
    this.engineOptions.plan = this.plan;
    const progress = getPlanProgress(this.plan);

    let text = `Step completed: ${step.label}\nProgress: ${progress.completed}/${progress.total} (${progress.percentage}%)`;
    if (progress.completed === progress.total) {
      text += '\n\nPlan complete!';
    }

    // Persist updated plan if planPath was provided
    if (this.config.planPath) {
      writeFileSync(this.config.planPath, JSON.stringify(this.plan, null, 2) + '\n');
    }

    return { content: [{ type: 'text', text }] };
  }
}

// ─── CLI Entry Point ────────────────────────────────────────────────────────

/**
 * Start the MCP governance server from CLI arguments.
 */
export async function startMcpServer(args: string[]): Promise<void> {
  function parseArg(flag: string): string | undefined {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
  }

  const worldPath = resolveWorldPath(parseArg('--world'));
  const planPath = parseArg('--plan');
  const level = parseArg('--level') as 'basic' | 'standard' | 'strict' | undefined;
  const trace = args.includes('--trace');
  const workingDir = parseArg('--cwd');

  if (!worldPath) {
    process.stderr.write(
      'Error: No world found.\n' +
      'Use --world <path>, set NEUROVERSE_WORLD, or run `neuroverse world use <name>`\n',
    );
    process.exit(1);
    return;
  }

  const server = new McpGovernanceServer({
    worldPath,
    planPath,
    level,
    trace,
    workingDir,
    enableShell: !args.includes('--no-shell'),
    enableFiles: !args.includes('--no-files'),
    enableHttp: !args.includes('--no-http'),
  });

  await server.start();
}
