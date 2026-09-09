import { describe, expect, it } from 'vitest'
import { nextFeedPageUrl } from './legislation-ingest'
import { parseYearFeed } from './legislation-clml'

// Year feeds page at 20 entries: page 1 of 2020 ends at c.10, so a scope
// that reads only the first page silently drops c.1-9. This pins the
// two-page walk contract (collect across rel=next, then dedupe by number).
describe('year feed paging', () => {
  const page = (ids: string, next: string | null) => `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
${ids}
${next ? `<link rel="next" type="application/atom+xml" href="${next}"/>` : ''}
</feed>`

  it('collects entries across pages via rel=next', () => {
    const entry = (n: number) =>
      `<entry><id>http://www.legislation.gov.uk/id/ukpga/2020/${n}</id><title>Act ${n}</title></entry>`
    const page1 = page(
      [10, 11, 12].map(entry).join(''),
      'http://www.legislation.gov.uk/ukpga/2020/data.feed?page=2&amp;foo=1',
    )
    const page2 = page([1, 2].map(entry).join(''), null)

    expect(nextFeedPageUrl(page1)).toBe(
      'http://www.legislation.gov.uk/ukpga/2020/data.feed?page=2&foo=1',
    )
    expect(nextFeedPageUrl(page2)).toBeNull()
    const acts = [...parseYearFeed(page1, 2020), ...parseYearFeed(page2, 2020)]
    expect(acts.map((act) => act.number).sort((a, b) => a - b)).toEqual([
      1, 2, 10, 11, 12,
    ])
  })
})
