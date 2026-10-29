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

/**
 * The two things a judgment page shows that Obiter may not derive from the
 * judgment itself: the bench and the court's summary.
 *
 * The Open Justice Licence covers storing and republishing a judgment; it does
 * not cover computational analysis of the text, which The National Archives
 * licenses separately. So every value here is read from a field Find Case Law
 * already publishes as structured metadata, and the field is recorded beside
 * the value. A judgment that carries no such field yields nothing — no regex
 * over the cover page, no model over the paragraphs.
 *
 * The `source` is `fcl_metadata` for everything this module can produce. A
 * later licensed extractor writes `extracted` into the same shape, so a reader
 * can always tell which rows were read and which were derived.
 */

export interface PublishedCaseLawMetadata {
  judges: CaseLawJudge[]
  summary: CaseLawSummary | null
}

/** A stored row, narrowed to what reading these fields needs. */
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

/**
 * Courts whose Find Case Law pages link a press summary. The UK Supreme Court
 * is the only publisher observed: sixteen sampled pages across EWCA Civ, EWCA
 * Crim, EWHC, UKUT, EAT and UKPC carried no such link. Adding a court here
 * costs one page fetch per judgment, so it needs evidence its pages link one.
 */
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

/**
 * The press summary is a separate published document. The judgment page links
 * it, and the summary's own `<uk:summaryOf>` names the judgment it belongs to;
 * both are checked, so a link to another case's summary is never stored.
 */
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
  // A summary that does not name this judgment is not this judgment's summary.
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

/** The judgment page's own link to its press summary, if it publishes one. */
function readPressSummaryHref(html: string): string | null {
  for (const match of html.matchAll(/href="([^"]+)"/gi)) {
    if (/\/press-summary$/.test(match[1])) return match[1]
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
