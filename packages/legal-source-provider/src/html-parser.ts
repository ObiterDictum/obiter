import {
  decodeHtml,
  extractDate,
  extractNeutralCitation,
  readTag,
} from './document-utils'

export function parseJudgmentParagraphs(html: string, documentId: string) {
  const judgmentHtml = extractJudgmentHtml(html)
  const structuredBlocks = Array.from(
    judgmentHtml.matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi),
  ).map((match) => htmlFragmentToText(match[2]))
  const fallbackBlocks = htmlFragmentToText(
    judgmentHtml.replace(/<\/(p|div|li|h[1-6])>/gi, '\n'),
  ).split(/\n+/)
  const bodyBlocks =
    structuredBlocks.length > 0 ? structuredBlocks : fallbackBlocks

  return bodyBlocks
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter(isJudgmentLine)
    .map((text, index) => ({
      id: `${documentId}-p${index + 1}`,
      documentId,
      paragraphNumber: index + 1,
      text,
    }))
}

function htmlFragmentToText(html: string) {
  return decodeHtml(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<header\b[\s\S]*?<\/header>/gi, ' ')
      .replace(/<footer\b[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<aside\b[\s\S]*?<\/aside>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
}

function extractJudgmentHtml(html: string) {
  return (
    html.match(/<article\b[\s\S]*?<\/article>/i)?.[0] ??
    html.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ??
    html
  )
}

function isJudgmentLine(line: string) {
  const lower = line.toLowerCase()
  const excluded = [
    'we place some essential cookies',
    'additional cookies',
    'this information will help us make improvements',
    'access official court judgments',
    'skip to main content',
    'cookie',
    'open justice licence',
  ]

  return !excluded.some((phrase) => lower.includes(phrase))
}

export function extractJudgmentTitleFromHtml(html: string) {
  const title =
    readTag(html, 'h1') ??
    html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ??
    ''

  return (
    decodeHtml(
      title
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+-\s+Find Case Law[\s\S]*$/i, '')
        .replace(/\s+/g, ' ')
        .trim(),
    ) || null
  )
}

export function extractNeutralCitationFromHtml(html: string) {
  const citationSource =
    html.match(/Neutral Citation Number[\s\S]{0,300}/i)?.[0] ??
    html.match(/judgment-header__neutral-citation[\s\S]{0,300}/i)?.[0] ??
    html

  return extractNeutralCitation(
    decodeHtml(citationSource.replace(/<[^>]+>/g, ' ')),
  )
}

export function extractJudgmentDateFromHtml(html: string) {
  const isoDate = extractDate(html)
  if (isoDate) return isoDate

  const slashDate = html.match(/\bDate:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\b/i)
  if (!slashDate) return null

  return `${slashDate[3]}-${slashDate[2].padStart(2, '0')}-${slashDate[1].padStart(2, '0')}`
}
