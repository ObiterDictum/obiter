/**
 * Pure CLML parsing for Stage 1 legislation ingest. No network, no
 * storage: one row per P1..P5 element carrying an /id/ URI under the
 * requested document, in document order, plus the year-feed listing
 * parse. Fetching, resumption, and database writes live in
 * legislation-ingest.ts.
 *
 * Size note: the tokenizer keeps provision, extent, title, and text state in
 * one pass (~350 lines, over the 300 target). Splitting open/close handling
 * across modules would separate state updates from the state they update;
 * the module is pure with one entry point and its tests read the samples.
 */

import { createHash } from 'node:crypto'

export const legislationBaseUrl = 'https://www.legislation.gov.uk'

export interface IngestActRef {
  actType: string
  year: number
  number: number
  title: string
}

export interface IngestProvision {
  labelPath: string
  label: string
  extent: string
  text: string
  docOrder: number
}

export interface IngestDocument {
  identity: string
  actType: string
  year: number
  number: number
  title: string
  sourceUrl: string
  contentHash: string
  extent: string
  provisions: IngestProvision[]
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function stripTags(value: string): string {
  return decodeXmlEntities(value.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
}

function readAttribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`${name}="([^"]*)"`, 'i'))
  return match ? match[1] : null
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function parseYearFeed(xml: string, year: number): IngestActRef[] {
  const acts: IngestActRef[] = []
  const seen = new Set<string>()
  for (const entry of xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)) {
    const entryXml = entry[0]
    const id = entryXml.match(/<id>\s*([^<]*)\s*<\/id>/i)?.[1]?.trim() ?? ''
    const idMatch = id.match(/\/id\/(ukpga)\/(\d{4})\/(\d+)\/?$/i)
    if (!idMatch) continue
    const entryYear = Number(idMatch[2])
    if (entryYear !== year) continue
    const key = `${idMatch[1]!.toLowerCase()}/${entryYear}/${Number(idMatch[3])}`
    if (seen.has(key)) continue
    seen.add(key)
    acts.push({
      actType: idMatch[1]!.toLowerCase(),
      year: entryYear,
      number: Number(idMatch[3]),
      title: stripTags(
        entryXml.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '',
      ),
    })
  }
  return acts.sort((a, b) => a.number - b.number)
}

/**
 * One row per P1..P5 element carrying an IdURI under this document, in
 * document order. Schedule paragraphs are P1 elements too, so section/13/2
 * and schedule/2/paragraph/4 share one rule: identity is the /id/ URI
 * suffix. Text is the concatenated descendant Text nodes (nested
 * sub-provisions included, which is what makes a section row searchable for
 * its subsection terms). Extent inherits the nearest RestrictExtent.
 */
export function parseClmlDocument(
  xml: string,
  ref: IngestActRef,
): IngestDocument | { skipped: string } {
  const identity = `${ref.actType}/${ref.year}/${ref.number}`
  const idMarker = `/id/${identity}/`
  if (!xml.includes(idMarker) && !xml.includes(`/id/${identity}<`)) {
    return { skipped: 'data.xml does not carry this Act identity' }
  }
  const title =
    stripTags(
      xml.match(
        /<ukm:Metadata\b[\s\S]*?<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i,
      )?.[1] ?? '',
    ) || ref.title
  const rootExtent = xml.match(/<Legislation\b([^>]*)>/i)?.[1] ?? ''
  const extent = readAttribute(rootExtent, 'RestrictExtent') ?? ''
  return parseClmlWithStack(xml, identity, title || ref.title, extent)
}

interface ClmlFrame {
  tag: string
  isProvision: boolean
  labelPath: string | null
  pnumber: string
  title: string
  extent: string
  texts: string[]
  inPnumber: boolean
  inTitle: boolean
  titleDepth: number
  order: number
}

function parseClmlWithStack(
  xml: string,
  identity: string,
  title: string,
  rootExtent: string,
): IngestDocument | { skipped: string } {
  const provisions: IngestProvision[] = []
  const stack: ClmlFrame[] = []
  let extentCurrent = rootExtent
  const extentSaved: string[] = []
  let order = 0
  let textDepth = 0
  const tagPattern = /<(\/?)([A-Za-z0-9:]+)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g
  let textStart = 0
  const provisionTags = new Set(['P1', 'P2', 'P3', 'P4', 'P5'])

  const openProvisions = (): ClmlFrame[] =>
    stack.filter((frame) => frame.isProvision)

  const currentProvision = (): ClmlFrame | null => {
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      if (stack[i]!.isProvision) return stack[i]!
    }
    return null
  }

  let m: RegExpExecArray | null
  tagPattern.lastIndex = 0
  while ((m = tagPattern.exec(xml)) !== null) {
    const isClose = m[1] === '/'
    const tag = m[2] ?? ''
    const attrs = m[3] ?? ''
    const textBefore = xml.slice(textStart, m.index)
    textStart = tagPattern.lastIndex
    // Character data belongs to whatever is open before this tag: accumulate
    // first, so a Pnumber's digits land while it is still open.
    // Character data counts only inside an open Text run: Pnumber digits
    // and titles outside one must not leak into provision text.
    if (textBefore && textDepth > 0) {
      const open = currentProvision()
      if (open) {
        if (open.inPnumber && !open.pnumber) {
          const cleaned = stripTags(textBefore)
          if (cleaned) {
            open.pnumber = cleaned
            open.inPnumber = false
          }
        } else if (open.inTitle && stack.length >= open.titleDepth) {
          const cleaned = stripTags(textBefore)
          if (cleaned)
            open.title = open.title ? `${open.title} ${cleaned}` : cleaned
        }
      }
      for (const frame of openProvisions()) {
        if (frame.texts.length > 0) {
          frame.texts[frame.texts.length - 1] += textBefore
        }
      }
    }
    if (!isClose) {
      const selfClosing = /\/\s*$/.test(attrs)
      const tagExtent = readAttribute(attrs, 'RestrictExtent')
      extentSaved.push(extentCurrent)
      if (tagExtent !== null) extentCurrent = tagExtent
      if (tag === 'Text') textDepth += 1
      if (provisionTags.has(tag)) {
        const idUri = readAttribute(attrs, 'IdURI') ?? ''
        const marker = `/id/${identity}/`
        const idx = idUri.indexOf(marker)
        if (idx !== -1) {
          const labelPath = idUri.slice(idx + marker.length).replace(/\/$/, '')
          if (labelPath) {
            stack.push({
              tag,
              isProvision: true,
              labelPath,
              pnumber: '',
              title: '',
              extent: extentCurrent,
              texts: [],
              inPnumber: false,
              inTitle: false,
              titleDepth: 0,
              order: order++,
            })
            if (selfClosing) closeFrame()
          } else {
            stack.push(placeholderFrame(tag))
            if (selfClosing) {
              stack.pop()
              extentCurrent = extentSaved.pop() ?? extentCurrent
            }
          }
        } else {
          // Provision-level element without a document IdURI (e.g. a
          // quoted extract): not addressable, never a row.
          stack.push(placeholderFrame(tag))
          if (selfClosing) {
            stack.pop()
            extentCurrent = extentSaved.pop() ?? extentCurrent
          }
        }
      } else {
        if (tag === 'Pnumber') {
          const prov = currentProvision()
          if (prov && !prov.pnumber) prov.inPnumber = true
        } else if (tag === 'Title') {
          const prov = currentProvision()
          if (prov && !prov.title) {
            prov.inTitle = true
            prov.titleDepth = stack.length
          }
        } else if (tag === 'Text') {
          // Every enclosing provision accumulates the run, so a section row
          // carries its subsections' terms and answers them in search.
          for (const open of openProvisions()) open.texts.push('')
        }
        stack.push(placeholderFrame(tag))
        if (selfClosing) {
          closeTag(tag)
          extentCurrent = extentSaved.pop() ?? extentCurrent
        }
      }
    } else {
      closeTag(tag)
      const saved = extentSaved.pop()
      if (saved !== undefined) extentCurrent = saved
    }
  }

  function placeholderFrame(tag: string): ClmlFrame {
    return {
      tag,
      isProvision: false,
      labelPath: null,
      pnumber: '',
      title: '',
      extent: '',
      texts: [],
      inPnumber: false,
      inTitle: false,
      titleDepth: 0,
      order: -1,
    }
  }

  function closeFrame() {
    const frame = stack.pop()
    if (!frame || !frame.isProvision || !frame.labelPath) return
    const text = frame.texts
      .map((t) => stripTags(t))
      .filter(Boolean)
      .join(' ')
    if (!text) return
    provisions.push({
      labelPath: frame.labelPath,
      label: formatProvisionLabel(frame.labelPath, frame.pnumber),
      extent: frame.extent,
      text,
      docOrder: frame.order,
    })
  }

  function closeTag(tag: string) {
    if (tag === 'Text') textDepth = Math.max(textDepth - 1, 0)
    // Pop placeholders up to the matching tag; a provision close emits it.
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      const frame = stack[i]!
      if (frame.tag !== tag) continue
      if (frame.isProvision) {
        // Remove any placeholders opened inside, then emit.
        stack.splice(i + 1)
        closeFrame()
      } else {
        stack.splice(i, 1)
        // Leaving a Title scope ends title capture.
        const prov = currentProvision()
        if (prov && prov.inTitle && stack.length < prov.titleDepth) {
          prov.inTitle = false
        }
        if (tag === 'Pnumber') {
          const p = currentProvision()
          if (p) p.inPnumber = false
        }
      }
      return
    }
  }

  if (provisions.length === 0) {
    return { skipped: 'no addressable provision text in data.xml' }
  }
  // Frames close children before parents, so emission order is not document
  // order. docOrder was assigned on open; sort restores it.
  provisions.sort((a, b) => a.docOrder - b.docOrder)
  const [actType = '', yearText = '', numberText = ''] = identity.split('/')
  return {
    identity,
    actType,
    year: Number(yearText),
    number: Number(numberText),
    title,
    sourceUrl: `${legislationBaseUrl}/${identity}`,
    contentHash: sha256Hex(xml),
    extent: rootExtent,
    provisions,
  }
}

/** Display label from the /id/ label path, e.g. section/13/2/a to s. 13(2)(a).
 * Mirrors formatProvisionDisplayLabel in the API's legislation-citations.ts;
 * the two cannot share one home because services must not import each other
 * and this formatter is ingest display logic, not a shared contract. */
export function formatProvisionLabel(
  labelPath: string,
  pnumber: string,
): string {
  const parts = labelPath.split('/')
  if (parts[0] === 'section') {
    const nums = parts.slice(1)
    if (nums.length === 0) return pnumber ? `s. ${pnumber}` : 'section'
    return `s. ${nums[0]}${nums
      .slice(1)
      .map((n) => `(${n})`)
      .join('')}`
  }
  if (parts[0] === 'schedule') {
    const schedNo = parts[1] ?? ''
    const rest = parts.slice(2)
    let label = schedNo ? `Sch. ${schedNo}` : 'Schedule'
    for (let i = 0; i < rest.length; i += 2) {
      const kind = rest[i]
      const num = rest[i + 1]
      if (
        kind === 'paragraph' ||
        kind === 'sub-paragraph' ||
        kind === 'subparagraph'
      ) {
        label += num ? ` para. ${num}` : ' para.'
      } else if (kind === 'part') {
        label += num ? ` Pt. ${num}` : ' Pt.'
      } else if (num !== undefined) {
        label += ` ${kind} ${num}`
      } else if (kind) {
        label += ` ${kind}`
      }
    }
    return label
  }
  return pnumber || labelPath
}
