import { expect, it } from 'bun:test'
import { refusalMessage } from './document-selection-notices'

it('explains that a cut removed one footnote and Undo restores it', () => {
  expect(
    refusalMessage({ kind: 'cut-footnotes', count: 1 }, false, false),
  ).toBe(
    '1 footnote was removed by the cut. Undo restores them. Pasting restores only the text.',
  )
})

it('reports the actual count when a cut removes several footnotes', () => {
  expect(
    refusalMessage({ kind: 'cut-footnotes', count: 2 }, false, false),
  ).toContain('2 footnotes were removed')
})
