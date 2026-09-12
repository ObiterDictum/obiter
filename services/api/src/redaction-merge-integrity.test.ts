import { describe, expect, it } from 'vitest'
import type { Pool } from 'pg'
import {
  detectHeuristics,
  mergeSpans as mergeRampartSpans,
  type Span as RampartSpan,
} from '@obiter/rampart-inference'
import {
  mapRampartSpans,
  mergeSpans,
  normalizePersonDetections,
  supplementSpans,
  type Decisions,
  type RedactionSpan,
} from '@obiter/redaction-policy'
import { createApiApp } from './app'
import type { createAuth } from './auth'
import type { RedactionRunRow } from './redaction-database'
import { createTestApiEnv } from './test-api-env'

type Auth = ReturnType<typeof createAuth>

/**
 * P2.39 regression: upstream's `mergeSpans` emits a partial-overlap union whose
 * `text` still belongs to the winner while `start`/`end` cover both spans.
 * `mapRampartSpans` used to inherit that text, so finalize's
 * `text.slice(start, end) === text` check failed with a permanent 409. This
 * drives the real merge, mapper and policy merge, then the real finalize route.
 */
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
    mapRampartSpans({
      text,
      spans: mergeRampartSpans(
        normalizePersonDetections(text, [...heuristic, modelSpan]),
      ),
    }),
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

function runRow(spans: RedactionSpan[]): RedactionRunRow {
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
    decisions_json: accepted(spans),
    output_artifact_id: null,
    summary_json: { totalSpans: spans.length },
    detector_version: null,
    detection_mode: 'model+supplement',
    replaces_run_id: null,
    replacement_run_id: null,
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

function finalizeApp(spans: RedactionSpan[]) {
  const readyRun = runRow(spans)
  const finalized = { ...readyRun, status: 'finalized' as const }
  let written: string | null = null
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
        if (statement.includes('insert into artifacts'))
          return {
            rows: [{ id: 'art_1', object_key: 'org/org_1/artifacts/art_1' }],
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
      readText: async () => text,
      writeText: async (_key: string, value: string) => {
        written = value
      },
      delete: async () => undefined,
    },
  })
  return { app, written: () => written }
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
    const { app, written } = finalizeApp(spans)

    const response = await app.request('/api/redaction-runs/red_1/finalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outputMode: 'redacted' }),
    })

    expect(response.status).toBe(200)
    expect(written()).toBe('[REDACTED]')
  })
})

/**
 * P0.30: `trimLeadingTitles` and `isDeniedPersonName` are written for a span the
 * model returned as one detection. Applied to the partial-overlap union they
 * discard bytes the losing contributor supplied, silently, because finalize
 * derives span text from the source instead of rejecting a mismatch (P2.39).
 * Production normalises each contributing detection before the union; these
 * drive the real normaliser, union and mapper.
 */
describe('heuristics run per detection before the span union (P0.30)', () => {
  function detect(text: string, spans: RampartSpan[]): RedactionSpan[] {
    return mapRampartSpans({
      text,
      spans: mergeRampartSpans(normalizePersonDetections(text, spans)),
    })
  }

  it('covers bytes a losing detection contributed a title-shaped prefix to', () => {
    // The address detection starts "Dr", which the person heuristic would read
    // as an honorific. Trimmed on the union it advances past the address's own
    // bytes; trimmed per detection it leaves them covered.
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
    // Denying the union on its newline discards both contributors; denying per
    // detection keeps the clean one redacted.
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
