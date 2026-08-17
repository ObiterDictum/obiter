import { describe, expect, it } from 'vitest'
import { readAlternateLink, readRelLink, readTypedLink } from './document-utils'

const pagedFeed = `<?xml version="1.0"?>
<feed xmlns:tna="https://caselaw.nationalarchives.gov.uk">
  <link href="https://caselaw.nationalarchives.gov.uk/atom.xml?court=ewhc%2Fipec&amp;from_date_2=2019&amp;page=2" rel="next"/>
  <entry>
    <link href="https://caselaw.nationalarchives.gov.uk/ewhc/ipec/2024/3256" rel="alternate"/>
    <link href="https://caselaw.nationalarchives.gov.uk/ewhc/ipec/2024/3256/data.xml" rel="alternate" type="application/xml"/>
  </entry>
</feed>`

describe('reading links out of an Atom feed', () => {
  // Attribute values are XML-escaped. Handed to `new URL` undecoded, this href
  // parses as a parameter literally named `amp;page`, so the page number and
  // every filter after the first ampersand are dropped and the request returns
  // page one again. A paged walk then loops on the first page forever.
  it('decodes escaped ampersands in a next link', () => {
    const next = readRelLink(pagedFeed, 'next')

    expect(next).toContain('&page=2')
    expect(next).not.toContain('&amp;')
  })

  it('produces a next link whose query parameters survive URL parsing', () => {
    const url = new URL(readRelLink(pagedFeed, 'next') ?? '')

    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('court')).toBe('ewhc/ipec')
    expect(url.searchParams.get('from_date_2')).toBe('2019')
    expect(url.searchParams.has('amp;page')).toBe(false)
  })

  it('reads the untyped alternate link as the judgment address', () => {
    expect(readAlternateLink(pagedFeed)).toBe(
      'https://caselaw.nationalarchives.gov.uk/ewhc/ipec/2024/3256',
    )
  })

  it('reads a typed alternate link separately', () => {
    expect(readTypedLink(pagedFeed, 'application/xml')).toBe(
      'https://caselaw.nationalarchives.gov.uk/ewhc/ipec/2024/3256/data.xml',
    )
  })

  it('returns nothing when no link matches', () => {
    expect(readRelLink(pagedFeed, 'previous')).toBeUndefined()
  })
})
