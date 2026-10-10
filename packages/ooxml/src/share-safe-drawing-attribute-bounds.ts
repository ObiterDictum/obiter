/**
 * The value bounds and element-scoped attribute table for embedded
 * (DrawingML, picture, wordprocessing-drawing, extension-shape)
 * elements. Every bound names the enumeration or grammar the declared
 * simple type permits — an attribute a table does not list strips as
 * inert metadata, while a declared slot holding an out-of-bound value
 * refuses the copy. `embeddedAttributeVerdict` in
 * `share-safe-drawing-attributes.ts` resolves against these tables.
 */

import {
  ARROW_SIZE_VALUES,
  ARROW_TYPE_VALUES,
  AUTONUM_VALUES,
  BLEND_MODE_VALUES,
  BLIP_CSTATE_VALUES,
  BW_MODE_VALUES,
  DASH_VALUES,
  FLAG_ATTRIBUTES,
  FLIP_VALUES,
  FONT_ALIGN_VALUES,
  FONT_FACE_ELEMENTS,
  FONT_REF_INDEX_VALUES,
  INT_ATTRIBUTES,
  LINE_ALIGN_VALUES,
  LINE_CAP_VALUES,
  LINE_CMPD_VALUES,
  LIGHT_RIG_DIRECTION_VALUES,
  LOCK_ELEMENTS,
  PARA_ALIGN_VALUES,
  PARA_PROPS_ELEMENTS,
  PATH_FILL_VALUES,
  PATH_SHADE_VALUES,
  PERCENT_VAL_ELEMENTS,
  POS_FROM_H_VALUES,
  POS_FROM_V_VALUES,
  POSITIVE_FIXED_PERCENT_VAL_ELEMENTS,
  RECT_ALIGN_VALUES,
  SCHEME_CLRS,
  SHADOW_ELEMENTS,
  SIZE_REL_FROM_VALUES,
  TAB_ALIGN_VALUES,
  TEXT_ANCHOR_VALUES,
  TEXT_CAP_VALUES,
  TEXT_HORZ_OVERFLOW_VALUES,
  TEXT_VERT_OVERFLOW_VALUES,
  TEXT_RUN_PROPS,
  TEXT_STRIKE_VALUES,
  TEXT_WRAP_VALUES,
  UNDERLINE_VALUES,
  VERT_TEXT_VALUES,
  WRAP_TEXT_VALUES,
} from './share-safe-drawing-attribute-sets'
import {
  PRESET_BEVEL,
  PRESET_CAMERA,
  PRESET_GEOMETRY,
  PRESET_LIGHT_RIG,
  PRESET_MATERIAL,
  PRESET_PATTERN,
  PRESET_SHADOW,
  PRESET_TEXT_WARP,
} from './share-safe-preset-attributes'
import { PRESET_COLOR, SYSTEM_COLOR } from './share-safe-preset-colors'
import {
  enumBound,
  intRangeBound,
  shapeBound,
  unionBound,
  UINT_BOUND,
  type ShareSafeValueBound,
} from './share-safe-value-bounds'

const FLAG_VALUES = new Set(['0', '1', 'true', 'false', 'on', 'off'])

function scoped(
  bound: ShareSafeValueBound,
  elements: readonly string[],
): ReadonlyMap<string, ShareSafeValueBound> {
  const map = new Map<string, ShareSafeValueBound>()
  for (const element of elements) map.set(element, bound)
  return map
}

const INT = shapeBound(/^-?\d{1,19}$/u)
const FLAG = enumBound([...FLAG_VALUES])
const HEX6 = shapeBound(/^[0-9A-Fa-f]{6}$/u)
const HEX20 = shapeBound(/^[0-9A-Fa-f]{20}$/u)
const GUID = shapeBound(
  /^\{[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}\}$/u,
)
/** A bounded alphanumeric token — preset names, field types, rig styles. */
const TOKEN = shapeBound(/^[A-Za-z][A-Za-z0-9]{0,31}$/u)
/** A geometry guide name (`a:gd`): referenced by `fmla` formulas. */
const IDENT = shapeBound(/^[A-Za-z_][\w.-]{0,62}$/u)
/** Language tags (`en`, `en-US`) — short primary subtag, bounded tail. */
const LANG_TAG = shapeBound(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8}){0,3}$/u)
/** Four-letter ISO 15924 script codes (`Latn`, `Cyrl`, `Jpan`). */
const SCRIPT_TAG = shapeBound(/^[A-Za-z]{4}$/u)
/** Font names are text, but never markup: bounded length, no `<>&"'`. */
const FONT_NAME = shapeBound(/^[^<>&"']{0,64}$/u)
/** `a:gd` formulas: operators and operands, no markup or string literals. */
const FMLA = shapeBound(/^[0-9A-Za-z_+*/(). ?:-]{1,64}$/u)

/**
 * The OOXML percentage family, each bound the union the schema declares:
 * a thousandths-of-a-percent integer plus the `N%`/`N.NN%` literal form
 * the same simple type permits.
 */
const PERCENT_FORM = /^-?[0-9]+(?:\.[0-9]+)?%$/u
const POSITIVE_PERCENT_FORM = /^[0-9]+(?:\.[0-9]+)?%$/u
const POSITIVE_FIXED_PERCENT_FORM = /^(?:100|[0-9][0-9]?)(?:\.[0-9][0-9]?)?%$/u
const FIXED_PERCENT_FORM = /^-?(?:100|[0-9][0-9]?)(?:\.[0-9][0-9]?)?%$/u

/** `ST_Percentage` — signed thousandths int or signed `N%` literal. */
const PERCENTAGE = unionBound([
  intRangeBound(-2147483648, 2147483647),
  shapeBound(PERCENT_FORM),
])
/** `ST_PositivePercentage` — the same union with no negative sign. */
const POSITIVE_PERCENTAGE = unionBound([
  intRangeBound(0, 2147483647),
  shapeBound(POSITIVE_PERCENT_FORM),
])
/** `ST_PositiveFixedPercentage` — 0 to 100% in either literal form. */
const POSITIVE_FIXED_PERCENTAGE = unionBound([
  intRangeBound(0, 100000),
  shapeBound(POSITIVE_FIXED_PERCENT_FORM),
])
/** `ST_FixedPercentage` — -100% to 100% in either literal form. */
const FIXED_PERCENTAGE = unionBound([
  intRangeBound(-100000, 100000),
  shapeBound(FIXED_PERCENT_FORM),
])
/** `ST_PositiveFixedAngle` — 60000ths of a degree, `[0, 21600000)`. */
const POSITIVE_FIXED_ANGLE = intRangeBound(0, 21599999)
/** `ST_FOVAngle` — `[0, 10800000]`. */
const FOV_ANGLE = intRangeBound(0, 10800000)
/** `a:spcPct val` — `ST_TextSpacingPercentOrPercentString`. */
const SPACING_PERCENT = unionBound([
  intRangeBound(0, 13200000),
  shapeBound(POSITIVE_PERCENT_FORM),
])
/** `a:buSzPct val` — the 25%-400% literal the schema patterns. */
const BULLET_SIZE_PERCENT = shapeBound(
  /^0*(?:(?:2[5-9])|(?:[3-9][0-9])|(?:[1-3][0-9][0-9])|400)%$/u,
)

/**
 * Reads a percentage attribute in thousandths-of-a-percent units
 * regardless of which literal form it spells — `50000` and `50%` are
 * the same value, so hidden-content checks compare numbers, not text.
 */
const PERCENT_LITERAL = /^(-?)([0-9]+)(?:\.([0-9]+))?%$/u

export function percentThousandths(value: string): number | undefined {
  if (/^-?\d{1,19}$/u.test(value)) return Number(value)
  const match = PERCENT_LITERAL.exec(value)
  if (match === null) return undefined
  const whole = Number(match[2])
  const frac = match[3] === undefined ? 0 : Number(`0.${match[3]}`)
  return (match[1] === '-' ? -1 : 1) * Math.round((whole + frac) * 1000)
}

const SCHEME_CLR = enumBound(SCHEME_CLRS)
const AUTONUM = enumBound(AUTONUM_VALUES)
const LIGHT_RIG_DIRECTION = enumBound(LIGHT_RIG_DIRECTION_VALUES)
const DASH = enumBound(DASH_VALUES)
const UNDERLINE = enumBound(UNDERLINE_VALUES)
const TEXT_STRIKE = enumBound(TEXT_STRIKE_VALUES)
const TEXT_CAP = enumBound(TEXT_CAP_VALUES)
const LINE_CAP = enumBound(LINE_CAP_VALUES)
const LINE_CMPD = enumBound(LINE_CMPD_VALUES)
const LINE_ALIGN = enumBound(LINE_ALIGN_VALUES)
const PARA_ALIGN = enumBound(PARA_ALIGN_VALUES)
const TAB_ALIGN = enumBound(TAB_ALIGN_VALUES)
const RECT_ALIGN = enumBound(RECT_ALIGN_VALUES)
const ARROW_TYPE = enumBound(ARROW_TYPE_VALUES)
const ARROW_SIZE = enumBound(ARROW_SIZE_VALUES)
const PATH_FILL = enumBound(PATH_FILL_VALUES)
const PATH_SHADE = enumBound(PATH_SHADE_VALUES)
const BW_MODE = enumBound(BW_MODE_VALUES)
const BLIP_CSTATE = enumBound(BLIP_CSTATE_VALUES)
const POS_FROM_H = enumBound(POS_FROM_H_VALUES)
const POS_FROM_V = enumBound(POS_FROM_V_VALUES)
const SIZE_REL_FROM = enumBound(SIZE_REL_FROM_VALUES)
const VERT_TEXT = enumBound(VERT_TEXT_VALUES)
const TEXT_ANCHOR = enumBound(TEXT_ANCHOR_VALUES)
const TEXT_HORZ_OVERFLOW = enumBound(TEXT_HORZ_OVERFLOW_VALUES)
const TEXT_VERT_OVERFLOW = enumBound(TEXT_VERT_OVERFLOW_VALUES)
const FONT_ALIGN = enumBound(FONT_ALIGN_VALUES)
const TEXT_WRAP = enumBound(TEXT_WRAP_VALUES)
const WRAP_TEXT = enumBound(WRAP_TEXT_VALUES)
const FONT_REF_INDEX = enumBound(FONT_REF_INDEX_VALUES)
const FLIP = enumBound(FLIP_VALUES)

/**
 * Unqualified attribute names embedded elements may carry when their
 * bound is the same everywhere. Names not listed — here or in the scoped
 * table — strip; a consumer resolves them only as inert metadata anyway.
 * The integer and flag shapes cannot carry text, so a kept value is
 * always inert — a bound failure refuses rather than shipping an
 * arbitrary string in a value slot. The name lists themselves live in
 * `share-safe-drawing-attribute-sets.ts`.
 */
export const EMBEDDED_ATTRIBUTES: ReadonlyMap<string, ShareSafeValueBound> =
  new Map<string, ShareSafeValueBound>([
    ...INT_ATTRIBUTES.map((name): [string, ShareSafeValueBound] => [name, INT]),
    ...FLAG_ATTRIBUTES.map((name): [string, ShareSafeValueBound] => [
      name,
      FLAG,
    ]),
  ])

/**
 * Unqualified attributes legal only on named embedded elements, with the
 * value bound each placement declares. `typeface` is a font declaration's
 * face name; placed on any other element it is a metadata channel. A name
 * absent from the element's set strips; a name present whose value fails
 * the bound refuses — an enum or grammar slot holding foreign text is a
 * payload, not formatting.
 */
export const EMBEDDED_SCOPED_ATTRIBUTES: ReadonlyMap<
  string,
  ReadonlyMap<string, ShareSafeValueBound>
> = new Map([
  [
    'id',
    new Map([
      ['docPr', INT],
      ['cNvPr', INT],
      ['fld', GUID],
    ]),
  ],
  ['name', scoped(IDENT, ['gd'])],
  ['typeface', scoped(FONT_NAME, FONT_FACE_ELEMENTS)],
  ['script', scoped(SCRIPT_TAG, ['font'])],
  ['panose', scoped(HEX20, FONT_FACE_ELEMENTS)],
  ['pitchFamily', scoped(INT, FONT_FACE_ELEMENTS)],
  ['charset', scoped(INT, FONT_FACE_ELEMENTS)],
  [
    'val',
    new Map([
      ['srgbClr', HEX6],
      ['sysClr', SYSTEM_COLOR],
      ['prstClr', PRESET_COLOR],
      ['schemeClr', SCHEME_CLR],
      ['prstDash', DASH],
      ['useLocalDpi', FLAG],
      ...scoped(PERCENTAGE, PERCENT_VAL_ELEMENTS),
      ...scoped(POSITIVE_FIXED_PERCENTAGE, POSITIVE_FIXED_PERCENT_VAL_ELEMENTS),
      ['alphaOff', FIXED_PERCENTAGE],
      ['alphaMod', POSITIVE_PERCENTAGE],
      ['hueMod', POSITIVE_PERCENTAGE],
      ['hue', POSITIVE_FIXED_ANGLE],
      ['hueOff', INT],
      ['spcPts', intRangeBound(0, 158400)],
      ['spcPct', SPACING_PERCENT],
      ['buSzPct', BULLET_SIZE_PERCENT],
      ['buSzPts', intRangeBound(100, 400000)],
    ]),
  ],
  ['a', scoped(POSITIVE_FIXED_PERCENTAGE, ['alphaRepl'])],
  ['thresh', scoped(POSITIVE_FIXED_PERCENTAGE, ['biLevel'])],
  ['amt', scoped(POSITIVE_PERCENTAGE, ['alphaModFix'])],
  // `rad` is a non-negative radius wherever it ships — `blur`, `glow` and
  // `softEdge` declare `ST_PositiveCoordinate`; `alphaOutset` declares a
  // signed `ST_Coordinate` whose negative form is an alpha inset that
  // erodes the shape's alpha mask, so it shares the same bound.
  ['rad', scoped(UINT_BOUND, ['alphaOutset', 'blur', 'glow', 'softEdge'])],
  // `a:fillOverlay@blend` is required; the transitional `ST_BlendMode`
  // set contains no alpha-erasing mode, so the full enum may ship.
  ['blend', scoped(enumBound(BLEND_MODE_VALUES), ['fillOverlay'])],
  [
    'pos',
    new Map([
      ['gs', POSITIVE_FIXED_PERCENTAGE],
      ['tab', INT],
    ]),
  ],
  ['hue', scoped(POSITIVE_FIXED_ANGLE, ['hslClr'])],
  ['sat', scoped(PERCENTAGE, ['hslClr'])],
  ['lum', scoped(PERCENTAGE, ['hslClr'])],
  ['g', scoped(PERCENTAGE, ['scrgbClr'])],
  [
    'r',
    new Map(
      scoped(PERCENTAGE, ['srcRect', 'fillRect', 'fillToRect', 'scrgbClr']),
    ),
  ],
  ['l', scoped(PERCENTAGE, ['srcRect', 'fillRect', 'fillToRect'])],
  ['t', scoped(PERCENTAGE, ['srcRect', 'fillRect', 'fillToRect'])],
  [
    'type',
    new Map([
      ['fld', TOKEN],
      ['headEnd', ARROW_TYPE],
      ['tailEnd', ARROW_TYPE],
      ['buAutoNum', AUTONUM],
    ]),
  ],
  ['scheme', scoped(SCHEME_CLR, ['buClr'])],
  ['startAt', scoped(INT, ['buAutoNum'])],
  ['char', scoped(FONT_NAME, ['buChar'])],
  ['lastClr', scoped(HEX6, ['sysClr'])],
  [
    'b',
    new Map([
      ...scoped(PERCENTAGE, ['srcRect', 'fillRect', 'fillToRect', 'scrgbClr']),
      ['effectExtent', INT],
      ...scoped(FLAG, TEXT_RUN_PROPS),
    ]),
  ],
  ['i', scoped(FLAG, TEXT_RUN_PROPS)],
  ['u', scoped(UNDERLINE, TEXT_RUN_PROPS)],
  ['strike', scoped(TEXT_STRIKE, TEXT_RUN_PROPS)],
  ['lang', scoped(LANG_TAG, TEXT_RUN_PROPS)],
  ['altLang', scoped(LANG_TAG, TEXT_RUN_PROPS)],
  ['cap', new Map([['ln', LINE_CAP], ...scoped(TEXT_CAP, TEXT_RUN_PROPS)])],
  [
    'algn',
    new Map([
      ['ln', LINE_ALIGN],
      ['tab', TAB_ALIGN],
      ...scoped(PARA_ALIGN, PARA_PROPS_ELEMENTS),
      ...scoped(RECT_ALIGN, ['tile', 'reflection']),
    ]),
  ],
  ['cmpd', scoped(LINE_CMPD, ['ln'])],
  [
    'w',
    new Map([
      ...scoped(INT, ['ln', 'gridCol', 'path', 'bevelT', 'bevelB']),
      ...scoped(ARROW_SIZE, ['headEnd', 'tailEnd']),
    ]),
  ],
  ['len', scoped(ARROW_SIZE, ['headEnd', 'tailEnd'])],
  [
    'dir',
    new Map([
      ...scoped(INT, SHADOW_ELEMENTS),
      ['lightRig', LIGHT_RIG_DIRECTION],
    ]),
  ],
  ['rig', scoped(PRESET_LIGHT_RIG, ['lightRig'])],
  ['fov', scoped(FOV_ANGLE, ['camera'])],
  ['zoom', scoped(POSITIVE_PERCENTAGE, ['camera'])],
  [
    'prst',
    new Map([
      ['prstGeom', PRESET_GEOMETRY],
      ['prstShdw', PRESET_SHADOW],
      ['camera', PRESET_CAMERA],
      ['bevelT', PRESET_BEVEL],
      ['bevelB', PRESET_BEVEL],
      ['pattFill', PRESET_PATTERN],
    ]),
  ],
  ['prstMaterial', scoped(PRESET_MATERIAL, ['sp3d'])],
  ['cstate', scoped(BLIP_CSTATE, ['blip'])],
  ['fmla', scoped(FMLA, ['gd'])],
  [
    'relativeFrom',
    new Map([
      ['positionH', POS_FROM_H],
      ['positionV', POS_FROM_V],
      ...scoped(SIZE_REL_FROM, ['sizeRelH', 'sizeRelW']),
    ]),
  ],
  ['edited', scoped(FLAG, ['wrapPolygon'])],
  ['wrapText', scoped(WRAP_TEXT, ['wrapSquare', 'wrapTight', 'wrapThrough'])],
  ['txBox', scoped(FLAG, ['cNvSpPr'])],
  ['bwMode', scoped(BW_MODE, ['cNvPr'])],
  ['vert', scoped(VERT_TEXT, ['bodyPr', 'tcPr'])],
  ['vertOverflow', scoped(TEXT_VERT_OVERFLOW, ['bodyPr'])],
  ['horzOverflow', scoped(TEXT_HORZ_OVERFLOW, ['bodyPr', 'tcPr'])],
  ['anchor', scoped(TEXT_ANCHOR, ['bodyPr', 'tcPr'])],
  ['fontAlgn', scoped(FONT_ALIGN, ['bodyPr'])],
  ['wrap', scoped(TEXT_WRAP, ['bodyPr'])],
  ['prstTxWarp', scoped(PRESET_TEXT_WARP, ['bodyPr'])],
  ['fill', scoped(PATH_FILL, ['path'])],
  ['stroke', scoped(FLAG, ['path'])],
  ['path', scoped(PATH_SHADE, ['path'])],
  ['flip', scoped(FLIP, ['tile', 'gradFill'])],
  ['grow', scoped(FLAG, ['blur'])],
  ['wR', scoped(INT, ['arcTo'])],
  ['hR', scoped(INT, ['arcTo'])],
  ['stAng', scoped(INT, ['arcTo'])],
  ['lim', scoped(INT, ['miter'])],
  ['d', scoped(INT, ['ds'])],
  ['sp', scoped(INT, ['ds'])],
  [
    'idx',
    new Map([
      ...scoped(INT, ['effectRef', 'fillRef', 'lnRef', 'bgRef']),
      ['fontRef', FONT_REF_INDEX],
    ]),
  ],
  ['gridSpan', scoped(INT, ['tc'])],
  ['rowSpan', scoped(INT, ['tc'])],
  ['hMerge', scoped(FLAG, ['tc'])],
  ['vMerge', scoped(FLAG, ['tc'])],
  ['firstRow', scoped(FLAG, ['tblPr'])],
  ['lastRow', scoped(FLAG, ['tblPr'])],
  ['firstCol', scoped(FLAG, ['tblPr'])],
  ['lastCol', scoped(FLAG, ['tblPr'])],
  ['bandRow', scoped(FLAG, ['tblPr'])],
  ['bandCol', scoped(FLAG, ['tblPr'])],
  ['noChangeAspect', scoped(FLAG, LOCK_ELEMENTS)],
  ['noGrp', scoped(FLAG, LOCK_ELEMENTS)],
  ['noDrilldown', scoped(FLAG, LOCK_ELEMENTS)],
  ['noSelect', scoped(FLAG, LOCK_ELEMENTS)],
  ['noChangeArrowheads', scoped(FLAG, LOCK_ELEMENTS)],
  ['noMove', scoped(FLAG, LOCK_ELEMENTS)],
  ['noResize', scoped(FLAG, LOCK_ELEMENTS)],
])
