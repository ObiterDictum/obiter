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
  if (!start && !end) {
    return source.slice(run.runRange.start, run.runRange.end)
  }
  if (!start && end) return closedPrefix(source, run, end)
  if (start && !end) return openedSuffix(source, run, start)
  return `${openAt(source, run, start)}${source.slice(start.sourceOffset, end.sourceOffset)}${closeAt(source, run, end)}`
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
