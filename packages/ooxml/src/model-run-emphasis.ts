import type { DocumentTextRunWire } from '@obiter/contracts'

import { locateOffset } from './comment-anchors'
import {
  OoxmlError,
  type OoxmlDocument,
  type ParagraphAnchor,
  type TextRunAnchor,
} from './model'
import { requireEditablePart } from './model-edit-overlay'
import { recordSplitRun, type LineageRecorder } from './document-lineage'
import {
  applyEmphasisXml,
  runPieceXml,
  splitsSurrogate,
} from './model-run-range-edits'
import {
  patchRunEmphasisXml,
  setRunEmphasis,
  type RunEmphasis,
} from './model-property-edits'
import { setOverlayReplacement, type XmlOverlay } from './parts/overlay'
import { hasPendingBreakSplice } from './run-break-splices'
import { effectiveRunView, runHasPendingOverlay } from './run-effective'

export type RunEmphasisRange = RunEmphasis & { from: number; to: number }

type RunSplitView = {
  source: string
  run: TextRunAnchor
  paragraph: ParagraphAnchor
  offsetBase: number
  fragments: readonly string[]
  // Overlay keys folded into `source`; the caller removes them once every run
  // in the paragraph has planned, so a rejected edit mutates nothing.
  consumedKeys: readonly string[]
}

/**
 * Apply every range emphasis for one paragraph in a single pass. Grouping is
 * what makes the result independent of how many range operations the client
 * sent: each original run is split once at the union of all range boundaries
 * and each resulting piece gets the merged emphasis of the ranges covering it.
 *
 * A run whose content was already changed by an earlier operation in the same
 * batch (a text replacement, or a whole-run property write) no longer has a
 * source-to-model mapping, so it is materialised from its effective overlay
 * first and split from that text. Runs without pending overlays keep the
 * source-slicing path so structural children (drawings, tabs, field
 * references) stay byte-identical.
 */
export function applyRunEmphasisRanges(
  document: OoxmlDocument,
  paragraph: ParagraphAnchor,
  ranges: readonly RunEmphasisRange[],
  lineage?: LineageRecorder,
) {
  const part = requireEditablePart(document, paragraph.partName)
  const text = paragraph.runs.map((run) => run.wire.text).join('')
  for (const range of ranges) {
    if (
      range.from < 0 ||
      range.to > text.length ||
      range.from >= range.to ||
      splitsSurrogate(text, range.from) ||
      splitsSurrogate(text, range.to)
    ) {
      throw new OoxmlError('invalid-document-edit')
    }
  }

  const nextId = textRunIdAllocator(document)
  const pending: Array<{
    runIndex: number
    xml: string
    wires: DocumentTextRunWire[]
    originParts: Array<{ run: DocumentTextRunWire; from: number; to: number }>
    consumedKeys: readonly string[]
  }> = []
  let runStart = 0
  paragraph.runs.forEach((run, runIndex) => {
    const runEnd = runStart + run.wire.text.length
    const local = ranges
      .map((range) => ({
        from: Math.max(range.from, runStart) - runStart,
        to: Math.min(range.to, runEnd) - runStart,
        emphasis: range,
      }))
      .filter((range) => range.from < range.to)
    if (local.length > 0) {
      const length = run.wire.text.length
      if (
        local.every((range) => range.from === 0 && range.to === length) &&
        !hasPendingBreakSplice(part.overlay, run.runRange)
      ) {
        setRunEmphasis(
          document,
          run,
          mergeRunEmphasis(local.map((range) => range.emphasis)),
        )
      } else {
        const materialise = runHasPendingOverlay(part.overlay, run)
        pending.push({
          runIndex,
          ...splitRun(
            part.overlay,
            run,
            paragraph,
            runStart,
            local,
            materialise,
            nextId,
          ),
        })
      }
    }
    runStart = runEnd
  })

  const consumedKeys = pending.flatMap((item) => item.consumedKeys)
  for (const key of consumedKeys) part.overlay.replacements.delete(key)
  for (const item of pending.reverse()) {
    const run = paragraph.runs[item.runIndex]
    if (!run) throw new OoxmlError('invalid-document-edit')
    if (lineage) recordSplitRun(lineage, run.wire, item.originParts)
    setOverlayReplacement(part.overlay, `${run.wire.id}:split`, {
      start: run.runRange.start,
      end: run.runRange.end,
      value: item.xml,
    })
    paragraph.wire.runs.splice(item.runIndex, 1, ...item.wires)
    part.dirty = true
  }
}

type LocalRange = { from: number; to: number; emphasis: RunEmphasis }

interface SplitRunResult {
  xml: string
  wires: DocumentTextRunWire[]
  originParts: Array<{ run: DocumentTextRunWire; from: number; to: number }>
  consumedKeys: readonly string[]
}

function splitRun(
  overlay: XmlOverlay,
  run: TextRunAnchor,
  paragraph: ParagraphAnchor,
  runStart: number,
  local: readonly LocalRange[],
  materialise: boolean,
  nextId: () => string,
): SplitRunResult {
  const view = materialise
    ? effectiveView(overlay, run, paragraph)
    : sourceView(overlay.source, run, paragraph, runStart)
  const bounds = new Set<number>([0, run.wire.text.length])
  for (const range of local) {
    bounds.add(range.from)
    bounds.add(range.to)
  }
  const ordered = [...bounds].sort((left, right) => left - right)
  const parts: Array<{
    xml: string
    text: string
    emphasis?: RunEmphasis
  }> = []
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const start = ordered[index]!
    const end = ordered[index + 1]!
    const covering = local.filter(
      (range) => range.from <= start && end <= range.to,
    )
    const emphasis =
      covering.length > 0
        ? mergeRunEmphasis(covering.map((range) => range.emphasis))
        : undefined
    const startCut =
      start === 0
        ? undefined
        : locateOffset(view.source, view.paragraph, view.offsetBase + start)
    const endCut =
      end === run.wire.text.length
        ? undefined
        : locateOffset(view.source, view.paragraph, view.offsetBase + end)
    const pieceXml = runPieceXml(view.source, view.run, startCut, endCut)
    parts.push({
      xml: emphasis ? applyEmphasisXml(pieceXml, emphasis) : pieceXml,
      text: run.wire.text.slice(start, end),
      ...(emphasis ? { emphasis } : {}),
    })
  }
  const wires = parts.map((part, index) => ({
    id: index === 0 ? run.wire.id : nextId(),
    ...(run.wire.styleId ? { styleId: run.wire.styleId } : {}),
    text: part.text,
    preservedXmlFragments: part.emphasis
      ? emphasisFragments(view.fragments, part.emphasis)
      : [...view.fragments],
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
    consumedKeys: view.consumedKeys,
  }
}

function sourceView(
  source: string,
  run: TextRunAnchor,
  paragraph: ParagraphAnchor,
  runStart: number,
): RunSplitView {
  return {
    source,
    run,
    paragraph,
    offsetBase: runStart,
    fragments: run.wire.preservedXmlFragments,
    consumedKeys: [],
  }
}

function effectiveView(
  overlay: XmlOverlay,
  run: TextRunAnchor,
  paragraph: ParagraphAnchor,
): RunSplitView {
  // The shared materialised-run view: pending replacements folded into one
  // source string, sibling runs a break splice produced coalesced, so the
  // split machinery styles exactly the characters a range covers.
  return { offsetBase: 0, ...effectiveRunView(overlay, run, paragraph) }
}

function textRunIdAllocator(document: OoxmlDocument) {
  const used = new Set(
    document.model.stories.flatMap((story) =>
      story.paragraphs.flatMap((paragraph) =>
        paragraph.runs.map((run) => run.id),
      ),
    ),
  )
  let sequence = 1
  return () => {
    let id = `text-edit-${String(sequence).padStart(6, '0')}`
    while (used.has(id)) {
      sequence += 1
      id = `text-edit-${String(sequence).padStart(6, '0')}`
    }
    used.add(id)
    sequence += 1
    return id
  }
}

function mergeRunEmphasis(ranges: readonly RunEmphasis[]): RunEmphasis {
  const merged: RunEmphasis = {}
  for (const range of ranges) {
    if (range.bold !== undefined) merged.bold = range.bold
    if (range.italic !== undefined) merged.italic = range.italic
    if (range.underline !== undefined) merged.underline = range.underline
    if (range.fontFamily !== undefined) merged.fontFamily = range.fontFamily
    if (range.fontSize !== undefined) merged.fontSize = range.fontSize
    if (range.colour !== undefined) merged.colour = range.colour
    if (range.highlight !== undefined) merged.highlight = range.highlight
    if (range.strikethrough !== undefined)
      merged.strikethrough = range.strikethrough
    if (range.vertAlign !== undefined) merged.vertAlign = range.vertAlign
    if (range.smallCaps !== undefined) merged.smallCaps = range.smallCaps
  }
  return merged
}

function emphasisFragments(
  fragments: readonly string[],
  emphasis: RunEmphasis,
) {
  const patched = fragments.map((fragment) =>
    /<w:rPr\b/u.test(fragment)
      ? patchRunEmphasisXml(fragment, emphasis)
      : fragment,
  )
  return patched.some((fragment) => /<w:rPr\b/u.test(fragment))
    ? patched
    : [...patched, patchRunEmphasisXml('<w:rPr/>', emphasis)]
}
