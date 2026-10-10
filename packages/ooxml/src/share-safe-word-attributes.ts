import {
  FLAG_BOUND,
  boundAllows,
  type ShareSafeValueBound,
} from './share-safe-value-bounds'
import { WML_FORMAT_ATTRIBUTE_BOUNDS } from './share-safe-word-attribute-format'
import { WML_REFERENCE_ATTRIBUTE_BOUNDS } from './share-safe-word-attribute-refs'

/**
 * Elements that carry a single boolean switch — `w:b`, `w:i`,
 * `w:keepNext`, `w:vanish` and their kin. Word spells the switch
 * `0|1|true|false|on|off`; any other `w:val` on one is not a weakened
 * flag but a payload or a malformed document, so the bound refuses it
 * like every other out-of-enumeration value.
 */
const WML_ONOFF_ELEMENTS = new Set([
  // paragraph toggles
  'keepNext',
  'keepLines',
  'pageBreakBefore',
  'widowControl',
  'suppressLineNumbers',
  'suppressAutoHyphens',
  'kinsoku',
  'wordWrap',
  'overflowPunct',
  'topLinePunct',
  'autoSpaceDE',
  'autoSpaceDN',
  'bidi',
  'adjustRightInd',
  'snapToGrid',
  'contextualSpacing',
  'mirrorIndents',
  'suppressOverlap',
  // run toggles
  'b',
  'bCs',
  'i',
  'iCs',
  'caps',
  'smallCaps',
  'strike',
  'dstrike',
  'outline',
  'shadow',
  'emboss',
  'imprint',
  'noProof',
  'rtl',
  'cs',
  'vanish',
  'webHidden',
  'specVanish',
  'oMath',
  'oMathPara',
  // table toggles
  'cantSplit',
  'tblHeader',
  'noWrap',
  'tcFitText',
  'hideMark',
  'bidiVisual',
  // section toggles
  'formProt',
  'noEndnote',
  'titlePg',
  'rtlGutter',
  // numbering
  'isLgl',
  // styles
  'semiHidden',
  'unhideWhenUsed',
  'locked',
  'autoRedefine',
  'personal',
  'personalCompose',
  'personalReply',
  'qFormat',
  // content controls and form fields
  'temporary',
  'showingPlcHdr',
  'default',
  'checked',
  'sizeAuto',
  'enabled',
  'calcOnExit',
  // fonts and web settings
  'notTrueType',
  'allowPNG',
  'doNotSaveAsSingleFile',
  'relyOnVML',
  'optimizeForBrowser',
  // settings toggles
  'useFELayout',
  'doNotAutoCompressPictures',
  'evenAndOddHeaders',
  'bookFoldPrinting',
  'bookFoldRevPrinting',
  'bookFoldPrintingSheets',
  'mirrorMargins',
  'bordersDoNotSurroundHeader',
  'bordersDoNotSurroundFooter',
  'gutterAtTop',
  'hideSpellingErrors',
  'hideGrammaticalErrors',
  'autoHyphenation',
  'doNotHyphenateCaps',
  'showEnvelope',
  'removeDateAndTime',
  'doNotDisplayPageBoundaries',
  'displayBackgroundShape',
  'printPostScriptOverText',
  'printFractionalCharacterWidth',
  'printFormsData',
  'embedTrueTypeFonts',
  'embedSystemFonts',
  'saveSubsetFonts',
  'saveFormsData',
  'alignBordersAndEdges',
  'truncateFontHeightsLikeWP6',
  'mwSmallCaps',
  'usePrinterMetrics',
  'doNotWrapTextWithPunct',
  'snapAndGridWithCell',
  'noExtraLineSpacing',
  'doNotLeaveBackslashAlone',
  'doNotExpandShiftReturn',
  'spacingInWholePoints',
  'lineWrapLikeWord6',
  'autoSpaceLikeWord95',
  'wpJustification',
  'wpSpaceWidth',
  'noTabHangInd',
  'doNotUseHTMLParagraphAutoSpacing',
  'footnoteLayoutLikeWW8',
  'shapeLayoutLikeWW8',
  'alignTablesRowByRow',
  'uiCompat97To2003',
  'forgetLastTabAlignment',
  'adjustLineHeightInTable',
  'useWord97LineBreakRules',
  'doNotBreakWrappedTables',
  'doNotSnapToGridInCell',
  'selectFieldWithFirstOrLastChar',
  'applyBreakingRules',
  'doNotUseEastAsianBreakRules',
  'useWord2002TableStyleRules',
  'growAutofit',
  'useNormalStyleForList',
  'doNotUseIndentAsNumberingTabStop',
  'useAltKinsokuLineBreakRules',
  'allowSpaceOfSameStyleInTable',
  'doNotSuppressIndentation',
  'doNotAutofitConstrainedTables',
  'autofitToFirstFixedWidthCell',
  'underlineTabInNumList',
  'displayHangulFixedWidth',
  'splitPgBreakAndParaMark',
  'doNotVertAlignInTxbx',
  'doNotVertAlignCellWithSp',
  'doNotBreakConstrainedForcedTable',
  'doNotIgnoreFloatingObjects',
  'useAnsiKerningPairs',
  'cachedColBalance',
  'strictFirstAndLastChars',
  'wrapTrailSpaces',
  'noPunctuationKerning',
  'printTwoOnOne',
  'linkStyles',
  'doNotIncludeSubdocsInStats',
  'doNotShadeFormData',
  'doNotTrackMoves',
  'doNotTrackFormatting',
  'autoFormatOverride',
  'showXMLTags',
])

/**
 * The merged `w:` attribute policy: element → attribute → value bound.
 * Declared pairs ship only when the value satisfies its bound — an
 * out-of-bound value is a payload or a malformed document, and the
 * verdict refuses rather than silently flipping semantics by stripping.
 */
const WML_ATTRIBUTE_BOUNDS: ReadonlyMap<
  string,
  ReadonlyMap<string, ShareSafeValueBound>
> = (() => {
  const bounds = new Map<string, Map<string, ShareSafeValueBound>>()
  for (const [element, attrs] of [
    ...WML_FORMAT_ATTRIBUTE_BOUNDS,
    ...WML_REFERENCE_ATTRIBUTE_BOUNDS,
  ]) {
    const existing = bounds.get(element) ?? new Map()
    for (const [name, bound] of attrs) existing.set(name, bound)
    bounds.set(element, existing)
  }
  for (const element of WML_ONOFF_ELEMENTS) {
    const existing = bounds.get(element) ?? new Map()
    if (!existing.has('val')) existing.set('val', FLAG_BOUND)
    bounds.set(element, existing)
  }
  return bounds
})()

/**
 * `w:` attributes that are declared for an element at all — the name
 * scope the transform and byte verifier share before any value check.
 */
export const WML_ELEMENT_ATTRIBUTES: ReadonlyMap<
  string,
  ReadonlySet<string>
> = new Map(
  [...WML_ATTRIBUTE_BOUNDS].map(([element, attrs]) => [
    element,
    new Set(attrs.keys()),
  ]),
)

/**
 * Whether a declared `w:` attribute ships — `keep` when the value fits
 * its bound, `refuse` when it does not. Undeclared attributes never
 * reach here; the caller strips them before asking.
 */
export function wmlAttributeVerdict(
  elementLocalName: string,
  attributeLocalName: string,
  value: string,
): 'keep' | 'refuse' {
  const bound =
    WML_ATTRIBUTE_BOUNDS.get(elementLocalName)?.get(attributeLocalName)
  if (bound === undefined) return 'refuse'
  return boundAllows(bound, value) ? 'keep' : 'refuse'
}
