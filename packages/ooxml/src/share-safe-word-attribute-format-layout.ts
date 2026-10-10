/**
 * Layout, table, section and numbering formatting attributes — the
 * element → attribute → value bound table slice covering frames, table
 * machinery, page/section setup and numbering declarations. Consumed by
 * `WML_FORMAT_ATTRIBUTE_BOUNDS` in `share-safe-word-attribute-format.ts`.
 */
import type { ShareSafeValueBound } from './share-safe-value-bounds'
import {
  WML_FRAME_ALIGN,
  WML_FRAME_ANCHOR,
  WML_FRAME_WRAP,
  WML_FRAME_YSPEC,
  WML_DROP_CAP,
  WML_TBL_OVERLAP,
  WML_TBL_LAYOUT,
  WML_TBL_STYLE_PR,
  WML_TYPE,
  WML_HEX4,
  WML_TBL_WIDTH,
  WML_MERGE,
  WML_VALIGN,
  WML_LINE_RULE,
  WML_ORIENT,
  WML_ZORDER,
  WML_PG_DISPLAY,
  WML_PG_OFFSET,
  WML_LN_RESTART,
  WML_DOC_GRID,
  WML_TEXT,
  WML_HEX8,
  WML_INT,
} from './share-safe-word-attribute-values'
import {
  WML_CHAP_SEP,
  WML_MULTILEVEL,
  WML_NUM_FMT,
  WML_SUFF,
} from './share-safe-word-attribute-numbering'
import { FLAG_BOUND } from './share-safe-value-bounds'

const ONOFF = FLAG_BOUND

export const WML_FORMAT_LAYOUT_ATTRIBUTE_BOUNDS: ReadonlyArray<
  readonly [string, ReadonlyMap<string, ShareSafeValueBound>]
> = [
  [
    'framePr',
    new Map([
      ['w', WML_INT],
      ['h', WML_INT],
      ['vSpace', WML_INT],
      ['hSpace', WML_INT],
      ['hAnchor', WML_FRAME_ANCHOR],
      ['vAnchor', WML_FRAME_ANCHOR],
      ['xAlign', WML_FRAME_ALIGN],
      ['yAlign', WML_FRAME_YSPEC],
      ['x', WML_INT],
      ['y', WML_INT],
      ['wrap', WML_FRAME_WRAP],
      ['dropCap', WML_DROP_CAP],
      ['lines', WML_INT],
      ['anchorLock', ONOFF],
    ]),
  ],
  [
    'tblpPr',
    new Map([
      ['leftFromText', WML_INT],
      ['rightFromText', WML_INT],
      ['topFromText', WML_INT],
      ['bottomFromText', WML_INT],
      ['horzAnchor', WML_FRAME_ANCHOR],
      ['vertAnchor', WML_FRAME_ANCHOR],
      ['tblpXSpec', WML_FRAME_ALIGN],
      ['tblpYSpec', WML_FRAME_YSPEC],
      ['tblpX', WML_INT],
      ['tblpY', WML_INT],
    ]),
  ],
  ['tblOverlap', new Map([['val', WML_TBL_OVERLAP]])],
  ['tblLayout', new Map([['type', WML_TBL_LAYOUT]])],
  ['tblStylePr', new Map([['type', WML_TBL_STYLE_PR]])],
  ['type', new Map([['val', WML_TYPE]])],
  ['tblStyleRowBandSize', new Map([['val', WML_INT]])],
  ['tblStyleColBandSize', new Map([['val', WML_INT]])],
  [
    'tblLook',
    new Map([
      ['val', WML_HEX4],
      ['firstRow', ONOFF],
      ['lastRow', ONOFF],
      ['firstColumn', ONOFF],
      ['lastColumn', ONOFF],
      ['noHBand', ONOFF],
      ['noVBand', ONOFF],
    ]),
  ],
  [
    'tblCellSpacing',
    new Map([
      ['w', WML_INT],
      ['type', WML_TBL_WIDTH],
    ]),
  ],
  [
    'tblInd',
    new Map([
      ['w', WML_INT],
      ['type', WML_TBL_WIDTH],
    ]),
  ],
  [
    'tblW',
    new Map([
      ['w', WML_INT],
      ['type', WML_TBL_WIDTH],
    ]),
  ],
  [
    'tcW',
    new Map([
      ['w', WML_INT],
      ['type', WML_TBL_WIDTH],
    ]),
  ],
  ['gridCol', new Map([['w', WML_INT]])],
  ['gridBefore', new Map([['val', WML_INT]])],
  ['gridAfter', new Map([['val', WML_INT]])],
  [
    'wBefore',
    new Map([
      ['w', WML_INT],
      ['type', WML_TBL_WIDTH],
    ]),
  ],
  [
    'wAfter',
    new Map([
      ['w', WML_INT],
      ['type', WML_TBL_WIDTH],
    ]),
  ],
  ['gridSpan', new Map([['val', WML_INT]])],
  ['hMerge', new Map([['val', WML_MERGE]])],
  ['vMerge', new Map([['val', WML_MERGE]])],
  ['vAlign', new Map([['val', WML_VALIGN]])],
  [
    'trHeight',
    new Map([
      ['val', WML_INT],
      ['hRule', WML_LINE_RULE],
    ]),
  ],
  [
    'cnfStyle',
    new Map([
      ['firstRow', ONOFF],
      ['lastRow', ONOFF],
      ['firstColumn', ONOFF],
      ['lastColumn', ONOFF],
      ['oddVBand', ONOFF],
      ['evenVBand', ONOFF],
      ['oddHBand', ONOFF],
      ['evenHBand', ONOFF],
      ['firstRowFirstColumn', ONOFF],
      ['firstRowLastColumn', ONOFF],
      ['lastRowFirstColumn', ONOFF],
      ['lastRowLastColumn', ONOFF],
    ]),
  ],
  [
    'pgSz',
    new Map([
      ['w', WML_INT],
      ['h', WML_INT],
      ['orient', WML_ORIENT],
      ['code', WML_INT],
    ]),
  ],
  [
    'pgMar',
    new Map([
      ['top', WML_INT],
      ['right', WML_INT],
      ['bottom', WML_INT],
      ['left', WML_INT],
      ['header', WML_INT],
      ['footer', WML_INT],
      ['gutter', WML_INT],
    ]),
  ],
  [
    'pgBorders',
    new Map([
      ['zOrder', WML_ZORDER],
      ['display', WML_PG_DISPLAY],
      ['offsetFrom', WML_PG_OFFSET],
    ]),
  ],
  [
    'pgNumType',
    new Map([
      ['fmt', WML_NUM_FMT],
      ['start', WML_INT],
      ['chapStyle', WML_INT],
      ['chapSep', WML_CHAP_SEP],
    ]),
  ],
  [
    'lnNumType',
    new Map([
      ['countBy', WML_INT],
      ['start', WML_INT],
      ['distance', WML_INT],
      ['restart', WML_LN_RESTART],
    ]),
  ],
  [
    'cols',
    new Map([
      ['num', WML_INT],
      ['space', WML_INT],
      ['equalWidth', ONOFF],
      ['sep', ONOFF],
    ]),
  ],
  [
    'docGrid',
    new Map([
      ['type', WML_DOC_GRID],
      ['linePitch', WML_INT],
      ['charSpace', WML_INT],
    ]),
  ],
  ['numFmt', new Map([['val', WML_NUM_FMT]])],
  ['multiLevelType', new Map([['val', WML_MULTILEVEL]])],
  ['suff', new Map([['val', WML_SUFF]])],
  ['lvlText', new Map([['val', WML_TEXT]])],
  ['startOverride', new Map([['val', WML_INT]])],
  ['lvlRestart', new Map([['val', WML_INT]])],
  ['lvlPicBulletId', new Map([['val', WML_INT]])],
  ['nsid', new Map([['val', WML_HEX8]])],
  ['tmpl', new Map([['val', WML_HEX8]])],
  ['numberingId', new Map([['val', WML_INT]])],
]

export default WML_FORMAT_LAYOUT_ATTRIBUTE_BOUNDS
