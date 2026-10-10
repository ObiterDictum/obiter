/**
 * Shared value-bound machinery for the share-safe attribute policy. Every
 * declared attribute slot — a `w:` attribute on a WordprocessingML element,
 * an unqualified attribute on an embedded (DrawingML/OMML) element, or an
 * `m:` attribute on a math element — names one bound: an exact enumeration,
 * a lexical shape that cannot carry text, or `external`, which marks the
 * value as owned by a dedicated validator (field instructions, bookmark
 * renames, anchor targets) rather than a free channel.
 *
 * The transform applies the same verdict the byte verifier re-derives from
 * emitted bytes, so a bound lives here exactly once.
 */
export type ShareSafeValueBound =
  | { kind: 'enum'; values: ReadonlySet<string> }
  | { kind: 'shape'; pattern: RegExp }
  | { kind: 'int-range'; min: number; max: number }
  | { kind: 'external' }
  | { kind: 'union'; bounds: readonly ShareSafeValueBound[] }

export function enumBound(values: readonly string[]): ShareSafeValueBound {
  return { kind: 'enum', values: new Set(values) }
}

export function shapeBound(pattern: RegExp): ShareSafeValueBound {
  return { kind: 'shape', pattern }
}

/**
 * An `xsd:int` restricted to a numeric interval — the `minInclusive` /
 * `maxInclusive` bounds the percentage and measure types declare, which
 * a lexical pattern cannot express without losing the grammar.
 */
export function intRangeBound(min: number, max: number): ShareSafeValueBound {
  return { kind: 'int-range', min, max }
}

/**
 * An element name reused across contexts carries the union of its meanings
 * — `w:start` is a border type under `w:pBdr` and a starting number under
 * `w:lvl`. The bound accepts a value either context could have produced;
 * the policy checks values, not schema placement.
 */
export function unionBound(
  bounds: readonly ShareSafeValueBound[],
): ShareSafeValueBound {
  return { kind: 'union', bounds }
}

/** A value owned by another validator — the bound itself keeps it. */
export const EXTERNAL_BOUND: ShareSafeValueBound = { kind: 'external' }

export function boundAllows(
  bound: ShareSafeValueBound,
  value: string,
): boolean {
  switch (bound.kind) {
    case 'enum':
      return bound.values.has(value)
    case 'shape':
      return bound.pattern.test(value)
    case 'int-range': {
      if (!/^-?\d{1,19}$/u.test(value)) return false
      const parsed = Number(value)
      return parsed >= bound.min && parsed <= bound.max
    }
    case 'external':
      return true
    case 'union':
      return bound.bounds.some((candidate) => boundAllows(candidate, value))
  }
}

/** A signed integer — measures, identifiers, positions, counts. */
export const INT_BOUND = shapeBound(/^-?\d{1,19}$/u)

/** An unsigned integer — percentages and counts that cannot be negative. */
export const UINT_BOUND = shapeBound(/^\d{1,19}$/u)

/** The six spellings of a boolean across OOXML simple types. */
export const FLAG_BOUND = enumBound(['0', '1', 'true', 'false', 'on', 'off'])

/** A two-digit hex byte — `themeShade`/`themeTint` factors. */
export const HEX2_BOUND = shapeBound(/^[0-9A-Fa-f]{2}$/u)

/** A four-digit hex value — `tblLook` flags, `w:sym` code points. */
export const HEX4_BOUND = shapeBound(/^[0-9A-Fa-f]{4}$/u)

/** An eight-digit hex value — `nsid`/`tmpl`/`usb`/`csb` signatures. */
export const HEX8_BOUND = shapeBound(/^[0-9A-Fa-f]{8}$/u)

/** A twenty-digit hex value — `panose1` font signatures. */
export const HEX20_BOUND = shapeBound(/^[0-9A-Fa-f]{20}$/u)

/** An `RRGGBB` colour or the `auto` keyword. */
export const COLOR_BOUND = shapeBound(/^[0-9A-Fa-f]{6}$|^auto$/u)

/**
 * A bounded alphanumeric token — preset-like names in slots whose full
 * enumeration is not worth pinning.
 */
export const TOKEN_BOUND = shapeBound(/^[A-Za-z0-9]{1,32}$/u)

/** A BCP-47-style language tag. */
export const LANG_BOUND = shapeBound(
  /^[A-Za-z0-9]{1,8}(?:-[A-Za-z0-9]{1,8}){0,7}$/u,
)

/**
 * A font or typeface name — letters, digits, punctuation and non-ASCII
 * scripts (`ＭＳ 明朝`) up to a display-sane length.
 */
export const FONT_NAME_BOUND = shapeBound(/^[^<>&"']{0,64}$/u)

/**
 * Bounded free text — visible/semantic content the copy legitimately
 * carries (style names, level text, format masks, help text). Control
 * characters are the only thing excluded; length is capped.
 */
export const TEXT_BOUND = shapeBound(/^[\t\n\r -￿]{0,255}$/u)

/** A short bounded string — symbols, separators, short captions. */
export const SHORT_TEXT_BOUND = shapeBound(/^.{0,8}$/u)

/** A dotted identifier — macro names, document-variable names. */
export const IDENT_BOUND = shapeBound(/^[A-Za-z_][\w.]{0,63}$/u)

/** A braced GUID — field identifiers, drawing instance ids. */
export const GUID_BOUND = shapeBound(
  /^\{[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}\}$/u,
)

/** An ISO-8601-style date — `w:date w:fullDate` stamps. */
export const DATE_BOUND = shapeBound(/^\d{4}-\d{2}-\d{2}T[^<>&"']{0,32}$/u)

/** A version string — `w:minVersion` values such as `15.0`. */
export const VERSION_BOUND = shapeBound(/^\d{1,3}(?:\.\d{1,6})?$/u)

/** An `x`-prefixed or decimal codepage number — `w:charset`. */
export const CHARSET_BOUND = shapeBound(/^x?[0-9A-Fa-f]{1,4}$|^-?\d{1,5}$/u)

/** A hex bitmask — style-pane filter flags. */
export const HEXFLAGS_BOUND = shapeBound(/^[0-9A-Fa-f]{1,8}$/u)
