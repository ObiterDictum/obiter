import {
  boundAllows,
  enumBound,
  FLAG_BOUND,
  FONT_NAME_BOUND,
  intRangeBound,
  shapeBound,
  unionBound,
  type ShareSafeValueBound,
} from './share-safe-value-bounds'

/**
 * OMML property elements and the bound each one's `m:val` must satisfy —
 * the map is generated from `shared-math.xsd`: an element appears here
 * exactly when its complex type declares an `m:val` attribute, and the
 * bound is that attribute's declared type. An element absent here cannot
 * carry `m:val` at all; a value outside its bound is a payload in a
 * value slot, and the copy refuses.
 */

/** `s:ST_TwipsMeasure` — unsigned decimal twips or a universal measure. */
const TWIPS_MEASURE = unionBound([
  shapeBound(/^[0-9]+(?:\.[0-9]+)?$/u),
  shapeBound(/^[0-9]+(?:\.[0-9]+)?(?:mm|cm|in|pt|pc|pi)$/u),
])

/** `ST_Char` — a single character; delimiters hold glyphs, not text. */
const CHAR = shapeBound(/^.$/su)

const ON_OFF_ELEMENTS = [
  'aln',
  'alnScr',
  'degHide',
  'diff',
  'dispDef',
  'grow',
  'hideBot',
  'hideLeft',
  'hideRight',
  'hideTop',
  'lit',
  'maxDist',
  'noBreak',
  'nor',
  'objDist',
  'opEmu',
  'plcHide',
  'show',
  'smallFrac',
  'strikeBLTR',
  'strikeH',
  'strikeTLBR',
  'strikeV',
  'subHide',
  'supHide',
  'transp',
  'wrapRight',
  'zeroAsc',
  'zeroDesc',
  'zeroWid',
] as const

const TWIPS_MEASURE_ELEMENTS = [
  'interSp',
  'intraSp',
  'lMargin',
  'rMargin',
  'postSp',
  'preSp',
  'wrapIndent',
] as const

const UNSIGNED_INT_ELEMENTS = ['cGp', 'cSp', 'rSp'] as const

const SPACING_RULE_ELEMENTS = ['cGpRule', 'rSpRule'] as const

const CHAR_ELEMENTS = ['chr', 'begChr', 'endChr', 'sepChr'] as const

const MATH_VAL_BOUNDS: ReadonlyMap<string, ShareSafeValueBound> = new Map([
  // `CT_OnOff` — s:ST_OnOff (xsd:boolean plus on/off)
  ...ON_OFF_ELEMENTS.map((element): readonly [string, ShareSafeValueBound] => [
    element,
    FLAG_BOUND,
  ]),
  // enumerations
  ['brkBin', enumBound(['before', 'after', 'repeat'])],
  ['brkBinSub', enumBound(['--', '-+', '+-'])],
  ['defJc', enumBound(['left', 'right', 'center', 'centerGroup'])],
  ['jc', enumBound(['left', 'right', 'center', 'centerGroup'])],
  ['mcJc', enumBound(['left', 'center', 'right', 'inside', 'outside'])],
  [
    'baseJc',
    enumBound(['inline', 'top', 'center', 'bottom', 'inside', 'outside']),
  ],
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
  ['type', enumBound(['bar', 'skw', 'lin', 'noBar'])],
  ['pos', enumBound(['top', 'bot'])],
  ['vertJc', enumBound(['top', 'bot'])],
  ['limLoc', enumBound(['undOvr', 'subSup'])],
  ['intLim', enumBound(['undOvr', 'subSup'])],
  ['naryLim', enumBound(['undOvr', 'subSup'])],
  ['shp', enumBound(['centered', 'match'])],
  // measurements and counts
  ...TWIPS_MEASURE_ELEMENTS.map(
    (element): readonly [string, ShareSafeValueBound] => [
      element,
      TWIPS_MEASURE,
    ],
  ),
  ...UNSIGNED_INT_ELEMENTS.map(
    (element): readonly [string, ShareSafeValueBound] => [
      element,
      intRangeBound(0, 4294967295),
    ],
  ),
  ...SPACING_RULE_ELEMENTS.map(
    (element): readonly [string, ShareSafeValueBound] => [
      element,
      intRangeBound(0, 4),
    ],
  ),
  ['count', intRangeBound(1, 255)],
  ['argSz', intRangeBound(-2, 2)],
  // characters and font names — a delimiter slot holds glyphs, not text
  ...CHAR_ELEMENTS.map((element): readonly [string, ShareSafeValueBound] => [
    element,
    CHAR,
  ]),
  ['mathFont', FONT_NAME_BOUND],
])

/**
 * `CT_Char` declares `m:val` as required — a `chr`/`begChr`/`endChr`/
 * `sepChr` element without it is malformed and refuses rather than
 * shipping a delimiter property a reader fills with a default.
 */
const MATH_REQUIRED_VAL_ELEMENTS: ReadonlySet<string> = new Set(CHAR_ELEMENTS)

/**
 * The `m:` attribute verdict for an OMML element. `m:val` keeps only on
 * an element that declares it, within that element's bound; `m:alnAt` on
 * `m:brk` is the one other declared `m:` attribute. Anything else —
 * an unknown attribute name or a declared slot outside its bound —
 * refuses.
 */
export function mathAttributeVerdict(
  elementLocalName: string,
  attributeLocalName: string,
  value: string,
): 'keep' | 'refuse' {
  if (attributeLocalName === 'alnAt' && elementLocalName === 'brk') {
    return boundAllows(intRangeBound(1, 255), value) ? 'keep' : 'refuse'
  }
  if (attributeLocalName !== 'val') return 'refuse'
  const bound = MATH_VAL_BOUNDS.get(elementLocalName)
  if (bound === undefined) return 'refuse'
  return boundAllows(bound, value) ? 'keep' : 'refuse'
}

/**
 * Whether an `m:` element requires an `m:val` it does not carry — the
 * element-level counterpart the transform and emitted-byte re-analysis
 * apply.
 */
export function mathElementMissingRequiredAttribute(
  elementLocalName: string,
): boolean {
  return MATH_REQUIRED_VAL_ELEMENTS.has(elementLocalName)
}
