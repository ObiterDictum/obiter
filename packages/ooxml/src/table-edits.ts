import type {
  DocumentParagraphWire,
  DocumentStoryWire,
} from '@obiter/contracts'

import {
  recordInsertedParagraph,
  type LineageRecorder,
} from './document-lineage'
import { OoxmlError, type OoxmlDocument, type ParagraphAnchor } from './model'
import { requireEditablePart } from './model-edit-overlay'
import { parseXmlElements, setOverlayReplacement } from './parts/overlay'
import { isWord } from './parts/xml-elements'
import { nextSyntheticParaId } from './structure-package'
import {
  buildTableParagraphXml,
  buildTableXml,
  decideTablePlacement,
} from './structure-xml'

/**
 * A bordered, full-width table: `w:tbl` carrying `w:tblPr`/`w:tblGrid`, each
 * `w:tr` holding `columns` `w:tc` cells that each end in an empty paragraph —
 * the OOXML rule that a cell's last child is its `w:p`. Every cell paragraph
 * carries a `w14:paraId`, which is how the reader binds cell paragraphs back
 * to the table (`paragraphIdsInCell` maps them to `para-w14-…` wire ids), so
 * the wire identity survives serialise/reload unchanged.
 *
 * Merged cells and nested tables are deliberately not offered by E6's insert:
 * the writer emits a plain grid rather than a `gridSpan`/`vMerge`/`w:tbl` it
 * cannot address afterwards.
 *
 * Returns the last cell paragraph wire so the caller can chain a second
 * table at the same anchor after it, in operation order, plus the number of
 * wires spliced — the separator, cells, and a freshly added trailing
 * paragraph — so the caller's post-anchor insertion count stays in step with
 * the wire model.
 */
export function insertTable(
  document: OoxmlDocument,
  story: DocumentStoryWire,
  anchor: ParagraphAnchor,
  rows: number,
  columns: number,
  /**
   * Two tables after one anchor compose in order: the next table's cell
   * wires splice after the previous table's last cell, matching the
   * zero-width overlay order at the same source offset. `occurrence` keeps
   * each table's overlay key distinct.
   */
  afterWire: DocumentParagraphWire | undefined,
  occurrence: number,
  lineage?: { recorder: LineageRecorder; operationIndex: number },
) {
  const part = requireEditablePart(document, anchor.partName)
  const source = part.overlay.source
  const elements = parseXmlElements(source)
  const paragraphElement = elements.find(
    (element) => element.start === anchor.paragraphRange.start,
  )
  const parent = paragraphElement?.parent
  // A table is a body-level block. Anchoring inside a table cell would nest a
  // table the client cannot bind to a position, and anchoring inside another
  // container (a structured-document-tag, a text box) would silently move the
  // table into structure the contract does not address. Refuse both.
  if (!paragraphElement || !parent || !isWord(parent, 'body')) {
    throw new OoxmlError('invalid-document-edit')
  }
  const siblings = elements.filter((element) => element.parent === parent)
  const nextSibling = siblings[siblings.indexOf(paragraphElement) + 1]
  // The placement rules are shared with the pending fold
  // (`decideTablePlacement`): the writer derives the descriptor from the
  // anchor's parsed siblings, the fold from the wires after the parked tail.
  const placement = decideTablePlacement({
    hasPendingTail: afterWire !== undefined,
    hasFollowingBlock: nextSibling !== undefined,
    followingIsTable: nextSibling !== undefined && isWord(nextSibling, 'tbl'),
    followingIsSectionProperties:
      nextSibling !== undefined && isWord(nextSibling, 'sectPr'),
    occurrence,
  })

  // Every cell gets its own paragraph id: `paragraphIdsInCell` binds cell
  // paragraphs to `para-w14-…` wires, so two cells sharing an id would bind to
  // the same wire twice.
  const paraIds = Array.from({ length: rows * columns }, () =>
    nextSyntheticParaId(part.overlay),
  )
  const separatorParaId = placement.needsSeparatorParagraph
    ? nextSyntheticParaId(part.overlay)
    : undefined
  const separatorXml = separatorParaId
    ? buildTableParagraphXml(separatorParaId, true)
    : ''
  const tblXml = buildTableXml(rows, columns, paraIds)
  const tableXml = separatorXml + tblXml

  const at = anchor.paragraphRange.end
  const overlay = part.overlay
  const tableKey = `${anchor.wire.id}:table:${String(occurrence)}`
  setOverlayReplacement(overlay, tableKey, {
    start: at,
    end: at,
    value: tableXml,
  })

  let trailingWire: DocumentParagraphWire | undefined
  if (placement.needsTrailingParagraph) {
    // The trailing paragraph must serialise after every table at this anchor:
    // a re-insert deletes and re-sets its key so map order puts it last again.
    // Its paraId is read back from the pending replacement so the re-emitted
    // paragraph keeps its wire identity instead of minting a second one.
    const trailingKey = `${anchor.wire.id}:table:end`
    const prior = overlay.replacements.get(trailingKey)
    const priorId = prior
      ? /w14:paraId="([0-9A-Fa-f]{8})"/u.exec(prior.value)?.[1]
      : undefined
    const trailingParaId = priorId ?? nextSyntheticParaId(overlay)
    overlay.replacements.delete(trailingKey)
    setOverlayReplacement(overlay, trailingKey, {
      start: at,
      end: at,
      value: buildTableParagraphXml(trailingParaId, true),
    })
    trailingWire = {
      id: `para-w14-${trailingParaId}`,
      sourceParaId: trailingParaId,
      runs: [],
      preservedXmlFragments: [],
    }
  }
  part.dirty = true

  const after = placement.chainAfterPendingTail ? afterWire : undefined
  const index = story.paragraphs.indexOf(after ?? anchor.wire)
  const cellWires: DocumentParagraphWire[] = []
  if (separatorParaId) {
    cellWires.push({
      id: `para-w14-${separatorParaId}`,
      sourceParaId: separatorParaId,
      runs: [],
      preservedXmlFragments: [],
    })
  }
  for (const paraId of paraIds) {
    cellWires.push({
      id: `para-w14-${paraId}`,
      sourceParaId: paraId,
      runs: [],
      preservedXmlFragments: [],
    })
  }
  const lastCell = cellWires[cellWires.length - 1] ?? anchor.wire
  let appended = cellWires.length
  if (
    trailingWire &&
    !story.paragraphs.some((paragraph) => paragraph.id === trailingWire.id)
  ) {
    cellWires.push(trailingWire)
    appended += 1
  }
  story.paragraphs.splice(index + 1, 0, ...cellWires)
  // The story fragment is the `w:tbl` alone — the separator is a sibling
  // `w:p`, which is exactly how a reparse splits the same source.
  story.preservedXmlFragments.push(tblXml)

  if (lineage) {
    for (const wire of cellWires) {
      recordInsertedParagraph(lineage.recorder, wire, lineage.operationIndex)
    }
  }
  // Chain the next table after the last cell wire, not the trailing
  // paragraph: the wire order must mirror the serialised order, where the
  // trailing paragraph stays after every table.
  return { lastCell, trailingWire, appended }
}
