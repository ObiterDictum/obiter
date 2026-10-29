import { DOCUMENT_EDIT_TABLE_OF_CONTENTS_MAX_ENTRIES } from '@obiter/contracts'
import type { DocumentStoryWire } from '@obiter/contracts'

import { locateOffset } from './text-offsets'
import { ensureParagraphBookmark } from './document-bookmarks'
import type { LineageRecorder } from './document-lineage'
import { OoxmlError, type OoxmlDocument, type ParagraphAnchor } from './model'
import { requireEditablePart } from './model-edit-overlay'
import {
  parseXmlElements,
  setOverlayReplacement,
  type XmlOverlay,
} from './parts/overlay'
import { isWord } from './parts/xml-elements'
import { nextSyntheticParaId } from './structure-package'
import { W14_NAMESPACE } from './structure-xml'
import { runHasPendingOverlay } from './run-effective'
import {
  assertNoPendingAt,
  runHoldingOffset,
  spliceIntoPendingRun,
  validateEffectiveOffset,
} from './structure-splice'
import { tableOfContentsEntries } from './table-of-contents-entries'
import {
  effectivePropertiesXml,
  isBlankParagraph,
  spliceIntoBlankParagraph,
  spliceParagraphWires,
  tocSpliceReplacement,
} from './table-of-contents-splice'
import {
  entryParagraphWire,
  entryParagraphXml,
  sectionColumnWidthTwips,
  TOC_FIELD_END_RUN,
  type TocEntry,
} from './table-of-contents-xml'
import { allocateModelId } from './model-paragraph-edits'

const TOC_BOOKMARK_PREFIX = '_Toc'

export function insertTableOfContents(
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

  const entries = headingEntries(document, deletedIds)
  if (
    entries.length === 0 ||
    entries.length > DOCUMENT_EDIT_TABLE_OF_CONTENTS_MAX_ENTRIES
  ) {
    throw new OoxmlError('invalid-document-edit')
  }

  const overlay = part.overlay
  const pPrCopy = effectivePropertiesXml(overlay, paragraph)
  if (/<w:sectPr\b/u.test(pPrCopy)) {
    throw new OoxmlError('invalid-document-edit')
  }
  const paraIds = entries.map(() => nextSyntheticParaId(overlay))
  const tailParaId = nextSyntheticParaId(overlay)
  const tabPosition = sectionColumnWidthTwips(
    elements,
    paragraph.paragraphRange.end,
  )
  const entriesXml = entries
    .map((entry, index) =>
      entryParagraphXml(entry, paraIds[index] ?? '', index === 0, tabPosition),
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
    const key = `${paragraph.wire.id}:toc:${String(occurrence)}`
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

  const nextRunId = () => allocateModelId(document, 'text-edit')
  const entryWires = entries.map((entry, index) =>
    entryParagraphWire(
      nextRunId,
      entry,
      paraIds[index] ?? '',
      index === 0,
      tabPosition,
    ),
  )
  const tailWire = spliceParagraphWires(
    document,
    story,
    paragraph,
    offset,
    entryWires,
    tailParaId,
    pPrCopy,
    lineage,
  )
  return { lastWire: tailWire, appended: entries.length + 1 }
}

function headingEntries(
  document: OoxmlDocument,
  deletedIds: ReadonlySet<string>,
): TocEntry[] {
  const entries: TocEntry[] = []
  for (const entry of tableOfContentsEntries(document.model)) {
    if (deletedIds.has(entry.paragraphId)) continue
    const anchor = document.paragraphAnchors.get(entry.paragraphId)
    if (!anchor) continue
    if (anchor.hasTrackedChanges) {
      throw new OoxmlError('model-node-not-editable')
    }
    entries.push({
      ...entry,
      bookmark: ensureParagraphBookmark(document, anchor, TOC_BOOKMARK_PREFIX),
    })
  }
  return entries
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
