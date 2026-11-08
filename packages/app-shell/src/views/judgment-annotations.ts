import type { JudgmentParagraph } from '@obiter/contracts'
import {
  parseLegislationActPath,
  parseLegislationProvisionPath,
} from '@obiter/contracts/legislation-paths'

export function judgmentImageUrl(sourceUrl: string | undefined, src: string) {
  if (!sourceUrl || !/^[\w-]+(?:\.[\w-]+)*$/.test(src)) return undefined
  const url = URL.parse(sourceUrl)
  if (
    url?.hostname !== 'caselaw.nationalarchives.gov.uk' ||
    url.protocol !== 'https:'
  )
    return undefined
  return `https://assets.caselaw.nationalarchives.gov.uk/${url.pathname.replace(/^\/+|\/+$/g, '')}/${src}`
}

export function judgmentCitationTarget(
  citation: NonNullable<JudgmentParagraph['citations']>[number],
) {
  if (!citation.href) return undefined
  const url = URL.parse(citation.href)
  if (!url || url.protocol !== 'https:') return undefined
  if (
    citation.type === 'case' &&
    url.hostname === 'caselaw.nationalarchives.gov.uk'
  ) {
    const path = url.pathname.replace(/^\/+|\/+$/g, '')
    return /^[\w-]+(?:\/[\w-]+)+$/.test(path)
      ? `/cases/${path.replaceAll('/', '-')}`
      : undefined
  }
  if (
    citation.type === 'legislation' &&
    ['legislation.gov.uk', 'www.legislation.gov.uk'].includes(url.hostname)
  ) {
    const path = url.pathname.replace(/^\/+|\/+$/g, '')
    if (parseLegislationActPath(path) || parseLegislationProvisionPath(path))
      return `/ln/${path}${url.hash}`
  }
  return [
    'legislation.gov.uk',
    'www.legislation.gov.uk',
    'caselaw.nationalarchives.gov.uk',
  ].includes(url.hostname)
    ? url.href
    : undefined
}

export function judgmentAnnotations(
  text: string,
  paragraph?: JudgmentParagraph,
) {
  const valid = (offset: number) =>
    Number.isInteger(offset) && offset >= 0 && offset <= text.length
  let end = 0
  const citations = (paragraph?.citations ?? [])
    .filter(
      (c) =>
        valid(c.offset) &&
        Number.isInteger(c.length) &&
        c.length > 0 &&
        c.offset + c.length <= text.length,
    )
    .sort((a, b) => a.offset - b.offset || b.length - a.length)
    .filter((c) => {
      if (c.offset < end) return false
      end = c.offset + c.length
      return true
    })
  return {
    citations,
    footnotes: paragraph?.footnotes?.filter((f) => valid(f.offset)) ?? [],
    images: paragraph?.images?.filter((i) => valid(i.offset)) ?? [],
  }
}
