import { expect, it } from 'bun:test'
import { verificationWordDiff } from './verification-word-diff'

it('highlights changed, inserted and removed words while preserving the exact excerpts', () => {
  for (const [draft, source, changedDraft, changedSource] of [
    [
      '“Only the court allows.”',
      'Only the contract allows.',
      ['court'],
      ['contract'],
    ],
    ['the court court allows', 'the court allows', ['court'], []],
    ['the court allows', 'the court now allows', [], ['now']],
    [
      'Party autonomy operates as the court allows.',
      'A discussion of party autonomy. Party autonomy operates as the contract allows. More context.',
      ['court'],
      ['contract'],
    ],
    ['THE court’s order', "the court's order", [], []],
  ] as const) {
    const result = verificationWordDiff(draft, source)
    expect(
      result?.draft.filter((word) => word.changed).map((word) => word.text),
    ).toEqual([...changedDraft])
    expect(
      result?.source.filter((word) => word.changed).map((word) => word.text),
    ).toEqual([...changedSource])
    expect(result?.draft.map((word) => word.text).join('')).toBe(draft)
    expect(result?.source.map((word) => word.text).join('')).toBe(source)
  }
})
