import {
  boundAllows,
  enumBound,
  FLAG_BOUND,
  FONT_NAME_BOUND,
  INT_BOUND,
  shapeBound,
  type ShareSafeValueBound,
} from './share-safe-value-bounds'

/**
 * OMML property elements and the bound each one's `m:val` must satisfy.
 * OMML declares `m:val` as the only namespaced attribute, on property
 * elements whose values are toggles, small enumerations, measurements,
 * single characters or a font name — none is a free channel. An element
 * absent here cannot carry `m:val` at all; a value outside its bound is
 * a payload in a value slot, and the copy refuses.
 */
const MATH_VAL_BOUNDS: ReadonlyMap<string, ShareSafeValueBound> = new Map([
  // on/off switches
  ...[
    'aln',
    'alnScr',
    'ctrlPr',
    'degHide',
    'diffEmph',
    'dispDef',
    'grow',
    'hideBot',
    'hideLeft',
    'hideRight',
    'hideTop',
    'intChk',
    'lit',
    'noBreak',
    'nor',
    'opEmu',
    'plcHide',
    'smallFrac',
    'strikeBLTR',
    'strikeH',
    'strikeTLBR',
    'strikeV',
    'subHide',
    'supHide',
    'transp',
    'zeroAsc',
    'zeroDesc',
    'zeroWid',
  ].map((element): readonly [string, ShareSafeValueBound] => [
    element,
    FLAG_BOUND,
  ]),
  // enumerations
  ['brkBin', enumBound(['before', 'after', 'repeat--'])],
  ['brkBinSub', enumBound(['--', '-+', '+-'])],
  ['defJc', enumBound(['centerGroup', 'center', 'left', 'right'])],
  ['jc', enumBound(['inline', 'centerGroup', 'center', 'left', 'right'])],
  ['mcJc', enumBound(['left', 'center', 'right', 'inline'])],
  ['baseJc', enumBound(['top', 'center', 'bottom', 'inline'])],
  ['sty', enumBound(['p', 'b', 'i', 'bi'])],
  [
    'scr',
    enumBound([
      'roman',
      'script',
      'fraktur',
      'sans-serif',
      'monospace',
      'double-struck',
    ]),
  ],
  ['type', enumBound(['bar', 'skewed', 'lin', 'noFrac'])],
  ['pos', enumBound(['top', 'bot'])],
  ['vertJc', enumBound(['top', 'bot', 'center'])],
  ['limLoc', enumBound(['undOvr', 'subSup'])],
  ['intLim', enumBound(['subSup', 'undOvr'])],
  ['naryLim', enumBound(['undOvr', 'subSup'])],
  ['shp', enumBound(['centered', 'match'])],
  ['dMacro', FLAG_BOUND],
  // measurements and counts
  ...[
    'argSz',
    'cGp',
    'cGpRule',
    'cSp',
    'interSp',
    'intraSp',
    'lMargin',
    'maxDist',
    'objDist',
    'postSp',
    'preSp',
    'rMargin',
    'rSp',
    'rSpRule',
    'wrapIndent',
    'count',
    'dist',
  ].map((element): readonly [string, ShareSafeValueBound] => [
    element,
    INT_BOUND,
  ]),
  // characters and font names — a delimiter slot holds glyphs, not text
  ['chr', shapeBound(/^.{1,4}$/u)],
  ['begChr', shapeBound(/^.{1,4}$/u)],
  ['endChr', shapeBound(/^.{1,4}$/u)],
  ['sepChr', shapeBound(/^.{0,4}$/u)],
  ['mathFont', FONT_NAME_BOUND],
])

/**
 * The `m:` attribute verdict for an OMML element: only `m:val` exists in
 * the vocabulary, and only where the element declares a bound for it.
 * Every other `m:` attribute name — and `m:val` on an element that does
 * not declare it — refuses.
 */
export function mathAttributeVerdict(
  elementLocalName: string,
  attributeLocalName: string,
  value: string,
): 'keep' | 'refuse' {
  if (attributeLocalName !== 'val') return 'refuse'
  const bound = MATH_VAL_BOUNDS.get(elementLocalName)
  if (bound === undefined) return 'refuse'
  return boundAllows(bound, value) ? 'keep' : 'refuse'
}
