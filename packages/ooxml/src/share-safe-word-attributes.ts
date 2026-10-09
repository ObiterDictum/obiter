/**
 * The bounded `w:`-namespace attribute vocabulary the share-safe copy may
 * emit, scoped per element: an attribute may only appear where
 * WordprocessingML declares it. A name like `w:val`, `w:instr` or
 * `w:name` placed on an element that does not declare it is a payload
 * channel, not formatting — it strips rather than shipping verbatim.
 * `w:` elements absent from this table carry no `w:` attributes at all;
 * `rsid*` provenance and `displacedBy*` resolve before the table runs.
 *
 * The table itself is split by concern:
 * `share-safe-word-attribute-format.ts` carries formatting geometry and
 * `share-safe-word-attribute-refs.ts` carries reference and identity
 * vocabulary.
 */

import { WML_FORMAT_ATTRIBUTES } from './share-safe-word-attribute-format'
import { WML_REFERENCE_ATTRIBUTES } from './share-safe-word-attribute-refs'

/**
 * Elements whose `w:val` is a pure on/off toggle. A value outside the
 * on/off vocabulary (`0`/`1`/`true`/`false`/`on`/`off`) on one of these
 * carries nothing a reader honours — it strips rather than shipping an
 * arbitrary string in a value slot.
 */
export const WML_ONOFF_ELEMENTS = new Set([
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

const ONOFF = ['val'] as const

/**
 * Element name → the `w:` attribute names it may carry, sourced from the
 * WordprocessingML schema surface the kept elements declare. An attribute
 * the element's set does not name is dropped by the policy.
 */
export const WML_ELEMENT_ATTRIBUTES: ReadonlyMap<
  string,
  ReadonlySet<string>
> = new Map(
  [
    ...WML_FORMAT_ATTRIBUTES,
    ...WML_REFERENCE_ATTRIBUTES,
    ...[...WML_ONOFF_ELEMENTS].map(
      (name): readonly [string, readonly string[]] => [name, ONOFF],
    ),
  ].map(([element, names]) => [element, new Set(names)]),
)
