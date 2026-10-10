/**
 * The declared enumerations and element groupings the embedded attribute
 * bounds in `share-safe-drawing-attributes.ts` draw on. These are plain
 * value vocabularies — the file carries no logic, so the tables stay
 * readable next to the schema surface they mirror.
 */

export const SCHEME_CLRS = [
  'tx1',
  'bg1',
  'tx2',
  'bg2',
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
  'phClr',
] as const

export const DASH_VALUES = [
  'solid',
  'dot',
  'dash',
  'lgDash',
  'dashDot',
  'lgDashDot',
  'lgDashDotDot',
  'sysDash',
  'sysDot',
  'sysDashDot',
  'sysDashDotDot',
] as const

export const UNDERLINE_VALUES = [
  'none',
  'words',
  'sng',
  'dbl',
  'heavy',
  'dotted',
  'dottedHeavy',
  'dash',
  'dashHeavy',
  'dashLong',
  'dashLongHeavy',
  'dotDash',
  'dotDashHeavy',
  'dotDotDash',
  'dotDotDashHeavy',
  'wavy',
  'wavyHeavy',
  'wavyDbl',
] as const

export const TEXT_STRIKE_VALUES = [
  'noStrike',
  'sngStrike',
  'dblStrike',
] as const

export const TEXT_CAP_VALUES = ['none', 'small', 'all'] as const

export const LINE_CAP_VALUES = ['flat', 'sq', 'rnd'] as const

export const LINE_CMPD_VALUES = [
  'sng',
  'dbl',
  'thickThin',
  'thinThick',
  'tri',
] as const

export const LINE_ALIGN_VALUES = ['ctr', 'in'] as const

export const PARA_ALIGN_VALUES = [
  'l',
  'ctr',
  'r',
  'just',
  'justLow',
  'dist',
  'thaiDist',
] as const

export const TAB_ALIGN_VALUES = ['l', 'ctr', 'r', 'dec'] as const

export const RECT_ALIGN_VALUES = [
  'tl',
  't',
  'tr',
  'l',
  'ctr',
  'r',
  'bl',
  'b',
  'br',
] as const

export const ARROW_TYPE_VALUES = [
  'none',
  'triangle',
  'stealth',
  'diamond',
  'oval',
  'arrow',
] as const

export const ARROW_SIZE_VALUES = ['sm', 'med', 'lg'] as const

export const PATH_FILL_VALUES = [
  'none',
  'norm',
  'lighten',
  'lightenLess',
  'darken',
  'darkenLess',
] as const

export const PATH_SHADE_VALUES = ['rect', 'circle', 'shape'] as const

export const BW_MODE_VALUES = [
  'auto',
  'clr',
  'gray',
  'ltGray',
  'invGray',
  'grayWhite',
  'blackGray',
  'blackWhite',
  'black',
  'hidden',
  'white',
] as const

export const BLIP_CSTATE_VALUES = [
  'email',
  'screen',
  'print',
  'hqprint',
  'none',
] as const

/** `ST_RelFromH` — `wp:positionH@relativeFrom` values, verbatim. */
export const POS_FROM_H_VALUES = [
  'margin',
  'page',
  'column',
  'character',
  'leftMargin',
  'rightMargin',
  'insideMargin',
  'outsideMargin',
] as const

/** `ST_RelFromV` — `wp:positionV@relativeFrom` values, verbatim. */
export const POS_FROM_V_VALUES = [
  'margin',
  'page',
  'paragraph',
  'line',
  'topMargin',
  'bottomMargin',
  'insideMargin',
  'outsideMargin',
] as const

export const SIZE_REL_FROM_VALUES = ['margin', 'page'] as const

export const VERT_TEXT_VALUES = [
  'horz',
  'vert',
  'vert270',
  'wordArtVert',
  'eaVert',
  'mongolianVert',
  'wordArtVertRtl',
] as const

export const TEXT_ANCHOR_VALUES = ['t', 'ctr', 'b', 'just', 'dist'] as const

/** `ST_TextHorzOverflowType` — `horzOverflow` declares two values only. */
export const TEXT_HORZ_OVERFLOW_VALUES = ['overflow', 'clip'] as const

/** `ST_TextVertOverflowType` — `vertOverflow` additionally allows ellipsis. */
export const TEXT_VERT_OVERFLOW_VALUES = [
  'overflow',
  'clip',
  'ellipsis',
] as const

export const FONT_ALIGN_VALUES = ['auto', 't', 'b', 'ctr', 'base'] as const

export const TEXT_WRAP_VALUES = ['none', 'square'] as const

export const WRAP_TEXT_VALUES = [
  'bothSides',
  'left',
  'right',
  'largest',
] as const

export const FONT_REF_INDEX_VALUES = ['major', 'minor', 'none'] as const

/** `ST_BlendMode` — `a:fillOverlay@blend` values, verbatim. */
export const BLEND_MODE_VALUES = [
  'over',
  'mult',
  'screen',
  'darken',
  'lighten',
] as const

export const FLIP_VALUES = ['none', 'x', 'y', 'xy'] as const

/**
 * Unqualified attribute names whose value is an integer wherever they
 * appear — coordinates, sizes, angles, distances and scalar options.
 */
export const INT_ATTRIBUTES = [
  'x',
  'y',
  'cx',
  'cy',
  'rot',
  'h',
  'ang',
  'sx',
  'sy',
  'kx',
  'ky',
  'stA',
  'swAng',
  'endA',
  'endPos',
  'stPos',
  'fadeDir',
  'blurRad',
  'l',
  't',
  'r',
  'lat',
  'lon',
  'rev',
  'extrusionH',
  'contourW',
  'z',
  'tx',
  'ty',
  'dpi',
  'dist',
  'distT',
  'distB',
  'distL',
  'distR',
  'pos',
  'ver',
  'relativeHeight',
  'marL',
  'marR',
  'marT',
  'marB',
  'lIns',
  'tIns',
  'rIns',
  'bIns',
  'numCol',
  'spcCol',
  'lvl',
  'indent',
  'defTabSz',
  'sz',
  'kern',
  'spc',
  'baseline',
  'pctWidth',
  'pctHeight',
  'fontScale',
  'lnSpcReduction',
  'g',
  'a',
  'hue',
  'sat',
  'lum',
  'thresh',
  'count',
] as const

/** Unqualified attribute names whose value is an on/off flag. */
export const FLAG_ATTRIBUTES = [
  'flipH',
  'flipV',
  'rotWithShape',
  'simplePos',
  'scaled',
  'extrusionOk',
  'behindDoc',
  'locked',
  'layoutInCell',
  'allowOverlap',
  'preferRelativeResize',
  'rtl',
  'eaLnBrk',
  'latinLnBrk',
  'hangingPunct',
  'anchorCtr',
  'forceAA',
  'upright',
  'compatLnSpc',
  'spcFirstLastPara',
  'rtlCol',
  'fromWordArt',
  'normalizeH',
  'smtClean',
  'err',
] as const

/** Drawing run properties the text-formatting scopes apply to. */
export const TEXT_RUN_PROPS = ['rPr', 'defRPr', 'endParaRPr'] as const

/**
 * `a:buAutoNum` numbering schemes — `ST_TextAutonumberScheme` exactly.
 * The wider `w:numFmt` list does not apply here: DrawingML bullets
 * declare only these scheme names.
 */
export const AUTONUM_VALUES = [
  'alphaLcParenBoth',
  'alphaUcParenBoth',
  'alphaLcParenR',
  'alphaUcParenR',
  'alphaLcPeriod',
  'alphaUcPeriod',
  'arabicParenBoth',
  'arabicParenR',
  'arabicPeriod',
  'arabicPlain',
  'arabic1Minus',
  'arabic2Minus',
  'arabicDbPeriod',
  'arabicDbPlain',
  'romanLcParenBoth',
  'romanUcParenBoth',
  'romanLcParenR',
  'romanUcParenR',
  'romanLcPeriod',
  'romanUcPeriod',
  'circleNumDbPlain',
  'circleNumWdBlackPlain',
  'circleNumWdWhitePlain',
  'hebrew2Minus',
  'thaiAlphaPeriod',
  'thaiAlphaParenR',
  'thaiAlphaParenBoth',
  'thaiNumPeriod',
  'thaiNumParenR',
  'thaiNumParenBoth',
  'hindiAlphaPeriod',
  'hindiNumPeriod',
  'hindiNumParenR',
  'hindiAlpha1Period',
  'ea1ChsPeriod',
  'ea1ChsPlain',
  'ea1ChtPeriod',
  'ea1ChtPlain',
  'ea1JpnChsDbPeriod',
  'ea1JpnKorPlain',
  'ea1JpnKorPeriod',
] as const

/**
 * Paragraph property carriers — `a:pPr`, its defaults and the nine level
 * shapes share the paragraph attribute surface (`algn`, `marL`, …).
 */
export const PARA_PROPS_ELEMENTS = [
  'pPr',
  'defPPr',
  'lvl1pPr',
  'lvl2pPr',
  'lvl3pPr',
  'lvl4pPr',
  'lvl5pPr',
  'lvl6pPr',
  'lvl7pPr',
  'lvl8pPr',
  'lvl9pPr',
] as const

/** Font declarations carrying face, script and codepage metadata. */
export const FONT_FACE_ELEMENTS = [
  'latin',
  'ea',
  'cs',
  'font',
  'sym',
  'buFont',
  'buFontTx',
] as const

/** Lock elements carrying `no*` flag attributes. */
export const LOCK_ELEMENTS = [
  'graphicFrameLocks',
  'spLocks',
  'grpSpLocks',
  'cxnSpLocks',
] as const

/** Shadow effects whose `dir` is an angle rather than a slot name. */
export const SHADOW_ELEMENTS = [
  'outerShdw',
  'innerShdw',
  'prstShdw',
  'reflection',
] as const

/**
 * `a:` elements whose `val` carries the unrestricted `ST_Percentage`
 * union (a signed thousandths integer or a signed `N%` literal).
 * Elements whose `val` is a narrower percentage type — fixed range,
 * positive-only, angle, spacing or bullet size — bind their own bound
 * in `share-safe-drawing-attributes.ts`; `comp`/`inv`/`gray`/`gamma`/
 * `invGamma` declare no attributes at all, and `sepia` is not an
 * element the schema declares.
 */
export const PERCENT_VAL_ELEMENTS = [
  'lum',
  'lumMod',
  'lumOff',
  'satMod',
  'satOff',
  'sat',
  'red',
  'green',
  'blue',
  'redOff',
  'redMod',
  'greenOff',
  'greenMod',
  'blueOff',
  'blueMod',
] as const

/**
 * `a:` elements whose `val` is `ST_PositiveFixedPercentage` — a
 * thousandths integer in `[0, 100000]` or a `N%`/`N.NN%` literal from
 * 0 to 100.
 */
export const POSITIVE_FIXED_PERCENT_VAL_ELEMENTS = [
  'tint',
  'shade',
  'alpha',
] as const

/** `a:lightRig dir` — the eight light directions. */
export const LIGHT_RIG_DIRECTION_VALUES = [
  'tl',
  't',
  'tr',
  'l',
  'r',
  'bl',
  'b',
  'br',
] as const
