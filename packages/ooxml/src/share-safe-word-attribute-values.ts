/**
 * WordprocessingML enumeration vocabulary for share-safe attribute bounds.
 * Each set names every value the OOXML simple type permits for the slot,
 * so a `w:` attribute keeps only a value Word itself could have written —
 * an out-of-enumeration value is either a crafted payload or a malformed
 * document, and the policy refuses rather than guessing.
 */
import {
  COLOR_BOUND,
  DATE_BOUND,
  enumBound,
  FONT_NAME_BOUND,
  HEX2_BOUND,
  HEX4_BOUND,
  HEX8_BOUND,
  HEX20_BOUND,
  HEXFLAGS_BOUND,
  IDENT_BOUND,
  INT_BOUND,
  LANG_BOUND,
  SHORT_TEXT_BOUND,
  TEXT_BOUND,
  unionBound,
  VERSION_BOUND,
  CHARSET_BOUND,
} from './share-safe-value-bounds'

export const WML_BORDER = enumBound([
  'nil',
  'none',
  'single',
  'thick',
  'double',
  'dotted',
  'dashed',
  'dotDash',
  'dotDotDash',
  'triple',
  'thinThickSmallGap',
  'thickThinSmallGap',
  'thinThickThinSmallGap',
  'thinThickMediumGap',
  'thickThinMediumGap',
  'thinThickThinMediumGap',
  'thinThickLargeGap',
  'thickThinLargeGap',
  'thinThickThinLargeGap',
  'wave',
  'doubleWave',
  'dashSmallGap',
  'dashDotStroked',
  'threeDEmboss',
  'threeDEngrave',
  'outset',
  'inset',
  'apples',
  'archedScallops',
  'babyPacifier',
  'babyRattle',
  'balloons3Colors',
  'balloonsHotAir',
  'basicBlackDashes',
  'basicBlackDots',
  'basicBlackSquares',
  'basicThinLines',
  'basicWhiteDashes',
  'basicWhiteDots',
  'basicWhiteSquares',
  'basicWideInline',
  'basicWideMidline',
  'basicWideOutline',
  'bats',
  'birds',
  'birdsFlight',
  'cabins',
  'cakeSlice',
  'candyCorn',
  'celticKnotwork',
  'certificateBanner',
  'chainLink',
  'champagneBottle',
  'checkedBarBlack',
  'checkedBarColor',
  'checkered',
  'christmasTree',
  'circlesLines',
  'circlesRectangles',
  'classicalWave',
  'clocks',
  'compass',
  'confetti',
  'confettiGrays',
  'confettiOutline',
  'confettiStreamers',
  'confettiWhite',
  'cornerTriangles',
  'couponCutoutDashes',
  'couponCutoutDots',
  'crazyMaze',
  'creaturesButterfly',
  'creaturesFish',
  'creaturesInsects',
  'creaturesLadyBug',
  'crossStitch',
  'cup',
  'decoArch',
  'decoArchColor',
  'decoBlocks',
  'diamondsGray',
  'doubleD',
  'doubleDiamonds',
  'earth1',
  'earth2',
  'eclipsingSquares1',
  'eclipsingSquares2',
  'eggsBlack',
  'fans',
  'film',
  'firecrackers',
  'flowersBlockPrint',
  'flowersDaisies',
  'flowersModern1',
  'flowersModern2',
  'flowersPansy',
  'flowersRedRose',
  'flowersRoses',
  'flowersTeacup',
  'flowersTiny',
  'gems',
  'gingerbreadMan',
  'gradient',
  'handmade1',
  'handmade2',
  'heartBalloon',
  'heartGray',
  'hearts',
  'heebieJeebies',
  'holly',
  'houseFunky',
  'hypnotic',
  'iceCreamCones',
  'lightBulb',
  'lightning1',
  'lightning2',
  'mapleLeaf',
  'mapleMuffins',
  'mapPins',
  'marquee',
  'marqueeToothed',
  'moons',
  'mosaic',
  'musicNotes',
  'northwest',
  'ovals',
  'packages',
  'palmsBlack',
  'palmsColor',
  'paperClips',
  'papyrus',
  'partyFavor',
  'partyGlass',
  'pencils',
  'people',
  'peopleHats',
  'peopleWaving',
  'poinsettias',
  'postageStamp',
  'pumpkin1',
  'pushPinNote1',
  'pushPinNote2',
  'pyramids',
  'pyramidsAbove',
  'quadrants',
  'rings',
  'safari',
  'sawtooth',
  'sawtoothGray',
  'scaredCat',
  'seattle',
  'shadowedSquares',
  'sharksTeeth',
  'shorebirdTracks',
  'skyrocket',
  'snowflakeFancy',
  'snowflakes',
  'sombrero',
  'southwest',
  'stars',
  'stars3d',
  'starsBlack',
  'starsShadowed',
  'starsTop',
  'sun',
  'swirligig',
  'tornPaper',
  'tornPaperBlack',
  'trees',
  'triangleParty',
  'triangles',
  'tribal1',
  'tribal2',
  'tribal3',
  'tribal4',
  'tribal5',
  'tribal6',
  'twistedLines1',
  'twistedLines2',
  'vine',
  'waveline',
  'weavingAngles',
  'weavingBraid',
  'weavingRibbon',
  'weavingStrips',
  'whiteFlowers',
  'woodwork',
  'xIllusions',
  'zanyTriangles',
  'zigZag',
  'zigZagStitch',
])

export const WML_JC = enumBound([
  'start',
  'end',
  'left',
  'right',
  'center',
  'both',
  'mediumKashida',
  'distribute',
  'numTab',
  'highKashida',
  'lowKashida',
  'thaiDistribute',
])

export const WML_UNDERLINE = enumBound([
  'none',
  'words',
  'single',
  'double',
  'thick',
  'dotted',
  'dottedHeavy',
  'dash',
  'dashedHeavy',
  'dashLong',
  'dashLongHeavy',
  'dotDash',
  'dashDotHeavy',
  'dotDotDash',
  'dashDotDotHeavy',
  'wave',
  'wavyHeavy',
  'wavyDouble',
])

export const WML_HIGHLIGHT = enumBound([
  'none',
  'black',
  'blue',
  'cyan',
  'darkBlue',
  'darkCyan',
  'darkGray',
  'darkGreen',
  'darkMagenta',
  'darkRed',
  'darkYellow',
  'green',
  'lightGray',
  'magenta',
  'red',
  'white',
  'yellow',
])

export const WML_SHD = enumBound([
  'nil',
  'clear',
  'solid',
  'horzStripe',
  'vertStripe',
  'reverseDiagStripe',
  'diagStripe',
  'horzCross',
  'diagCross',
  'thinHorzStripe',
  'thinVertStripe',
  'thinReverseDiagStripe',
  'thinDiagStripe',
  'thinHorzCross',
  'thinDiagCross',
  'pct5',
  'pct10',
  'pct12',
  'pct15',
  'pct20',
  'pct25',
  'pct30',
  'pct35',
  'pct37',
  'pct40',
  'pct45',
  'pct50',
  'pct55',
  'pct60',
  'pct62',
  'pct65',
  'pct70',
  'pct75',
  'pct80',
  'pct85',
  'pct87',
  'pct90',
  'pct95',
])

export const WML_TBL_WIDTH = enumBound(['nil', 'pct', 'dxa', 'auto'])
export const WML_LINE_RULE = enumBound(['auto', 'atLeast', 'exact'])
export const WML_MERGE = enumBound(['restart', 'continue'])
export const WML_TAB_JC = enumBound([
  'clear',
  'start',
  'left',
  'center',
  'right',
  'end',
  'decimal',
  'bar',
  'num',
])
export const WML_TAB_LEADER = enumBound([
  'none',
  'dot',
  'hyphen',
  'underscore',
  'heavy',
  'middleDot',
])
export const WML_PTAB_ALIGN = enumBound(['left', 'center', 'right'])
export const WML_PTAB_REL = enumBound(['margin', 'indent'])
export const WML_PTAB_LEADER = enumBound([
  'none',
  'dot',
  'hyphen',
  'underscore',
  'middleDot',
])
export const WML_BR_TYPE = enumBound(['page', 'column', 'textWrapping'])
export const WML_BR_CLEAR = enumBound(['none', 'left', 'right', 'all'])
export const WML_FLDCHAR_TYPE = enumBound(['begin', 'separate', 'end'])
export const WML_TBL_LAYOUT = enumBound(['fixed', 'autofit'])
export const WML_TBL_OVERLAP = enumBound(['never', 'overlap'])
export const WML_TBL_STYLE_PR = enumBound([
  'wholeTable',
  'firstRow',
  'lastRow',
  'firstCol',
  'lastCol',
  'band1Vert',
  'band2Vert',
  'band1Horz',
  'band2Horz',
  'neCell',
  'nwCell',
  'seCell',
  'swCell',
])
export const WML_VALIGN = enumBound(['top', 'center', 'bottom'])
export const WML_VERT_ALIGN = enumBound([
  'superscript',
  'subscript',
  'baseline',
])
export const WML_EFFECT = enumBound([
  'none',
  'blinkBackground',
  'lights',
  'shimmer',
  'sparkle',
  'antBlack',
  'antRed',
])
export const WML_EM = enumBound(['none', 'dot', 'comma', 'circle', 'underDot'])
export const WML_FONT_HINT = enumBound(['default', 'eastAsia', 'cs'])
export const WML_THEME_FONT = enumBound([
  'majorEastAsia',
  'minorEastAsia',
  'majorAscii',
  'minorAscii',
  'majorHAnsi',
  'minorHAnsi',
  'majorBidi',
  'minorBidi',
])
export const WML_THEME_COLOR = enumBound([
  'dk1',
  'lt1',
  'dk2',
  'lt2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
  'hlink',
  'folHlink',
  'none',
  'background1',
  'background2',
  'text1',
  'text2',
])
export const WML_ORIENT = enumBound(['portrait', 'landscape'])
export const WML_ZORDER = enumBound(['front', 'back'])
export const WML_PG_DISPLAY = enumBound([
  'allPages',
  'firstPage',
  'notFirstPage',
])
export const WML_PG_OFFSET = enumBound(['text', 'page'])
export const WML_SECT_TYPE = enumBound([
  'nextPage',
  'nextColumn',
  'continuous',
  'evenPage',
  'oddPage',
])
export const WML_HDR_FTR = enumBound(['default', 'first', 'even'])
export const WML_FTN_TYPE = enumBound([
  'normal',
  'separator',
  'continuationSeparator',
  'continuationNotice',
])
export const WML_TEXT_ALIGN = enumBound([
  'top',
  'center',
  'baseline',
  'bottom',
  'auto',
])
export const WML_TEXT_DIR = enumBound([
  'lrTb',
  'tbRl',
  'btLr',
  'lrTbV',
  'tbRlV',
  'tbLrV',
])
export const WML_TIGHTWRAP = enumBound([
  'none',
  'allLines',
  'firstAndLastLine',
  'firstLineOnly',
  'lastLineOnly',
])
export const WML_LN_RESTART = enumBound(['newPage', 'newSection', 'continuous'])
export const WML_DOC_GRID = enumBound([
  'default',
  'lines',
  'linesAndChars',
  'snapToChars',
])
export const WML_FRAME_ANCHOR = enumBound(['margin', 'page', 'text'])
export const WML_FRAME_ALIGN = enumBound([
  'left',
  'center',
  'right',
  'inside',
  'outside',
])
export const WML_FRAME_YSPEC = enumBound([
  'top',
  'center',
  'bottom',
  'inside',
  'outside',
])
export const WML_FRAME_WRAP = enumBound([
  'auto',
  'notBeside',
  'around',
  'none',
  'throughBeside',
  'through',
])
export const WML_DROP_CAP = enumBound(['none', 'margin', 'drop'])
export const WML_STYLE_TYPE = enumBound([
  'paragraph',
  'character',
  'table',
  'numbering',
])
export const WML_FONT_FAMILY = enumBound([
  'auto',
  'decorative',
  'modern',
  'roman',
  'script',
  'swiss',
])
export const WML_PITCH = enumBound(['fixed', 'variable', 'default'])
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
export const WML_ZOOM = enumBound(['none', 'fullPage', 'bestFit', 'textFit'])
export const WML_VIEW = enumBound([
  'none',
  'print',
  'outline',
  'masterPages',
  'normal',
  'web',
])
export const WML_DOC_TYPE = enumBound(['notSpecified', 'letter', 'eMail'])
export const WML_PROOF_STATE = enumBound(['clean', 'dirty'])
export const WML_PROOF_ERR = enumBound([
  'spellStart',
  'spellEnd',
  'gramStart',
  'gramEnd',
  'corrStart',
  'corrEnd',
])
export const WML_SCREEN_SIZE = enumBound([
  '544x376',
  '640x480',
  '720x512',
  '800x600',
  '1024x768',
  '1152x882',
  '1152x900',
  '1280x1024',
  '1600x1200',
  '1800x1440',
  '1920x1200',
])
export const WML_CHAR_SPC = enumBound([
  'doNotCompress',
  'compressPunctuation',
  'compressPunctuationAndJapaneseKana',
])
export const WML_STORE_MAPPED = enumBound(['dateTime', 'text'])
export const WML_CALENDAR = enumBound([
  'gregorian',
  'hijri',
  'hebrew',
  'taiwan',
  'japan',
  'thai',
  'korea',
  'saka',
  'gregorianXlitEnglish',
  'gregorianXlitFrench',
  'none',
])
export const WML_HELP_TYPE = enumBound(['name', 'text'])
export const WML_TEXT_INPUT_TYPE = enumBound([
  'regular',
  'number',
  'date',
  'currentDate',
  'currentTime',
  'calculated',
])
export const WML_LOCK = enumBound([
  'sdtLocked',
  'contentLocked',
  'sdtContentLocked',
  'unlocked',
])
/**
 * `w:appearance` — `hidden` is excluded deliberately: an SDT that renders
 * no placeholder is an invisible carrier, so the value refuses with the
 * rest of the out-of-enumeration set.
 */
export const WML_APPEARANCE = enumBound(['boundingBox', 'tags'])
export const WML_CLR_SCHEME = enumBound([
  'bg1',
  'bg2',
  't1',
  't2',
  'dk1',
  'dk2',
  'lt1',
  'lt2',
  'dark1',
  'dark2',
  'light1',
  'light2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
  'hlink',
  'folHlink',
  'hyperlink',
  'followedHyperlink',
])
export const WML_RUBY_ALIGN = enumBound([
  'center',
  'distributeLetter',
  'distributeSpace',
  'left',
  'right',
  'rightVertical',
])
// Shared bound constants re-exported under WML names for the two tables.
export const WML_INT = INT_BOUND
export const WML_COLOR = COLOR_BOUND
export const WML_HEX2 = HEX2_BOUND
export const WML_HEX4 = HEX4_BOUND
export const WML_HEX8 = HEX8_BOUND
export const WML_HEX20 = HEX20_BOUND
export const WML_HEXFLAGS = HEXFLAGS_BOUND
export const WML_LANG = LANG_BOUND
export const WML_FONT_NAME = FONT_NAME_BOUND
export const WML_TEXT = TEXT_BOUND
export const WML_SHORT_TEXT = SHORT_TEXT_BOUND
export const WML_IDENT = IDENT_BOUND
export const WML_VERSION = VERSION_BOUND
export const WML_CHARSET = CHARSET_BOUND
export const WML_DATE = DATE_BOUND
/** `w:type` — a section type or a form-field input type by context. */
export const WML_TYPE = unionBound([WML_SECT_TYPE, WML_TEXT_INPUT_TYPE])
/** `w:start`/`w:end` — a border type or a numbering integer by context. */
export const WML_BORDER_OR_INT = unionBound([WML_BORDER, INT_BOUND])
