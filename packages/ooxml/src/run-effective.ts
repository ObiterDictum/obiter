import type { ParagraphAnchor, TextRunAnchor, XmlElementRange } from './model'
import { OoxmlError } from './model'
import { parseWrappedRun } from './model-run-range-edits'
import { elementFragment, type XmlOverlay } from './parts/overlay'
import { elementRange, isTextWrappingBreak } from './parts/xml-elements'
import { decodeXmlReferences } from './xml-lexemes'

export type EffectiveRunView = {
  source: string
  run: TextRunAnchor
  paragraph: ParagraphAnchor
  fragments: readonly string[]
  consumedKeys: readonly string[]
}

export function effectiveRunView(
  overlay: XmlOverlay,
  run: TextRunAnchor,
  paragraph: ParagraphAnchor,
): EffectiveRunView {
  const folded = materialiseRun(overlay, run)
  const source = mergeSiblingRuns(overlay.source, folded.xml)
  const elements = parseWrappedRun(overlay.source, source)
  const runElements = elements.filter((element) => element.depth === 0)
  const first = runElements[0]
  const last = runElements.at(-1)
  if (!first || !last || runElements.length !== 1) {
    throw new OoxmlError('invalid-document-edit')
  }
  const children = elements.filter((element) => element.depth === 1)
  const textElements = children
    .filter((element) => element.localName === 't' && !element.selfClosing)
    .map(elementRange)
  const textBreaks = children
    .filter((element) => isTextWrappingBreak(element))
    .map(elementRange)
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
  const runRange: XmlElementRange = {
    start: first.start,
    startTagEnd: first.startTagEnd,
    endTagStart: last.endTagStart,
    end: last.end,
  }
  const effectiveRun: TextRunAnchor = {
    partName: run.partName,
    wire: run.wire,
    runRange,
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
      paragraphRange: runRange,
    },
    fragments,
    consumedKeys: folded.keys,
  }
}

function materialiseRun(overlay: XmlOverlay, run: TextRunAnchor) {
  const { start, end } = run.runRange
  const replacements = [...overlay.replacements.entries()]
    .filter(([, replacement]) => insideRunRange(replacement, start, end))
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

export function runHasPendingOverlay(overlay: XmlOverlay, run: TextRunAnchor) {
  const { start, end } = run.runRange
  for (const [key, replacement] of overlay.replacements) {
    if (key.startsWith(`${run.wire.id}:`)) return true
    if (insideRunRange(replacement, start, end) && replacement.start < end) {
      return true
    }
  }
  return false
}

function insideRunRange(
  replacement: { start: number; end: number },
  start: number,
  end: number,
) {
  if (
    replacement.start === replacement.end &&
    (replacement.start === start || replacement.start === end)
  ) {
    return false
  }
  return replacement.start >= start && replacement.end <= end
}

function mergeSiblingRuns(partSource: string, runXml: string) {
  const elements = parseWrappedRun(partSource, runXml)
  const runs = elements.filter((element) => element.depth === 0)
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
