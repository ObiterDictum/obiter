import type { DocumentTextRunWire } from '@obiter/contracts'

import {
  locateOffset,
  preserveTextOpeningTag,
  type InsertionPoint,
} from './comment-anchors'
import { OoxmlError, type OoxmlDocument, type ParagraphAnchor } from './model'
import { requireEditablePart } from './model-edit-overlay'
import { recordSplitRun, type LineageRecorder } from './document-lineage'
import { patchRunEmphasisXml, type RunEmphasis } from './model-property-edits'
import { setOverlayReplacement, parseXmlElements } from './parts/overlay'
import { replaceTextRunAtAnchor, wordRunInnerTextXml } from './text-run-edit'

// Shared run-splitting primitives. model-run-emphasis composes them for range
// formatting; this module composes them for redaction text replacement.
export function runPieceXml(
  source: string,
  run: ParagraphAnchor['runs'][number],
  start: InsertionPoint | undefined,
  end: InsertionPoint | undefined,
) {
  if (start && end) {
    return `${openAt(source, run, start)}${source.slice(start.sourceOffset, end.sourceOffset)}${closeAt(source, run, end)}`
  }
  if (start) return openedSuffix(source, run, start)
  if (end) return closedPrefix(source, run, end)
  return source.slice(run.runRange.start, run.runRange.end)
}

function closedPrefix(
  source: string,
  run: ParagraphAnchor['runs'][number],
  end: InsertionPoint,
) {
  return `${source.slice(run.runRange.start, end.sourceOffset)}${closeAt(source, run, end)}`
}

function openedSuffix(
  source: string,
  run: ParagraphAnchor['runs'][number],
  start: InsertionPoint,
) {
  return `${openAt(source, run, start)}${source.slice(start.sourceOffset, run.runRange.end)}`
}

function openAt(
  source: string,
  run: ParagraphAnchor['runs'][number],
  point: InsertionPoint,
) {
  const openRun = source.slice(run.runRange.start, run.runRange.startTagEnd)
  const properties = run.runProperties.join('')
  const split = point.split
  if (
    split?.kind === 'run' &&
    split.position === 'content' &&
    split.textElement
  ) {
    return `${openRun}${properties}${preserveTextOpeningTag(
      source.slice(split.textElement.start, split.textElement.startTagEnd),
    )}`
  }
  return `${openRun}${properties}`
}

function closeAt(
  source: string,
  run: ParagraphAnchor['runs'][number],
  point: InsertionPoint,
) {
  const closeRun = source.slice(run.runRange.endTagStart, run.runRange.end)
  const split = point.split
  if (
    split?.kind === 'run' &&
    split.position === 'content' &&
    split.textElement
  ) {
    return `${source.slice(split.textElement.endTagStart, split.textElement.end)}${closeRun}`
  }
  return closeRun
}

export function applyEmphasisXml(xml: string, emphasis: RunEmphasis) {
  const match = xml.match(/<w:rPr\b[^>]*\/>|<w:rPr\b[\s\S]*?<\/w:rPr>/u)
  if (match?.[0] !== undefined) {
    return xml.replace(match[0], patchRunEmphasisXml(match[0], emphasis))
  }
  return xml.replace(/<w:r\b[^>]*>/u, (open) => {
    return `${open}${patchRunEmphasisXml('<w:rPr/>', emphasis)}`
  })
}

export function splitsSurrogate(value: string, offset: number) {
  if (offset <= 0 || offset >= value.length) return false
  const previous = value.charCodeAt(offset - 1)
  const next = value.charCodeAt(offset)
  return (
    previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
  )
}

export type RunTextReplacement = {
  from: number
  to: number
  text: string
  /**
   * Run properties applied to the replacement run only. The covered source
   * text is gone before this is written, so a black highlight/colour here
   * styles the harmless marker, never the original content.
   */
  emphasis?: RunEmphasis
}

/**
 * Replace text ranges inside one paragraph, splitting runs at range
 * boundaries exactly like applyRunEmphasisRange (same locateOffset /
 * runPieceXml / openAt / closeAt machinery, same whole-run fast path via
 * replaceTextRunAtAnchor). Covered pieces keep the run's rPr so styles
 * survive; only the w:t content is swapped.
 *
 * One pass per paragraph: every original run is split at most once and new
 * ids come from a local allocator seeded with the live model, so the
 * duplicate ids E41 reports for repeated splits of the same run cannot
 * occur here regardless of that defect's status.
 */
export function applyRunTextReplacementRange(
  document: OoxmlDocument,
  paragraph: ParagraphAnchor,
  replacements: readonly RunTextReplacement[],
  lineage?: LineageRecorder,
) {
  const part = requireEditablePart(document, paragraph.partName)
  const source = part.overlay.source
  const text = paragraph.runs.map((run) => run.wire.text).join('')
  // Mirror the text-output overlap rule (redaction-policy outputSpans):
  // ordered by start, a range starting inside the previous one is dropped.
  const spans: RunTextReplacement[] = []
  for (const replacement of [...replacements].sort(
    (left, right) => left.from - right.from || right.to - left.to,
  )) {
    if (
      replacement.from < 0 ||
      replacement.to > text.length ||
      replacement.from >= replacement.to ||
      splitsSurrogate(text, replacement.from) ||
      splitsSurrogate(text, replacement.to)
    ) {
      throw new OoxmlError('invalid-document-edit')
    }
    const previous = spans.at(-1)
    if (previous && previous.to > replacement.from) continue
    spans.push(replacement)
  }
  if (spans.length === 0) return

  const usedIds = new Set(
    document.model.stories.flatMap((story) =>
      story.paragraphs.flatMap((item) => [
        item.id,
        ...item.runs.map((run) => run.id),
      ]),
    ),
  )
  const nextId = () => {
    let sequence = 1
    let id = `text-edit-${String(sequence).padStart(6, '0')}`
    while (usedIds.has(id)) {
      sequence += 1
      id = `text-edit-${String(sequence).padStart(6, '0')}`
    }
    usedIds.add(id)
    return id
  }

  const pending: Array<{
    runIndex: number
    xml: string
    wires: DocumentTextRunWire[]
    originParts: Array<{ run: DocumentTextRunWire; from: number; to: number }>
  }> = []
  let runStart = 0
  paragraph.runs.forEach((run, runIndex) => {
    const runEnd = runStart + run.wire.text.length
    const hits = spans
      .filter(
        (span) => Math.max(span.from, runStart) < Math.min(span.to, runEnd),
      )
      .map((span) => ({
        localFrom: Math.max(span.from, runStart) - runStart,
        localTo: Math.min(span.to, runEnd) - runStart,
        text: span.text,
        emphasis: span.emphasis,
      }))
    if (hits.length === 1) {
      const hit = hits[0]!
      // A styled replacement cannot use the whole-run fast path: it keeps the
      // run's existing rPr, so the emphasis would be lost.
      if (
        hit.localFrom === 0 &&
        hit.localTo === run.wire.text.length &&
        !hit.emphasis
      ) {
        if (!replaceTextRunAtAnchor(document, run, hit.text)) {
          throw new OoxmlError('model-node-not-editable')
        }
        runStart = runEnd
        return
      }
    }
    if (hits.length > 0) {
      pending.push({
        runIndex,
        ...splitReplacedRun(source, paragraph, run, runStart, hits, nextId),
      })
    }
    runStart = runEnd
  })

  for (const item of pending.reverse()) {
    const run = paragraph.runs[item.runIndex]
    if (!run) throw new OoxmlError('invalid-document-edit')
    if (lineage) recordSplitRun(lineage, run.wire, item.originParts)
    setOverlayReplacement(part.overlay, `${run.wire.id}:redact`, {
      start: run.runRange.start,
      end: run.runRange.end,
      value: item.xml,
    })
    paragraph.wire.runs.splice(item.runIndex, 1, ...item.wires)
    part.dirty = true
  }
}

function splitReplacedRun(
  source: string,
  paragraph: ParagraphAnchor,
  run: ParagraphAnchor['runs'][number],
  runStart: number,
  hits: Array<{
    localFrom: number
    localTo: number
    text: string
    emphasis?: RunEmphasis
  }>,
  nextId: () => string,
) {
  const bounds = new Set<number>([0, run.wire.text.length])
  for (const hit of hits) {
    bounds.add(hit.localFrom)
    bounds.add(hit.localTo)
  }
  const ordered = [...bounds].sort((left, right) => left - right)
  const cuts = new Map<number, InsertionPoint>()
  for (const bound of ordered) {
    if (bound === 0 || bound === run.wire.text.length) continue
    cuts.set(bound, locateOffset(source, paragraph, runStart + bound))
  }
  const openRun = source.slice(run.runRange.start, run.runRange.startTagEnd)
  const prefix = /^<([^:>\s]+):/u.exec(openRun)?.[1] ?? 'w'
  const properties = run.runProperties.join('')
  const closeRun = source.slice(run.runRange.endTagStart, run.runRange.end)
  const fragments = [...run.wire.preservedXmlFragments]
  const parts: Array<{ xml: string; text: string }> = []
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const start = ordered[index]!
    const end = ordered[index + 1]!
    const hit = hits.find(
      (candidate) => candidate.localFrom <= start && end <= candidate.localTo,
    )
    if (hit) {
      const propertiesXml = hit.emphasis
        ? patchRunEmphasisXml(properties, hit.emphasis)
        : properties
      parts.push({
        xml: `${openRun}${propertiesXml}${wordRunInnerTextXml(prefix, hit.text)}${closeRun}`,
        text: hit.text,
      })
    } else {
      const startCut = start === 0 ? undefined : cuts.get(start)
      const endCut = end === run.wire.text.length ? undefined : cuts.get(end)
      parts.push({
        xml: runPieceXml(source, run, startCut, endCut),
        text: run.wire.text.slice(start, end),
      })
    }
  }
  const wires = parts.map((part, index) => ({
    id: index === 0 ? run.wire.id : nextId(),
    ...(run.wire.styleId ? { styleId: run.wire.styleId } : {}),
    text: part.text,
    preservedXmlFragments: [...fragments],
  }))
  return {
    xml: parts.map((part) => part.xml).join(''),
    wires,
    // SAFETY: `wires` is built one per `parts` entry, and `ordered` is the
    // sorted split bounds with one more entry than `parts`, so `index` and
    // `index + 1` are in range for every part.
    originParts: parts.map((part, index) => ({
      run: wires[index] as DocumentTextRunWire,
      from: ordered[index] as number,
      to: ordered[index + 1] as number,
    })),
  }
}

// A materialised run is a bare <w:r>; its namespace prefixes are declared on
// the part root, so wrap it in a synthetic root carrying the part's
// declarations and shift the parsed ranges back into run coordinates.
export function parseWrappedRun(partSource: string, runXml: string) {
  const declarationEnd = partSource.startsWith('<?xml')
    ? partSource.indexOf('?>') + 2
    : 0
  const rootStart = partSource.indexOf('<', declarationEnd)
  const head = partSource.slice(rootStart, partSource.indexOf('>', rootStart))
  const declarations =
    head.match(/xmlns(?::[\w.-]+)?="[^"]*"/gu)?.join(' ') ?? ''
  const open = `<obiter-run ${declarations}>`
  const shift = open.length
  return parseXmlElements(`${open}${runXml}</obiter-run>`).map((element) => ({
    ...element,
    depth: element.depth - 1,
    start: element.start - shift,
    startTagEnd: element.startTagEnd - shift,
    endTagStart: element.endTagStart - shift,
    end: element.end - shift,
  }))
}

/**
 * Coalesces the sibling `<w:r>` elements a folded page-break splice produced
 * back into one run. The splice duplicates the original run's properties onto
 * its reopened tail, so keeping every sibling's `w:rPr` would put two into one
 * run; the first sibling owns the effective properties (a property overlay
 * writes into the original run's property range, or wire fragments already
 * carry the patch), and the tail's copy is the stale snapshot. Structural
 * children (a break, a tab) are emitted in order between the chosen properties
 * and the run close.
 */
export function mergeSiblingRuns(partSource: string, runXml: string) {
  const elements = parseWrappedRun(partSource, runXml)
  const runs = elements.filter((element) => element.depth === 0)
  // A fold can legitimately hold non-run siblings — a pending hyperlink wrap
  // emits `<w:hyperlink>` around the pieces — and merging those as if they
  // were runs would produce malformed XML. Returning the fold unchanged lets
  // the caller's one-run check refuse the edit with a typed error instead.
  if (runs.some((element) => element.localName !== 'r')) return runXml
  const first = runs[0]
  const last = runs.at(-1)
  if (!first || !last || runs.length <= 1) return runXml
  const childrenByRun = runs.map((run) =>
    elements.filter(
      (element) =>
        element.depth === 1 &&
        element.start >= run.start &&
        element.end <= run.end,
    ),
  )
  const properties = childrenByRun
    .flat()
    .find((element) => element.localName === 'rPr')
  let inner = properties ? runXml.slice(properties.start, properties.end) : ''
  for (const children of childrenByRun) {
    for (const child of children) {
      if (child.localName === 'rPr') continue
      inner += runXml.slice(child.start, child.end)
    }
  }
  return `${runXml.slice(first.start, first.startTagEnd)}${inner}${runXml.slice(last.endTagStart, last.end)}`
}
