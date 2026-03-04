/**
 * AI Provider — chat/completions abstraction
 *
 * Single interface for LLM synthesis. Uses native fetch (Node 18+).
 * No SDK dependencies.
 *
 * Supports:
 *   - OpenAI (api.openai.com)
 *   - Azure OpenAI
 *   - Ollama / vLLM / LiteLLM (any chat/completions-compatible endpoint)
 */

import type { AIProvider, AIProviderConfig } from '../contracts/derive-contract';

// ─── OpenAI-Compatible Provider ─────────────────────────────────────────────

export class ChatCompletionsProvider implements AIProvider {
  private readonly model: string;
  private readonly apiKey: string;
  private readonly endpoint: string;

  constructor(config: AIProviderConfig) {
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.endpoint = config.endpoint ?? 'https://api.openai.com/v1/chat/completions';
  }

  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 16384,
    };

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Provider returned ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Provider returned empty response — no content in choices[0].message.content');
    }

    return content;
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createProvider(config: AIProviderConfig): AIProvider {
  return new ChatCompletionsProvider(config);
}
