import {
  DOCUMENT_EDIT_TABLE_OF_AUTHORITIES_MAX_ENTRIES,
  DOCUMENT_EDIT_TABLE_OF_AUTHORITIES_MAX_OCCURRENCES,
} from '@obiter/contracts'
import type { DocumentStoryWire } from '@obiter/contracts'

import { locateOffset } from './text-offsets'
import { ensureParagraphBookmark } from './document-bookmarks'
import type { LineageRecorder } from './document-lineage'
import { OoxmlError, type OoxmlDocument, type ParagraphAnchor } from './model'
import { requireEditablePart } from './model-edit-overlay'
import { allocateModelId } from './model-paragraph-edits'
import {
  parseXmlElements,
  setOverlayReplacement,
  type XmlOverlay,
} from './parts/overlay'
import { isWord } from './parts/xml-elements'
import { runHasPendingOverlay } from './run-effective'
import {
  assertNoPendingAt,
  runHoldingOffset,
  spliceInlineXml,
  spliceIntoPendingRun,
  spliceRunWires,
  validateEffectiveOffset,
} from './structure-splice'
import { nextSyntheticParaId } from './structure-package'
import { W14_NAMESPACE } from './structure-xml'
import { tableOfAuthoritiesCitations } from './table-of-authorities-entries'
import {
  effectivePropertiesXml,
  isBlankParagraph,
  spliceIntoBlankParagraph,
  spliceParagraphWires,
  tocSpliceReplacement,
} from './table-of-contents-splice'
import {
  sectionColumnWidthTwips,
  TOC_FIELD_END_RUN,
} from './table-of-contents-xml'
import {
  tableAuthorityMarkWires,
  tableAuthorityMarkXml,
  toaEntryParagraphWire,
  toaEntryParagraphXml,
  toaHeadingParagraphWire,
  toaHeadingParagraphXml,
  type ToaEntry,
} from './table-of-authorities-xml'

const TOA_BOOKMARK_PREFIX = '_ToA'

export function insertTableOfAuthorities(
  document: OoxmlDocument,
  story: DocumentStoryWire,
  paragraph: ParagraphAnchor,
  offset: number,
  occurrence: number,
  deletedIds: ReadonlySet<string>,
  lineage?: { recorder: LineageRecorder; operationIndex: number },
) {
  const part = requireEditablePart(document, paragraph.partName)
  if (paragraph.hasTrackedChanges) {
    throw new OoxmlError('model-node-not-editable')
  }
  validateEffectiveOffset(paragraph, offset)
  const source = part.overlay.source
  const elements = parseXmlElements(source)
  const paragraphElement = elements.find(
    (element) => element.start === paragraph.paragraphRange.start,
  )
  const parent = paragraphElement?.parent
  if (!paragraphElement || !parent || !isWord(parent, 'body')) {
    throw new OoxmlError('invalid-document-edit')
  }

  const { occurrences, entries } = tableOfAuthoritiesCitations(story.paragraphs)
  const anchors = new Map<string, ParagraphAnchor>()
  for (const id of new Set([
    ...entries.flatMap((entry) => entry.paragraphIds),
    ...occurrences.map((hit) => hit.paragraphId),
  ])) {
    if (deletedIds.has(id)) continue
    const anchor = document.paragraphAnchors.get(id)
    if (!anchor) continue
    if (anchor.hasTrackedChanges) {
      throw new OoxmlError('model-node-not-editable')
    }
    anchors.set(id, anchor)
  }
  const liveEntries = entries
    .map((entry) => ({
      ...entry,
      paragraphIds: entry.paragraphIds.filter((id) => anchors.has(id)),
    }))
    .filter((entry) => entry.paragraphIds.length > 0)
  const liveOccurrences = occurrences.filter((hit) =>
    anchors.has(hit.paragraphId),
  )
  if (
    liveEntries.length === 0 ||
    liveEntries.length > DOCUMENT_EDIT_TABLE_OF_AUTHORITIES_MAX_ENTRIES ||
    liveOccurrences.length > DOCUMENT_EDIT_TABLE_OF_AUTHORITIES_MAX_OCCURRENCES
  ) {
    throw new OoxmlError('invalid-document-edit')
  }

  const overlay = part.overlay
  const pPrCopy = effectivePropertiesXml(overlay, paragraph)
  if (/<w:sectPr\b/u.test(pPrCopy)) {
    throw new OoxmlError('invalid-document-edit')
  }
  const holder = runHoldingOffset(paragraph, offset)
  if (holder && runHasPendingOverlay(overlay, holder.run)) {
    refuseInsideStoredHyperlink(overlay, holder.run.runRange.start)
    if (holder.run.wire.hyperlinkTarget !== undefined) {
      throw new OoxmlError('invalid-document-edit')
    }
  } else if (!isBlankParagraph(paragraph)) {
    const point = locateOffset(source, paragraph, offset, true)
    assertNoPendingAt(overlay, point.sourceOffset)
    refuseInsideStoredHyperlink(overlay, point.sourceOffset)
  }

  const nextRunId = () => allocateModelId(document, 'text-edit')
  liveOccurrences.forEach((hit, index) => {
    const anchor = anchors.get(hit.paragraphId)
    if (!anchor) return
    spliceInlineXml(
      part.overlay,
      anchor,
      hit.end,
      tableAuthorityMarkXml(hit.citation),
      `${anchor.wire.id}:ta:${String(index)}`,
    )
    spliceRunWires(
      anchor.wire,
      hit.end,
      tableAuthorityMarkWires(nextRunId, hit.citation),
      nextRunId,
      lineage?.recorder,
    )
  })

  const toaEntries: ToaEntry[] = liveEntries.map((entry) => ({
    ...entry,
    bookmarks: entry.paragraphIds.map((id) => {
      const anchor = anchors.get(id)
      if (!anchor) throw new OoxmlError('invalid-document-edit')
      return ensureParagraphBookmark(document, anchor, TOA_BOOKMARK_PREFIX)
    }),
  }))

  const headingParaId = nextSyntheticParaId(overlay)
  const paraIds = toaEntries.map(() => nextSyntheticParaId(overlay))
  const tailParaId = nextSyntheticParaId(overlay)
  const tabPosition = sectionColumnWidthTwips(
    elements,
    paragraph.paragraphRange.end,
  )
  const entriesXml =
    toaHeadingParagraphXml(headingParaId) +
    toaEntries
      .map((entry, index) =>
        toaEntryParagraphXml(entry, paraIds[index] ?? '', tabPosition),
      )
      .join('')
  const tailOpen = `<w:p xmlns:w14="${W14_NAMESPACE}" w14:paraId="${tailParaId}">${pPrCopy}${TOC_FIELD_END_RUN}`

  if (isBlankParagraph(paragraph)) {
    spliceIntoBlankParagraph(
      overlay,
      paragraph,
      entriesXml,
      tailParaId,
      pPrCopy,
    )
  } else {
    const insertion = `</w:p>${entriesXml}${tailOpen}`
    const key = `${paragraph.wire.id}:toa:${String(occurrence)}`
    const holder = runHoldingOffset(paragraph, offset)
    if (holder && runHasPendingOverlay(overlay, holder.run)) {
      refuseInsideStoredHyperlink(overlay, holder.run.runRange.start)
      if (holder.run.wire.hyperlinkTarget !== undefined) {
        throw new OoxmlError('invalid-document-edit')
      }
      spliceIntoPendingRun(overlay, paragraph, holder, offset, insertion, key)
    } else {
      const point = locateOffset(source, paragraph, offset, true)
      assertNoPendingAt(overlay, point.sourceOffset)
      refuseInsideStoredHyperlink(overlay, point.sourceOffset)
      setOverlayReplacement(
        overlay,
        key,
        tocSpliceReplacement(source, point, insertion),
      )
    }
  }
  part.dirty = true

  const insertedWires = [
    toaHeadingParagraphWire(nextRunId, headingParaId),
    ...toaEntries.map((entry, index) =>
      toaEntryParagraphWire(
        nextRunId,
        entry,
        paraIds[index] ?? '',
        tabPosition,
      ),
    ),
  ]
  const tailWire = spliceParagraphWires(
    document,
    story,
    paragraph,
    offset,
    insertedWires,
    tailParaId,
    pPrCopy,
    lineage,
  )
  return { lastWire: tailWire, appended: toaEntries.length + 2 }
}

function refuseInsideStoredHyperlink(
  overlay: XmlOverlay,
  sourceOffset: number,
) {
  for (const element of parseXmlElements(overlay.source)) {
    if (
      isWord(element, 'hyperlink') &&
      element.start < sourceOffset &&
      sourceOffset < element.end
    ) {
      throw new OoxmlError('invalid-document-edit')
    }
  }
}
