export const DEFINED_TERM_NAME_PREFIX = '_Def_'

const DEFINED_TERM_NAME_MAX_LENGTH = 40

const WORD = /[\p{L}\p{N}]+/gu

export function definedTermWords(text: string): string[] | null {
  const words = text.toLowerCase().match(WORD)
  return words && words.length > 0 ? words : null
}

export function definedTermBookmarkName(text: string): string | null {
  const words = definedTermWords(text)
  if (!words) return null
  const name = `${DEFINED_TERM_NAME_PREFIX}${words.join('_')}`
  return name.length <= DEFINED_TERM_NAME_MAX_LENGTH ? name : null
}

export function definedTermFromBookmarkName(
  name: string,
): { words: string[] } | null {
  if (!name.startsWith(DEFINED_TERM_NAME_PREFIX)) return null
  const suffix = name.slice(DEFINED_TERM_NAME_PREFIX.length)
  if (!/^[\p{L}\p{N}]+(?:_[\p{L}\p{N}]+)*$/u.test(suffix)) return null
  return { words: suffix.split('_').map((word) => word.toLowerCase()) }
}
