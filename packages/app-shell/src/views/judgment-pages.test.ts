import { expect, it } from 'bun:test'
import { pageAtPosition, judgmentTarget, placePages } from './judgment-pages'
const entries = [1, 2, 3].map((n) => ({ id: `p${n}`, paragraphNumber: n }))
it('only cites a page whose start is known and does not bridge an omitted page', () => {
  const pages = placePages(
    [
      { page: 3, paragraphNumber: 1, offset: 20 },
      { page: 5, paragraphNumber: 3, offset: 0 },
    ],
    entries,
  )
  expect(pageAtPosition(pages, 0, 0)).toBeUndefined()
  expect(pageAtPosition(pages, 0, 20)).toBe(3)
  expect(pageAtPosition(pages, 1, 0)).toBeUndefined()
  expect(pageAtPosition(pages, 2, 0)).toBe(5)
})
it('places a page in the sub-item it starts in rather than the first entry of the court paragraph', () => {
  const structured = [
    { id: 'p1', paragraphNumber: 2 },
    { id: 'p2', paragraphNumber: 2 },
    { id: 'p3', paragraphNumber: 2 },
  ]
  const pages = placePages(
    [
      { page: 4, paragraphNumber: 2, offset: 0, paragraphId: 'p1' },
      { page: 5, paragraphNumber: 2, offset: 7, paragraphId: 'p3' },
      { page: 9, paragraphNumber: 2, offset: 0, paragraphId: 'gone' },
    ],
    structured,
  )
  expect(pages?.map((page) => page.at)).toEqual([0, 2])
  expect(pageAtPosition(pages, 1, 3)).toBe(4)
  expect(pageAtPosition(pages, 2, 7)).toBe(5)
})
it('accepts page and paragraph destinations without interpolating arbitrary selectors', () => {
  expect(judgmentTarget('p. 47')).toBe('page-47')
  expect(judgmentTarget('137')).toBe('para-137')
  expect(judgmentTarget('bad')).toBeNull()
})
