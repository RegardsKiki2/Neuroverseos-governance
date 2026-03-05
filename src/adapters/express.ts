/**
 * NeuroVerse Adapter — Express / Fastify
 *
 * HTTP middleware that evaluates incoming requests against a world definition.
 * Works with Express, Fastify, or any connect-compatible framework.
 *
 * Usage (Express):
 *   import { createGovernanceMiddleware } from 'neuroverse-governance/adapters/express';
 *
 *   const middleware = await createGovernanceMiddleware('./world/');
 *   app.use('/api', middleware);
 *
 * Usage (Fastify):
 *   const middleware = await createGovernanceMiddleware('./world/');
 *   fastify.addHook('preHandler', middleware);
 */

import type { GuardEvent, GuardVerdict, GuardEngineOptions } from '../contracts/guard-contract';
import type { WorldDefinition } from '../types';
import { evaluateGuard } from '../engine/guard-engine';
import { loadWorld } from '../loader/world-loader';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Minimal request shape (works with Express, Fastify, Node http). */
export interface GovernanceRequest {
  method?: string;
  url?: string;
  path?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
  params?: Record<string, string>;
  query?: Record<string, string>;
}

/** Minimal response shape. */
export interface GovernanceResponse {
  status?: (code: number) => GovernanceResponse;
  statusCode?: number;
  json?: (body: unknown) => void;
  send?: (body: string) => void;
  end?: () => void;
}

export interface GovernanceMiddlewareOptions {
  /** Include full evaluation trace in verdicts. Default: false. */
  trace?: boolean;

  /** Enforcement level override. */
  level?: 'basic' | 'standard' | 'strict';

  /** Called for every evaluation (logging/audit hook). */
  onEvaluate?: (verdict: GuardVerdict, event: GuardEvent, req: GovernanceRequest) => void;

  /** Custom request → GuardEvent mapping. */
  mapRequest?: (req: GovernanceRequest) => GuardEvent;

  /** Custom response for blocked requests. */
  onBlock?: (verdict: GuardVerdict, req: GovernanceRequest, res: GovernanceResponse) => void;

  /** Custom handler for pause verdicts. Return true to allow. */
  onPause?: (verdict: GuardVerdict, req: GovernanceRequest) => Promise<boolean> | boolean;

  /** HTTP status code for blocked requests. Default: 403. */
  blockStatusCode?: number;
}

// ─── Default Mapping ────────────────────────────────────────────────────────

function methodToCategory(method: string): GuardEvent['actionCategory'] {
  switch (method.toUpperCase()) {
    case 'GET':
    case 'HEAD':
    case 'OPTIONS':
      return 'read';
    case 'POST':
    case 'PUT':
    case 'PATCH':
      return 'write';
    case 'DELETE':
      return 'delete';
    default:
      return 'other';
  }
}

function defaultMapRequest(req: GovernanceRequest): GuardEvent {
  const method = (req.method ?? 'GET').toUpperCase();
  const path = req.path ?? req.url ?? '/';

  return {
    intent: `${method} ${path}`,
    tool: 'http',
    scope: path,
    actionCategory: methodToCategory(method),
    direction: 'input',
    args: {
      method,
      path,
      ...(req.params ?? {}),
      ...(req.query ?? {}),
    },
  };
}

function defaultOnBlock(
  verdict: GuardVerdict,
  _req: GovernanceRequest,
  res: GovernanceResponse,
  statusCode: number,
): void {
  const body = {
    error: 'Governance policy violation',
    reason: verdict.reason ?? 'Action not permitted',
    ruleId: verdict.ruleId,
    status: verdict.status,
  };

  if (res.status && res.json) {
    // Express-style
    res.status(statusCode).json(body);
  } else if (res.send) {
    // Fallback
    res.statusCode = statusCode;
    res.send(JSON.stringify(body));
  } else if (res.end) {
    res.statusCode = statusCode;
    res.end();
  }
}

// ─── Middleware Factory ─────────────────────────────────────────────────────

/**
 * Create governance middleware from a world path.
 *
 * Returns a connect-compatible middleware function:
 *   (req, res, next) => void
 */
export async function createGovernanceMiddleware(
  worldPath: string,
  options?: GovernanceMiddlewareOptions,
): Promise<(req: GovernanceRequest, res: GovernanceResponse, next: (err?: unknown) => void) => void> {
  const world = await loadWorld(worldPath);
  return createGovernanceMiddlewareFromWorld(world, options);
}

/**
 * Create governance middleware from a pre-loaded world.
 */
export function createGovernanceMiddlewareFromWorld(
  world: WorldDefinition,
  options: GovernanceMiddlewareOptions = {},
): (req: GovernanceRequest, res: GovernanceResponse, next: (err?: unknown) => void) => void {
  const engineOptions: GuardEngineOptions = {
    trace: options.trace ?? false,
    level: options.level,
  };
  const mapRequest = options.mapRequest ?? defaultMapRequest;
  const blockStatusCode = options.blockStatusCode ?? 403;

  return async function neuroVerseGovernance(
    req: GovernanceRequest,
    res: GovernanceResponse,
    next: (err?: unknown) => void,
  ): Promise<void> {
    try {
      const event = mapRequest(req);
      const verdict = evaluateGuard(event, world, engineOptions);

      options.onEvaluate?.(verdict, event, req);

      if (verdict.status === 'ALLOW') {
        next();
        return;
      }

      if (verdict.status === 'PAUSE') {
        const approved = await options.onPause?.(verdict, req);
        if (approved) {
          next();
          return;
        }
      }

      // BLOCK (or unapproved PAUSE)
      if (options.onBlock) {
        options.onBlock(verdict, req, res);
      } else {
        defaultOnBlock(verdict, req, res, blockStatusCode);
      }
    } catch (err) {
      next(err);
    }
  };
}
