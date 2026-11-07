import { expect, it } from 'bun:test'
import { pageAtPosition, judgmentTarget } from './judgment-pages'
it('only cites a page whose start is known and does not bridge an omitted page', () => {
  const pages = [
    { page: 3, paragraphNumber: 1, offset: 20 },
    { page: 5, paragraphNumber: 3, offset: 0 },
  ]
  expect(pageAtPosition(pages, 1, 0)).toBeUndefined()
  expect(pageAtPosition(pages, 1, 20)).toBe(3)
  expect(pageAtPosition(pages, 2, 0)).toBeUndefined()
  expect(pageAtPosition(pages, 3, 0)).toBe(5)
})
it('accepts page and paragraph destinations without interpolating arbitrary selectors', () => {
  expect(judgmentTarget('p. 47')).toBe('page-47')
  expect(judgmentTarget('137')).toBe('para-137')
  expect(judgmentTarget('bad')).toBeNull()
})
