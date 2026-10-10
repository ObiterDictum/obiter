import {
  DRAWINGML_2010_NAMESPACE,
  DRAWINGML_MAIN_NAMESPACE,
  DRAWINGML_PICTURE_NAMESPACE,
  MATH_NAMESPACE,
  WP14_NAMESPACE,
  WPC_NAMESPACE,
  WP_DRAWING_NAMESPACE,
  WPG_NAMESPACE,
  WPS_NAMESPACE,
} from './share-safe-parts'
import {
  MATH_ELEMENTS,
  mathElementRefusesHidden,
} from './share-safe-math-vocabulary'

/**
 * The bounded embedded vocabulary: DrawingML, picture, wordprocessing-
 * drawing, OMML and the Word extension shape namespaces a kept part may
 * emit, plus the unqualified attribute names embedded elements may carry.
 * An element whose namespace has no entry — VML, `urn:` Office legacy
 * namespaces, or an unbounded drawing extension — refuses the export.
 */

const DRAWINGML_MAIN_ELEMENTS = new Set([
  // graphic payloads and shape containers
  'graphic',
  'graphicData',
  'graphicFrame',
  'sp',
  'spPr',
  'grpSp',
  'grpSpPr',
  'cxnSp',
  'nvSpPr',
  'nvGrpSpPr',
  'nvCxnSpPr',
  'nvGraphicFramePr',
  'nvPr',
  'cNvPr',
  'cNvSpPr',
  'cNvGrpSpPr',
  'cNvCxnSpPr',
  'cNvGraphicFramePr',
  'spLocks',
  'grpSpLocks',
  'cxnSpLocks',
  // images and fills
  'blip',
  'stretch',
  'fillRect',
  'srcRect',
  'tile',
  // geometry
  'xfrm',
  'off',
  'ext',
  'chOff',
  'chExt',
  'prstGeom',
  'avLst',
  'gd',
  'custGeom',
  'pathLst',
  'path',
  'moveTo',
  'lnTo',
  'arcTo',
  'quadBezTo',
  'cubicBezTo',
  'pt',
  'close',
  'fillToRect',
  // line and fill styles
  'ln',
  'headEnd',
  'tailEnd',
  'prstDash',
  'custDash',
  'ds',
  'round',
  'bevel',
  'miter',
  'solidFill',
  'noFill',
  'gradFill',
  'gsLst',
  'gs',
  'lin',
  'pattFill',
  'fgClr',
  'bgClr',
  'grpFill',
  // colours and colour transforms
  'schemeClr',
  'srgbClr',
  'sysClr',
  'prstClr',
  'scrgbClr',
  'hslClr',
  'tint',
  'shade',
  'comp',
  'inv',
  'gray',
  'gamma',
  'invGamma',
  'alpha',
  'alphaOff',
  'alphaMod',
  'alphaModFix',
  'alphaBiLevel',
  'alphaRepl',
  'alphaCeiling',
  'alphaFloor',
  'alphaInv',
  'alphaOutset',
  'biLevel',
  'blur',
  'clrChange',
  'clrFrom',
  'clrTo',
  'clrRepl',
  'duotone',
  'grayscl',
  'hsl',
  'lum',
  'lumMod',
  'lumOff',
  'satMod',
  'satOff',
  'hue',
  'sat',
  'hueMod',
  'hueOff',
  'red',
  'green',
  'blue',
  'redOff',
  'redMod',
  'greenOff',
  'greenMod',
  'blueOff',
  'blueMod',
  // effects
  'effectLst',
  'effectDag',
  'outerShdw',
  'innerShdw',
  'prstShdw',
  'glow',
  'softEdge',
  'reflection',
  'fillOverlay',
  'effect',
  'sp3d',
  'scene3d',
  'camera',
  'lightRig',
  'bevelT',
  'bevelB',
  'extrusionClr',
  'contourClr',
  'rot',
  'extLst',
  'ext',
  // links inside drawings
  'hlinkClick',
  'hlinkHover',
  // fonts
  'latin',
  'ea',
  'cs',
  'font',
  'sym',
  'script',
  // theme parts
  'theme',
  'themeElements',
  'clrScheme',
  'dk1',
  'lt1',
  'dk2',
  'lt2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
  'hlink',
  'folHlink',
  'fontScheme',
  'majorFont',
  'minorFont',
  'fmtScheme',
  'fillStyleLst',
  'lnStyleLst',
  'effectStyleLst',
  'bgFillStyleLst',
  'effectStyle',
  'effectRef',
  'fillRef',
  'lnRef',
  'fontRef',
  'bgRef',
  'style',
  'extraClrSchemeLst',
  'extraClrScheme',
  'objectDefaults',
  'spDef',
  'lnDef',
  'txDef',
  'graphicFrameLocks',
  'officeStyleSheet',
  'baseStyles',
  'clrMapOvr',
  // text bodies inside shapes
  'bodyPr',
  'noAutofit',
  'normAutofit',
  'spAutoFit',
  'lstStyle',
  'defPPr',
  't',
  'r',
  'rPr',
  'p',
  'pPr',
  'endParaRPr',
  'br',
  'fld',
  'defRPr',
  'lvl1pPr',
  'lvl2pPr',
  'lvl3pPr',
  'lvl4pPr',
  'lvl5pPr',
  'lvl6pPr',
  'lvl7pPr',
  'lvl8pPr',
  'lvl9pPr',
  'tabLst',
  'tab',
  'spcBef',
  'spcAft',
  'spcPts',
  'spcPct',
  'lnSpc',
  'buNone',
  'buChar',
  'buAutoNum',
  'buClr',
  'buSzPct',
  'buSzPts',
  'buFont',
  'buFontTx',
  'buClrTx',
  'buBlip',
  'buSzTx',
  // tables inside drawings
  'tbl',
  'tblPr',
  'tblGrid',
  'gridCol',
  'tc',
  'txBody',
  'tr',
  'tcPr',
  'bandRow',
  'bandCol',
  'firstRow',
  'firstCol',
  'lastRow',
  'lastCol',
])

const DRAWINGML_PICTURE_ELEMENTS = new Set([
  'pic',
  'nvPicPr',
  'cNvPr',
  'cNvPicPr',
  'blipFill',
  'spPr',
  'style',
])

const WP_DRAWING_ELEMENTS = new Set([
  'inline',
  'anchor',
  'extent',
  'effectExtent',
  'docPr',
  'cNvGraphicFramePr',
  'positionH',
  'positionV',
  'posOffset',
  'align',
  'wrapNone',
  'wrapSquare',
  'wrapTight',
  'wrapThrough',
  'wrapTopAndBottom',
  'wrapPolygon',
  'lineTo',
  'start',
  'simplePos',
])

/**
 * `a:rPr`-class parents whose `a:noFill` child hides text outright —
 * like an OMML phantom, a fill that erases a run's visible text refuses
 * rather than shipping a reader-invisible carrier.
 */
const HIDDEN_FILL_PARENTS = new Set(['defRPr', 'endParaRPr', 'rPr'])

/**
 * `a:` alpha-effect elements whose declared function can erase their
 * input outright, wherever they sit — `alphaInv` subtracts the running
 * alpha from 100% (an opaque fill goes transparent), `alphaFloor` zeroes
 * any alpha under 100%, and `alphaBiLevel` zeroes everything under its
 * threshold. Whether a given instance erases depends on the base alpha
 * it composes with, which a per-element check cannot see, so the family
 * refuses outright. Siblings that can only preserve or deepen opacity
 * keep: `alphaCeiling` (nonzero alpha → opaque), `alphaOutset` (its
 * eroding inset form is refused by the non-negative `rad` bound), and
 * the per-attribute `alpha`/`alphaOff`/`alphaMod`/`alphaModFix`/
 * `alphaRepl` slots bounded in `share-safe-drawing-attributes.ts`.
 */
const ALPHA_ERASURE_ELEMENTS = new Set([
  'alphaBiLevel',
  'alphaFloor',
  'alphaInv',
])

export function embeddedElementRefusesHidden(element: {
  namespaceUri: string
  localName: string
  parent?: { namespaceUri: string; localName: string }
}): boolean {
  if (element.namespaceUri === MATH_NAMESPACE) {
    return mathElementRefusesHidden(element.localName)
  }
  if (element.namespaceUri !== DRAWINGML_MAIN_NAMESPACE) return false
  if (ALPHA_ERASURE_ELEMENTS.has(element.localName)) return true
  return (
    element.localName === 'noFill' &&
    element.parent !== undefined &&
    element.parent.namespaceUri === DRAWINGML_MAIN_NAMESPACE &&
    HIDDEN_FILL_PARENTS.has(element.parent.localName)
  )
}

/**
 * Extension URIs (`a:ext uri`) whose payload vocabulary this build can
 * bound — currently only `a14:useLocalDpi`. Any other `a:ext` removes
 * whole rather than shipping an opaque payload under a text-bearing
 * identifier.
 */
export const SHARE_SAFE_EXTENSION_URIS = new Set([
  '{28A0092B-C50C-407E-A947-70E740481C1C}',
])

const WPS_ELEMENTS = new Set([
  'wsp',
  'cNvSpPr',
  'spPr',
  'style',
  'txbx',
  'bodyPr',
  'extLst',
])

const WPG_ELEMENTS = new Set(['wgp', 'cNvGrpSpPr', 'grpSp'])
const WPC_ELEMENTS = new Set(['wholeCanvas', 'bg', 'fg'])
const WP14_ELEMENTS = new Set(['sizeRelH', 'sizeRelW'])

/**
 * Element names allowed per embedded or extension namespace. A namespace
 * without an entry refuses every element it carries.
 */
export const EMBEDDED_ELEMENTS = new Map<string, ReadonlySet<string>>([
  [DRAWINGML_MAIN_NAMESPACE, DRAWINGML_MAIN_ELEMENTS],
  [DRAWINGML_PICTURE_NAMESPACE, DRAWINGML_PICTURE_ELEMENTS],
  [WP_DRAWING_NAMESPACE, WP_DRAWING_ELEMENTS],
  [MATH_NAMESPACE, MATH_ELEMENTS],
  [WPS_NAMESPACE, WPS_ELEMENTS],
  [WPG_NAMESPACE, WPG_ELEMENTS],
  [WPC_NAMESPACE, WPC_ELEMENTS],
  [WP14_NAMESPACE, WP14_ELEMENTS],
  [DRAWINGML_2010_NAMESPACE, new Set(['useLocalDpi'])],
])

/**
 * Embedded vocabulary elements the copy drops outright rather than
 * carrying. `a:tableStyleId` is a dangling pointer into the refused
 * tableStyles part — keeping it ships a name reference to nothing.
 */
export const EMBEDDED_REMOVE_ELEMENTS = new Map<string, ReadonlySet<string>>([
  [DRAWINGML_MAIN_NAMESPACE, new Set(['tableStyleId'])],
])
