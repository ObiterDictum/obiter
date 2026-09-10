/**
 * Pure CLML parsing for Stage 1 legislation ingest. No network, no
 * storage: one row per addressable element carrying an /id/ URI under the
 * requested document, in document order — provisions (P1..P5) plus
 * containers (Part, Chapter, Schedule, crossheading Pblock) — and the
 * year-feed listing parse. Fetching, resumption, and database writes live
 * in legislation-ingest.ts.
 *
 * Size note: the tokenizer keeps provision, extent, title, and text state in
 * one pass (~400 lines, over the 300 target). Splitting open/close handling
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

/** Kind of an emitted row: the CLML element tag for provisions (P1..P5) or
 * the container name for the hierarchy levels (part, chapter, schedule,
 * crossheading). Containers and provisions share the row shape because the
 * Act page renders one document-order tree from both. */
export type LegislationProvisionKind =
  | 'part'
  | 'chapter'
  | 'schedule'
  | 'crossheading'
  | 'P1'
  | 'P2'
  | 'P3'
  | 'P4'
  | 'P5'

/** Container row kinds (Part, Chapter, Schedule, crossheading): headings,
 * never provisions and never withheld. Shared with ingest orchestration so
 * the set is not triplicated; the API mirrors it in legislation-kind.ts
 * because services must not import each other. */
export const containerProvisionKinds: ReadonlySet<LegislationProvisionKind> =
  new Set<LegislationProvisionKind>([
    'part',
    'chapter',
    'schedule',
    'crossheading',
  ])

export interface IngestProvision {
  kind: LegislationProvisionKind
  labelPath: string
  label: string
  /** Nearest addressable ancestor in CLML nesting, null for tree roots.
   * Never derived from label-path prefixes: inserted-amendment provisions
   * carry hierarchical IdURIs (part/2/section/100/kn1) while base
   * provisions are flat (section/100), so prefixing would mis-nest. */
  parentLabelPath: string | null
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
  /**
   * The Legislation open tag's NumberOfProvisions, null when absent or not
   * a number. Verified against a real 1.2 MB Act (ukpga/2020/7, declared
   * 579) to count every P1 open, including BlockAmendment inserts that
   * carry no document IdURI, so it is a P1-level check, never a total-row
   * check: our rows include P2..P5 and always exceed it.
   */
  declaredProvisions: number | null
  /** Every P1 open the tokenizer saw, inserts included. */
  p1Seen: number
  /**
   * Census of the P1 opens, reconciling as
   * p1Seen = p1Addressable + p1BlockAmendment + p1NoIdUriOther and
   * p1Addressable = p1Rows + p1EmptyText. BlockAmendment inserts quote
   * new-law text for another Act: they carry no document IdURI and
   * correctly never become rows, so only they are quiet in the count
   * check. Anything else without a row stays loud (see
   * provisionCountNote).
   */
  p1Addressable: number
  /** No-IdURI P1 opens inside a BlockAmendment element: explained gap. */
  p1BlockAmendment: number
  /** No-IdURI P1 opens anywhere else: unexplained, check stays loud. */
  p1NoIdUriOther: number
  /** Addressable P1 opens that emitted no row for want of text. */
  p1EmptyText: number
  /** Emitted rows whose frame tag was P1. */
  p1Rows: number
}

function decodeXmlEntities(value: string): string {
  // &amp; decodes last so a single pass never double-unescapes: `&amp;lt;`
  // becomes `&lt;` (one level) rather than `<` (two levels).
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * Drops XML tags from character data. Hand scanner, not a tag regex: the
 * old `/<[^>]*>/g` stopped at the first `>` even inside an attribute value
 * or comment, leaving tag residue (the CodeQL incomplete-sanitization
 * flag on this function), and comments arriving in character data were cut
 * mid-comment. Quotes are honoured so `>` inside attributes stays inside
 * the tag; `<!-- ... -->` is skipped whole.
 *
 * Why this is safe rather than just quiet: the output flows to Postgres
 * provision text, then API JSON, then React text nodes (`{hit.text}` in
 * SearchResults.tsx). There is no HTML sink anywhere on that path: no
 * dangerouslySetInnerHTML in app-shell, services/api, or the ingestor
 * (grep-verified), so a missed fragment could garble display text but
 * cannot become element injection. The scanner is still worth having
 * correct, because a red check everyone ignores rots: like the PDF glyph
 * cover tests pinned in ci-local.sh, a permanently-red gate teaches the
 * next reader to merge past red, and the real breakage then walks through
 * unnoticed. Clear it, do not normalise it.
 */
function stripTags(value: string): string {
  const kept: string[] = []
  let i = 0
  while (i < value.length) {
    if (value[i] !== '<') {
      kept.push(value[i]!)
      i += 1
      continue
    }
    if (value.startsWith('<!--', i)) {
      const end = value.indexOf('-->', i + 4)
      i = end === -1 ? value.length : end + 3
      continue
    }
    // Skip to the closing `>`, honouring both quote kinds so a `>` inside
    // an attribute value does not end the tag early. A `<` with no closing
    // `>` drops the tail: such input never occurs in CLML character data,
    // and dropping beats serving tag residue as text.
    i += 1
    let quote: string | null = null
    while (i < value.length) {
      const char = value[i]!
      if (quote !== null) {
        if (char === quote) quote = null
      } else if (char === '"' || char === "'") {
        quote = char
      } else if (char === '>') {
        i += 1
        break
      }
      i += 1
    }
  }
  return decodeXmlEntities(kept.join('')).replace(/\s+/g, ' ').trim()
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
 * One row per addressable element carrying an IdURI under this document, in
 * document order: provisions (P1..P5) and containers (Part, Chapter,
 * Schedule, crossheading Pblock). Sections are P1 elements inside Primary;
 * schedule paragraphs are P1 elements inside Schedules, so
 * section/13/2 and schedule/2/paragraph/4 share one rule: identity is the
 * /id/ URI suffix. Container rows carry their heading as text and a parent
 * pointer to the nearest addressable ancestor, so the Act page can render
 * Parts containing sections and Schedules containing paragraphs in document
 * order. Text is the concatenated descendant Text nodes (nested
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
  const rootTag = xml.match(/<Legislation\b([^>]*)>/i)?.[1] ?? ''
  const extent = readAttribute(rootTag, 'RestrictExtent') ?? ''
  const declaredRaw = readAttribute(rootTag, 'NumberOfProvisions')
  const declaredCount =
    declaredRaw !== null && /^\d+$/.test(declaredRaw.trim())
      ? Number(declaredRaw.trim())
      : null
  return parseClmlWithStack(
    xml,
    identity,
    title || ref.title,
    extent,
    declaredCount,
  )
}

interface ClmlFrame {
  tag: string
  /** Null for placeholder frames: an element that is never a row because
   * it has no document IdURI (P1group, ScheduleBody, Body, amendments). */
  kind: LegislationProvisionKind | null
  isProvision: boolean
  labelPath: string | null
  parentLabelPath: string | null
  pnumber: string
  title: string
  extent: string
  texts: string[]
  inNumber: boolean
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
  declaredProvisions: number | null,
): IngestDocument | { skipped: string } {
  const provisions: IngestProvision[] = []
  const stack: ClmlFrame[] = []
  let extentCurrent = rootExtent
  const extentSaved: string[] = []
  let order = 0
  let p1Seen = 0
  let p1Rows = 0
  let p1Addressable = 0
  let p1BlockAmendment = 0
  let p1NoIdUriOther = 0
  let p1EmptyText = 0
  // Nesting depth of BlockAmendment elements: the only legitimate home
  // of a P1 open without a document IdURI.
  let blockAmendmentDepth = 0
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

  // Addressable containers: Part, Chapter and Schedule are the numbered
  // levels; Pblock is the crossheading level (every observed Pblock IdURI
  // carries a crossheading segment). Like provisions, they become rows only
  // when carrying a document IdURI: the corpus has Parts, Chapters,
  // Schedules and crossheadings without one (2023/55 carries 23 such
  // Pblocks), and addressability is the row criterion everywhere.
  const containerTags = new Set(['Part', 'Chapter', 'Schedule', 'Pblock'])

  function containerKindFor(tag: string): LegislationProvisionKind | null {
    switch (tag) {
      case 'Part':
        return 'part'
      case 'Chapter':
        return 'chapter'
      case 'Schedule':
        return 'schedule'
      case 'Pblock':
        return 'crossheading'
      default:
        return null
    }
  }

  /** Nearest open frame that is or will be a row (container or provision). */
  const currentAddressable = (): ClmlFrame | null => {
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      if (stack[i]!.kind !== null) return stack[i]!
    }
    return null
  }

  const nearestAddressableLabelPath = (): string | null => {
    const open = currentAddressable()
    return open?.labelPath ?? null
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
    // first, so a container's Number or a Pnumber's digits land while still
    // open. Provision body text counts only inside an open Text run; Number
    // and Title capture is ungated because container headings (SCHEDULE 1,
    // crossheading titles) are never wrapped in Text elements.
    if (textBefore) {
      const open = currentAddressable()
      if (open) {
        if (open.inNumber && !open.pnumber) {
          const cleaned = stripTags(textBefore)
          if (cleaned) {
            open.pnumber = cleaned
            open.inNumber = false
          }
        } else if (open.inTitle && stack.length >= open.titleDepth) {
          const cleaned = stripTags(textBefore)
          if (cleaned)
            open.title = open.title ? `${open.title} ${cleaned}` : cleaned
        }
      }
      if (textDepth > 0) {
        const provision = currentProvision()
        if (provision && provision.inPnumber && !provision.pnumber) {
          const cleaned = stripTags(textBefore)
          if (cleaned) {
            provision.pnumber = cleaned
            provision.inPnumber = false
          }
        }
        for (const frame of openProvisions()) {
          if (frame.texts.length > 0) {
            frame.texts[frame.texts.length - 1] += textBefore
          }
        }
      }
    }
    if (!isClose) {
      const selfClosing = /\/\s*$/.test(attrs)
      const tagExtent = readAttribute(attrs, 'RestrictExtent')
      extentSaved.push(extentCurrent)
      if (tagExtent !== null) extentCurrent = tagExtent
      if (tag === 'Text') textDepth += 1
      // A self-closing BlockAmendment cannot contain a P1, so only
      // paired opens move the depth.
      if (provisionTags.has(tag) || containerTags.has(tag)) {
        // Every P1 open counts towards the declared total and the
        // census: addressable opens must yield rows (or an empty-text
        // note), no-IdURI opens are explained only inside
        // BlockAmendment. Containers never touch the P1 census.
        const idUri = readAttribute(attrs, 'IdURI') ?? ''
        const marker = `/id/${identity}/`
        const idx = idUri.indexOf(marker)
        const labelPath =
          idx !== -1 ? idUri.slice(idx + marker.length).replace(/\/$/, '') : ''
        if (tag === 'P1') {
          p1Seen += 1
          if (labelPath) p1Addressable += 1
          else if (blockAmendmentDepth > 0) p1BlockAmendment += 1
          else p1NoIdUriOther += 1
        }
        if (idx !== -1) {
          if (labelPath) {
            stack.push({
              tag,
              kind:
                containerKindFor(tag) ??
                (provisionTags.has(tag)
                  ? (tag as LegislationProvisionKind)
                  : null),
              isProvision: provisionTags.has(tag),
              labelPath,
              parentLabelPath: nearestAddressableLabelPath(),
              pnumber: '',
              title: '',
              extent: extentCurrent,
              texts: [],
              inNumber: false,
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
          // Element without a document IdURI (e.g. a quoted extract, or a
          // non-addressable container): not addressable, never a row.
          stack.push(placeholderFrame(tag))
          if (selfClosing) {
            stack.pop()
            extentCurrent = extentSaved.pop() ?? extentCurrent
          }
        }
      } else {
        if (tag === 'BlockAmendment' && !selfClosing) {
          blockAmendmentDepth += 1
        }
        if (tag === 'Number') {
          const container = currentAddressable()
          if (container && containerProvisionKinds.has(container.kind!)) {
            container.inNumber = true
          }
        } else if (tag === 'Pnumber') {
          const prov = currentProvision()
          if (prov && !prov.pnumber) prov.inPnumber = true
        } else if (tag === 'Title') {
          // Title capture targets the nearest addressable frame (container
          // or provision) that has no title yet, so inner group headings
          // (P1group Titles, which are not addressable) are skipped once
          // their container's own Title is captured.
          const open = currentAddressable()
          if (open && !open.title) {
            open.inTitle = true
            open.titleDepth = stack.length + 1
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
      if (tag === 'BlockAmendment') {
        blockAmendmentDepth = Math.max(blockAmendmentDepth - 1, 0)
      }
      closeTag(tag)
      const saved = extentSaved.pop()
      if (saved !== undefined) extentCurrent = saved
    }
  }

  function placeholderFrame(tag: string): ClmlFrame {
    return {
      tag,
      kind: null,
      isProvision: false,
      labelPath: null,
      parentLabelPath: null,
      pnumber: '',
      title: '',
      extent: '',
      texts: [],
      inNumber: false,
      inPnumber: false,
      inTitle: false,
      titleDepth: 0,
      order: -1,
    }
  }

  function closeFrame() {
    const frame = stack.pop()
    if (!frame || frame.kind === null || !frame.labelPath) return
    if (containerProvisionKinds.has(frame.kind)) {
      const label = formatContainerLabel(
        frame.kind,
        frame.pnumber,
        frame.title,
        frame.labelPath,
      )
      provisions.push({
        kind: frame.kind,
        labelPath: frame.labelPath,
        label,
        parentLabelPath: frame.parentLabelPath,
        extent: frame.extent,
        // A container row's text is its heading: the Act page shows Parts
        // and Schedules as headings, never as searchable body content.
        text: frame.title || label,
        docOrder: frame.order,
      })
      return
    }
    const text = frame.texts
      .map((t) => stripTags(t))
      .filter(Boolean)
      .join(' ')
    if (!text) {
      // Addressable but textless: stays a row-less P1 and stays loud
      // in the count check rather than vanishing silently.
      if (frame.tag === 'P1') p1EmptyText += 1
      return
    }
    if (frame.tag === 'P1') p1Rows += 1
    provisions.push({
      kind: frame.kind,
      labelPath: frame.labelPath,
      label: formatProvisionLabel(frame.labelPath, frame.pnumber),
      parentLabelPath: frame.parentLabelPath,
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
      if (frame.kind !== null) {
        // Remove any placeholders opened inside, then emit.
        stack.splice(i + 1)
        closeFrame()
      } else {
        stack.splice(i, 1)
        // Leaving a Title scope ends title capture (titleDepth counts the
        // Title frame, so this must clear explicitly, not via depth).
        if (tag === 'Title') {
          const open = currentAddressable()
          if (open) open.inTitle = false
        }
        if (tag === 'Number') {
          const container = currentAddressable()
          if (container && container.inNumber) container.inNumber = false
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
    declaredProvisions,
    p1Seen,
    p1Rows,
    p1Addressable,
    p1BlockAmendment,
    p1NoIdUriOther,
    p1EmptyText,
  }
}

/**
 * Human-readable extraction-completeness note, or null when the counts
 * are consistent. Mismatch behaviour is store-flagged-and-reported,
 * never fail the document. Only the BlockAmendment gap is quiet:
 * NumberOfProvisions counts every P1 open including quoted-insert P1s
 * (new-law text for another Act, correctly carrying no document IdURI
 * and correctly never a row: ukpga/2020/7 declares 579 with 15 such
 * inserts), so a gap fully explained by them is healthy. Everything else
 * stays loud: tokenizer drift, a no-IdURI P1 outside BlockAmendment, an
 * addressable P1 with no emitted row, or a census that does not
 * reconcile. The note persists on the document row and every mismatch
 * lands in the ingest summary, so a systematic gap shows as a pattern
 * instead of one silent document.
 */
export function provisionCountNote(
  doc: Pick<
    IngestDocument,
    | 'declaredProvisions'
    | 'p1Seen'
    | 'p1Rows'
    | 'p1Addressable'
    | 'p1BlockAmendment'
    | 'p1NoIdUriOther'
    | 'p1EmptyText'
  >,
): string | null {
  if (doc.declaredProvisions === null) {
    return 'upstream declared no NumberOfProvisions'
  }
  const notes: string[] = []
  if (doc.p1Seen !== doc.declaredProvisions) {
    notes.push(
      `tokenizer saw ${doc.p1Seen} P1 opens but upstream declared ${doc.declaredProvisions}`,
    )
  }
  if (
    doc.p1Seen !==
    doc.p1Addressable + doc.p1BlockAmendment + doc.p1NoIdUriOther
  ) {
    notes.push(
      `census does not reconcile (seen ${doc.p1Seen} != addressable ${doc.p1Addressable} + inserts ${doc.p1BlockAmendment} + other no-IdURI ${doc.p1NoIdUriOther}): parser bug`,
    )
  }
  if (doc.p1NoIdUriOther > 0) {
    notes.push(
      `${doc.p1NoIdUriOther} P1 without document IdURI outside BlockAmendment: unexplained, possible gap`,
    )
  }
  if (doc.p1EmptyText > 0) {
    notes.push(
      `${doc.p1EmptyText} addressable P1 emitted no row (empty text): possible gap`,
    )
  }
  if (doc.p1Rows + doc.p1EmptyText !== doc.p1Addressable) {
    notes.push(
      `emitted ${doc.p1Rows} P1 rows from ${doc.p1Addressable} addressable P1 opens: impossible, parser bug`,
    )
  }
  return notes.length > 0 ? notes.join('; ') : null
}

/** Display label for a container row. Upstream Number text is inconsistent
 * in case ("Part 2", "PART 6ZA", "SCHEDULE 1", "Chapter 1"), so the number
 * is normalised and re-prefixed with the canonical capitalisation. A
 * crossheading has no Number: its title is the heading. */
export function formatContainerLabel(
  kind: LegislationProvisionKind,
  pnumber: string,
  title: string,
  labelPath: string,
): string {
  const stripped = pnumber.replace(/^(part|schedule|chapter)\s*/i, '').trim()
  switch (kind) {
    case 'part':
      return stripped ? `Part ${stripped}` : 'Part'
    case 'chapter':
      // Chapters normally number as "Chapter 1", but ECHR-style schedules
      // number their chapters as "Article 2"; that verbatim form is the
      // published label, so only a chapter-prefixed Number is normalised.
      if (pnumber && !/^chapter/i.test(pnumber)) return pnumber.trim()
      return stripped ? `Chapter ${stripped}` : 'Chapter'
    case 'schedule':
      return stripped ? `Schedule ${stripped}` : 'Schedule'
    case 'crossheading': {
      // A crossheading has no Number: its label is the heading text, or the
      // last slug segment humanised when upstream carried no Title.
      const heading = title.trim()
      if (heading) return heading
      const slug = labelPath.split('/').at(-1) ?? ''
      return slug
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase())
    }
    default:
      return title || pnumber || kind
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
