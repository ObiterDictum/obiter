import Anthropic from '@anthropic-ai/sdk'
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

function textFromAnthropic(content: Array<{ type: string; text?: string }>) {
  const text = content.find((block) => block.type === 'text')?.text
  if (!text) throw new Error('Anthropic response contained no text block')
  return text
}

function usageFromAnthropic(usage: {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
}): Usage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? undefined,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? undefined,
  }
}

export class AnthropicBatchGenerator implements GeneratorAdapter {
  readonly name: string
  readonly maxChargeAttempts = 1
  private readonly client: Anthropic

  constructor(
    private readonly model: string,
    options: { pollIntervalMs?: number } = {},
  ) {
    this.name = `anthropic:${model}`
    this.client = new Anthropic({
      apiKey: requiredEnvironment('ANTHROPIC_API_KEY'),
    })
    this.pollIntervalMs = options.pollIntervalMs ?? 15_000
  }

  private readonly pollIntervalMs: number

  async generate(specs: DocumentSpec[]): Promise<GeneratedDocument[]> {
    const batch = await this.client.messages.batches.create({
      requests: specs.map((spec) => ({
        custom_id: spec.id,
        params: {
          model: this.model,
          max_tokens: 2_400,
          system: [
            {
              type: 'text',
              text: systemPrompt,
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [{ role: 'user', content: userPrompt(spec) }],
        },
      })),
    })

    let completed = batch
    while (completed.processing_status !== 'ended') {
      await sleep(this.pollIntervalMs)
      completed = await this.client.messages.batches.retrieve(batch.id)
    }

    const results = new Map<string, GeneratedDocument>()
    const failures: string[] = []
    for await (const result of await this.client.messages.batches.results(
      batch.id,
    )) {
      if (result.result.type !== 'succeeded') {
        failures.push(`${result.custom_id}: ${result.result.type}`)
        continue
      }
      const message = result.result.message
      results.set(result.custom_id, {
        customId: result.custom_id,
        text: textFromAnthropic(message.content),
        generator: `anthropic:${message.model}`,
        usage: usageFromAnthropic(message.usage),
      })
    }
    if (failures.length)
      throw new Error(
        `Anthropic batch ${batch.id} had failures: ${failures.join(', ')}`,
      )
    if (results.size !== specs.length)
      throw new Error(
        `Anthropic batch ${batch.id} returned ${results.size}/${specs.length} results`,
      )
    return specs.map((spec) => {
      const result = results.get(spec.id)
      if (!result)
        throw new Error(`Anthropic result missing custom_id ${spec.id}`)
      return result
    })
  }
}

type DeepSeekResponse = {
  model?: unknown
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }
  choices?: Array<{ message?: { content?: unknown } }>
}

function parseDeepSeekResponse(value: unknown): {
  text: string
  model: string
  usage: Usage
} {
  if (!value || typeof value !== 'object')
    throw new Error('DeepSeek returned invalid JSON')
  const body = value as DeepSeekResponse
  const text = body.choices?.[0]?.message?.content
  const inputTokens = body.usage?.prompt_tokens
  const outputTokens = body.usage?.completion_tokens
  if (
    typeof text !== 'string' ||
    typeof body.model !== 'string' ||
    typeof inputTokens !== 'number' ||
    typeof outputTokens !== 'number'
  )
    throw new Error('DeepSeek response omitted text, model, or usage')
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
    return parseDeepSeekResponse(await response.json())
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
