import { describe, expect, it } from 'bun:test'
import type { Pool } from 'pg'
import {
  detectHeuristics,
  type Span as RampartSpan,
  type TokenClassifier,
} from '@obiter/rampart-inference'
import {
  applyRedacted,
  mergeSpans,
  normalizePersonDetections,
  reconcileRampartSpans,
  supplementSpans,
  type Decisions,
  type RedactionSpan,
} from '@obiter/redaction-policy'
import { createApiApp } from './app'
import type { createAuth } from './auth'
import { createRedactionDetector } from './redaction-detection'
import type { RedactionRunRow } from './redaction-database'
import { createTestApiEnv } from './test-api-env'

type Auth = ReturnType<typeof createAuth>

const text = 'Alice alice@example.com'
const heuristic = detectHeuristics(text)
const modelSpan = {
  start: 0,
  end: 10,
  label: 'GIVEN_NAME' as const,
  score: 0.99,
  source: 'ner' as const,
  text: text.slice(0, 10),
}

function detectionSpans(): RedactionSpan[] {
  return mergeSpans(
    reconcileRampartSpans(
      text,
      normalizePersonDetections(text, [...heuristic, modelSpan]),
    ),
    supplementSpans(text),
  )
}

function accepted(spans: RedactionSpan[]): Decisions {
  return Object.fromEntries(
    spans.map((span) => [
      span.id,
      {
        decision: 'accept' as const,
        decidedBy: 'usr_1',
        decidedAt: '2026-01-01T00:00:00.000Z',
      },
    ]),
  )
}

function fromSuggestions(spans: RedactionSpan[]): Decisions {
  return Object.fromEntries(
    spans.map((span) => [
      span.id,
      {
        decision: span.suggestion === 'redact' ? 'accept' : 'reject',
        decidedBy: 'usr_1',
        decidedAt: '2026-01-01T00:00:00.000Z',
      } as Decisions[string],
    ]),
  )
}

function runRow(spans: RedactionSpan[], decisions: Decisions): RedactionRunRow {
  return {
    id: 'red_1',
    organisation_id: 'org_1',
    matter_id: null,
    matter_name: null,
    document_id: null,
    document_version_id: null,
    source_filename: 'source.txt',
    source_text_object_key: 'org/org_1/redaction-runs/red_1/source',
    source_file_object_key: null,
    source_layout_object_key: null,
    source_mime_type: null,
    status: 'ready_for_review',
    policy_mode: 'internal_ai_minimisation',
    spans_json: spans,
    decisions_json: decisions,
    output_id: null,
    summary_json: { totalSpans: spans.length },
    detector_version: null,
    detection_mode: 'model+supplement',
    replaces_run_id: null,
    replacement_run_id: null,
    returned_document_version_id: null,
    returned_matter_id: null,
    returned_document_id: null,
    returned_document_version_number: null,
    created_by: 'usr_1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
    deleted_by: null,
  }
}

function authWithRole(): Auth {
  return {
    api: {
      getSession: async () => ({
        user: { id: 'usr_1', organisationId: 'org_1', role: 'member' },
        session: { id: 'ses_1' },
      }),
    },
    handler: async () => new Response(null, { status: 404 }),
  } as unknown as Auth
}

function finalizeApp(
  sourceText: string,
  spans: RedactionSpan[],
  decisions: Decisions,
) {
  const readyRun = runRow(spans, decisions)
  const finalized = { ...readyRun, status: 'finalized' as const }
  let written: string | null = null
  let writtenBytes: Buffer | null = null
  const pool = {
    query: async (sql: unknown) => {
      const statement = String(sql)
      if (statement.includes('from redaction_runs')) return { rows: [readyRun] }
      return { rows: [] }
    },
    connect: async () => ({
      query: async (sql: unknown) => {
        const statement = String(sql)
        if (
          statement === 'begin' ||
          statement === 'commit' ||
          statement === 'rollback'
        )
          return { rows: [] }
        if (
          statement.includes('for update of run') ||
          statement.includes('select matter_id, document_id, replaces_run_id')
        )
          return { rows: [readyRun] }
        if (statement.includes('insert into outputs'))
          return {
            rows: [{ id: 'out_1', object_key: 'org/org_1/outputs/out_1' }],
          }
        if (statement.includes('update redaction_runs')) return { rows: [] }
        if (statement.includes('from redaction_runs'))
          return { rows: [finalized] }
        if (statement.includes('insert into audit_logs')) return { rows: [] }
        throw new Error(`Unexpected SQL: ${statement}`)
      },
      release: () => undefined,
    }),
  } as unknown as Pool

  const app = createApiApp(createTestApiEnv(), pool, {
    auth: authWithRole(),
    storage: {
      readText: async () => sourceText,
      writeText: async (_key: string, value: string) => {
        written = value
      },
      writeBinary: async (_key: string, value: Buffer) => {
        writtenBytes = Buffer.from(value)
      },
      delete: async () => undefined,
    },
  })
  return {
    app,
    written: () => written,
    writtenBytes: () => writtenBytes,
  }
}

describe('redaction merge integrity (P2.39)', () => {
  it('re-slices the partial-overlap union so every span matches the source', () => {
    const spans = detectionSpans()
    expect(spans).toHaveLength(1)
    for (const span of spans) {
      expect(text.slice(span.start, span.end)).toBe(span.text)
    }
  })

  it('finalizes a run whose detection produced a partial-overlap union', async () => {
    const spans = detectionSpans()
    const { app, written, writtenBytes } = finalizeApp(
      text,
      spans,
      accepted(spans),
    )

    const response = await app.request('/api/redaction-runs/red_1/finalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outputMode: 'redacted' }),
    })

    expect(response.status).toBe(200)
    expect(written()).toBeNull()
    expect(writtenBytes()!.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })
})

describe('heuristics run per detection before the span union (P0.30)', () => {
  function detect(text: string, spans: RampartSpan[]): RedactionSpan[] {
    return reconcileRampartSpans(text, normalizePersonDetections(text, spans))
  }

  it('covers bytes a losing detection contributed a title-shaped prefix to', () => {
    const text = 'Dr Smith Street'
    const spans = detect(text, [
      {
        start: 0,
        end: 8,
        label: 'STREET_NAME',
        score: 0.8,
        source: 'ner',
        text: 'Dr Smith',
      },
      {
        start: 3,
        end: 15,
        label: 'SURNAME',
        score: 0.9,
        source: 'ner',
        text: 'Smith Street',
      },
    ])
    expect(spans).toHaveLength(1)
    expect(spans[0]!.start).toBe(0)
    expect(text.slice(spans[0]!.start, spans[0]!.end)).toBe('Dr Smith Street')
  })

  it('drops only the detection that contained the line break', () => {
    const text = 'Jo\nnes Smith'
    const spans = detect(text, [
      {
        start: 0,
        end: 5,
        label: 'GIVEN_NAME',
        score: 0.5,
        source: 'ner',
        text: 'Jo\nne',
      },
      {
        start: 4,
        end: 12,
        label: 'SURNAME',
        score: 0.9,
        source: 'ner',
        text: 'es Smith',
      },
    ])
    expect(spans).toHaveLength(1)
    expect(text.slice(spans[0]!.start, spans[0]!.end)).toBe('es Smith')
  })

  it('preserves single-detection trimming and denial', () => {
    expect(
      detect('Mr. Smith', [
        {
          start: 0,
          end: 9,
          label: 'GIVEN_NAME',
          score: 0.9,
          source: 'ner',
          text: 'Mr. Smith',
        },
      ]).map((span) => span.text),
    ).toEqual(['Smith'])
    expect(
      detect('Jones\nLaw', [
        {
          start: 0,
          end: 9,
          label: 'GIVEN_NAME',
          score: 0.9,
          source: 'ner',
          text: 'Jones\nLaw',
        },
      ]),
    ).toEqual([])
  })
})

describe('overlap disposition (P0.31)', () => {
  const source = 'alpha bravo charlie delta'
  const contributors: RampartSpan[] = [
    {
      start: 6,
      end: 17,
      label: 'URL',
      score: 0.99,
      source: 'ner',
      text: source.slice(6, 17),
    },
    {
      start: 12,
      end: 19,
      label: 'GIVEN_NAME',
      score: 0.5,
      source: 'ner',
      text: source.slice(12, 19),
    },
  ]

  const containment: RampartSpan[] = [
    {
      start: 6,
      end: 19,
      label: 'GIVEN_NAME',
      score: 0.5,
      source: 'ner',
      text: source.slice(6, 19),
    },
    {
      start: 12,
      end: 19,
      label: 'URL',
      score: 0.99,
      source: 'ner',
      text: source.slice(12, 19),
    },
  ]

  it('redacts a redact-required union through the finalize route', async () => {
    const spans = mergeSpans(
      reconcileRampartSpans(
        source,
        normalizePersonDetections(source, contributors),
      ),
      supplementSpans(source),
    )
    const decisions = fromSuggestions(spans)
    expect(applyRedacted(source, spans, decisions)).toBe(
      'alpha [REDACTED] delta',
    )
    const { app, writtenBytes, written } = finalizeApp(source, spans, decisions)

    const response = await app.request('/api/redaction-runs/red_1/finalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outputMode: 'redacted' }),
    })

    expect(response.status).toBe(200)
    expect(written()).toBeNull()
    const bytes = writtenBytes()
    expect(bytes).not.toBeNull()
    expect(bytes!.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(bytes!.includes(Buffer.from('charlie'))).toBe(false)
  })

  it('honours explicit keep and redact overrides on the same union', async () => {
    const spans = mergeSpans(
      reconcileRampartSpans(
        source,
        normalizePersonDetections(source, containment),
      ),
      supplementSpans(source),
    )
    const decidedAt = '2026-01-01T00:00:00.000Z'
    const override = (
      decision: 'override_keep' | 'override_redact',
    ): Decisions =>
      Object.fromEntries(
        spans.map((span) => [
          span.id,
          { decision, decidedBy: 'usr_1', decidedAt },
        ]),
      )

    expect(applyRedacted(source, spans, override('override_keep'))).toBe(source)
    const kept = finalizeApp(source, spans, override('override_keep'))
    const keptResponse = await kept.app.request(
      '/api/redaction-runs/red_1/finalize',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outputMode: 'redacted' }),
      },
    )
    expect(keptResponse.status).toBe(200)
    expect(kept.written()).toBeNull()
    expect(kept.writtenBytes()!.subarray(0, 5).toString('latin1')).toBe('%PDF-')

    expect(applyRedacted(source, spans, override('override_redact'))).toBe(
      'alpha [REDACTED] delta',
    )
    const redacted = finalizeApp(source, spans, override('override_redact'))
    const redactedResponse = await redacted.app.request(
      '/api/redaction-runs/red_1/finalize',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outputMode: 'redacted' }),
      },
    )
    expect(redactedResponse.status).toBe(200)
    expect(redacted.written()).toBeNull()
    expect(redacted.writtenBytes()!.subarray(0, 5).toString('latin1')).toBe(
      '%PDF-',
    )
  })
})

describe('multi-window cross-window merge (P0.31 residual)', () => {
  const text =
    'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima ' +
    'mike november oscar papa quebec romeo sierra tango uniform victor whiskey ' +
    'xray yankee zulu'

  function seamClassifier(source: string): TokenClassifier {
    let cursor = 0
    let call = 0
    const classifier: TokenClassifier = async (window) => {
      const at = source.indexOf(window, cursor)
      if (at < 0) throw new Error('classifier window not found in source')
      cursor = at + 1
      const index = call++
      const emit = (
        label: 'URL' | 'GIVEN_NAME',
        score: number,
        start: number,
        end: number,
      ) => ({
        entity_group: label,
        score,
        start: start - at,
        end: end - at,
        word: label,
      })
      if (index === 0) return [emit('URL', 0.95, 50, 70)]
      if (index === 1) return [emit('GIVEN_NAME', 0.5, 60, 80)]
      return []
    }
    classifier.countTokens = (value) => value.length
    return classifier
  }

  it('does not let a keep winner erase a seam redact contributor', async () => {
    const detect = createRedactionDetector(
      {
        loadClassifier: async () => seamClassifier(text),
        log: () => undefined,
      },
      {
        model: 'example/rampart-test',
        revision: 'revision-1',
        cacheDir: '/tmp/rampart-cache',
        minScore: 0.4,
        chunkTokens: 100,
      },
    )
    const detection = await detect(text)
    expect(detection.degraded).toBe(false)
    expect(detection.spans).toHaveLength(1)
    expect(detection.spans[0]).toMatchObject({ suggestion: 'redact' })

    const { app, written } = finalizeApp(
      text,
      detection.spans,
      fromSuggestions(detection.spans),
    )
    const response = await app.request('/api/redaction-runs/red_1/finalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outputMode: 'redacted' }),
    })
    expect(response.status).toBe(200)
    expect(written()).toBeNull()
    expect(
      applyRedacted(text, detection.spans, fromSuggestions(detection.spans)),
    ).not.toContain(text.slice(60, 80))
  })
})
