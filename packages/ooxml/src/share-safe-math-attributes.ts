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

const TWIPS_MEASURE = unionBound([
  shapeBound(/^[0-9]+(?:\.[0-9]+)?$/u),
  shapeBound(/^[0-9]+(?:\.[0-9]+)?(?:mm|cm|in|pt|pc|pi)$/u),
])

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
  ...ON_OFF_ELEMENTS.map((element): readonly [string, ShareSafeValueBound] => [
    element,
    FLAG_BOUND,
  ]),
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
  ...CHAR_ELEMENTS.map((element): readonly [string, ShareSafeValueBound] => [
    element,
    CHAR,
  ]),
  ['mathFont', FONT_NAME_BOUND],
])

const MATH_REQUIRED_VAL_ELEMENTS: ReadonlySet<string> = new Set(CHAR_ELEMENTS)

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

export function mathElementMissingRequiredAttribute(
  elementLocalName: string,
): boolean {
  return MATH_REQUIRED_VAL_ELEMENTS.has(elementLocalName)
}
