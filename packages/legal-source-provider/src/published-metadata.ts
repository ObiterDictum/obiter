import type { CaseLawJudge, CaseLawSummary } from '@obiter/legal-schema'
import type {
  FindCaseLawEnv,
  ProviderFetch,
  ProviderSkipReason,
} from './moj-provider'
import { resolveProviderUrl } from './fetch-safety'
import {
  extractLegalDocMlJudges,
  extractLegalDocMlPressSummary,
} from './legaldocml-parser'
import type { MojRequestBudget } from './rate-limiter'

// Legal: The Open Justice Licence covers storing and republishing a judgment, not computational analysis of its text. The bench and the court's summary are read only from structured metadata Find Case Law publishes, never derived by regex or model, and a judgment without the field yields nothing.
export interface PublishedCaseLawMetadata {
  judges: CaseLawJudge[]
  summary: CaseLawSummary | null
}

export interface PublishedMetadataSourceRecord {
  court: string
  xmlUri: string | null
  sourceUri: string
}

export type PublishedMetadataFailure =
  | { status: 'rate_limited'; retryAfter: string | null }
  | { status: 'unavailable' }
  | { status: 'skipped'; reason: ProviderSkipReason }

export type PublishedMetadataResult =
  | { status: 'ok'; metadata: PublishedCaseLawMetadata }
  | PublishedMetadataFailure

const pressSummaryCourts: ReadonlySet<string> = new Set(['uksc'])

export async function fetchPublishedCaseLawMetadata(
  env: FindCaseLawEnv,
  record: PublishedMetadataSourceRecord,
  budget: MojRequestBudget,
  options: { fetchImpl?: ProviderFetch } = {},
): Promise<PublishedMetadataResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const judges: CaseLawJudge[] = []

  if (record.xmlUri) {
    const xmlUrl = resolveProviderUrl(env.mojFindCaseLawBaseUrl, record.xmlUri)
    if (!xmlUrl) return { status: 'skipped', reason: 'off_origin' }

    const xml = await fetchProviderText(xmlUrl, fetchImpl, budget)
    if (xml.status !== 'ok') return xml

    judges.push(
      ...extractLegalDocMlJudges(xml.text).map((name): CaseLawJudge => ({
        name,
        source: 'fcl_metadata',
        field: 'legaldocml:judge',
      })),
    )
  }

  if (!pressSummaryCourts.has(record.court)) {
    return { status: 'ok', metadata: { judges, summary: null } }
  }

  const summary = await fetchPressSummary(env, record, fetchImpl, budget)
  if (summary.status !== 'ok') return summary

  return { status: 'ok', metadata: { judges, summary: summary.summary } }
}

async function fetchPressSummary(
  env: FindCaseLawEnv,
  record: PublishedMetadataSourceRecord,
  fetchImpl: ProviderFetch,
  budget: MojRequestBudget,
): Promise<
  { status: 'ok'; summary: CaseLawSummary | null } | PublishedMetadataFailure
> {
  const detailUrl = resolveProviderUrl(
    env.mojFindCaseLawBaseUrl,
    record.sourceUri,
  )
  if (!detailUrl) return { status: 'skipped', reason: 'off_origin' }

  const page = await fetchProviderText(detailUrl, fetchImpl, budget)
  if (page.status !== 'ok') return page

  const href = readPressSummaryHref(page.text)
  if (!href) return { status: 'ok', summary: null }

  const summaryPageUrl = resolveProviderUrl(env.mojFindCaseLawBaseUrl, href)
  const summaryXmlUrl = summaryPageUrl
    ? resolveProviderUrl(
        env.mojFindCaseLawBaseUrl,
        `${summaryPageUrl.toString().replace(/\/$/, '')}/data.xml`,
      )
    : null
  if (!summaryPageUrl || !summaryXmlUrl) return { status: 'ok', summary: null }

  const xml = await fetchProviderText(summaryXmlUrl, fetchImpl, budget)
  if (xml.status !== 'ok') return xml

  const summary = extractLegalDocMlPressSummary(xml.text)
  if (!summary) return { status: 'skipped', reason: 'unparsable' }
  const summaryPath = documentPath(summary.summaryOf)
  const judgmentPath = documentPath(record.sourceUri)
  if (!summaryPath || !judgmentPath || summaryPath !== `/id${judgmentPath}`)
    return { status: 'ok', summary: null }

  return {
    status: 'ok',
    summary: {
      paragraphs: summary.paragraphs,
      source: 'fcl_metadata',
      field: 'legaldocml:press-summary',
      sourceUrl: summaryPageUrl.toString(),
    },
  }
}

function readPressSummaryHref(html: string): string | null {
  for (const match of html.matchAll(/href="([^"]+)"/gi)) {
    if (match[1].endsWith('/press-summary')) return match[1]
  }
  return null
}

function documentPath(value: string | null): string | null {
  if (!value) return null
  if (value.startsWith('/') && !value.startsWith('//'))
    return value.replace(/\/$/, '')
  try {
    return new URL(value).pathname.replace(/\/$/, '')
  } catch {
    return null
  }
}

type ProviderText = { status: 'ok'; text: string } | PublishedMetadataFailure

async function fetchProviderText(
  url: URL,
  fetchImpl: ProviderFetch,
  budget: MojRequestBudget,
): Promise<ProviderText> {
  const charged = await budget.charge()
  if (charged.status === 'unavailable') return { status: 'unavailable' }
  if (charged.status === 'rate_limited') {
    return {
      status: 'rate_limited',
      retryAfter: charged.retryAfterSeconds.toString(),
    }
  }

  let response: Response
  try {
    response = await fetchImpl(url, { redirect: 'manual' })
  } catch {
    return { status: 'unavailable' }
  }

  if (response.status === 429) {
    return {
      status: 'rate_limited',
      retryAfter: response.headers.get('retry-after'),
    }
  }
  if (response.status >= 500) return { status: 'unavailable' }
  if (!response.ok) return { status: 'skipped', reason: 'http_error' }

  return { status: 'ok', text: await response.text() }
}
