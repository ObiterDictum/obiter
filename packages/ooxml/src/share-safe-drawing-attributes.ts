/**
 * The bounded attribute vocabulary for embedded (DrawingML, picture,
 * wordprocessing-drawing, OMML, extension-shape) elements. Descriptive
 * carrier attributes are stripped, never shipped; every attribute that may
 * ship is either scoped by element or carries a value bound — an enum of
 * declared values or a grammar shape (integer, flag, GUID, colour, tag).
 * `embeddedAttributeVerdict` is the one resolver both the policy transform
 * and the byte-level verifier run, so a value-bearing attribute cannot
 * reach emitted bytes unbounded. The bound tables themselves live in
 * `share-safe-drawing-attribute-bounds.ts`.
 */

import type { XmlElement } from './parts/xml-elements'
import { PERCENT_VAL_ELEMENTS } from './share-safe-drawing-attribute-sets'
import { SHARE_SAFE_EXTENSION_URIS } from './share-safe-drawing-vocabulary'
import {
  EMBEDDED_ATTRIBUTES,
  EMBEDDED_SCOPED_ATTRIBUTES,
  percentThousandths,
} from './share-safe-drawing-attribute-bounds'
import { boundAllows } from './share-safe-value-bounds'

/** What the embedded vocabulary decides for one attribute. */
export type EmbeddedAttributeVerdict =
  'keep' | 'strip' | 'refuse' | 'refuse-hidden'

const embeddedBoundAllows = boundAllows

const ON_VALUES = new Set(['1', 'true', 'on'])

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
 * The alpha family's opacity slots and the minimum each may hold, in
 * thousandths of a percent. Colour transforms compose in document order
 * against a base alpha the verdict cannot see, so every slot's floor must
 * hold on its own:
 *
 * - `alpha` and `alphaRepl` declare an absolute alpha — under 1% the
 *   colour is invisible in every renderer, whichever way the value is
 *   spelled;
 * - `alphaMod` and `alphaModFix` multiply the running alpha — any
 *   multiplier under 100% reduces, and repeated reductions can shrink a
 *   chain toward invisibility, so only non-reducing modulators keep;
 * - `alphaOff` is additive, not subtractive — ECMA-376 §20.1.2.3.3: "a
 *   10% alpha offset increases a 50% opacity to 60%. A -10% alpha offset
 *   decreases a 50% opacity to 40%" — so any negative offset can complete
 *   an erasure against the base it composes with and only `0` and above
 *   keep (`+100%` merely clamps, harmless).
 *
 * The floors guarantee a bounded promise — no shipped alpha declaration
 * can render a colour below 1% of its full opacity — not universal
 * visibility: luminance and hue transforms can still spell white on
 * white, the accepted residual class. A value under its floor refuses
 * like `hidden`/`vanish`: a colour a recipient cannot see is a
 * hidden-content carrier, not a style choice.
 */
const ALPHA_OPACITY_FLOORS: ReadonlyMap<
  string,
  ReadonlyMap<string, number>
> = new Map([
  ['alpha', new Map([['val', 1000]])],
  ['alphaRepl', new Map([['a', 1000]])],
  ['alphaMod', new Map([['val', 100000]])],
  ['alphaModFix', new Map([['amt', 100000]])],
  ['alphaOff', new Map([['val', 0]])],
])

/**
 * Attributes the schema marks `use="required"` on embedded elements that
 * ship — a kept element missing one is malformed or deliberately
 * stripped of the slot that carries its semantics, so it refuses
 * rather than emitting a shape a reader would re-interpret. Descriptive
 * carriers (`cNvPr name`) stay off the list: the policy strips them
 * deliberately. The transform and the emitted-byte re-analysis both run
 * this map, so the check cannot be bypassed by splicing bytes.
 */
export const EMBEDDED_REQUIRED_ATTRIBUTES: ReadonlyMap<
  string,
  ReadonlySet<string>
> = new Map([
  ['alpha', new Set(['val'])],
  ['alphaOff', new Set(['val'])],
  ['alphaMod', new Set(['val'])],
  ['alphaRepl', new Set(['a'])],
  ['biLevel', new Set(['thresh'])],
  ['fillOverlay', new Set(['blend'])],
  ['softEdge', new Set(['rad'])],
  ...PERCENT_VAL_ELEMENTS.map((name): [string, ReadonlySet<string>] => [
    name,
    new Set(['val']),
  ]),
  ['tint', new Set(['val'])],
  ['shade', new Set(['val'])],
  ['hue', new Set(['val'])],
  ['hueMod', new Set(['val'])],
  ['hueOff', new Set(['val'])],
  ['srgbClr', new Set(['val'])],
  ['sysClr', new Set(['val'])],
  ['prstClr', new Set(['val'])],
  ['schemeClr', new Set(['val'])],
  ['useLocalDpi', new Set(['val'])],
  ['spcPts', new Set(['val'])],
  ['spcPct', new Set(['val'])],
  ['buSzPct', new Set(['val'])],
  ['buSzPts', new Set(['val'])],
  ['scrgbClr', new Set(['r', 'g', 'b'])],
  ['hslClr', new Set(['hue', 'sat', 'lum'])],
  ['prstGeom', new Set(['prst'])],
  ['camera', new Set(['prst'])],
  ['lightRig', new Set(['rig', 'dir'])],
  ['gs', new Set(['pos'])],
  ['tab', new Set(['pos'])],
  ['gd', new Set(['name', 'fmla'])],
  ['font', new Set(['script', 'typeface'])],
  ['fld', new Set(['id'])],
  ['buAutoNum', new Set(['type'])],
  ['buChar', new Set(['char'])],
  ['effectRef', new Set(['idx'])],
  ['fillRef', new Set(['idx'])],
  ['lnRef', new Set(['idx'])],
  ['bgRef', new Set(['idx'])],
  ['docPr', new Set(['id'])],
  ['cNvPr', new Set(['id'])],
  ['graphicData', new Set(['uri'])],
  ['pt', new Set(['x', 'y'])],
  ['off', new Set(['x', 'y'])],
  ['chOff', new Set(['x', 'y'])],
  ['chExt', new Set(['cx', 'cy'])],
  ['extent', new Set(['cx', 'cy'])],
  [
    'anchor',
    new Set([
      'relativeHeight',
      'behindDoc',
      'locked',
      'layoutInCell',
      'allowOverlap',
    ]),
  ],
  ['positionH', new Set(['relativeFrom'])],
  ['positionV', new Set(['relativeFrom'])],
  ['effectExtent', new Set(['l', 't', 'r', 'b'])],
  ['simplePos', new Set(['x', 'y'])],
  ['start', new Set(['x', 'y'])],
  ['lineTo', new Set(['x', 'y'])],
  ['wrapSquare', new Set(['wrapText'])],
  ['wrapTight', new Set(['wrapText'])],
  ['wrapThrough', new Set(['wrapText'])],
])

const EXT_UNDER_EXT_LST = new Set(['uri'])
const EXT_UNDER_XFRM = new Set(['cx', 'cy'])

/**
 * Required attributes for an embedded element, resolving the one name two
 * schema types share: `a:ext` under `a:extLst` is the extension record
 * (`uri` required) and under `a:xfrm` the positive-size pair (`cx`/`cy`
 * required). `a:ext` anywhere else is a shape no writer declares — refuse.
 */
export function embeddedElementRequiredAttributes(
  element: XmlElement,
): ReadonlySet<string> | 'refuse' | undefined {
  if (element.localName === 'ext') {
    const parent = element.parent?.localName
    if (parent === 'extLst') return EXT_UNDER_EXT_LST
    if (parent === 'xfrm') return EXT_UNDER_XFRM
    return 'refuse'
  }
  return EMBEDDED_REQUIRED_ATTRIBUTES.get(element.localName)
}

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
      // An extension ships only when its URI names a supported
      // extension — the element verdict removes the whole `a:ext`
      // otherwise, so a kept identifier is always the supported one.
      return SHARE_SAFE_EXTENSION_URIS.has(value) ? 'keep' : 'strip'
    }
    return 'strip'
  }
  // Explicit invisibility refuses like `hidden`/`vanish` — an object a
  // recipient cannot see must not ship under the copy. The comparison is
  // numeric, so `0`, `0%`, `-50%` and `0.0%` resolve to thousandths and
  // catch the floor regardless of lexical form; a value that does not
  // parse as a percentage falls through to its declared bound.
  const alphaFloor =
    ALPHA_OPACITY_FLOORS.get(elementLocalName)?.get(attributeLocalName)
  if (alphaFloor !== undefined) {
    const thousandths = percentThousandths(value)
    if (thousandths !== undefined && thousandths < alphaFloor) {
      return 'refuse-hidden'
    }
  }
  if (attributeLocalName === 'bwMode' && value === 'hidden') {
    return 'refuse-hidden'
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
