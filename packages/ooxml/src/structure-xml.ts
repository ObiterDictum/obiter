import { escapeXmlAttribute } from './parts/overlay'

export const W14_NAMESPACE =
  'http://schemas.microsoft.com/office/word/2010/wordml'
export const IMAGE_RELATIONSHIP_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'
export const HYPERLINK_RELATIONSHIP_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink'
export const RELATIONSHIPS_NAMESPACE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

export const EMU_PER_PX = 9525

const TABLE_WIDTH_TWIPS = 9000

const DRAWING_NAMESPACES =
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"'

/**
 * The structural-insertion markup builders. The save writer and the client's
 * pending fold both call these, so a pending table or picture serialises the
 * same fragment it will carry once stored — pending paint reads the writer's
 * own output through the same model shape a reparse produces.
 */

/**
 * The neighbourhood a table insert is decided against, expressed so both the
 * writer (parsed XML siblings) and the fold (wire paragraphs) can compute it
 * from their own representation.
 */
export type TablePlacementContext = {
  /**
   * Earlier inserts in this batch parked a tail behind the anchor — a prior
   * table's last cell or an inserted paragraph — that the new table chains
   * after to keep operation order.
   */
  hasPendingTail: boolean
  /** A block follows the anchor's pending region in the body. */
  hasFollowingBlock: boolean
  /**
   * The following block is a table: two adjacent `w:tbl` elements merge in
   * Word, so the boundary needs a paragraph between them.
   */
  followingIsTable: boolean
  /** The following block is the body `w:sectPr` — a body cannot end on a table. */
  followingIsSectionProperties: boolean
  /** Tables this anchor already produced in the batch. */
  occurrence: number
}

/** The placement decisions for one table insert. */
export type TablePlacement = {
  /** Splice after the parked tail rather than the anchor paragraph. */
  chainAfterPendingTail: boolean
  /** Emit the separator paragraph keeping two same-anchor tables distinct. */
  needsSeparatorParagraph: boolean
  /**
   * Emit the trailing paragraph OOXML requires after a body-final table or
   * before an adjacent one.
   */
  needsTrailingParagraph: boolean
}

/**
 * The placement rules for a body-level table insert — the single source both
 * the save writer and the pending fold apply, so a painted draft cannot
 * drift from what save/reload produces.
 */
export function decideTablePlacement(
  context: TablePlacementContext,
): TablePlacement {
  return {
    chainAfterPendingTail: context.hasPendingTail,
    needsSeparatorParagraph: context.occurrence > 0,
    needsTrailingParagraph:
      !context.hasFollowingBlock ||
      context.followingIsTable ||
      context.followingIsSectionProperties,
  }
}

/**
 * An empty paragraph carrying a `w14:paraId`. It is a table cell's mandatory
 * last child, the separator Word writes between adjacent tables, and the
 * trailing paragraph OOXML requires after a body-final table. The `w14`
 * namespace is declared inline only where the fragment's own root cannot
 * inherit it: cell paragraphs sit inside a `w:tbl` that declares it, while a
 * separator or trailing paragraph is a body-level sibling and must carry it.
 */
export function buildTableParagraphXml(
  paraId: string,
  declareNamespace: boolean,
) {
  return declareNamespace
    ? `<w:p xmlns:w14="${W14_NAMESPACE}" w14:paraId="${paraId}"/>`
    : `<w:p w14:paraId="${paraId}"/>`
}

/**
 * A bordered, full-width table: `w:tbl` carrying `w:tblPr`/`w:tblGrid`, each
 * `w:tr` holding `columns` `w:tc` cells that each end in an empty paragraph —
 * the OOXML rule that a cell's last child is its `w:p`. `cellParaIds` supplies
 * one `w14:paraId` per cell, row-major, so `paragraphIdsInCell` binds each
 * cell paragraph to a distinct wire.
 *
 * Merged cells and nested tables are deliberately not offered by E6's insert:
 * the writer emits a plain grid rather than a `gridSpan`/`vMerge`/`w:tbl` it
 * cannot address afterwards.
 */
export function buildTableXml(
  rows: number,
  columns: number,
  cellParaIds: readonly string[],
) {
  const columnWidth = Math.floor(TABLE_WIDTH_TWIPS / columns)
  const grid = `<w:gridCol w:w="${String(columnWidth)}"/>`.repeat(columns)
  let cursor = 0
  const cell = () =>
    `<w:tc><w:tcPr><w:tcW w:w="${String(columnWidth)}" w:type="dxa"/></w:tcPr>${buildTableParagraphXml(cellParaIds[cursor++] ?? '', false)}</w:tc>`
  const row = () =>
    `<w:tr>${Array.from({ length: columns }, cell).join('')}</w:tr>`
  return (
    `<w:tbl xmlns:w14="${W14_NAMESPACE}">` +
    `<w:tblPr><w:tblW w:w="5000" w:type="pct"/>` +
    `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map(
        (edge) =>
          `<w:${edge} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`,
      )
      .join('')}</w:tblBorders>` +
    `<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar>` +
    `</w:tblPr><w:tblGrid>${grid}</w:tblGrid>${Array.from({ length: rows }, row).join('')}</w:tbl>`
  )
}

/**
 * An inline picture: `w:drawing`/`wp:inline`/`a:blip` with the image part
 * addressed by `relId` — the same shape the reader resolves
 * (`imagePartNameForDrawing`) and paints (`PageDrawing`). The extent is the
 * requested pixel size in EMU at 96 dpi, which is how `drawingBoxSize` reads
 * it back.
 */
export function buildInlineDrawingXml({
  widthPx,
  heightPx,
  relId,
  name,
  docPrId,
}: {
  widthPx: number
  heightPx: number
  relId: string
  name: string
  docPrId: number
}) {
  const cx = Math.round(widthPx * EMU_PER_PX)
  const cy = Math.round(heightPx * EMU_PER_PX)
  const id = String(docPrId)
  const escaped = escapeXmlAttribute(name)
  return (
    `<w:drawing ${DRAWING_NAMESPACES}>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${String(cx)}" cy="${String(cy)}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${id}" name="${escaped}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${escaped}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${escapeXmlAttribute(relId)}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${String(cx)}" cy="${String(cy)}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`
  )
}
