import type { LegalFetchRequest } from './fetch-schema'
import {
  supportedFindCaseLawCourts,
  toFindCaseLawCourtParam,
} from './court-utils'

export function readTag(xml: string, tag: string) {
  return xml.match(
    new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'),
  )?.[1]
}

export function readAlternateLink(xml: string) {
  return readLink(
    xml,
    (attributes) =>
      hasLinkRel(attributes, 'alternate') &&
      !readLinkAttribute(attributes, 'type'),
  )
}

export function readTypedLink(xml: string, type: string) {
  return readLink(
    xml,
    (attributes) =>
      hasLinkRel(attributes, 'alternate') &&
      readLinkAttribute(attributes, 'type')?.toLowerCase() === type,
  )
}

export function readRelLink(xml: string, rel: string) {
  return readLink(xml, (attributes) => hasLinkRel(attributes, rel))
}

export function readIdentifier(xml: string) {
  return xml.match(
    /<tna:identifier\b[^>]*type=["']ukncn["'][^>]*>([\s\S]*?)<\/tna:identifier>/i,
  )?.[1]
}

/**
 * Attribute values in an Atom feed are XML-escaped, so a paged feed's next link
 * arrives as `...&amp;page=2`. Handed to `new URL` undecoded it parses as a
 * parameter literally named `amp;page`, which silently drops both the page
 * number and every filter after the first ampersand: the request then returns
 * page one again. Decoding here keeps that from reaching any caller.
 */
function readLink(xml: string, predicate: (attributes: string) => boolean) {
  const attributes = Array.from(xml.matchAll(/<link\b([^>]*?)\/?>/gi))
    .map((match) => match[1])
    .find(predicate)

  if (!attributes) return undefined

  const href = readLinkAttribute(attributes, 'href')
  return href === undefined ? undefined : decodeXml(href)
}

function hasLinkRel(attributes: string, rel: string) {
  return (
    readLinkAttribute(attributes, 'rel')
      ?.split(/\s+/)
      .some((value) => value.toLowerCase() === rel.toLowerCase()) ?? false
  )
}

function readLinkAttribute(attributes: string, name: string) {
  return attributes.match(new RegExp(`\\b${name}=["']([^"']+)["']`, 'i'))?.[1]
}

export function toDocumentUri(value: string) {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.pathname
  } catch {
    return value.startsWith('/') ? value : `/${value}`
  }
}

export function documentIdFromUri(uri: string) {
  return uri
    .replace(/^\/+/, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

export function documentUriFromId(documentId: string) {
  if (documentId.startsWith('d-')) {
    return null
  }

  const court = Array.from(supportedFindCaseLawCourts)
    .sort((left, right) => right.length - left.length)
    .find((supportedCourt) => documentId.startsWith(`${supportedCourt}-`))

  if (!court) return null

  const suffix = documentId.slice(court.length + 1)
  const segments = suffix.split('-').filter(Boolean)
  const yearIndex = segments.findIndex(
    (segment, index) =>
      /^\d{4}$/.test(segment) && /^\d+$/.test(segments[index + 1] ?? ''),
  )

  if (yearIndex === -1) return null

  const nestedPath = segments.slice(0, yearIndex).join('/')
  const year = segments[yearIndex]
  const sequence = segments[yearIndex + 1]
  const courtPath = toFindCaseLawCourtParam(court)
  const prefix = nestedPath ? `${courtPath}/${nestedPath}` : courtPath

  return `/${prefix}/${year}/${sequence}`
}

export function courtFromDocumentId(documentId: string) {
  return (
    Array.from(supportedFindCaseLawCourts)
      .sort((left, right) => right.length - left.length)
      .find((court) => documentId.startsWith(`${court}-`)) ?? null
  )
}

export function dateFromDocumentId(documentId: string) {
  const year = documentId.match(/-(\d{4})-\d+$/)?.[1]
  return year ? `${year}-01-01` : null
}

const neutralCitationPattern =
  /\[\d{4}\]\s+[A-Za-z][A-Za-z0-9 ]*?\s+\d+(?:\s+\([A-Za-z][A-Za-z0-9 ]*\))?/

export function extractNeutralCitation(value: string) {
  return value.match(neutralCitationPattern)?.[0].replace(/\s+/g, ' ').trim()
}

export function addFindCaseLawDateParams(
  url: URL,
  request: Pick<LegalFetchRequest, 'dateFrom' | 'dateTo'>,
) {
  addFindCaseLawDateParam(url, 'from_date', request.dateFrom)
  addFindCaseLawDateParam(url, 'to_date', request.dateTo)
}

function addFindCaseLawDateParam(
  url: URL,
  prefix: 'from_date' | 'to_date',
  value?: string,
) {
  if (!value) return

  const [year, month, day] = value.split('-')
  url.searchParams.set(`${prefix}_0`, day)
  url.searchParams.set(`${prefix}_1`, month)
  url.searchParams.set(`${prefix}_2`, year)
}

export function extractDate(value: string) {
  return value.match(/\d{4}-\d{2}-\d{2}/)?.[0]
}

export function decodeXml(value: string) {
  return decodeHtml(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))
}

export function decodeHtml(value: string) {
  return (
    value
      // Numeric character references, decimal and hexadecimal. Judgment text is
      // full of them — curly quotes, dashes, section marks — and leaving them
      // encoded puts `&#8220;` into the indexed text where a quotation mark
      // belongs, so a phrase query spanning a quote cannot match.
      .replace(/&#(\d+);/g, (match, code: string) =>
        codePointToString(Number(code), match),
      )
      .replace(/&#[xX]([0-9a-fA-F]+);/g, (match, code: string) =>
        codePointToString(Number.parseInt(code, 16), match),
      )
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      // Last, so that an encoded entity such as `&amp;#8220;` decodes to the
      // literal text `&#8220;` rather than being decoded twice into a quote.
      .replace(/&amp;/g, '&')
  )
}

function codePointToString(codePoint: number, fallback: string) {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return fallback
  }

  try {
    return String.fromCodePoint(codePoint)
  } catch {
    return fallback
  }
}

export function hashText(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash.toString(16)
}
