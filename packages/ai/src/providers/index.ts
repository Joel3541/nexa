import { env } from '@nexa/config';
import type { AiProvider } from '../provider.js';
import { AnthropicAiProvider } from './anthropic.js';
import { MockAiProvider } from './mock.js';

let cached: AiProvider | null = null;

/**
 * Resolves the configured provider. `mock` needs no credentials and answers
 * from real seeded data; `anthropic` requires AI_API_KEY (validated at boot).
 */
export function getAiProvider(): AiProvider {
  if (cached) return cached;
  cached = env.AI_PROVIDER === 'anthropic' ? new AnthropicAiProvider(env.AI_API_KEY!) : new MockAiProvider();
  return cached;
}

export function setAiProviderForTesting(provider: AiProvider | null): void {
  cached = provider;
}

export { MockAiProvider, AnthropicAiProvider };
