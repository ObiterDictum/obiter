import type {
  DocumentParagraphWire,
  DocumentEditInsertTableOperation,
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
import { resolveCellEditNumbering } from './numbering-edits'
import {
  buildTableParagraphXml,
  buildTableXml,
  decideTablePlacement,
  tableCellParagraphPropertiesXml,
} from './structure-xml'
import { insertRunPropertiesXml } from './model-paragraph-edits'

export function insertTable(
  document: OoxmlDocument,
  story: DocumentStoryWire,
  anchor: ParagraphAnchor,
  rows: number,
  columns: number,
  afterWire: DocumentParagraphWire | undefined,
  occurrence: number,
  lineage?: { recorder: LineageRecorder; operationIndex: number },
  cellEdits?: DocumentEditInsertTableOperation['cellEdits'],
) {
  const part = requireEditablePart(document, anchor.partName)
  const source = part.overlay.source
  const elements = parseXmlElements(source)
  const paragraphElement = elements.find(
    (element) => element.start === anchor.paragraphRange.start,
  )
  const parent = paragraphElement?.parent
  if (!paragraphElement || !parent || !isWord(parent, 'body')) {
    throw new OoxmlError('invalid-document-edit')
  }
  const siblings = elements.filter((element) => element.parent === parent)
  const nextSibling = siblings[siblings.indexOf(paragraphElement) + 1]
  const placement = decideTablePlacement({
    hasPendingTail: afterWire !== undefined,
    hasFollowingBlock: nextSibling !== undefined,
    followingIsTable: nextSibling !== undefined && isWord(nextSibling, 'tbl'),
    followingIsSectionProperties:
      nextSibling !== undefined && isWord(nextSibling, 'sectPr'),
    occurrence,
  })

  const paraIds = Array.from({ length: rows * columns }, () =>
    nextSyntheticParaId(part.overlay),
  )
  const separatorParaId = placement.needsSeparatorParagraph
    ? nextSyntheticParaId(part.overlay)
    : undefined
  const separatorXml = separatorParaId
    ? buildTableParagraphXml(separatorParaId, true)
    : ''
  const resolvedEdits = cellEdits?.map((edit) =>
    resolveCellEditNumbering(document, edit),
  )
  const tblXml = buildTableXml(rows, columns, paraIds, resolvedEdits)
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
  const editByCell = new Map(
    resolvedEdits?.map((edit) => [edit.row * columns + edit.column, edit]),
  )
  for (const [index, paraId] of paraIds.entries()) {
    const edit = editByCell.get(index)
    const pPr = tableCellParagraphPropertiesXml(edit?.paragraph)
    const wireRuns = edit?.runs?.length
      ? edit.runs.map((run, runIndex) => {
          const rPr = insertRunPropertiesXml('w', run)
          return {
            id: `para-w14-${paraId}:run-${String(runIndex)}`,
            ...(run.styleId ? { styleId: run.styleId } : {}),
            text: run.text,
            preservedXmlFragments: rPr === '' ? [] : [rPr],
          }
        })
      : edit?.text === undefined
        ? []
        : [
            {
              id: `para-w14-${paraId}:run-0`,
              text: edit.text,
              preservedXmlFragments: [],
            },
          ]
    cellWires.push({
      id: `para-w14-${paraId}`,
      sourceParaId: paraId,
      ...(edit?.paragraph?.styleId ? { styleId: edit.paragraph.styleId } : {}),
      runs: wireRuns,
      preservedXmlFragments: pPr === '' ? [] : [pPr],
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
  story.preservedXmlFragments.push(tblXml)

  if (lineage) {
    for (const wire of cellWires) {
      recordInsertedParagraph(lineage.recorder, wire, lineage.operationIndex)
    }
  }
  return { lastCell, trailingWire, appended }
}
