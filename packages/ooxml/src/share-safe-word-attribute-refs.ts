import type { ShareSafeValueBound } from './share-safe-value-bounds'
import { EXTERNAL_BOUND, FLAG_BOUND } from './share-safe-value-bounds'
import {
  WML_BR_CLEAR,
  WML_BR_TYPE,
  WML_FLDCHAR_TYPE,
  WML_FTN_TYPE,
  WML_HDR_FTR,
  WML_HEX8,
  WML_IDENT,
  WML_INT,
  WML_RUBY_ALIGN,
} from './share-safe-word-attribute-values'

const ONOFF = FLAG_BOUND
const ID: ReadonlyMap<string, ShareSafeValueBound> = new Map([['id', WML_INT]])

/**
 * The reference attribute surface — identifiers, cross-references, field
 * machinery and revision hooks — mapped element → attribute → bound.
 * `EXTERNAL_BOUND` marks values a dedicated validator owns: `w:instr`
 * passes through the field classifier, bookmark names through the
 * `bm<n>` rename, and `w:anchor` through the anchor-resolution check —
 * none is a free channel, but none is boundable here either.
 */
export const WML_REFERENCE_ATTRIBUTE_BOUNDS: ReadonlyArray<
  readonly [string, ReadonlyMap<string, ShareSafeValueBound>]
> = [
  ['abstractNum', new Map([['abstractNumId', WML_INT]])],
  ['abstractNumId', new Map([['val', WML_INT]])],
  ['num', new Map([['numId', WML_INT]])],
  ['numId', new Map([['val', WML_INT]])],
  [
    'lvl',
    new Map([
      ['ilvl', WML_INT],
      ['tentative', ONOFF],
      ['tplc', WML_HEX8],
    ]),
  ],
  ['lvlOverride', new Map([['ilvl', WML_INT]])],
  [
    'numPicBullet',
    new Map([
      ['numPicBulletId', WML_INT],
      ['numberingId', WML_INT],
    ]),
  ],
  [
    'bookmarkStart',
    new Map([
      ['id', WML_INT],
      ['colFirst', WML_INT],
      ['colLast', WML_INT],
      ['name', EXTERNAL_BOUND],
    ]),
  ],
  ['bookmarkEnd', ID],
  [
    'footnoteReference',
    new Map([
      ['id', WML_INT],
      ['customMarkFollows', ONOFF],
    ]),
  ],
  [
    'endnoteReference',
    new Map([
      ['id', WML_INT],
      ['customMarkFollows', ONOFF],
    ]),
  ],
  [
    'footnote',
    new Map([
      ['id', WML_INT],
      ['type', WML_FTN_TYPE],
    ]),
  ],
  [
    'endnote',
    new Map([
      ['id', WML_INT],
      ['type', WML_FTN_TYPE],
    ]),
  ],
  ['headerReference', new Map([['type', WML_HDR_FTR]])],
  ['footerReference', new Map([['type', WML_HDR_FTR]])],
  [
    'hyperlink',
    new Map([
      ['anchor', EXTERNAL_BOUND],
      ['history', ONOFF],
      ['tgtFrame', WML_IDENT],
    ]),
  ],
  [
    'fldSimple',
    new Map([
      ['instr', EXTERNAL_BOUND],
      ['dirty', ONOFF],
      ['fldLock', ONOFF],
    ]),
  ],
  [
    'fldChar',
    new Map([
      ['fldCharType', WML_FLDCHAR_TYPE],
      ['dirty', ONOFF],
      ['fldLock', ONOFF],
    ]),
  ],
  [
    'br',
    new Map([
      ['type', WML_BR_TYPE],
      ['clear', WML_BR_CLEAR],
    ]),
  ],
  [
    'paperSrc',
    new Map([
      ['first', WML_INT],
      ['other', WML_INT],
    ]),
  ],
  ['rubyAlign', new Map([['val', WML_RUBY_ALIGN]])],
  ['hps', new Map([['val', WML_INT]])],
  ['hpsRaise', new Map([['val', WML_INT]])],
  ['hpsBaseText', new Map([['val', WML_INT]])],
]

export default WML_REFERENCE_ATTRIBUTE_BOUNDS
