import type { DocumentTextRunWire } from '@obiter/contracts'

import {
  locateOffset,
  preserveTextOpeningTag,
  type InsertionPoint,
} from './comment-anchors'
import { OoxmlError, type OoxmlDocument, type ParagraphAnchor } from './model'
import { requireEditablePart } from './model-edit-overlay'
import { allocateModelId } from './model-paragraph-edits'
import {
  patchRunEmphasisXml,
  setRunEmphasis,
  type RunEmphasis,
} from './model-property-edits'
import { setOverlayReplacement } from './parts/overlay'
import { replaceTextRunAtAnchor, wordRunInnerTextXml } from './text-run-edit'

export function applyRunEmphasisRange(
  document: OoxmlDocument,
  paragraph: ParagraphAnchor,
  from: number,
  to: number,
  emphasis: RunEmphasis,
) {
  const part = requireEditablePart(document, paragraph.partName)
  const source = part.overlay.source
  const text = paragraph.runs.map((run) => run.wire.text).join('')
  if (
    from < 0 ||
    to > text.length ||
    from >= to ||
    splitsSurrogate(text, from) ||
    splitsSurrogate(text, to)
  ) {
    throw new OoxmlError('invalid-document-edit')
  }

  const pending: Array<{
    runIndex: number
    xml: string
    wires: DocumentTextRunWire[]
  }> = []
  let runStart = 0
  paragraph.runs.forEach((run, runIndex) => {
    const runEnd = runStart + run.wire.text.length
    const overlapFrom = Math.max(from, runStart)
    const overlapTo = Math.min(to, runEnd)
    if (overlapFrom < overlapTo) {
      const localFrom = overlapFrom - runStart
      const localTo = overlapTo - runStart
      if (localFrom === 0 && localTo === run.wire.text.length) {
        setRunEmphasis(document, run, emphasis)
      } else {
        pending.push({
          runIndex,
          ...splitCoveredRun(
            document,
            source,
            paragraph,
            run,
            runStart,
            localFrom,
            localTo,
            emphasis,
          ),
        })
      }
    }
    runStart = runEnd
  })

  for (const item of pending.reverse()) {
    const run = paragraph.runs[item.runIndex]
    if (!run) throw new OoxmlError('invalid-document-edit')
    setOverlayReplacement(part.overlay, `${run.wire.id}:split`, {
      start: run.runRange.start,
      end: run.runRange.end,
      value: item.xml,
    })
    paragraph.wire.runs.splice(item.runIndex, 1, ...item.wires)
    part.dirty = true
  }
}

function splitCoveredRun(
  document: OoxmlDocument,
  source: string,
  paragraph: ParagraphAnchor,
  run: ParagraphAnchor['runs'][number],
  runStart: number,
  localFrom: number,
  localTo: number,
  emphasis: RunEmphasis,
) {
  const startCut =
    localFrom > 0
      ? locateOffset(source, paragraph, runStart + localFrom)
      : undefined
  const endCut =
    localTo < run.wire.text.length
      ? locateOffset(source, paragraph, runStart + localTo)
      : undefined
  const parts: Array<{ xml: string; text: string; cover: boolean }> = []
  if (localFrom > 0 && startCut) {
    parts.push({
      xml: runPieceXml(source, run, undefined, startCut),
      text: run.wire.text.slice(0, localFrom),
      cover: false,
    })
  }
  parts.push({
    xml: applyEmphasisXml(runPieceXml(source, run, startCut, endCut), emphasis),
    text: run.wire.text.slice(localFrom, localTo),
    cover: true,
  })
  if (localTo < run.wire.text.length && endCut) {
    parts.push({
      xml: runPieceXml(source, run, endCut, undefined),
      text: run.wire.text.slice(localTo),
      cover: false,
    })
  }
  const fragments = [...run.wire.preservedXmlFragments]
  const wires = parts.map((part, index) => {
    const preserved = part.cover
      ? fragments.map((fragment) =>
          /<w:rPr\b/u.test(fragment)
            ? patchRunEmphasisXml(fragment, emphasis)
            : fragment,
        )
      : [...fragments]
    if (
      part.cover &&
      !preserved.some((fragment) => /<w:rPr\b/u.test(fragment))
    ) {
      preserved.push(patchRunEmphasisXml('<w:rPr/>', emphasis))
    }
    return {
      id: index === 0 ? run.wire.id : allocateModelId(document, 'text-edit'),
      ...(run.wire.styleId ? { styleId: run.wire.styleId } : {}),
      text: part.text,
      preservedXmlFragments: preserved,
    }
  })
  return { xml: parts.map((part) => part.xml).join(''), wires }
}

function runPieceXml(
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

function applyEmphasisXml(xml: string, emphasis: RunEmphasis) {
  const match = xml.match(/<w:rPr\b[^>]*\/>|<w:rPr\b[\s\S]*?<\/w:rPr>/u)
  if (match?.[0] !== undefined) {
    return xml.replace(match[0], patchRunEmphasisXml(match[0], emphasis))
  }
  return xml.replace(/<w:r\b[^>]*>/u, (open) => {
    return `${open}${patchRunEmphasisXml('<w:rPr/>', emphasis)}`
  })
}

function splitsSurrogate(value: string, offset: number) {
  if (offset <= 0 || offset >= value.length) return false
  const previous = value.charCodeAt(offset - 1)
  const next = value.charCodeAt(offset)
  return (
    previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
  )
}

export type RunTextReplacement = { from: number; to: number; text: string }

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
      }))
    if (hits.length === 1) {
      const hit = hits[0]!
      if (hit.localFrom === 0 && hit.localTo === run.wire.text.length) {
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
  hits: Array<{ localFrom: number; localTo: number; text: string }>,
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
      parts.push({
        xml: `${openRun}${properties}${wordRunInnerTextXml(prefix, hit.text)}${closeRun}`,
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
  return { xml: parts.map((part) => part.xml).join(''), wires }
}
