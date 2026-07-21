import { afterEach, describe, expect, it } from 'vitest'
import {
  DeepSeekGenerator,
  OpenRouterJudge,
  OpenRouterLabeler,
  ProviderBatchError,
} from './providers'
import type { LabelInput, SyntheticDocument } from './types'

const previousOpenRouter = process.env.OPENROUTER_API_KEY
const previousDeepSeek = process.env.DEEPSEEK_API_KEY
afterEach(() => {
  if (previousOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = previousOpenRouter
  if (previousDeepSeek === undefined) delete process.env.DEEPSEEK_API_KEY
  else process.env.DEEPSEEK_API_KEY = previousDeepSeek
})
const input: LabelInput = {
  spec: {
    id: 'doc-1',
    docType: 'witness_statement',
    requiredCategories: [],
    register: 'formal_pleading',
    difficulty: 'standard',
    lengthWords: 1,
    seed: 's',
    scenario: 's',
    hardNegatives: [],
    matrixCells: [],
  },
  text: 'Fictional source.',
}

function parseRequestBody(
  value: BodyInit | null | undefined,
): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(String(value))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('not an object')
    return { ...parsed }
  } catch {
    throw new Error('Mock received invalid JSON request body')
  }
}

function fakeFetch(
  handler: (body: Record<string, unknown>) => Response,
): typeof fetch {
  return async (_input, init) => handler(parseRequestBody(init?.body))
}

describe('OpenRouter schema and offline failure behaviour', () => {
  it('requests strict JSON schema and keeps local quote validation', async () => {
    process.env.OPENROUTER_API_KEY = 'offline-test-only'
    let body: Record<string, unknown> | undefined
    const labeler = new OpenRouterLabeler('fake/model', {
      fetch: fakeFetch((request) => {
        body = request
        return new Response(
          JSON.stringify({
            model: 'fake/model',
            usage: { prompt_tokens: 2, completion_tokens: 3 },
            choices: [
              {
                message: {
                  content: JSON.stringify({ id: 'doc-1', spans: [] }),
                },
              },
            ],
          }),
        )
      }),
    })
    await expect(labeler.label([input])).resolves.toHaveLength(1)
    expect(body?.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { strict: true },
    })
  })
  it('sends judges only text and a quote-occurrence reference schema', async () => {
    process.env.OPENROUTER_API_KEY = 'offline-test-only'
    let body: Record<string, unknown> | undefined
    const judge = new OpenRouterJudge('fake/model', {
      fetch: fakeFetch((request) => {
        body = request
        return new Response(
          JSON.stringify({
            model: 'fake/model',
            usage: { prompt_tokens: 2, completion_tokens: 3 },
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    id: 'doc-1',
                    referenceSpans: [],
                    realismScore: 5,
                    confidence: 1,
                    rationale: 'fictional',
                  }),
                },
              },
            ],
          }),
        )
      }),
    })
    const document: SyntheticDocument = {
      id: 'doc-1',
      text: 'Fictional.',
      spans: [
        { category: 'person_private', start: 0, end: 9, text: 'Fictional' },
      ],
      generator: 'fixture',
      specCell: 'fixture',
      matrixCells: [],
      contentHash: 'fixture',
    }
    await expect(judge.judge([document])).resolves.toHaveLength(1)
    const prompt = String(
      (body?.messages as Array<{ content?: unknown }>)[0]?.content,
    )
    expect(prompt).not.toContain('Proposed spans')
    expect(prompt).not.toContain('"start"')
    expect(body?.response_format).toMatchObject({
      json_schema: {
        schema: {
          properties: {
            referenceSpans: {
              items: { required: ['category', 'quote', 'occurrence'] },
            },
          },
        },
      },
    })
  })

  it('retains billed response telemetry when annotation validation fails', async () => {
    process.env.OPENROUTER_API_KEY = 'offline-test-only'
    const labeler = new OpenRouterLabeler('fake/model', {
      fetch: fakeFetch(
        () =>
          new Response(
            JSON.stringify({
              model: 'fake/model',
              usage: { prompt_tokens: 2, completion_tokens: 3 },
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      id: 'doc-1',
                      spans: [
                        {
                          category: 'email',
                          quote: 'absent@example.test',
                          occurrence: 1,
                        },
                      ],
                    }),
                  },
                },
              ],
            }),
          ),
      ),
    })
    await expect(labeler.label([input])).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ProviderBatchError &&
        error.telemetry[0]?.usage?.outputTokens === 3 &&
        error.telemetry[0]?.errorCode === 'annotation_validation_failed',
    )
  })

  it('fails closed when a provider returns a different model identity', async () => {
    process.env.OPENROUTER_API_KEY = 'offline-test-only'
    const labeler = new OpenRouterLabeler('fake/model', {
      fetch: fakeFetch(
        () =>
          new Response(
            JSON.stringify({
              model: 'other/model',
              usage: { prompt_tokens: 2, completion_tokens: 3 },
              choices: [
                {
                  message: {
                    content: JSON.stringify({ id: 'doc-1', spans: [] }),
                  },
                },
              ],
            }),
          ),
      ),
    })
    await expect(labeler.label([input])).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ProviderBatchError &&
        error.telemetry[0]?.errorCode === 'model_identity_mismatch' &&
        error.telemetry[0]?.returnedModel === 'other/model',
    )
  })

  it('stops dequeueing after terminal failure and preserves failure telemetry', async () => {
    process.env.OPENROUTER_API_KEY = 'offline-test-only'
    let calls = 0
    const labeler = new OpenRouterLabeler('fake/model', {
      concurrency: 1,
      fetch: fakeFetch(() => {
        calls++
        return new Response('failure', { status: 500 })
      }),
    })
    await expect(
      labeler.label([
        input,
        { ...input, spec: { ...input.spec, id: 'doc-2' } },
        { ...input, spec: { ...input.spec, id: 'doc-3' } },
      ]),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ProviderBatchError && error.telemetry.length === 1,
    )
    expect(calls).toBe(1)
  })
  it('retains all terminal DeepSeek retry attempts with linked request IDs', async () => {
    process.env.DEEPSEEK_API_KEY = 'offline-test-only'
    const generator = new DeepSeekGenerator('fake-model', {
      retries: 1,
      fetch: fakeFetch(() => new Response('failure', { status: 500 })),
    })
    await expect(generator.generate([input.spec])).rejects.toSatisfy(
      (error: unknown) => {
        if (!(error instanceof ProviderBatchError)) return false
        const [first, second] = error.telemetry
        return (
          error.telemetry.length === 2 &&
          first?.retryOfRequestId === undefined &&
          second?.retryOfRequestId === first?.requestId
        )
      },
    )
  })

  it('rejects models explicitly configured without required schema support', async () => {
    process.env.OPENROUTER_API_KEY = 'offline-test-only'
    const labeler = new OpenRouterLabeler('fake/model', {
      schemaMode: 'unsupported',
    })
    await expect(labeler.label([input])).rejects.toThrow('does not support')
  })
})
