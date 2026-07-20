import { parseAnnotationResponse } from './annotations'
import {
  draftSystemPrompt,
  draftUserPrompt,
  labelSystemPrompt,
  labelUserPrompt,
} from './prompts'
import type {
  DocumentSpec,
  GeneratedAnnotation,
  GeneratedDocument,
  GenerationProgress,
  GeneratorAdapter,
  LabelingAdapter,
  LabelInput,
  Usage,
} from './types'

export class ProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderConfigurationError'
  }
}

class ProviderHttpError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
  ) {
    super(`${provider} request failed with HTTP ${status}`)
    this.name = 'ProviderHttpError'
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
    private readonly options: {
      baseUrl?: string
      concurrency?: number
      timeoutMs?: number
    } = {},
  ) {
    this.name = `openrouter:${model}`
    this.apiKey = requiredEnvironment('OPENROUTER_API_KEY')
  }

  async generate(
    specs: DocumentSpec[],
    onProgress?: (progress: GenerationProgress) => void,
  ): Promise<GeneratedDocument[]> {
    return generateConcurrent(
      specs,
      this.options.concurrency ?? 3,
      onProgress,
      async (spec) => {
        const response = await this.request(spec)
        return {
          customId: spec.id,
          text: response.text,
          generator: `openrouter:${response.model}`,
          usage: response.usage,
        }
      },
    )
  }

  private async request(spec: DocumentSpec) {
    const response = await fetch(
      `${this.options.baseUrl ?? 'https://openrouter.ai/api/v1'}/chat/completions`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 120_000),
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 2_400,
          temperature: 0.65,
          messages: [
            { role: 'system', content: draftSystemPrompt },
            { role: 'user', content: draftUserPrompt(spec) },
          ],
        }),
      },
    )
    if (!response.ok)
      throw new Error(`OpenRouter request failed with HTTP ${response.status}`)
    return parseOpenAICompatibleResponse(await response.json(), 'OpenRouter')
  }
}

export class OpenRouterLabeler implements LabelingAdapter {
  readonly name: string
  readonly maxChargeAttempts = 1
  private readonly apiKey: string

  constructor(
    private readonly model: string,
    private readonly options: {
      baseUrl?: string
      concurrency?: number
      timeoutMs?: number
    } = {},
  ) {
    this.name = `openrouter:${model}`
    this.apiKey = requiredEnvironment('OPENROUTER_API_KEY')
  }

  async label(
    inputs: LabelInput[],
    onProgress?: (progress: GenerationProgress) => void,
  ): Promise<GeneratedAnnotation[]> {
    return this.annotate(inputs, undefined, onProgress)
  }

  async repair(
    inputs: LabelInput[],
    feedback: Map<string, string>,
    onProgress?: (progress: GenerationProgress) => void,
  ): Promise<GeneratedAnnotation[]> {
    return this.annotate(inputs, feedback, onProgress)
  }

  private async annotate(
    inputs: LabelInput[],
    feedback: Map<string, string> | undefined,
    onProgress: ((progress: GenerationProgress) => void) | undefined,
  ) {
    return generateConcurrent(
      inputs.map((input) => ({ ...input.spec, draftText: input.text })),
      this.options.concurrency ?? 3,
      onProgress,
      async (input) => {
        const response = await this.request(
          input,
          input.draftText,
          feedback?.get(input.id),
        )
        return {
          customId: input.id,
          spans: parseAnnotationResponse(
            response.text,
            input.draftText,
            input.id,
          ),
          generator: `openrouter:${response.model}`,
          usage: response.usage,
        }
      },
    )
  }

  private async request(
    spec: DocumentSpec,
    text: string,
    repairFeedback?: string,
  ) {
    const response = await fetch(
      `${this.options.baseUrl ?? 'https://openrouter.ai/api/v1'}/chat/completions`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 120_000),
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 2_400,
          temperature: 0,
          messages: [
            { role: 'system', content: labelSystemPrompt },
            {
              role: 'user',
              content: labelUserPrompt(spec, text, repairFeedback),
            },
          ],
        }),
      },
    )
    if (!response.ok) throw new ProviderHttpError('OpenRouter', response.status)
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
    text.trim().length === 0 ||
    typeof body.model !== 'string' ||
    typeof inputTokens !== 'number' ||
    typeof outputTokens !== 'number'
  )
    throw new Error(
      `${provider} response omitted visible text, model, or usage`,
    )
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
      timeoutMs?: number
    } = {},
  ) {
    this.name = `deepseek:${model}`
    this.apiKey = requiredEnvironment('DEEPSEEK_API_KEY')
  }

  async generate(
    specs: DocumentSpec[],
    onProgress?: (progress: GenerationProgress) => void,
  ): Promise<GeneratedDocument[]> {
    return generateConcurrent(
      specs,
      this.options.concurrency ?? 3,
      onProgress,
      async (spec) => {
        const response = await withRetries(
          () => this.request(spec),
          this.options.retries ?? 3,
          (error, attempt) =>
            onProgress?.({
              phase: 'retrying',
              completed: 0,
              total: specs.length,
              specId: spec.id,
              attempt,
              reason: retryReason(error),
            }),
        )
        return {
          customId: spec.id,
          ...response,
          generator: `deepseek:${response.model}`,
        }
      },
    )
  }

  private async request(spec: DocumentSpec) {
    const response = await fetch(
      `${this.options.baseUrl ?? 'https://api.deepseek.com'}/chat/completions`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 120_000),
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 2_400,
          temperature: 0.65,
          thinking: { type: 'disabled' },
          messages: [
            { role: 'system', content: draftSystemPrompt },
            { role: 'user', content: draftUserPrompt(spec) },
          ],
        }),
      },
    )
    if (!response.ok) throw new ProviderHttpError('DeepSeek', response.status)
    return parseOpenAICompatibleResponse(await response.json(), 'DeepSeek')
  }
}

async function generateConcurrent<T extends DocumentSpec, Result>(
  values: T[],
  concurrency: number,
  onProgress: ((progress: GenerationProgress) => void) | undefined,
  operation: (value: T) => Promise<Result>,
) {
  const output: Result[] = []
  let next = 0
  let completed = 0
  onProgress?.({ phase: 'submitted', completed, total: values.length })
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (next < values.length) {
        const index = next++
        const spec = values[index]!
        output[index] = await operation(spec)
        completed++
        onProgress?.({
          phase: 'completed',
          completed,
          total: values.length,
          specId: spec.id,
        })
      }
      return undefined
    }),
  )
  return output
}

async function withRetries<T>(
  operation: () => Promise<T>,
  retries: number,
  onRetry?: (error: unknown, attempt: number) => void,
) {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (attempt === retries || !isRetryable(error)) break
      onRetry?.(error, attempt + 1)
      await sleep(500 * 2 ** attempt + Math.floor(Math.random() * 250))
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('DeepSeek request failed')
}

function isRetryable(error: unknown) {
  if (error instanceof ProviderHttpError)
    return error.status === 408 || error.status === 429 || error.status >= 500
  return (
    error instanceof TypeError ||
    (error instanceof Error && error.name === 'TimeoutError')
  )
}

function retryReason(error: unknown) {
  if (error instanceof ProviderHttpError) return `HTTP ${error.status}`
  if (error instanceof TypeError) return 'network failure'
  if (error instanceof Error && error.name === 'TimeoutError')
    return 'request timeout'
  return 'transient provider failure'
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}
