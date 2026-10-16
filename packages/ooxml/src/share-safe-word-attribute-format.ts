/**
 * Run and paragraph formatting attributes — the element → attribute →
 * value bound table slice covering borders, shading, justification,
 * tabs, spacing, indentation, font declarations and run effects. Layout
 * and settings slices live in their sibling modules; the assembled
 * `WML_FORMAT_ATTRIBUTE_BOUNDS` re-exports all three.
 */
import type { ShareSafeValueBound } from './share-safe-value-bounds'
import {
  WML_CHARSET,
  WML_COLOR,
  WML_EFFECT,
  WML_EM,
  WML_FONT_FAMILY,
  WML_FONT_HINT,
  WML_FONT_NAME,
  WML_HEX2,
  WML_HEX4,
  WML_HEX8,
  WML_HEX20,
  WML_HIGHLIGHT,
  WML_INT,
  WML_JC,
  WML_LANG,
  WML_LINE_RULE,
  WML_PITCH,
  WML_PTAB_ALIGN,
  WML_PTAB_LEADER,
  WML_PTAB_REL,
  WML_SHD,
  WML_TAB_JC,
  WML_TAB_LEADER,
  WML_TBL_WIDTH,
  WML_TEXT_ALIGN,
  WML_TEXT_DIR,
  WML_THEME_COLOR,
  WML_THEME_FONT,
  WML_TIGHTWRAP,
  WML_UNDERLINE,
  WML_VERT_ALIGN,
} from './share-safe-word-attribute-values'
import {
  WML_BORDER,
  WML_BORDER_OR_INT,
} from './share-safe-word-attribute-borders'
import { WML_FORMAT_LAYOUT_ATTRIBUTE_BOUNDS } from './share-safe-word-attribute-format-layout'
import { WML_FORMAT_SETTINGS_ATTRIBUTE_BOUNDS } from './share-safe-word-attribute-format-settings'
import { FLAG_BOUND } from './share-safe-value-bounds'

const ONOFF = FLAG_BOUND

// `w:` and `w:type` belong only where a border element doubles as a
// cell-margin carrier — the six `w:tblCellMar` slots.
const MARGIN_BORDER_ELEMENTS = new Set([
  'top',
  'left',
  'bottom',
  'right',
  'start',
  'end',
])
const MARGIN_BORDER_ATTRIBUTES: ReadonlyArray<
  readonly [string, ShareSafeValueBound]
> = [
  ['w', WML_INT],
  ['type', WML_TBL_WIDTH],
]

const WML_FORMAT_TEXT_ATTRIBUTE_BOUNDS: ReadonlyArray<
  readonly [string, ReadonlyMap<string, ShareSafeValueBound>]
> = [
  ...(
    [
      'top',
      'left',
      'bottom',
      'right',
      'start',
      'end',
      'between',
      'bar',
      'insideH',
      'insideV',
      'bdr',
    ] as const
  ).map(
    (element): readonly [string, ReadonlyMap<string, ShareSafeValueBound>] => [
      element,
      new Map([
        // `w:start`/`w:end` double as numbering bound attributes in
        // other contexts; as border values they take the border enum,
        // and `w:ind`/`w:lvl` numeric uses land through the union.
        [
          'val',
          element === 'start' || element === 'end'
            ? WML_BORDER_OR_INT
            : WML_BORDER,
        ],
        ['sz', WML_INT],
        ['space', WML_INT],
        ['color', WML_COLOR],
        ['themeColor', WML_THEME_COLOR],
        ['themeShade', WML_HEX2],
        ['themeTint', WML_HEX2],
        ['shadow', ONOFF],
        ['frame', ONOFF],
        ...(MARGIN_BORDER_ELEMENTS.has(element)
          ? MARGIN_BORDER_ATTRIBUTES
          : []),
      ]),
    ],
  ),
  [
    'shd',
    new Map([
      ['val', WML_SHD],
      ['fill', WML_COLOR],
      ['color', WML_COLOR],
      ['themeColor', WML_THEME_COLOR],
      ['themeFill', WML_THEME_COLOR],
      ['themeShade', WML_HEX2],
      ['themeTint', WML_HEX2],
      ['themeFillShade', WML_HEX2],
      ['themeFillTint', WML_HEX2],
    ]),
  ],
  [
    'color',
    new Map([
      ['val', WML_COLOR],
      ['themeColor', WML_THEME_COLOR],
      ['themeShade', WML_HEX2],
      ['themeTint', WML_HEX2],
    ]),
  ],
  ['jc', new Map([['val', WML_JC]])],
  ['lvlJc', new Map([['val', WML_JC]])],
  [
    'tab',
    new Map([
      ['val', WML_TAB_JC],
      ['leader', WML_TAB_LEADER],
      ['pos', WML_INT],
    ]),
  ],
  [
    'ptab',
    new Map([
      ['alignment', WML_PTAB_ALIGN],
      ['relativeTo', WML_PTAB_REL],
      ['leader', WML_PTAB_LEADER],
      ['indentation', WML_INT],
    ]),
  ],
  [
    'spacing',
    new Map([
      ['before', WML_INT],
      ['after', WML_INT],
      ['beforeLines', WML_INT],
      ['afterLines', WML_INT],
      ['beforeAutospacing', ONOFF],
      ['afterAutospacing', ONOFF],
      ['line', WML_INT],
      ['lineRule', WML_LINE_RULE],
      ['val', WML_INT],
    ]),
  ],
  [
    'ind',
    new Map([
      ['left', WML_INT],
      ['right', WML_INT],
      ['start', WML_INT],
      ['end', WML_INT],
      ['hanging', WML_INT],
      ['firstLine', WML_INT],
      ['leftChars', WML_INT],
      ['rightChars', WML_INT],
      ['startChars', WML_INT],
      ['endChars', WML_INT],
      ['hangingChars', WML_INT],
      ['firstLineChars', WML_INT],
    ]),
  ],
  [
    'rFonts',
    new Map([
      ['ascii', WML_FONT_NAME],
      ['hAnsi', WML_FONT_NAME],
      ['eastAsia', WML_FONT_NAME],
      ['cs', WML_FONT_NAME],
      ['asciiTheme', WML_THEME_FONT],
      ['hAnsiTheme', WML_THEME_FONT],
      ['eastAsiaTheme', WML_THEME_FONT],
      ['cstheme', WML_THEME_FONT],
      ['hint', WML_FONT_HINT],
    ]),
  ],
  ['font', new Map([['name', WML_FONT_NAME]])],
  ['altName', new Map([['val', WML_FONT_NAME]])],
  ['panose1', new Map([['val', WML_HEX20]])],
  ['charset', new Map([['val', WML_CHARSET]])],
  ['family', new Map([['val', WML_FONT_FAMILY]])],
  ['pitch', new Map([['val', WML_PITCH]])],
  [
    'sig',
    new Map([
      ['usb0', WML_HEX8],
      ['usb1', WML_HEX8],
      ['usb2', WML_HEX8],
      ['usb3', WML_HEX8],
      ['csb0', WML_HEX8],
      ['csb1', WML_HEX8],
    ]),
  ],
  ['kern', new Map([['val', WML_INT]])],
  ['position', new Map([['val', WML_INT]])],
  ['sz', new Map([['val', WML_INT]])],
  ['szCs', new Map([['val', WML_INT]])],
  ['fitText', new Map([['val', WML_INT]])],
  ['w', new Map([['val', WML_INT]])],
  [
    'u',
    new Map([
      ['val', WML_UNDERLINE],
      ['color', WML_COLOR],
      ['themeColor', WML_THEME_COLOR],
      ['themeShade', WML_HEX2],
      ['themeTint', WML_HEX2],
    ]),
  ],
  ['em', new Map([['val', WML_EM]])],
  ['effect', new Map([['val', WML_EFFECT]])],
  ['highlight', new Map([['val', WML_HIGHLIGHT]])],
  ['vertAlign', new Map([['val', WML_VERT_ALIGN]])],
  ['outlineLvl', new Map([['val', WML_INT]])],
  ['textDirection', new Map([['val', WML_TEXT_DIR]])],
  ['textAlignment', new Map([['val', WML_TEXT_ALIGN]])],
  ['textboxTightWrap', new Map([['val', WML_TIGHTWRAP]])],
  [
    'lang',
    new Map([
      ['val', WML_LANG],
      ['eastAsia', WML_LANG],
      ['bidi', WML_LANG],
    ]),
  ],
  [
    'themeFontLang',
    new Map([
      ['val', WML_LANG],
      ['eastAsia', WML_LANG],
      ['bidi', WML_LANG],
    ]),
  ],
  [
    'sym',
    new Map([
      ['font', WML_FONT_NAME],
      ['char', WML_HEX4],
    ]),
  ],
]

/**
 * The formatting attribute surface, mapped element → attribute → value
 * bound: layout, borders, shading, spacing, font and frame attributes the
 * copy may carry, each pinned to the enumeration or lexical shape its
 * simple type declares. An attribute a table does not list is not
 * formatting a reader needs; a declared attribute whose value falls
 * outside its bound is a payload, not a format choice.
 */
export const WML_FORMAT_ATTRIBUTE_BOUNDS: ReadonlyArray<
  readonly [string, ReadonlyMap<string, ShareSafeValueBound>]
> = [
  ...WML_FORMAT_TEXT_ATTRIBUTE_BOUNDS,
  ...WML_FORMAT_LAYOUT_ATTRIBUTE_BOUNDS,
  ...WML_FORMAT_SETTINGS_ATTRIBUTE_BOUNDS,
]

export default WML_FORMAT_ATTRIBUTE_BOUNDS
