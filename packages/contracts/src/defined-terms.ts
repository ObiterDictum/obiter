/**
 * The `_Def_` bookmark name codec, shared by the OOXML writer (which names
 * the mark it splices) and the app-shell defined-term check (which reads the
 * term back out of stored paragraph fragments).
 *
 * A defined-term mark is a `w:bookmarkStart`/`w:bookmarkEnd` pair around the
 * words that bind the term — the same mechanism a cross-reference target
 * uses — so the mark survives save and reload. The name must carry the term:
 * a preserved fragment keeps no offset, so the name is the only place the
 * marked words can be recovered from.
 *
 * Names are lowercase letter/number words joined by `_`, and the whole name
 * stays inside Word's 40-character bookmark limit. A term that cannot map to
 * a name — no word characters, or over the cap — is refused rather than
 * truncated, because truncating could fold two different terms under one
 * name.
 */

export const DEFINED_TERM_NAME_PREFIX = '_Def_'

/** Word caps a bookmark name at 40 characters. */
const DEFINED_TERM_NAME_MAX_LENGTH = 40

const WORD = /[\p{L}\p{N}]+/gu

/**
 * The term's normalised words, or `null` when the text carries no word
 * characters. Whitespace and punctuation are separators, so quoted or
 * parenthesised selections normalise to their words.
 */
export function definedTermWords(text: string): string[] | null {
  const words = text.toLowerCase().match(WORD)
  return words && words.length > 0 ? words : null
}

/** The bookmark name a mark over this text writes, or `null` when refused. */
export function definedTermBookmarkName(text: string): string | null {
  const words = definedTermWords(text)
  if (!words) return null
  const name = `${DEFINED_TERM_NAME_PREFIX}${words.join('_')}`
  return name.length <= DEFINED_TERM_NAME_MAX_LENGTH ? name : null
}

/**
 * The normalised term a `_Def_` bookmark name carries, or `null` for any
 * other name — including the `_Ref_`/`_Toc` families. Non-`_Def_` names and
 * malformed suffixes return `null` rather than a partial term.
 */
export function definedTermFromBookmarkName(
  name: string,
): { words: string[] } | null {
  if (!name.startsWith(DEFINED_TERM_NAME_PREFIX)) return null
  const suffix = name.slice(DEFINED_TERM_NAME_PREFIX.length)
  // The name the writer produces is word characters joined by single
  // underscores; anything else under the prefix is malformed, not a term.
  if (!/^[\p{L}\p{N}]+(?:_[\p{L}\p{N}]+)*$/u.test(suffix)) return null
  return { words: suffix.split('_').map((word) => word.toLowerCase()) }
}
