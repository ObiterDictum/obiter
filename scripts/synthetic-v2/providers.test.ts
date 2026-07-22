import { afterEach, describe, expect, it } from 'vitest'
import {
  DeepSeekGenerator,
  OpenCodeGoJudge,
  OpenRouterJudge,
  OpenRouterLabeler,
  ProviderBatchError,
  requestTelemetryFromResult,
  ZaiJudge,
} from './providers'
import type { LabelInput, SyntheticDocument } from './types'

const previousOpenRouter = process.env.OPENROUTER_API_KEY
const previousDeepSeek = process.env.DEEPSEEK_API_KEY
const previousOpenCodeGo = process.env.OPENCODE_GO_API_KEY
const previousZai = process.env.ZAI_API_KEY
const previousOpenCodeGoTerms = process.env.OBITER_OPENCODE_GO_TERMS_CONFIRMED
const previousZaiGeneralApi = process.env.OBITER_ZAI_GENERAL_API_CONFIRMED
afterEach(() => {
  if (previousOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = previousOpenRouter
  if (previousDeepSeek === undefined) delete process.env.DEEPSEEK_API_KEY
  else process.env.DEEPSEEK_API_KEY = previousDeepSeek
  if (previousOpenCodeGo === undefined) delete process.env.OPENCODE_GO_API_KEY
  else process.env.OPENCODE_GO_API_KEY = previousOpenCodeGo
  if (previousZai === undefined) delete process.env.ZAI_API_KEY
  else process.env.ZAI_API_KEY = previousZai
  if (previousOpenCodeGoTerms === undefined)
    delete process.env.OBITER_OPENCODE_GO_TERMS_CONFIRMED
  else process.env.OBITER_OPENCODE_GO_TERMS_CONFIRMED = previousOpenCodeGoTerms
  if (previousZaiGeneralApi === undefined)
    delete process.env.OBITER_ZAI_GENERAL_API_CONFIRMED
  else process.env.OBITER_ZAI_GENERAL_API_CONFIRMED = previousZaiGeneralApi
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
const document: SyntheticDocument = {
  id: 'doc-1',
  text: 'Fictional.',
  spans: [{ category: 'person_private', start: 0, end: 9, text: 'Fictional' }],
  generator: 'fixture',
  specCell: 'fixture',
  matrixCells: [],
  contentHash: 'fixture',
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

const judgeReference = {
  id: 'doc-1',
  proposedSpanDecisions: [
    {
      index: 0,
      action: 'keep',
      correctedCategory: 'person_private',
    },
  ],
  missingSpans: [],
  hardNegativeAssertions: [],
  realismScore: 5,
  confidence: 1,
  rationale: 'fictional',
}

function annotationToolMessage(payload: unknown) {
  return {
    tool_calls: [
      {
        function: {
          name: 'synthetic_v2_annotation',
          arguments: JSON.stringify(payload),
        },
      },
    ],
  }
}

describe('provider batch telemetry', () => {
  it('retains successful-item retry telemetry for later peer failures', () => {
    const retry = {
      requestId: 'retry-1',
      specId: 'doc-1',
      role: 'annotator' as const,
      provider: 'openrouter',
      requestedModel: 'fake/model',
      returnedModel: 'fake/model',
      usage: { inputTokens: 123, outputTokens: 45 },
      latencyMs: 1,
      status: 'error' as const,
      errorCode: 'annotation_invalid_json',
      attempt: 1,
    }
    const success = {
      ...retry,
      requestId: 'success-1',
      usage: { inputTokens: 100, outputTokens: 20 },
      status: 'success' as const,
      errorCode: undefined,
      attempt: 2,
      retryOfRequestId: retry.requestId,
    }
    expect(
      requestTelemetryFromResult({
        telemetry: success,
        retryTelemetry: [retry],
      }),
    ).toEqual([retry, success])
  })
})

describe('OpenRouter schema and offline failure behaviour', () => {
  it('forces a schema tool and keeps local token-range validation', async () => {
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
                  tool_calls: [
                    {
                      function: {
                        name: 'synthetic_v2_annotation',
                        arguments: { id: 'doc-1', spans: [] },
                      },
                    },
                  ],
                },
              },
            ],
          }),
        )
      }),
    })
    await expect(labeler.label([input])).resolves.toHaveLength(1)
    expect(body?.provider).toEqual({ require_parameters: true })
    expect(body?.reasoning).toEqual({ effort: 'minimal' })
    expect(body?.tool_choice).toEqual({
      type: 'function',
      function: { name: 'synthetic_v2_annotation' },
    })
    expect(body?.tools).toMatchObject([
      {
        function: {
          name: 'synthetic_v2_annotation',
          parameters: {
            properties: {
              spans: {
                items: {
                  required: ['category', 'startToken', 'endToken'],
                },
              },
            },
          },
        },
      },
    ])
    expect(JSON.stringify(body?.tools)).not.toContain('"start"')
  })

  it('retains billing evidence when a successful response omits output', async () => {
    process.env.OPENROUTER_API_KEY = 'offline-test-only'
    const labeler = new OpenRouterLabeler('fake/model', {
      fetch: fakeFetch(
        () =>
          new Response(
            JSON.stringify({
              model: 'fake/model',
              usage: { prompt_tokens: 123, completion_tokens: 45 },
              choices: [{ message: {} }],
            }),
          ),
      ),
    })
    await expect(labeler.label([input])).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ProviderBatchError &&
        error.telemetry[0]?.returnedModel === 'fake/model' &&
        error.telemetry[0]?.usage?.inputTokens === 123 &&
        error.telemetry[0]?.usage?.outputTokens === 45 &&
        error.telemetry[0]?.errorCode === 'provider_missing_tool_call',
    )
  })

  it('accepts a locally validated content fallback when a route omits tool_calls', async () => {
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
                    content: JSON.stringify({ id: 'doc-1', spans: [] }),
                  },
                },
              ],
            }),
          ),
      ),
    })
    await expect(labeler.label([input])).resolves.toHaveLength(1)
  })

  it('sends judges only text and a quote-occurrence reference schema', async () => {
    process.env.OPENROUTER_API_KEY = 'offline-test-only'
    let body: Record<string, unknown> | undefined
    const judge = new OpenRouterJudge('openai/gpt-4.1', {
      fetch: fakeFetch((request) => {
        body = request
        return new Response(
          JSON.stringify({
            model: 'openai/gpt-4.1',
            usage: { prompt_tokens: 2, completion_tokens: 3 },
            choices: [
              {
                message: {
                  content: JSON.stringify(judgeReference),
                },
              },
            ],
          }),
        )
      }),
    })
    await expect(judge.judge([document])).resolves.toHaveLength(1)
    if (!body) throw new Error('Judge request body was not captured')
    const prompt = String(
      (body.messages as Array<{ content?: unknown }>)[0]?.content,
    )
    expect(prompt).toContain('Proposed spans')
    expect(prompt).not.toContain('"start"')
    expect(body.provider).toEqual({ require_parameters: true })
    expect(body.temperature).toBe(0)
    expect(body.max_tokens).toBe(2400)
    expect(body.reasoning).toBeUndefined()
    expect(body.response_format).toMatchObject({
      json_schema: {
        schema: {
          properties: {
            proposedSpanDecisions: {
              items: {
                required: ['index', 'action', 'correctedCategory'],
              },
            },
            missingSpans: {
              items: { required: ['category', 'quote', 'occurrence'] },
            },
          },
        },
      },
    })
  })

  it('classifies length-limited invalid judge JSON as truncation', async () => {
    process.env.OPENROUTER_API_KEY = 'offline-test-only'
    const judge = new OpenRouterJudge('openai/gpt-5.4-mini', {
      fetch: fakeFetch(
        () =>
          new Response(
            JSON.stringify({
              model: 'openai/gpt-5.4-mini',
              usage: { prompt_tokens: 2, completion_tokens: 2400 },
              choices: [{ finish_reason: 'length', message: { content: '{' } }],
            }),
          ),
      ),
    })
    let failure: unknown
    try {
      await judge.judge([document])
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(ProviderBatchError)
    expect(failure).toMatchObject({
      telemetry: [
        expect.objectContaining({ errorCode: 'judge_output_truncated' }),
        expect.objectContaining({ errorCode: 'judge_output_truncated' }),
      ],
    })
  })

  it('retains only sanitized provider error fields for HTTP failures', async () => {
    process.env.OPENROUTER_API_KEY = 'offline-test-only'
    const judge = new OpenRouterJudge('openai/gpt-5.4-mini', {
      fetch: fakeFetch(
        () =>
          new Response(
            JSON.stringify({
              error: {
                type: 'invalid_request_error',
                code: 'unsupported_parameter',
                param: 'temperature',
                message: 'must not persist this provider message',
              },
            }),
            { status: 400 },
          ),
      ),
    })
    let failure: unknown
    try {
      await judge.judge([document])
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(ProviderBatchError)
    expect(failure).toMatchObject({
      telemetry: [
        expect.objectContaining({
          errorCode:
            'http_400:invalid_request_error:unsupported_parameter:temperature',
        }),
      ],
    })
    expect(JSON.stringify(failure)).not.toContain('must not persist')
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
                  message: annotationToolMessage({
                    id: 'doc-1',
                    spans: [
                      {
                        category: 'email',
                        startToken: 0,
                        endToken: 99,
                      },
                    ],
                  }),
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
        error.telemetry[0]?.errorCode === 'annotation_span_shape_invalid',
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
                  message: annotationToolMessage({
                    id: 'doc-1',
                    spans: [],
                  }),
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
        error instanceof ProviderBatchError &&
        error.telemetry.length === 2 &&
        error.telemetry[1]?.retryOfRequestId === error.telemetry[0]?.requestId,
    )
    expect(calls).toBe(2)
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

  it('uses Z.ai JSON mode with local schema validation and provider telemetry', async () => {
    process.env.ZAI_API_KEY = 'offline-test-only'
    process.env.OBITER_ZAI_GENERAL_API_CONFIRMED = '1'
    let body: Record<string, unknown> | undefined
    const judge = new ZaiJudge('glm-5.2', {
      fetch: fakeFetch((request) => {
        body = request
        return new Response(
          JSON.stringify({
            model: 'glm-5.2',
            usage: { prompt_tokens: 2, completion_tokens: 3 },
            choices: [{ message: { content: JSON.stringify(judgeReference) } }],
          }),
        )
      }),
    })
    const [result] = await judge.judge([document])
    expect(body?.response_format).toEqual({ type: 'json_object' })
    expect(JSON.stringify(body?.messages)).toContain('proposedSpanDecisions')
    expect(result?.telemetry?.provider).toBe('zai')
  })

  it('uses OpenCode Go OpenAI-compatible models with explicit JSON mode', async () => {
    process.env.OPENCODE_GO_API_KEY = 'offline-test-only'
    process.env.OBITER_OPENCODE_GO_TERMS_CONFIRMED = '1'
    let body: Record<string, unknown> | undefined
    const judge = new OpenCodeGoJudge('glm-5.2', {
      fetch: fakeFetch((request) => {
        body = request
        return new Response(
          JSON.stringify({
            model: 'glm-5.2',
            usage: { prompt_tokens: 2, completion_tokens: 3 },
            choices: [{ message: { content: JSON.stringify(judgeReference) } }],
          }),
        )
      }),
    })
    const [result] = await judge.judge([document])
    expect(body?.response_format).toEqual({ type: 'json_object' })
    expect(body?.thinking).toEqual({ type: 'disabled' })
    expect(body?.reasoning_effort).toBe('none')
    expect(result?.telemetry?.provider).toBe('opencode-go')
  })

  it('retries a locally invalid judge reference with validation feedback', async () => {
    process.env.OPENCODE_GO_API_KEY = 'offline-test-only'
    process.env.OBITER_OPENCODE_GO_TERMS_CONFIRMED = '1'
    const bodies: Record<string, unknown>[] = []
    const judge = new OpenCodeGoJudge('glm-5.2', {
      fetch: fakeFetch((request) => {
        bodies.push(request)
        const reference =
          bodies.length === 1
            ? {
                ...judgeReference,
                missingSpans: [
                  {
                    category: 'person_private',
                    quote: 'Absent',
                    occurrence: 1,
                  },
                ],
              }
            : judgeReference
        return new Response(
          JSON.stringify({
            model: 'glm-5.2',
            usage: { prompt_tokens: 2, completion_tokens: 3 },
            choices: [{ message: { content: JSON.stringify(reference) } }],
          }),
        )
      }),
    })
    const [result] = await judge.judge([document])
    expect(bodies).toHaveLength(2)
    expect(JSON.stringify(bodies[1]?.messages)).toContain('VALIDATION FEEDBACK')
    expect(JSON.stringify(bodies[1]?.messages)).toContain('Absent')
    expect(JSON.stringify(bodies[1]?.messages)).toContain(
      'Copy the replacement quote directly from Text',
    )
    expect(result?.retryTelemetry).toHaveLength(1)
    expect(result?.telemetry?.retryOfRequestId).toBe(
      result?.retryTelemetry?.[0]?.requestId,
    )
  })

  it('uses a forced schema tool for OpenCode Go Anthropic-compatible models', async () => {
    process.env.OPENCODE_GO_API_KEY = 'offline-test-only'
    process.env.OBITER_OPENCODE_GO_TERMS_CONFIRMED = '1'
    let body: Record<string, unknown> | undefined
    const judge = new OpenCodeGoJudge('qwen3.7-max', {
      fetch: fakeFetch((request) => {
        body = request
        return new Response(
          JSON.stringify({
            model: 'qwen3.7-max',
            usage: { input_tokens: 2, output_tokens: 3 },
            content: [
              {
                type: 'tool_use',
                name: 'synthetic_v2_structured_review',
                input: judgeReference,
              },
            ],
          }),
        )
      }),
    })
    await expect(judge.judge([document])).resolves.toHaveLength(1)
    expect(body?.tool_choice).toEqual({
      type: 'tool',
      name: 'synthetic_v2_structured_review',
    })
    expect(JSON.stringify(body?.tools)).toContain('proposedSpanDecisions')
  })

  it('retains Anthropic-compatible billing evidence when tool output is missing', async () => {
    process.env.OPENCODE_GO_API_KEY = 'offline-test-only'
    process.env.OBITER_OPENCODE_GO_TERMS_CONFIRMED = '1'
    const judge = new OpenCodeGoJudge('qwen3.7-max', {
      fetch: fakeFetch(
        () =>
          new Response(
            JSON.stringify({
              model: 'qwen3.7-max',
              usage: { input_tokens: 123, output_tokens: 45 },
              content: [],
            }),
          ),
      ),
    })
    await expect(judge.judge([document])).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ProviderBatchError &&
        error.telemetry[0]?.returnedModel === 'qwen3.7-max' &&
        error.telemetry[0]?.usage?.inputTokens === 123 &&
        error.telemetry[0]?.usage?.outputTokens === 45,
    )
  })

  it('rejects OpenCode Go models outside the reviewed endpoint allowlist', () => {
    process.env.OPENCODE_GO_API_KEY = 'offline-test-only'
    process.env.OBITER_OPENCODE_GO_TERMS_CONFIRMED = '1'
    expect(() => new OpenCodeGoJudge('unreviewed-model')).toThrow(
      'reviewed endpoint allowlist',
    )
  })

  it('fails closed until provider-specific terms are confirmed', () => {
    process.env.ZAI_API_KEY = 'offline-test-only'
    process.env.OPENCODE_GO_API_KEY = 'offline-test-only'
    delete process.env.OBITER_ZAI_GENERAL_API_CONFIRMED
    delete process.env.OBITER_OPENCODE_GO_TERMS_CONFIRMED
    expect(() => new ZaiJudge('glm-5.2')).toThrow('general Z.ai API key')
    expect(() => new OpenCodeGoJudge('grok-4.5')).toThrow(
      'reviewing the Go API terms',
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
