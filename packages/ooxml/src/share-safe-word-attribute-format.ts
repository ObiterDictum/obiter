/**
 * Formatting half of the element-scoped `w:` attribute vocabulary: the
 * geometry and styling attributes that borders, shading, spacing,
 * indentation, fonts, table layout and section properties may carry.
 * Reference and identity vocabulary (`w:val` carriers, field machinery,
 * bookmarks, styles, settings) lives in
 * `share-safe-word-attribute-refs.ts`; `WML_ELEMENT_ATTRIBUTES` in
 * `share-safe-word-attributes.ts` assembles both.
 */

/** Paragraph and table borders. */
const BORDER = [
  'val',
  'sz',
  'space',
  'color',
  'themeColor',
  'themeShade',
  'themeTint',
  'shadow',
  'frame',
] as const

/** `w:top`/`w:left`/`w:bottom`/`w:right` also serve as cell margins. */
const BORDER_OR_MARGIN = [...BORDER, 'w', 'type'] as const

/** Width-bearing elements — `w:w` + `w:type`. */
const WIDTH = ['w', 'type'] as const

export const WML_FORMAT_ATTRIBUTES: ReadonlyArray<
  readonly [string, readonly string[]]
> = [
  // borders and run borders
  ['top', BORDER_OR_MARGIN],
  ['left', BORDER_OR_MARGIN],
  ['bottom', BORDER_OR_MARGIN],
  ['right', BORDER_OR_MARGIN],
  ['between', BORDER],
  ['bar', BORDER],
  ['insideH', BORDER],
  ['insideV', BORDER],
  ['bdr', BORDER],
  // shading and colour
  [
    'shd',
    [
      'val',
      'color',
      'fill',
      'themeColor',
      'themeFill',
      'themeShade',
      'themeTint',
      'themeFillShade',
      'themeFillTint',
    ],
  ],
  ['color', ['val', 'themeColor', 'themeShade', 'themeTint']],
  // paragraph spacing and indentation
  [
    'spacing',
    [
      'before',
      'after',
      'beforeLines',
      'afterLines',
      'beforeAutospacing',
      'afterAutospacing',
      'line',
      'lineRule',
      'val',
    ],
  ],
  [
    'ind',
    [
      'left',
      'right',
      'firstLine',
      'hanging',
      'leftChars',
      'rightChars',
      'firstLineChars',
      'hangingChars',
      'start',
      'end',
      'startChars',
      'endChars',
    ],
  ],
  ['tab', ['val', 'leader', 'pos']],
  [
    'framePr',
    [
      'dropCap',
      'lines',
      'w',
      'h',
      'vSpace',
      'hSpace',
      'wrap',
      'hAnchor',
      'vAnchor',
      'x',
      'xAlign',
      'y',
      'yAlign',
      'anchorLock',
    ],
  ],
  [
    'tblpPr',
    [
      'leftFromText',
      'rightFromText',
      'topFromText',
      'bottomFromText',
      'vertAnchor',
      'horzAnchor',
      'tblpXSpec',
      'tblpX',
      'tblpYSpec',
      'tblpY',
    ],
  ],
  // fonts
  [
    'rFonts',
    [
      'ascii',
      'hAnsi',
      'eastAsia',
      'cs',
      'asciiTheme',
      'hAnsiTheme',
      'eastAsiaTheme',
      'cstheme',
      'hint',
    ],
  ],
  ['lang', ['val', 'eastAsia', 'bidi']],
  ['themeFontLang', ['val', 'eastAsia', 'bidi']],
  ['sig', ['usb0', 'usb1', 'usb2', 'usb3', 'csb0', 'csb1']],
  // run content
  ['br', ['type', 'clear']],
  ['sym', ['font', 'char']],
  ['ptab', ['alignment', 'relativeTo', 'leader']],
  // tables
  ['tblW', WIDTH],
  ['tcW', WIDTH],
  ['wBefore', WIDTH],
  ['wAfter', WIDTH],
  ['tblInd', WIDTH],
  ['tblCellSpacing', WIDTH],
  ['tblLayout', ['type']],
  ['tblStylePr', ['type']],
  [
    'tblLook',
    [
      'val',
      'firstRow',
      'firstColumn',
      'lastRow',
      'lastColumn',
      'noHBand',
      'noVBand',
    ],
  ],
  ['gridCol', ['w']],
  // section properties
  ['headerReference', ['type']],
  ['footerReference', ['type']],
  ['pgSz', ['w', 'h', 'orient', 'code']],
  ['pgMar', ['top', 'right', 'bottom', 'left', 'header', 'footer', 'gutter']],
  ['pgBorders', ['zOrder', 'display', 'offsetFrom']],
  ['pgNumType', ['fmt', 'start', 'chapStyle', 'chapSep']],
  ['lnNumType', ['countBy', 'start', 'distance', 'restart']],
  ['cols', ['num', 'space', 'equalWidth', 'sep']],
  ['docGrid', ['type', 'linePitch', 'charSpace']],
]
