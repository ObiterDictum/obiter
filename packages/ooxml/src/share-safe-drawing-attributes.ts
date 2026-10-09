/**
 * The bounded attribute vocabulary for embedded (DrawingML, picture,
 * wordprocessing-drawing, OMML, extension-shape) elements. Descriptive
 * carrier attributes are stripped or bounded, never shipped; the unqualified
 * name list is the only set a kept attribute may draw from, and `uri`
 * values are bounded identifiers, not free text.
 */

/**
 * Descriptive carrier attributes on embedded elements are stripped or
 * bounded, never shipped: `descr`/`title` are alt-text metadata, `name`
 * labels the object (a pasted image's filename rides here), `hidden` on a
 * drawing object marks invisible content. `uri` on `graphicData` or `ext`
 * is an identifier with a bounded value set, resolved by the policy.
 */
export const EMBEDDED_STRIP_ATTRIBUTES = new Set(['descr', 'title'])

/**
 * Elements whose `name` attribute is a descriptive label, not semantics.
 * Theme machinery names (`theme`, `clrScheme`, `fontScheme`, `fmtScheme`)
 * are author-chosen display strings a recipient never resolves — the
 * scheme's colour and font slots still apply by structure.
 */
export const EMBEDDED_NAME_LABEL_ELEMENTS = new Set([
  'docPr',
  'cNvPr',
  'cNvPicPr',
  'cNvSpPr',
  'cNvGrpSpPr',
  'cNvGraphicFramePr',
  'theme',
  'clrScheme',
  'fontScheme',
  'fmtScheme',
  'extraClrScheme',
  'custGeom',
  'path',
])

/**
 * Unqualified attributes legal only on named embedded elements —
 * `typeface` is a font declaration's face name; placed on any other
 * element it is a metadata channel.
 */
export const EMBEDDED_SCOPED_ATTRIBUTES = new Map<string, ReadonlySet<string>>([
  [
    'typeface',
    new Set(['latin', 'ea', 'cs', 'font', 'sym', 'buFont', 'buFontTx']),
  ],
])

/**
 * Unqualified attribute names embedded elements may carry: geometry,
 * layout and scalar options. Names not listed strip — a consumer resolves
 * them only as inert metadata anyway.
 */
export const EMBEDDED_ATTRIBUTES = new Set([
  'id',
  'name',
  'x',
  'y',
  'cx',
  'cy',
  'rot',
  'flipH',
  'flipV',
  'rotWithShape',
  'simplePos',
  'pos',
  'algn',
  'cap',
  'cmpd',
  'w',
  'h',
  'dist',
  'distT',
  'distB',
  'distL',
  'distR',
  'l',
  't',
  'r',
  'b',
  'prst',
  'lastClr',
  'val',
  'ver',
  'ang',
  'scaled',
  'sx',
  'sy',
  'kx',
  'ky',
  'stA',
  'swAng',
  'endA',
  'endPos',
  'stPos',
  'fadeDir',
  'blurRad',
  'dir',
  'rad',
  'rig',
  'lat',
  'lon',
  'rev',
  'extrusionH',
  'contourW',
  'prstMaterial',
  'z',
  'fill',
  'stroke',
  'extrusionOk',
  'tx',
  'ty',
  'dpi',
  'cstate',
  'fmla',
  'relativeFrom',
  'relativeHeight',
  'behindDoc',
  'locked',
  'layoutInCell',
  'allowOverlap',
  'edited',
  'wrapText',
  'preferRelativeResize',
  'txBox',
  'pctWidth',
  'pctHeight',
  'marL',
  'marR',
  'marT',
  'marB',
  'lvl',
  'indent',
  'defTabSz',
  'rtl',
  'eaLnBrk',
  'latinLnBrk',
  'hangingPunct',
  'fontAlgn',
  'lang',
  'altLang',
  'sz',
  'b',
  'i',
  'u',
  'strike',
  'kern',
  'cap',
  'spc',
  'normalizeH',
  'baseline',
  'smtClean',
  'err',
  'lIns',
  'tIns',
  'rIns',
  'bIns',
  'numCol',
  'spcCol',
  'rtlCol',
  'fromWordArt',
  'anchor',
  'anchorCtr',
  'forceAA',
  'upright',
  'compatLnSpc',
  'spcFirstLastPara',
  'vertOverflow',
  'horzOverflow',
  'noAutofit',
  'normAutofit',
  'fontScale',
  'lnSpcReduction',
  'bwMode',
  'bwNormal',
  'bwPure',
  'bwAuto',
  'noChangeAspect',
  'noGrp',
  'noDrilldown',
  'noSelect',
  'noChangeArrowheads',
  'noMove',
  'noResize',
  'percentage',
  'hue',
  'sat',
  'lum',
  'type',
  'fmt',
  'atLeast',
  'count',
  'vert',
  'flatTx',
  'pitchFamily',
  'charset',
  'panose',
  'script',
  'scheme',
  'withFill',
  'withLine',
  'withEffect',
  'i1',
  'i2',
  'i3',
  'level',
  'isTabStop',
  'horizontalOverflow',
  // a:tbl table flags and cell spans
  'firstRow',
  'lastRow',
  'firstCol',
  'lastCol',
  'bandRow',
  'bandCol',
  'gridSpan',
  'rowSpan',
  'hMerge',
  'vMerge',
])

/**
 * `a:graphicData` names its payload type with a `uri` attribute; the value
 * is an identifier, not content. Only these are readable payloads this
 * build can classify — a chart or diagram URI would hide parts the
 * relationship walk refused, so anything else refuses.
 */
export const GRAPHIC_DATA_URIS = new Set([
  'http://schemas.openxmlformats.org/drawingml/2006/picture',
  'http://schemas.openxmlformats.org/drawingml/2006/table',
  'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
])

/** `a:ext uri` is an extension GUID — not free text. */
export const EXTENSION_URI_PATTERN =
  /^(?:\{[0-9A-Fa-f-]{36}\}|https?:\/\/(?:schemas\.openxmlformats\.org|schemas\.microsoft\.com|purl\.oclc\.org)\/)/u
