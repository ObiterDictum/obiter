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

export function intRangeBound(min: number, max: number): ShareSafeValueBound {
  return { kind: 'int-range', min, max }
}

export function unionBound(
  bounds: readonly ShareSafeValueBound[],
): ShareSafeValueBound {
  return { kind: 'union', bounds }
}

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

export const INT_BOUND = shapeBound(/^-?\d{1,19}$/u)

export const UINT_BOUND = shapeBound(/^\d{1,19}$/u)

export const FLAG_BOUND = enumBound(['0', '1', 'true', 'false', 'on', 'off'])

export const HEX2_BOUND = shapeBound(/^[0-9A-Fa-f]{2}$/u)

export const HEX4_BOUND = shapeBound(/^[0-9A-Fa-f]{4}$/u)

export const HEX8_BOUND = shapeBound(/^[0-9A-Fa-f]{8}$/u)

export const HEX20_BOUND = shapeBound(/^[0-9A-Fa-f]{20}$/u)

export const COLOR_BOUND = shapeBound(/^[0-9A-Fa-f]{6}$|^auto$/u)

export const LANG_BOUND = shapeBound(
  /^[A-Za-z0-9]{1,8}(?:-[A-Za-z0-9]{1,8}){0,7}$/u,
)

export const FONT_NAME_BOUND = shapeBound(/^[^<>&"']{0,64}$/u)

export const TEXT_BOUND = shapeBound(/^[\t\n\r -￿]{0,255}$/u)

export const SHORT_TEXT_BOUND = shapeBound(/^.{0,8}$/u)

export const IDENT_BOUND = shapeBound(/^[A-Za-z_][\w.]{0,63}$/u)

export const DATE_BOUND = shapeBound(/^\d{4}-\d{2}-\d{2}T[^<>&"']{0,32}$/u)

export const VERSION_BOUND = shapeBound(/^\d{1,3}(?:\.\d{1,6})?$/u)

export const CHARSET_BOUND = shapeBound(/^x?[0-9A-Fa-f]{1,4}$|^-?\d{1,5}$/u)

export const HEXFLAGS_BOUND = shapeBound(/^[0-9A-Fa-f]{1,8}$/u)
