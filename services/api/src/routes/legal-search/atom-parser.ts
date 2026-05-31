import type { LegalFetchRequest } from './fetch-schema'
import {
  courtFromCitation,
  courtFromFindCaseLawPath,
  findCaseLawJurisdiction,
  supportedFindCaseLawCourts,
  normalizeCourtCode,
} from './court-utils'
import {
  decodeXml,
  extractDate,
  extractNeutralCitation,
  hashText,
  readAlternateLink,
  readIdentifier,
  readTag,
  readTypedLink,
  toDocumentUri,
} from './document-utils'

export interface AtomEntry {
  title: string
  neutralCitation: string | null
  court: string
  dateDecided: string
  uri: string
  sourceUri: string
  xmlUri: string | null
  pdfUri: string | null
  contentHash: string
  rawXml: string
}

export function parseFindCaseLawAtom(xml: string, request: LegalFetchRequest): AtomEntry[] {
  const normalizedRequest: LegalFetchRequest = {
    ...request,
    court: request.court ? normalizeCourtCode(request.court) : undefined,
  }

  return Array.from(xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi))
    .map((match) => parseAtomEntry(match[0], normalizedRequest))
    .filter((entry): entry is AtomEntry => entry !== null)
    .filter((entry) => entryMatchesFetchRequest(entry, normalizedRequest))
}

function parseAtomEntry(xml: string, request: LegalFetchRequest): AtomEntry | null {
  const title = decodeXml(readTag(xml, 'title') ?? '')
  const source = readAlternateLink(xml) ?? decodeXml(readTag(xml, 'id') ?? '')
  const sourceUri = toDocumentUri(source)
  const documentUri = toDocumentUri(decodeXml(readTag(xml, 'tna:uri') ?? '')) ?? sourceUri
  const xmlUri =
    readTypedLink(xml, 'application/xml') ??
    (sourceUri ? `${sourceUri.replace(/\/$/, '')}/data.xml` : null)
  const pdfUri = readTypedLink(xml, 'application/pdf') ?? null
  const updated = decodeXml(readTag(xml, 'published') ?? readTag(xml, 'updated') ?? '')
  const neutralCitation = extractNeutralCitation(readIdentifier(xml) ?? title) ?? null
  const dateDecided = extractDate(updated) ?? extractDate(title)
  const court =
    (neutralCitation ? courtFromCitation(neutralCitation) : null) ??
    courtFromFindCaseLawPath(sourceUri) ??
    courtFromFindCaseLawPath(documentUri) ??
    request.court ??
    null

  if (!title || !documentUri || !sourceUri || !court || !dateDecided) {
    return null
  }

  return {
    title: title.replace(/\s+/g, ' ').trim(),
    neutralCitation,
    court,
    dateDecided,
    uri: documentUri,
    sourceUri,
    xmlUri,
    pdfUri,
    contentHash: decodeXml(readTag(xml, 'tna:contenthash') ?? '') || hashText(xml),
    rawXml: xml,
  }
}

export function isSupportedFindCaseLawRequest(request: LegalFetchRequest) {
  return (
    (!request.court || supportedFindCaseLawCourts.has(request.court)) &&
    (!request.jurisdiction || request.jurisdiction === findCaseLawJurisdiction)
  )
}

function entryMatchesFetchRequest(entry: AtomEntry, request: LegalFetchRequest) {
  if (request.court && entry.court !== request.court) return false
  if (request.jurisdiction && request.jurisdiction !== findCaseLawJurisdiction) return false
  if (request.dateFrom && entry.dateDecided < request.dateFrom) return false
  if (request.dateTo && entry.dateDecided > request.dateTo) return false
  return true
}
