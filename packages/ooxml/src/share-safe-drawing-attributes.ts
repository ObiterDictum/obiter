import type { XmlElement } from './parts/xml-elements'
import { PERCENT_VAL_ELEMENTS } from './share-safe-drawing-attribute-sets'
import { SHARE_SAFE_EXTENSION_URIS } from './share-safe-drawing-vocabulary'
import {
  EMBEDDED_ATTRIBUTES,
  EMBEDDED_SCOPED_ATTRIBUTES,
  percentThousandths,
} from './share-safe-drawing-attribute-bounds'
import { boundAllows } from './share-safe-value-bounds'

export type EmbeddedAttributeVerdict =
  'keep' | 'strip' | 'refuse' | 'refuse-hidden'

const embeddedBoundAllows = boundAllows

const ON_VALUES = new Set(['1', 'true', 'on'])

export const XML_SPACE_VALUES = new Set(['default', 'preserve'])

const EMBEDDED_STRIP_ATTRIBUTES = new Set(['descr', 'title'])

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

const GRAPHIC_DATA_URIS = new Set([
  'http://schemas.openxmlformats.org/drawingml/2006/picture',
  'http://schemas.openxmlformats.org/drawingml/2006/table',
  'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
])

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
      return SHARE_SAFE_EXTENSION_URIS.has(value) ? 'keep' : 'strip'
    }
    return 'strip'
  }
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
