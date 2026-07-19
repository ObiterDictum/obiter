import { systemPrompt, userPrompt } from './prompts'
import type {
  DocumentSpec,
  GeneratedDocument,
  GeneratorAdapter,
  Usage,
} from './types'

export class ProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderConfigurationError'
  }
}

function requiredEnvironment(name: string) {
  const value = process.env[name]
  if (!value)
    throw new ProviderConfigurationError(
      `${name} is required. Set it in the environment; do not add it to a file.`,
    )
  return value
}

export class OpenRouterGenerator implements GeneratorAdapter {
  readonly name: string
  readonly maxChargeAttempts = 1
  private readonly apiKey: string

  constructor(
    private readonly model: string,
    private readonly options: { baseUrl?: string; concurrency?: number } = {},
  ) {
    this.name = `openrouter:${model}`
    this.apiKey = requiredEnvironment('OPENROUTER_API_KEY')
  }

  async generate(specs: DocumentSpec[]): Promise<GeneratedDocument[]> {
    return mapConcurrent(specs, this.options.concurrency ?? 3, async (spec) => {
      const response = await this.request(spec)
      return {
        customId: spec.id,
        text: response.text,
        generator: `openrouter:${response.model}`,
        usage: response.usage,
      }
    })
  }

  private async request(spec: DocumentSpec) {
    const response = await fetch(
      `${this.options.baseUrl ?? 'https://openrouter.ai/api/v1'}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 2_400,
          temperature: 0.85,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt(spec) },
          ],
        }),
      },
    )
    if (!response.ok)
      throw new Error(`OpenRouter request failed with HTTP ${response.status}`)
    return parseOpenAICompatibleResponse(await response.json(), 'OpenRouter')
  }
}

type OpenAICompatibleResponse = {
  model?: unknown
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }
  choices?: Array<{ message?: { content?: unknown } }>
}

function parseOpenAICompatibleResponse(
  value: unknown,
  provider: string,
): {
  text: string
  model: string
  usage: Usage
} {
  if (!value || typeof value !== 'object')
    throw new Error(`${provider} returned invalid JSON`)
  const body = value as OpenAICompatibleResponse
  const text = body.choices?.[0]?.message?.content
  const inputTokens = body.usage?.prompt_tokens
  const outputTokens = body.usage?.completion_tokens
  if (
    typeof text !== 'string' ||
    typeof body.model !== 'string' ||
    typeof inputTokens !== 'number' ||
    typeof outputTokens !== 'number'
  )
    throw new Error(`${provider} response omitted text, model, or usage`)
  return { text, model: body.model, usage: { inputTokens, outputTokens } }
}

export class DeepSeekGenerator implements GeneratorAdapter {
  readonly name: string
  readonly maxChargeAttempts = 4
  private readonly apiKey: string

  constructor(
    private readonly model: string,
    private readonly options: {
      baseUrl?: string
      concurrency?: number
      retries?: number
    } = {},
  ) {
    this.name = `deepseek:${model}`
    this.apiKey = requiredEnvironment('DEEPSEEK_API_KEY')
  }

  async generate(specs: DocumentSpec[]): Promise<GeneratedDocument[]> {
    const concurrency = this.options.concurrency ?? 3
    return mapConcurrent(specs, concurrency, async (spec) => {
      const response = await withRetries(
        () => this.request(spec),
        this.options.retries ?? 3,
      )
      return {
        customId: spec.id,
        ...response,
        generator: `deepseek:${response.model}`,
      }
    })
  }

  private async request(spec: DocumentSpec) {
    const response = await fetch(
      `${this.options.baseUrl ?? 'https://api.deepseek.com'}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 2_400,
          temperature: 0.85,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt(spec) },
          ],
        }),
      },
    )
    if (!response.ok)
      throw new Error(`DeepSeek request failed with HTTP ${response.status}`)
    return parseOpenAICompatibleResponse(await response.json(), 'DeepSeek')
  }
}

async function mapConcurrent<T, Result>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<Result>,
) {
  const output: Result[] = []
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (next < values.length) {
        const index = next++
        output[index] = await operation(values[index]!)
      }
      return undefined
    }),
  )
  return output
}

async function withRetries<T>(operation: () => Promise<T>, retries: number) {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (attempt === retries) break
      await sleep(500 * 2 ** attempt + Math.floor(Math.random() * 250))
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('DeepSeek request failed')
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}
