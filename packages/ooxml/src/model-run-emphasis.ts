import type { DocumentTextRunWire } from '@obiter/contracts'

import { locateOffset } from './comment-anchors'
import {
  OoxmlError,
  type OoxmlDocument,
  type ParagraphAnchor,
  type TextRunAnchor,
  type XmlElementRange,
} from './model'
import { requireEditablePart } from './model-edit-overlay'
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
import {
  elementFragment,
  parseXmlElements,
  setOverlayReplacement,
  type XmlOverlay,
} from './parts/overlay'
import { isTextWrappingBreak } from './parts/xml-elements'
import { decodeXmlReferences } from './xml-lexemes'

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
      if (local.every((range) => range.from === 0 && range.to === length)) {
        setRunEmphasis(
          document,
          run,
          mergeRunEmphasis(local.map((range) => range.emphasis)),
        )
      } else {
        const materialise = hasPendingOverlay(part.overlay, run.wire.id)
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

function splitRun(
  overlay: XmlOverlay,
  run: TextRunAnchor,
  paragraph: ParagraphAnchor,
  runStart: number,
  local: readonly LocalRange[],
  materialise: boolean,
  nextId: () => string,
): {
  xml: string
  wires: DocumentTextRunWire[]
  consumedKeys: readonly string[]
} {
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
  const folded = materialiseRun(overlay, run)
  const source = folded.xml
  const elements = parseWrappedRun(overlay.source, source)
  const root = elements.find((element) => element.depth === 0)
  if (!root) throw new OoxmlError('invalid-document-edit')
  const children = elements.filter((element) => element.depth === 1)
  const textElements = children
    .filter((element) => element.localName === 't' && !element.selfClosing)
    .map(elementRange)
  const textBreaks = children
    .filter((element) => isTextWrappingBreak(element))
    .map(elementRange)
  // Mirror the parser: a w:br contributes one text character only when it is a
  // text-wrapping break. A page or column break is structure and consumes none.
  let effectiveText = ''
  for (const element of children) {
    if (element.localName === 't' && !element.selfClosing) {
      effectiveText += decodeXmlReferences(
        source.slice(element.startTagEnd, element.endTagStart),
      )
    } else if (isTextWrappingBreak(element)) {
      effectiveText += '\n'
    }
  }
  if (effectiveText !== run.wire.text) {
    throw new OoxmlError('invalid-document-edit')
  }
  const fragments = children
    .filter(
      (element) => element.localName !== 't' && !isTextWrappingBreak(element),
    )
    .map((element) => elementFragment(source, element))
  const effectiveRun: TextRunAnchor = {
    partName: run.partName,
    wire: run.wire,
    runRange: elementRange(root),
    textRanges: textElements.map(({ startTagEnd, endTagStart }) => ({
      start: startTagEnd,
      end: endTagStart,
    })),
    textElements,
    textBreaks,
    runProperties: fragments.filter((fragment) => /<w:rPr\b/u.test(fragment)),
  }
  return {
    source,
    run: effectiveRun,
    paragraph: {
      ...paragraph,
      runs: [effectiveRun],
      paragraphRange: elementRange(root),
    },
    offsetBase: 0,
    fragments,
    consumedKeys: folded.keys,
  }
}

/**
 * Fold every overlay replacement inside the run into its source slice, so the
 * returned XML is the run exactly as it would serialise today. Callers then
 * split that text and write a single replacement covering the run, which
 * cannot overlap the folded ones. The consumed keys come back with the fold so
 * the caller removes them only once the paragraph has planned successfully.
 */
function materialiseRun(overlay: XmlOverlay, run: TextRunAnchor) {
  const { start, end } = run.runRange
  const replacements = [...overlay.replacements.entries()]
    .filter(
      ([, replacement]) => replacement.start >= start && replacement.end <= end,
    )
    .sort((left, right) => left[1].start - right[1].start)
  let cursor = start
  let result = ''
  const keys: string[] = []
  for (const [key, replacement] of replacements) {
    if (replacement.start < cursor) {
      throw new OoxmlError('invalid-document-edit')
    }
    result += overlay.source.slice(cursor, replacement.start)
    result += replacement.value
    cursor = replacement.end
    keys.push(key)
  }
  result += overlay.source.slice(cursor, end)
  return { xml: result, keys }
}

function hasPendingOverlay(overlay: XmlOverlay, runId: string) {
  for (const key of overlay.replacements.keys()) {
    if (key.startsWith(`${runId}:`)) return true
  }
  return false
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

function elementRange(element: {
  start: number
  startTagEnd: number
  endTagStart: number
  end: number
}): XmlElementRange {
  return {
    start: element.start,
    startTagEnd: element.startTagEnd,
    endTagStart: element.endTagStart,
    end: element.end,
  }
}

// A materialised run is a bare <w:r>; its namespace prefixes are declared on
// the part root, so wrap it in a synthetic root carrying the part's
// declarations and shift the parsed ranges back into run coordinates.
function parseWrappedRun(partSource: string, runXml: string) {
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
