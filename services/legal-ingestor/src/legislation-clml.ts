import { createHash } from 'node:crypto'

export const legislationBaseUrl = 'https://www.legislation.gov.uk'

export interface IngestActRef {
  actType: string
  year: number
  number: number
  title: string
}

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
  heading: string
  parentLabelPath: string | null
  extent: string
  text: string
  ownText: string
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
  declaredProvisions: number | null
  p1Seen: number
  p1Addressable: number
  p1BlockAmendment: number
  p1NoIdUriOther: number
  p1EmptyText: number
  p1Rows: number
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

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

export function stripDotLeaders(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (/^(?:\.\s*){4,}$/u.test(collapsed)) return '. . .'
  return collapsed.replace(/\s*(?:\.\s*){4,}/gu, ' ').trim()
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
  kind: LegislationProvisionKind | null
  isProvision: boolean
  labelPath: string | null
  parentLabelPath: string | null
  pnumber: string
  title: string
  extent: string
  texts: string[]
  ownTexts: string[]
  inNumber: boolean
  inPnumber: boolean
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
  let blockAmendmentDepth = 0
  let textDepth = 0
  let titleFrame: ClmlFrame | null = null
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

  const currentGroup = (): ClmlFrame | null => {
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      if (stack[i]!.tag === 'P1group') return stack[i]!
    }
    return null
  }

  const enclosingGroupTitle = (): string => currentGroup()?.title ?? ''

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

  function provisionKindFor(tag: string): LegislationProvisionKind | null {
    return tag === 'P1' ||
      tag === 'P2' ||
      tag === 'P3' ||
      tag === 'P4' ||
      tag === 'P5'
      ? tag
      : null
  }

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
    if (textBefore) {
      const open = currentAddressable()
      if (open && open.inNumber && !open.pnumber) {
        const cleaned = stripTags(textBefore)
        if (cleaned) {
          open.pnumber = cleaned
          open.inNumber = false
        }
      }
      if (titleFrame && stack.length >= titleFrame.titleDepth) {
        const cleaned = stripTags(textBefore)
        if (cleaned) {
          titleFrame.title = titleFrame.title
            ? `${titleFrame.title} ${cleaned}`
            : cleaned
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
        const innermost = provision?.ownTexts
        if (innermost && innermost.length > 0) {
          innermost[innermost.length - 1] += textBefore
        }
      }
    }
    if (!isClose) {
      const selfClosing = /\/\s*$/.test(attrs)
      const tagExtent = readAttribute(attrs, 'RestrictExtent')
      extentSaved.push(extentCurrent)
      if (tagExtent !== null) extentCurrent = tagExtent
      if (tag === 'Text') textDepth += 1
      if (provisionTags.has(tag) || containerTags.has(tag)) {
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
              kind: containerKindFor(tag) ?? provisionKindFor(tag),
              isProvision: provisionTags.has(tag),
              labelPath,
              parentLabelPath: nearestAddressableLabelPath(),
              pnumber: '',
              title: '',
              extent: extentCurrent,
              texts: [],
              ownTexts: [],
              inNumber: false,
              inPnumber: false,
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
          const group = currentGroup()
          const target = group && !group.title ? group : currentAddressable()
          if (target && !target.title) {
            target.titleDepth = stack.length + 1
            titleFrame = target
          }
        } else if (tag === 'Text') {
          for (const open of openProvisions()) open.texts.push('')
          currentProvision()?.ownTexts.push('')
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
      ownTexts: [],
      inNumber: false,
      inPnumber: false,
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
        heading: '',
        parentLabelPath: frame.parentLabelPath,
        extent: frame.extent,
        text: frame.title || label,
        ownText: '',
        docOrder: frame.order,
      })
      return
    }
    const joined = (runs: string[]) =>
      stripDotLeaders(
        runs
          .map((t) => stripTags(t))
          .filter(Boolean)
          .join(' '),
      )
    const text = joined(frame.texts)
    if (!text) {
      if (frame.tag === 'P1') p1EmptyText += 1
      return
    }
    if (frame.tag === 'P1') p1Rows += 1
    provisions.push({
      kind: frame.kind,
      labelPath: frame.labelPath,
      label: formatProvisionLabel(frame.labelPath, frame.pnumber),
      heading: frame.title || (frame.tag === 'P1' ? enclosingGroupTitle() : ''),
      parentLabelPath: frame.parentLabelPath,
      extent: frame.extent,
      text,
      ownText: joined(frame.ownTexts),
      docOrder: frame.order,
    })
  }

  function closeTag(tag: string) {
    if (tag === 'Text') textDepth = Math.max(textDepth - 1, 0)
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      const frame = stack[i]!
      if (frame.tag !== tag) continue
      if (frame.kind !== null) {
        stack.splice(i + 1)
        closeFrame()
      } else {
        stack.splice(i, 1)
        if (tag === 'Title') titleFrame = null
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
      if (pnumber && !/^chapter/i.test(pnumber)) return pnumber.trim()
      return stripped ? `Chapter ${stripped}` : 'Chapter'
    case 'schedule':
      return stripped ? `Schedule ${stripped}` : 'Schedule'
    case 'crossheading': {
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
