/**
 * NeuroVerse Adapters — Framework Integration Layer
 *
 * Each adapter wraps the governance engine for a specific framework:
 *
 *   adapters/langchain  — LangChain callback handler
 *   adapters/openai     — OpenAI function calling guard
 *   adapters/openclaw   — OpenClaw agent plugin
 *   adapters/express    — Express/Fastify HTTP middleware
 *
 * Import directly from the adapter you need:
 *   import { createNeuroVerseCallbackHandler } from 'neuroverse-governance/adapters/langchain';
 *   import { createGovernedToolExecutor } from 'neuroverse-governance/adapters/openai';
 *   import { createNeuroVersePlugin } from 'neuroverse-governance/adapters/openclaw';
 *   import { createGovernanceMiddleware } from 'neuroverse-governance/adapters/express';
 */

export {
  NeuroVerseCallbackHandler,
  createNeuroVerseCallbackHandler,
  createNeuroVerseCallbackHandlerFromWorld,
  GovernanceBlockedError as LangChainGovernanceBlockedError,
} from './langchain';

export type {
  NeuroVerseHandlerOptions,
} from './langchain';

export {
  GovernedToolExecutor,
  createGovernedToolExecutor,
  createGovernedToolExecutorFromWorld,
  GovernanceBlockedError as OpenAIGovernanceBlockedError,
} from './openai';

export type {
  OpenAIToolCall,
  GovernedToolResult,
  GovernedExecutorOptions,
} from './openai';

export {
  NeuroVersePlugin,
  createNeuroVersePlugin,
  createNeuroVersePluginFromWorld,
  GovernanceBlockedError as OpenClawGovernanceBlockedError,
} from './openclaw';

export type {
  AgentAction,
  HookResult,
  NeuroVersePluginOptions,
} from './openclaw';

export {
  createGovernanceMiddleware,
  createGovernanceMiddlewareFromWorld,
} from './express';

export type {
  GovernanceRequest,
  GovernanceResponse,
  GovernanceMiddlewareOptions,
} from './express';
