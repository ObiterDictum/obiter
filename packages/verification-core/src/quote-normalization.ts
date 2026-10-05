/**
 * The quote-text normalisation policy, separate from the comparison engine so
 * the policy has exactly one owner. The comparison in `quote-text.ts` reads the
 * apostrophe set here rather than listing its own, so one input cannot fold as
 * an apostrophe and bound as something else. The policy is stated in
 * `docs/specs/verify/quote-fidelity.md`.
 */

/**
 * The apostrophe marks that are typography-equivalent to the ASCII apostrophe
 * under the V4 contract, so a contraction or possessive re-encoded by a
 * provider is not reported as punctuation.
 *
 * `'` and the curly, low and reversed single quotation marks cover Word and
 * PDF re-encoding; U+2032 is the prime a PDF often substitutes; U+02BC
 * (modifier letter apostrophe) and U+FF07 (fullwidth apostrophe) are the usual
 * extraction offenders.
 *
 * Deliberately excluded, and covered by tests in `quote-text.test.ts`:
 *
 * - U+02BB MODIFIER LETTER TURNED COMMA (the `okina`) is a letter in several
 *   orthographies, not an apostrophe mark.
 * - U+02B9 MODIFIER LETTER PRIME is a transliteration prime, not an apostrophe.
 * - U+2039/U+203A SINGLE GUILLEMETS are quotation marks, the single partners of
 *   the double guillemets U+00AB/U+00BB, which this policy does not fold.
 *   Folding only the single pair would equate one quotation system and not the
 *   other.
 */
const APOSTROPHE_FOLDS: readonly string[] = [
  '\u2018',
  '\u2019',
  '\u201a',
  '\u201b',
  '\u2032',
  '\u02bc',
  '\uff07',
]

/** The one owned apostrophe set: the ASCII apostrophe plus every mark folded to
 * it. `quote-text.ts` builds its word pattern and its boundary test from this,
 * so the fold list and the boundary model cannot drift. */
export const APOSTROPHE_MARKS: readonly string[] = ["'", ...APOSTROPHE_FOLDS]

/**
 * The permitted folds, each a legal-document reality rather than a convenience:
 * judgement and Act text is re-encoded between providers, a draft that pasted
 * from PDF or Word carries the typographic forms, and line wrapping, soft
 * hyphens and NBSP all vary without changing a word. The list is deliberately
 * short: case is not folded (capitalisation can be legally meaningful), dashes
 * are not folded (hyphen and en/em dash are not the same mark), and no
 * punctuation, word, negation or number is ever removed.
 *
 * NFC is used rather than NFKC: NFKC also folds compatibility characters such
 * as fullwidth digits and ligatures, which can carry meaning in legal text.
 */
const TYPOGRAPHIC_FOLDS: ReadonlyArray<readonly [string, string]> = [
  ...APOSTROPHE_FOLDS.map((mark): readonly [string, string] => [mark, "'"]),
  ['\u201c', '"'],
  ['\u201d', '"'],
  ['\u201e', '"'],
  ['\u201f', '"'],
  ['\u2033', '"'],
  ['\u2026', '...'],
  ['\u00ad', ''],
]

/**
 * The normalised form both sides of a comparison are reduced to. It is
 * deterministic, idempotent, and reversible enough to explain: each fold maps
 * one known variant onto its canonical form, and none of them drops a word,
 * a number, a negation or a punctuation mark stronger than a quote mark.
 */
export function normalizeQuoteText(text: string): string {
  let value = text.normalize('NFC').replace(/\r\n?/g, '\n')
  for (const [from, to] of TYPOGRAPHIC_FOLDS) value = value.replaceAll(from, to)
  // `\s` with the `u` flag folds every Unicode space, including NBSP and the
  // Ogham space, to one ASCII space, so a line wrap is not a difference.
  return value.replace(/\s+/gu, ' ').trim()
}
