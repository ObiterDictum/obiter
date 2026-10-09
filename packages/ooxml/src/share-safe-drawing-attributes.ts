/**
 * The bounded attribute vocabulary for embedded (DrawingML, picture,
 * wordprocessing-drawing, OMML, extension-shape) elements. Descriptive
 * carrier attributes are stripped, never shipped; every attribute that may
 * ship is either scoped by element or carries a value bound — an enum of
 * declared values or a grammar shape (integer, flag, GUID, colour, tag).
 * `embeddedAttributeVerdict` is the one resolver both the policy transform
 * and the byte-level verifier run, so a value-bearing attribute cannot
 * reach emitted bytes unbounded.
 */

import {
  ARROW_SIZE_VALUES,
  ARROW_TYPE_VALUES,
  AUTONUM_VALUES,
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
  LOCK_ELEMENTS,
  PARA_ALIGN_VALUES,
  PARA_PROPS_ELEMENTS,
  PATH_FILL_VALUES,
  PATH_SHADE_VALUES,
  PERCENT_VAL_ELEMENTS,
  POS_FROM_VALUES,
  RECT_ALIGN_VALUES,
  SCHEME_CLRS,
  SHADOW_ELEMENTS,
  SIZE_REL_FROM_VALUES,
  TAB_ALIGN_VALUES,
  TEXT_ANCHOR_VALUES,
  TEXT_CAP_VALUES,
  TEXT_OVERFLOW_VALUES,
  TEXT_RUN_PROPS,
  TEXT_STRIKE_VALUES,
  TEXT_WRAP_VALUES,
  UNDERLINE_VALUES,
  VERT_TEXT_VALUES,
  WRAP_TEXT_VALUES,
} from './share-safe-drawing-attribute-sets'

/** What the embedded vocabulary decides for one attribute. */
export type EmbeddedAttributeVerdict =
  'keep' | 'strip' | 'refuse' | 'refuse-hidden'

/** A kept value must match a declared enumeration or a grammar shape. */
type EmbeddedValueBound =
  | { kind: 'enum'; values: ReadonlySet<string> }
  | { kind: 'shape'; pattern: RegExp }

function embeddedBoundAllows(
  bound: EmbeddedValueBound,
  value: string,
): boolean {
  return bound.kind === 'enum'
    ? bound.values.has(value)
    : bound.pattern.test(value)
}

const FLAG_VALUES = new Set(['0', '1', 'true', 'false', 'on', 'off'])
const ON_VALUES = new Set(['1', 'true', 'on'])

function enumBound(values: readonly string[]): EmbeddedValueBound {
  return { kind: 'enum', values: new Set(values) }
}

function shapeBound(pattern: RegExp): EmbeddedValueBound {
  return { kind: 'shape', pattern }
}

function scoped(
  bound: EmbeddedValueBound,
  elements: readonly string[],
): ReadonlyMap<string, EmbeddedValueBound> {
  const map = new Map<string, EmbeddedValueBound>()
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
/** Colour-slot names (`sysClr`, `prstClr`) are alphabetic tokens. */
const COLOR_NAME = shapeBound(/^[A-Za-z]{3,25}$/u)
/** Language tags (`en`, `en-US`) — short primary subtag, bounded tail. */
const LANG_TAG = shapeBound(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8}){0,3}$/u)
/** Four-letter ISO 15924 script codes (`Latn`, `Cyrl`, `Jpan`). */
const SCRIPT_TAG = shapeBound(/^[A-Za-z]{4}$/u)
/** Font names are text, but never markup: bounded length, no `<>&"'`. */
const FONT_NAME = shapeBound(/^[^<>&"']{0,64}$/u)
/** `a:gd` formulas: operators and operands, no markup or string literals. */
const FMLA = shapeBound(/^[0-9A-Za-z_+*/(). ?:-]{1,64}$/u)

const SCHEME_CLR = enumBound(SCHEME_CLRS)
const AUTONUM = enumBound(AUTONUM_VALUES)
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
const POS_FROM = enumBound(POS_FROM_VALUES)
const SIZE_REL_FROM = enumBound(SIZE_REL_FROM_VALUES)
const VERT_TEXT = enumBound(VERT_TEXT_VALUES)
const TEXT_ANCHOR = enumBound(TEXT_ANCHOR_VALUES)
const TEXT_OVERFLOW = enumBound(TEXT_OVERFLOW_VALUES)
const FONT_ALIGN = enumBound(FONT_ALIGN_VALUES)
const TEXT_WRAP = enumBound(TEXT_WRAP_VALUES)
const WRAP_TEXT = enumBound(WRAP_TEXT_VALUES)
const FONT_REF_INDEX = enumBound(FONT_REF_INDEX_VALUES)
const FLIP = enumBound(FLIP_VALUES)

/** `xml:space` is a two-value switch; anything else never emits. */
export const XML_SPACE_VALUES = new Set(['default', 'preserve'])

/**
 * Descriptive carrier attributes on embedded elements are stripped, never
 * shipped: `descr`/`title` are alt-text metadata, `name` labels the object
 * (a pasted image's filename rides here), `hidden` on a drawing object
 * marks invisible content. `uri` on `graphicData` or `ext` is an
 * identifier with a bounded value set, resolved by the policy.
 */
const EMBEDDED_STRIP_ATTRIBUTES = new Set(['descr', 'title'])

/**
 * Elements whose `name` attribute is a descriptive label, not semantics.
 * Theme machinery names (`theme`, `clrScheme`, `fontScheme`, `fmtScheme`)
 * are author-chosen display strings a recipient never resolves — the
 * scheme's colour and font slots still apply by structure.
 */
const EMBEDDED_NAME_LABEL_ELEMENTS = new Set([
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
 * Unqualified attribute names embedded elements may carry when their
 * bound is the same everywhere. Names not listed — here or in the scoped
 * table — strip; a consumer resolves them only as inert metadata anyway.
 * The integer and flag shapes cannot carry text, so a kept value is
 * always inert — a bound failure refuses rather than shipping an
 * arbitrary string in a value slot. The name lists themselves live in
 * `share-safe-drawing-attribute-sets.ts`.
 */
const EMBEDDED_ATTRIBUTES: ReadonlyMap<string, EmbeddedValueBound> = new Map<
  string,
  EmbeddedValueBound
>([
  ...INT_ATTRIBUTES.map((name): [string, EmbeddedValueBound] => [name, INT]),
  ...FLAG_ATTRIBUTES.map((name): [string, EmbeddedValueBound] => [name, FLAG]),
])

/**
 * Unqualified attributes legal only on named embedded elements, with the
 * value bound each placement declares. `typeface` is a font declaration's
 * face name; placed on any other element it is a metadata channel. A name
 * absent from the element's set strips; a name present whose value fails
 * the bound refuses — an enum or grammar slot holding foreign text is a
 * payload, not formatting.
 */
const EMBEDDED_SCOPED_ATTRIBUTES: ReadonlyMap<
  string,
  ReadonlyMap<string, EmbeddedValueBound>
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
      ['sysClr', COLOR_NAME],
      ['prstClr', COLOR_NAME],
      ['schemeClr', SCHEME_CLR],
      ['prstDash', DASH],
      ...scoped(INT, PERCENT_VAL_ELEMENTS),
    ]),
  ],
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
      ...scoped(INT, [
        'srcRect',
        'fillRect',
        'fillToRect',
        'effectExtent',
        'scrgbClr',
      ]),
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
  ['dir', new Map([...scoped(INT, SHADOW_ELEMENTS), ['lightRig', RECT_ALIGN]])],
  ['rig', scoped(TOKEN, ['lightRig'])],
  [
    'prst',
    scoped(TOKEN, [
      'prstGeom',
      'prstShdw',
      'camera',
      'bevelT',
      'bevelB',
      'pattFill',
    ]),
  ],
  ['prstMaterial', scoped(TOKEN, ['sp3d'])],
  ['fov', scoped(INT, ['camera'])],
  ['zoom', scoped(INT, ['camera'])],
  ['cstate', scoped(BLIP_CSTATE, ['blip'])],
  ['fmla', scoped(FMLA, ['gd'])],
  [
    'relativeFrom',
    new Map([
      ...scoped(POS_FROM, ['positionH', 'positionV']),
      ...scoped(SIZE_REL_FROM, ['sizeRelH', 'sizeRelW']),
    ]),
  ],
  ['edited', scoped(FLAG, ['wrapPolygon'])],
  ['wrapText', scoped(WRAP_TEXT, ['wrapSquare', 'wrapTight', 'wrapThrough'])],
  ['txBox', scoped(FLAG, ['cNvSpPr'])],
  ['bwMode', scoped(BW_MODE, ['cNvPr'])],
  ['vert', scoped(VERT_TEXT, ['bodyPr', 'tcPr'])],
  ['vertOverflow', scoped(TEXT_OVERFLOW, ['bodyPr'])],
  ['horzOverflow', scoped(TEXT_OVERFLOW, ['bodyPr', 'tcPr'])],
  ['anchor', scoped(TEXT_ANCHOR, ['bodyPr', 'tcPr'])],
  ['fontAlgn', scoped(FONT_ALIGN, ['bodyPr'])],
  ['wrap', scoped(TEXT_WRAP, ['bodyPr'])],
  ['prstTxWarp', scoped(TOKEN, ['bodyPr'])],
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
  ['amt', scoped(INT, ['alphaModFix'])],
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

/**
 * `a:graphicData` names its payload type with a `uri` attribute; the value
 * is an identifier, not content. Only these are readable payloads this
 * build can classify — a chart or diagram URI would hide parts the
 * relationship walk refused, so anything else refuses.
 */
const GRAPHIC_DATA_URIS = new Set([
  'http://schemas.openxmlformats.org/drawingml/2006/picture',
  'http://schemas.openxmlformats.org/drawingml/2006/table',
  'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
])

/**
 * `a:ext uri` is an extension identifier — a GUID or a bounded schema URL
 * with path segments of word characters, never a free-text channel.
 */
const EXTENSION_URI_PATTERN =
  /^(?:\{[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}\}|https?:\/\/(?:schemas\.openxmlformats\.org|schemas\.microsoft\.com|purl\.oclc\.org)(?:\/[\w.-]{1,40}){1,8})$/u

/**
 * The unqualified attribute verdict for an embedded element, given element
 * and attribute local names and the raw value. Descriptive carriers strip
 * outright; `hidden` refuses when it marks the object invisible; `uri` is
 * an identifier resolved to its declared value set; every other name
 * resolves through the scoped table first (element placement plus value
 * bound) and the unscoped bounded table second. A scoped or bounded name
 * holding a value outside its grammar refuses — it is a payload slot, not
 * formatting — while an unrecognised name strips as inert metadata.
 */
export function embeddedAttributeVerdict(
  elementLocalName: string,
  attributeLocalName: string,
  value: string,
): EmbeddedAttributeVerdict {
  if (EMBEDDED_STRIP_ATTRIBUTES.has(attributeLocalName)) return 'strip'
  if (attributeLocalName === 'hidden') {
    return ON_VALUES.has(value.trim().toLowerCase()) ? 'refuse-hidden' : 'strip'
  }
  if (
    attributeLocalName === 'name' &&
    EMBEDDED_NAME_LABEL_ELEMENTS.has(elementLocalName)
  ) {
    return 'strip'
  }
  if (attributeLocalName === 'uri') {
    if (elementLocalName === 'graphicData') {
      return GRAPHIC_DATA_URIS.has(value) ? 'keep' : 'refuse'
    }
    if (elementLocalName === 'ext') {
      return EXTENSION_URI_PATTERN.test(value) ? 'keep' : 'strip'
    }
    return 'strip'
  }
  const scoped = EMBEDDED_SCOPED_ATTRIBUTES.get(attributeLocalName)
  if (scoped !== undefined) {
    const bound = scoped.get(elementLocalName)
    if (bound === undefined) return 'strip'
    return embeddedBoundAllows(bound, value) ? 'keep' : 'refuse'
  }
  const bound = EMBEDDED_ATTRIBUTES.get(attributeLocalName)
  if (bound === undefined) return 'strip'
  return embeddedBoundAllows(bound, value) ? 'keep' : 'refuse'
}
