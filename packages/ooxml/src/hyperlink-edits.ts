import type { DocumentTextRunWire } from '@obiter/contracts'

import { locateOffset } from './comment-anchors'
import { recordSplitRun, type LineageRecorder } from './document-lineage'
import {
  OoxmlError,
  type OoxmlDocument,
  type ParagraphAnchor,
  type TextRunAnchor,
} from './model'
import { requireEditablePart } from './model-edit-overlay'
import { allocateModelId } from './model-paragraph-edits'
import { runPieceXml, splitsSurrogate } from './model-run-range-edits'
import {
  elementFragment,
  parseXmlElements,
  setOverlayReplacement,
  type XmlOverlay,
} from './parts/overlay'
import {
  attributeValue,
  isWord,
  type XmlElement,
} from './parts/xml-elements'
import { effectiveRunView, runHasPendingOverlay } from './run-effective'
import {
  appendRelationship,
  relationshipsPartName,
} from './structure-package'
import {
  HYPERLINK_RELATIONSHIP_TYPE,
  RELATIONSHIPS_NAMESPACE,
} from './structure-xml'

export interface SetHyperlinkOperation {
  from: number
  to: number
  target: string | null
}

/**
 * Wraps the runs covering `[from, to)` of the paragraph's effective text in a
 * `w:hyperlink` element joined to a new external relationship, or — with
 * `target: null` — unwraps the hyperlink covering `from` and drops its
 * relationship. The mark inserts no text, so no offset downstream can move.
 *
 * Only the first and last covered runs are split: a covered interior run
 * stays untouched inside the wrap, preserving its markup byte-for-byte. The
 * source anchors are left alone — like every range edit, the anchor's
 * `runRange` must keep addressing the original element — while the wire
 * gains the run pieces a reparse would produce.
 */
export function setHyperlink(
  document: OoxmlDocument,
  paragraph: ParagraphAnchor,
  operation: SetHyperlinkOperation,
  occurrence: number,
  lineage?: LineageRecorder,
) {
  const part = requireEditablePart(document, paragraph.partName)
  if (paragraph.hasTrackedChanges) {
    throw new OoxmlError('model-node-not-editable')
  }
  const text = paragraph.runs.map((run) => run.wire.text).join('')
  const { from, to, target } = operation
  if (
    from < 0 ||
    to > text.length ||
    from >= to ||
    splitsSurrogate(text, from) ||
    splitsSurrogate(text, to)
  ) {
    throw new OoxmlError('invalid-document-edit')
  }
  if (target === null) {
    removeHyperlink(document, paragraph, from, occurrence)
    return
  }
  const runs = coveringRuns(paragraph, from, to)
  refuseNestedHyperlink(part.overlay.source, runs)
  const relationship = appendRelationship(document, paragraph.partName, {
    type: HYPERLINK_RELATIONSHIP_TYPE,
    target,
    targetMode: 'External',
  })
  const openTag =
    `<w:hyperlink xmlns:r="${RELATIONSHIPS_NAMESPACE}"` +
    ` r:id="${relationship.id}">`
  const fragment = writeHyperlinkWrap(
    document,
    part.overlay,
    paragraph,
    runs,
    openTag,
    occurrence,
    lineage,
  )
  paragraph.wire.preservedXmlFragments.push(fragment)
  part.dirty = true
}

interface CoveringRun {
  anchor: TextRunAnchor
  runStart: number
  localFrom: number
  localTo: number
  first: boolean
  last: boolean
}

/** Runs whose effective text intersects `[from, to)`, in document order. */
function coveringRuns(
  paragraph: ParagraphAnchor,
  from: number,
  to: number,
): CoveringRun[] {
  const runs: CoveringRun[] = []
  let runStart = 0
  paragraph.runs.forEach((run) => {
    const runEnd = runStart + run.wire.text.length
    const localFrom = Math.max(0, from - runStart)
    const localTo = Math.min(run.wire.text.length, to - runStart)
    if (localFrom < localTo) {
      runs.push({
        anchor: run,
        runStart,
        localFrom,
        localTo,
        first: false,
        last: false,
      })
    }
    runStart = runEnd
  })
  const first = runs[0]
  const last = runs.at(-1)
  if (!first || !last) throw new OoxmlError('invalid-document-edit')
  first.first = true
  last.last = true
  return runs
}

/**
 * Refuses a wrap that would overlap a stored `w:hyperlink`. Nested hyperlinks
 * are invalid markup and a partial overlap would leave half a link
 * byte-corrupt; both get the same typed refusal rather than a silent rewrite.
 */
function refuseNestedHyperlink(source: string, runs: readonly CoveringRun[]) {
  const elements = parseXmlElements(source)
  for (const element of elements) {
    if (!isWord(element, 'hyperlink')) continue
    for (const { anchor } of runs) {
      if (
        element.start <= anchor.runRange.start &&
        element.end >= anchor.runRange.end
      ) {
        throw new OoxmlError('invalid-document-edit')
      }
    }
  }
}

/**
 * Writes the boundary replacements and returns the `w:hyperlink` fragment for
 * the wire — the wrapper with every covered run element nested inside it, as
 * `preservedXmlFragments` reports after a reparse.
 */
function writeHyperlinkWrap(
  document: OoxmlDocument,
  overlay: XmlOverlay,
  paragraph: ParagraphAnchor,
  runs: readonly CoveringRun[],
  openTag: string,
  occurrence: number,
  lineage?: LineageRecorder,
) {
  const pieces: string[] = []
  for (const covered of runs) {
    const { anchor, localFrom, localTo } = covered
    const needsHead = localFrom > 0
    const needsTail = localTo < anchor.wire.text.length
    if (!needsHead && !needsTail && !covered.first && !covered.last) {
      pieces.push(
        overlay.source.slice(anchor.runRange.start, anchor.runRange.end),
      )
      continue
    }
    const materialise = runHasPendingOverlay(overlay, anchor)
    const view = materialise
      ? effectiveRunView(overlay, anchor, paragraph)
      : {
          paragraph,
          run: anchor,
          source: overlay.source,
          consumedKeys: [] as string[],
        }
    // A materialised view's paragraph holds only the folded run, so its
    // offsets are run-local; the source view addresses paragraph offsets.
    const offsetBase = materialise ? 0 : covered.runStart
    const startCut = needsHead
      ? locateOffset(view.source, view.paragraph, offsetBase + localFrom)
      : undefined
    const endCut = needsTail
      ? locateOffset(view.source, view.paragraph, offsetBase + localTo)
      : undefined
    const headXml = needsHead
      ? runPieceXml(view.source, view.run, undefined, startCut)
      : ''
    const coveredXml = runPieceXml(view.source, view.run, startCut, endCut)
    const tailXml = needsTail
      ? runPieceXml(view.source, view.run, endCut, undefined)
      : ''
    pieces.push(coveredXml)
    const parts = [
      ...(needsHead ? [{ from: 0, to: localFrom }] : []),
      { from: localFrom, to: localTo },
      ...(needsTail ? [{ from: localTo, to: anchor.wire.text.length }] : []),
    ]
    const wireRuns: DocumentTextRunWire[] = parts.map((part, index) => ({
      id: index === 0 ? anchor.wire.id : allocateModelId(document, 'text-edit'),
      text: anchor.wire.text.slice(part.from, part.to),
      preservedXmlFragments: [...anchor.wire.preservedXmlFragments],
      ...(anchor.wire.styleId !== undefined
        ? { styleId: anchor.wire.styleId }
        : {}),
    }))
    const value = [
      headXml,
      covered.first ? openTag : '',
      coveredXml,
      covered.last ? '</w:hyperlink>' : '',
      tailXml,
    ].join('')
    for (const key of view.consumedKeys) overlay.replacements.delete(key)
    setOverlayReplacement(
      overlay,
      `${anchor.wire.id}:hyperlink:${String(occurrence)}`,
      { start: anchor.runRange.start, end: anchor.runRange.end, value },
    )
    const wireIndex = paragraph.wire.runs.indexOf(anchor.wire)
    if (wireIndex === -1) throw new OoxmlError('invalid-document-edit')
    paragraph.wire.runs.splice(wireIndex, 1, ...wireRuns)
    if (wireRuns.length > 1 && lineage) {
      recordSplitRun(
        lineage,
        anchor.wire,
        parts.map((part, index) => ({
          run: wireRuns[index],
          from: part.from,
          to: part.to,
        })),
      )
    }
  }
  return `${openTag}${pieces.join('')}</w:hyperlink>`
}

/**
 * Unwraps the stored `w:hyperlink` covering `from` and drops its relationship.
 * The inner markup is lifted out byte-for-byte; a pending replacement touching
 * the element refuses rather than silently swallowing work queued this batch.
 */
function removeHyperlink(
  document: OoxmlDocument,
  paragraph: ParagraphAnchor,
  from: number,
  occurrence: number,
) {
  const part = requireEditablePart(document, paragraph.partName)
  const covering = coveringRuns(paragraph, from, from + 1)
  const run = covering[0]
  if (!run) throw new OoxmlError('invalid-document-edit')
  const elements = parseXmlElements(part.overlay.source)
  const runElement = elements.find(
    (element) =>
      isWord(element, 'r') && element.start === run.anchor.runRange.start,
  )
  const linkElement = runElement ? hyperlinkAncestor(runElement) : undefined
  if (!linkElement) throw new OoxmlError('invalid-document-edit')
  for (const replacement of part.overlay.replacements.values()) {
    if (
      replacement.start < linkElement.end &&
      replacement.end > linkElement.start
    ) {
      throw new OoxmlError('invalid-document-edit')
    }
  }
  const relId = attributeValue(linkElement, RELATIONSHIPS_NAMESPACE, 'id')
  setOverlayReplacement(
    part.overlay,
    `${run.anchor.wire.id}:hyperlink:remove:${String(occurrence)}`,
    {
      start: linkElement.start,
      end: linkElement.end,
      value: part.overlay.source.slice(
        linkElement.startTagEnd,
        linkElement.endTagStart,
      ),
    },
  )
  part.dirty = true
  const fragment = elementFragment(part.overlay.source, linkElement)
  paragraph.wire.preservedXmlFragments =
    paragraph.wire.preservedXmlFragments.filter((item) => item !== fragment)
  if (relId) dropRelationship(document, paragraph.partName, relId)
}

/** The enclosing `w:hyperlink` of a run element, if one exists. */
function hyperlinkAncestor(element: XmlElement): XmlElement | undefined {
  let cursor = element.parent
  while (cursor) {
    if (isWord(cursor, 'hyperlink')) return cursor
    cursor = cursor.parent
  }
  return undefined
}

/** Removes a relationship element from the part's rels and the wire. */
function dropRelationship(
  document: OoxmlDocument,
  partName: string,
  relationshipId: string,
) {
  const relsName = relationshipsPartName(partName)
  const rels = document.sourceParts.get(relsName)
  if (rels?.kind === 'xml' && rels.overlay) {
    const elements = parseXmlElements(rels.overlay.source)
    const element = elements.find(
      (item) =>
        item.localName === 'Relationship' &&
        attributeValue(item, '', 'Id') === relationshipId,
    )
    if (!element) throw new OoxmlError('invalid-document-edit')
    for (const replacement of rels.overlay.replacements.values()) {
      if (replacement.start < element.end && replacement.end > element.start) {
        throw new OoxmlError('invalid-document-edit')
      }
    }
    setOverlayReplacement(
      rels.overlay,
      `relationship:${relationshipId}:remove`,
      { start: element.start, end: element.end, value: '' },
    )
    rels.dirty = true
  }
  const index = document.model.relationships.findIndex(
    (wire) => wire.sourcePartName === partName && wire.id === relationshipId,
  )
  if (index >= 0) document.model.relationships.splice(index, 1)
}
