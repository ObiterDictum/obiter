const APOSTROPHE_FOLDS: readonly string[] = [
  '\u2018',
  '\u2019',
  '\u201a',
  '\u201b',
  '\u2032',
  '\u02bc',
  '\uff07',
]

export const APOSTROPHE_MARKS: readonly string[] = ["'", ...APOSTROPHE_FOLDS]

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

export function normalizeQuoteText(text: string): string {
  let value = text.normalize('NFC').replace(/\r\n?/g, '\n')
  for (const [from, to] of TYPOGRAPHIC_FOLDS) value = value.replaceAll(from, to)
  return value.replace(/\s+/gu, ' ').trim()
}
