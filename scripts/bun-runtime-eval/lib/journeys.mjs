/*
 * The journey matrix: what a "sweep" consists of.
 *
 * Kept separate from the runner so the matrix (which routes, how many
 * requests, what concurrency) is one reviewable thing and the runner
 * (spawn, warm-up, sample, tear down) is another. Sample counts are
 * overridable per journey so a tail question (ONNX inference, verification)
 * can be re-measured at a larger n without changing the rest of the sweep.
 *
 * Defaults are sized so the whole sweep is bounded and the load generator
 * keeps headroom on a four-vCPU host; they are not large enough for a p95 to
 * mean anything on the small-count journeys, which the report says explicitly.
 */
import { createHash, randomBytes } from 'node:crypto'
import { DOCX_CONTENT_TYPE, fixtureFilename } from '../../load/fixtures.mjs'
import {
  bearer,
  json,
  keepAliveSequence,
  slowDownload,
  timedFetch,
} from './transport.mjs'

/**
 * Text long enough to make the ONNX detector do real chunked work: the
 * configured chunk size is 400 tokens, so this is several chunks of
 * entity-dense prose. Synthetic, no client data.
 */
export const INFERENCE_TEXT = Array.from(
  { length: 60 },
  (_, index) =>
    `Clause ${index + 1}. The parties acknowledge that Acme Holdings Limited, ` +
    `registered at 14 Fenchurch Street, London, and its director Ms Jane Whitfield ` +
    `(jane.whitfield@example.test, +44 7700 900123) shall keep the terms of this ` +
    `agreement confidential and shall not disclose them to any third party without ` +
    `prior written consent, save as required by law or by a competent regulatory authority.`,
).join(' ')

export function buildJourneyMatrix({
  origin,
  ids,
  fixtures,
  documentId,
  versionId,
  textDocumentId,
  counts = {},
}) {
  const medium = fixtures.find((entry) => entry.size === 'medium')
  const small = fixtures.find((entry) => entry.size === 'small')
  const port = Number(new URL(origin).port)

  const upload = (entry) => async () => {
    const form = new FormData()
    form.set('filename', fixtureFilename(entry))
    form.set('fileType', 'docx')
    form.set('sizeBytes', String(entry.bytes))
    form.set(
      'contentSha256',
      createHash('sha256').update(entry.content).digest('hex'),
    )
    form.set(
      'file',
      new File([entry.content], fixtureFilename(entry), {
        type: DOCX_CONTENT_TYPE,
      }),
    )
    return timedFetch(`${origin}/api/matters/${ids.matterId}/documents`, {
      method: 'POST',
      headers: bearer(ids.sessionToken),
      body: form,
    })
  }

  const matrix = [
    // Control only: a route that walks no data is not a product measurement.
    {
      name: 'health',
      requests: 40,
      concurrency: 4,
      run: () => timedFetch(`${origin}/api/health`),
    },
    {
      name: 'auth_me',
      requests: 40,
      concurrency: 4,
      run: () =>
        timedFetch(`${origin}/api/me`, { headers: bearer(ids.sessionToken) }),
    },
    {
      name: 'matters_list',
      requests: 40,
      concurrency: 4,
      run: () =>
        timedFetch(`${origin}/api/matters`, {
          headers: bearer(ids.sessionToken),
        }),
    },
    {
      name: 'matter_read',
      requests: 40,
      concurrency: 4,
      run: () =>
        timedFetch(`${origin}/api/matters/${ids.matterId}`, {
          headers: bearer(ids.sessionToken),
        }),
    },
    {
      name: 'matter_documents',
      requests: 40,
      concurrency: 4,
      run: () =>
        timedFetch(`${origin}/api/matters/${ids.matterId}/documents`, {
          headers: bearer(ids.sessionToken),
        }),
    },
    {
      name: 'search',
      requests: 24,
      concurrency: 2,
      run: () =>
        timedFetch(
          `${origin}/api/search/fetch`,
          json(
            {
              query: 'duty of care negligence',
              sourceType: 'judgment',
              foregroundLiveResults: false,
            },
            ids.sessionToken,
          ),
        ),
    },
    {
      name: 'search_readiness',
      requests: 20,
      concurrency: 2,
      run: () => timedFetch(`${origin}/api/search/readiness`),
    },
    {
      name: 'upload_small_extract',
      requests: 10,
      concurrency: 2,
      run: upload(small),
    },
    {
      name: 'upload_medium_extract',
      requests: 8,
      concurrency: 2,
      run: upload(medium),
    },
    {
      name: 'verification_run',
      requests: 8,
      concurrency: 1,
      run: () =>
        timedFetch(
          `${origin}/api/documents/${documentId}/verification-runs`,
          json({ versionId }, ids.sessionToken),
        ),
    },
    {
      name: 'redaction_run_inference',
      requests: 12,
      concurrency: 1,
      run: () =>
        timedFetch(
          `${origin}/api/redaction-runs`,
          json(
            {
              filename: `inference-${randomBytes(4).toString('hex')}.txt`,
              text: INFERENCE_TEXT,
              policyMode: 'internal_ai_minimisation',
            },
            ids.sessionToken,
          ),
        ),
    },
    {
      name: 'document_text_read',
      requests: 12,
      concurrency: 2,
      run: () =>
        timedFetch(`${origin}/api/documents/${textDocumentId}/text`, {
          headers: bearer(ids.sessionToken),
        }),
    },
    {
      name: 'download_stream',
      requests: 12,
      concurrency: 2,
      run: () =>
        timedFetch(`${origin}/api/documents/${documentId}/download`, {
          headers: bearer(ids.sessionToken),
        }),
    },
    {
      name: 'download_stream_slow_reader',
      requests: 6,
      concurrency: 2,
      run: () =>
        slowDownload(`${origin}/api/documents/${documentId}/download`, {
          token: ids.sessionToken,
          readDelayMs: 25,
        }),
    },
    {
      name: 'keep_alive_sequence',
      requests: 1,
      concurrency: 1,
      run: async () => {
        const result = await keepAliveSequence({
          port,
          path: '/api/matters',
          headers: bearer(ids.sessionToken),
          count: 30,
        })
        const sorted = [...result.times].sort((a, b) => a - b)
        return {
          ms: sorted[Math.floor(sorted.length / 2)],
          status: result.failures === 0 ? 200 : 0,
          bytes: 0,
          note: `${result.failures} failures over 30 requests on one reused connection`,
        }
      },
    },
  ]

  return matrix.map((journey) =>
    counts[journey.name]
      ? {
          ...journey,
          requests: counts[journey.name],
          defaultRequests: journey.requests,
        }
      : journey,
  )
}
