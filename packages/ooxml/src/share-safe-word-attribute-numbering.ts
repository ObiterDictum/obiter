/**
 * WordprocessingML numbering enumerations: `ST_NumberFormat` and the
 * chapter-separator, multilevel and suffix tokens a numbering or
 * page-numbering declaration may carry. An out-of-enumeration value is
 * a crafted payload or a malformed document — the copy refuses it.
 */
import { enumBound } from './share-safe-value-bounds'

export const WML_NUM_FMT = enumBound([
  'decimal',
  'upperRoman',
  'lowerRoman',
  'upperLetter',
  'lowerLetter',
  'ordinal',
  'cardinalText',
  'ordinalText',
  'hex',
  'chicago',
  'ideographDigital',
  'japaneseCounting',
  'aiueo',
  'iroha',
  'decimalFullWidth',
  'decimalHalfWidth',
  'japaneseLegal',
  'japaneseDigitalTenThousand',
  'decimalEnclosedCircle',
  'decimalFullWidth2',
  'aiueoFullWidth',
  'irohaFullWidth',
  'decimalZero',
  'bullet',
  'ganada',
  'chosung',
  'decimalEnclosedFullstop',
  'decimalEnclosedParen',
  'decimalEnclosedCircleChinese',
  'ideographEnclosedCircle',
  'ideographTraditional',
  'ideographZodiac',
  'ideographZodiacTraditional',
  'taiwaneseCounting',
  'ideographLegalTraditional',
  'taiwaneseCountingThousand',
  'taiwaneseDigital',
  'chineseCounting',
  'chineseLegalSimplified',
  'chineseCountingThousand',
  'koreanDigital',
  'koreanCounting',
  'koreanLegal',
  'koreanDigital2',
  'vietnameseCounting',
  'russianLower',
  'russianUpper',
  'none',
  'numberInDash',
  'hebrew1',
  'hebrew2',
  'arabicAlpha',
  'arabicAbjad',
  'hindiVowels',
  'hindiConsonants',
  'hindiNumbers',
  'hindiCounting',
  'thaiLetters',
  'thaiNumbers',
  'thaiCounting',
])

export const WML_CHAP_SEP = enumBound([
  'hyphen',
  'period',
  'colon',
  'emDash',
  'enDash',
])

export const WML_MULTILEVEL = enumBound([
  'singleLevel',
  'hybridMultilevel',
  'multilevel',
])

export const WML_SUFF = enumBound(['tab', 'space', 'nothing'])
