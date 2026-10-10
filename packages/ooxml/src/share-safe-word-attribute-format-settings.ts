/**
 * Settings, style-definition and structured-document-tag formatting
 * attributes — the element → attribute → value bound table slice for
 * `word/settings.xml`, `word/styles.xml` and SDT payload surfaces.
 * Consumed by `WML_FORMAT_ATTRIBUTE_BOUNDS` in
 * `share-safe-word-attribute-format.ts`.
 */
import type { ShareSafeValueBound } from './share-safe-value-bounds'
import {
  WML_ZOOM,
  WML_VIEW,
  WML_DOC_TYPE,
  WML_PROOF_STATE,
  WML_PROOF_ERR,
  WML_INT,
  WML_TEXT,
  WML_CHAR_SPC,
  WML_SHORT_TEXT,
  WML_CLR_SCHEME,
  WML_HEXFLAGS,
  WML_SCREEN_SIZE,
  WML_IDENT,
  WML_VERSION,
  WML_STYLE_TYPE,
  WML_LOCK,
  WML_STORE_MAPPED,
  WML_CALENDAR,
  WML_LANG,
  WML_DATE,
  WML_APPEARANCE,
  WML_HELP_TYPE,
} from './share-safe-word-attribute-values'
import { FLAG_BOUND } from './share-safe-value-bounds'

const ONOFF = FLAG_BOUND

export const WML_FORMAT_SETTINGS_ATTRIBUTE_BOUNDS: ReadonlyArray<
  readonly [string, ReadonlyMap<string, ShareSafeValueBound>]
> = [
  [
    'zoom',
    new Map([
      ['val', WML_ZOOM],
      ['percent', WML_INT],
    ]),
  ],
  ['view', new Map([['val', WML_VIEW]])],
  ['documentType', new Map([['val', WML_DOC_TYPE]])],
  [
    'proofState',
    new Map([
      ['spelling', WML_PROOF_STATE],
      ['grammar', WML_PROOF_STATE],
    ]),
  ],
  ['proofErr', new Map([['type', WML_PROOF_ERR]])],
  ['defaultTabStop', new Map([['val', WML_INT]])],
  ['autoHyphenation', new Map([['val', ONOFF]])],
  ['consecutiveHyphenLimit', new Map([['val', WML_INT]])],
  ['hyphenationZone', new Map([['val', WML_INT]])],
  ['doNotHyphenateCaps', new Map([['val', ONOFF]])],
  ['summaryLength', new Map([['val', WML_INT]])],
  ['clickAndTypeStyle', new Map([['val', WML_TEXT]])],
  ['defaultTableStyle', new Map([['val', WML_TEXT]])],
  ['characterSpacingControl', new Map([['val', WML_CHAR_SPC]])],
  ['decimalSymbol', new Map([['val', WML_SHORT_TEXT]])],
  ['listSeparator', new Map([['val', WML_SHORT_TEXT]])],
  [
    'clrSchemeMapping',
    new Map([
      ['bg1', WML_CLR_SCHEME],
      ['bg2', WML_CLR_SCHEME],
      ['t1', WML_CLR_SCHEME],
      ['t2', WML_CLR_SCHEME],
      ['accent1', WML_CLR_SCHEME],
      ['accent2', WML_CLR_SCHEME],
      ['accent3', WML_CLR_SCHEME],
      ['accent4', WML_CLR_SCHEME],
      ['accent5', WML_CLR_SCHEME],
      ['accent6', WML_CLR_SCHEME],
      ['hyperlink', WML_CLR_SCHEME],
      ['followedHyperlink', WML_CLR_SCHEME],
    ]),
  ],
  [
    'activeWritingStyle',
    new Map([
      ['appName', WML_TEXT],
      ['nat', ONOFF],
      ['checkStyle', ONOFF],
      ['dllVersion', WML_INT],
      ['vendorID', WML_INT],
    ]),
  ],
  ['stylePaneFormatFilter', new Map([['val', WML_HEXFLAGS]])],
  ['stylePaneSortMethod', new Map([['val', WML_HEXFLAGS]])],
  ['targetScreenSz', new Map([['val', WML_SCREEN_SIZE]])],
  ['pixelsPerInch', new Map([['val', WML_INT]])],
  [
    'compatSetting',
    new Map([
      ['name', WML_IDENT],
      ['uri', WML_TEXT],
      ['val', WML_INT],
    ]),
  ],
  ['minVersion', new Map([['val', WML_VERSION]])],
  [
    'style',
    new Map([
      ['type', WML_STYLE_TYPE],
      ['styleId', WML_TEXT],
      ['default', ONOFF],
      ['customStyle', ONOFF],
    ]),
  ],
  ['pStyle', new Map([['val', WML_TEXT]])],
  ['rStyle', new Map([['val', WML_TEXT]])],
  ['tblStyle', new Map([['val', WML_TEXT]])],
  ['basedOn', new Map([['val', WML_TEXT]])],
  ['next', new Map([['val', WML_TEXT]])],
  ['link', new Map([['val', WML_TEXT]])],
  ['name', new Map([['val', WML_TEXT]])],
  ['uiPriority', new Map([['val', WML_INT]])],
  ['divId', new Map([['val', WML_INT]])],
  ['ilvl', new Map([['val', WML_INT]])],
  ['lock', new Map([['val', WML_LOCK]])],
  [
    'latentStyles',
    new Map([
      ['count', WML_INT],
      ['defLockedState', ONOFF],
      ['defUIPriority', WML_INT],
      ['defSemiHidden', ONOFF],
      ['defUnhideWhenUsed', ONOFF],
      ['defQFormat', ONOFF],
    ]),
  ],
  [
    'lsdException',
    new Map([
      ['name', WML_TEXT],
      ['locked', ONOFF],
      ['uiPriority', WML_INT],
      ['semiHidden', ONOFF],
      ['unhideWhenUsed', ONOFF],
      ['qFormat', ONOFF],
    ]),
  ],
  ['div', new Map([['id', WML_INT]])],
  ['storeMappedDataAs', new Map([['val', WML_STORE_MAPPED]])],
  ['calendar', new Map([['val', WML_CALENDAR]])],
  ['lid', new Map([['val', WML_LANG]])],
  ['dateFormat', new Map([['val', WML_TEXT]])],
  ['fullDate', new Map([['val', WML_DATE]])],
  ['date', new Map([['fullDate', WML_DATE]])],
  ['appearance', new Map([['val', WML_APPEARANCE]])],
  ['label', new Map([['val', WML_TEXT]])],
  ['alias', new Map([['val', WML_TEXT]])],
  ['tag', new Map([['val', WML_TEXT]])],
  ['id', new Map([['val', WML_INT]])],
  [
    'docVar',
    new Map([
      ['name', WML_IDENT],
      ['val', WML_TEXT],
    ]),
  ],
  [
    'helpText',
    new Map([
      ['type', WML_HELP_TYPE],
      ['val', WML_TEXT],
    ]),
  ],
  [
    'statusText',
    new Map([
      ['type', WML_HELP_TYPE],
      ['val', WML_TEXT],
    ]),
  ],
  ['entryMacro', new Map([['val', WML_IDENT]])],
  ['exitMacro', new Map([['val', WML_IDENT]])],
  ['format', new Map([['val', WML_TEXT]])],
  [
    'listItem',
    new Map([
      ['val', WML_TEXT],
      ['displayText', WML_TEXT],
      ['value', WML_TEXT],
    ]),
  ],
  ['listEntry', new Map([['val', WML_TEXT]])],
  ['maxLength', new Map([['val', WML_INT]])],
  ['size', new Map([['val', WML_INT]])],
  ['text', new Map([['multiLine', ONOFF]])],
  ['tabIndex', new Map([['val', WML_INT]])],
]

export default WML_FORMAT_SETTINGS_ATTRIBUTE_BOUNDS
