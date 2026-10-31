import { describe, expect, it } from 'bun:test'
import {
  collapseSpaceRuns,
  readElementContent,
  stripFindCaseLawSuffix,
  replaceElements,
  replaceTags,
  unwrapCdata,
} from './html-scan'
import { extractNeutralCitation, readIdentifier } from './document-utils'
import { courtFromCitation } from './court-utils'

function seeded(seed: number) {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return state / 0x7fffffff
  }
}

function randomText(random: () => number, parts: string[], length: number) {
  let text = ''
  for (let index = 0; index < length; index += 1) {
    text += parts[Math.floor(random() * parts.length)]
  }
  return text
}

function fast(run: () => void) {
  const start = performance.now()
  run()
  return performance.now() - start
}

describe('replaceTags', () => {
  it('matches the /<[^>]+>/g replacement on random markup', () => {
    const random = seeded(1)
    for (let round = 0; round < 4000; round += 1) {
      const text = randomText(random, ['<', '>', '/', 'a', ' ', '<>'], 24)
      expect(replaceTags(text, ' ')).toBe(text.replace(/<[^>]+>/g, ' '))
    }
  })

  it('stays linear on an unterminated run of tag openers', () => {
    expect(fast(() => replaceTags('<'.repeat(200_000), ' '))).toBeLessThan(50)
  })
})

describe('replaceElements', () => {
  const original = (html: string) =>
    html.replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ')

  it('matches the original element removal when end tags are exact', () => {
    const random = seeded(2)
    const parts = [
      '<nav>',
      '</nav>',
      '<NAV a>',
      '<navs>',
      'x',
      ' ',
      '<',
      '>',
      '</navx>',
    ]
    for (let round = 0; round < 4000; round += 1) {
      const html = randomText(random, parts, 12)
      expect(replaceElements(html, 'nav', ' ')).toBe(original(html))
    }
  })

  it('also closes on end tags with whitespace, attributes or different case', () => {
    for (const end of [
      '</script >',
      '</SCRIPT>',
      '</script\t\n bar>',
      '</Script foo="a">',
    ]) {
      expect(replaceElements(`a<script>alert(1)${end}b`, 'script', ' ')).toBe(
        'a b',
      )
    }
  })

  it('stays linear on many unclosed openers', () => {
    expect(
      fast(() => replaceElements('<script>'.repeat(50_000), 'script', ' ')),
    ).toBeLessThan(100)
  })
})

describe('unwrapCdata', () => {
  it('matches the original CDATA unwrap on random input', () => {
    const random = seeded(3)
    const parts = ['<![CDATA[', ']]>', 'a', ']', '<', ' ']
    for (let round = 0; round < 4000; round += 1) {
      const text = randomText(random, parts, 14)
      expect(unwrapCdata(text)).toBe(
        text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'),
      )
    }
  })

  it('stays linear on repeated unterminated sections', () => {
    expect(fast(() => unwrapCdata('<![CDATA[a'.repeat(50_000)))).toBeLessThan(
      50,
    )
  })
})

describe('readElementContent', () => {
  const original = (xml: string) =>
    xml.match(
      /<tna:identifier\b[^>]*type=["']ukncn["'][^>]*>([\s\S]*?)<\/tna:identifier>/i,
    )?.[1]

  it('matches the original identifier lookup on random feeds', () => {
    const random = seeded(4)
    const parts = [
      '<tna:identifier type="ukncn">',
      "<TNA:IDENTIFIER x type='UKNCN' y>",
      '<tna:identifier type="other">',
      '<tna:identifierx type="ukncn">',
      '</tna:identifier>',
      '[2024] EWHC 1',
      '>',
      ' ',
    ]
    for (let round = 0; round < 4000; round += 1) {
      const xml = randomText(random, parts, 8)
      expect(readIdentifier(xml)).toBe(original(xml))
    }
  })

  it('stays linear on repeated unterminated identifiers', () => {
    const xml = '<tna:identifier type="ukncn">'.repeat(20_000)
    expect(
      fast(() => readElementContent(xml, 'tna:identifier', () => true)),
    ).toBeLessThan(100)
  })
})

describe('stripFindCaseLawSuffix', () => {
  it('matches the original suffix removal on random titles', () => {
    const random = seeded(6)
    const parts = [
      ' ',
      '\t',
      '-',
      'Find Case Law',
      'find case law',
      'A',
      ' - Find Case Law',
      '\n',
    ]
    for (let round = 0; round < 4000; round += 1) {
      const title = randomText(random, parts, 8)
      expect(stripFindCaseLawSuffix(title)).toBe(
        title.replace(/\s+-\s+Find Case Law[\s\S]*$/i, ''),
      )
    }
  })

  it('stays linear on long whitespace runs', () => {
    const title = `A${'\t'.repeat(100_000)}B`
    expect(fast(() => stripFindCaseLawSuffix(title))).toBeLessThan(50)
  })
})

describe('citation matching', () => {
  it('finds the same citations as the original patterns', () => {
    const originalNeutral =
      /\[\d{4}\]\s+[A-Za-z][A-Za-z0-9 ]*?\s+\d+(?:\s+\([A-Za-z][A-Za-z0-9 ]*\))?/
    const originalCourt =
      /^\[\d{4}\]\s+([A-Za-z][A-Za-z0-9 ]*?)\s+\d+(?:\s+\(([A-Za-z][A-Za-z0-9 ]*)\))?$/
    const random = seeded(5)
    const parts = ['[2024]', ' ', '  ', 'EWHC', 'Ch', '12', '(', ')', 'x', '\n']
    for (let round = 0; round < 4000; round += 1) {
      const text = randomText(random, parts, 9)
      const collapsed = collapseSpaceRuns(text)
      expect(extractNeutralCitation(text)).toBe(
        collapsed.match(originalNeutral)?.[0].replace(/\s+/g, ' ').trim(),
      )
      const court = collapsed.match(originalCourt)
      if (!court) expect(courtFromCitation(text)).toBeNull()
    }
  })

  it('finds the same neutral citation whatever the space runs', () => {
    expect(extractNeutralCitation('see [2024]   EWHC   123   (Ch) today')).toBe(
      '[2024] EWHC 123 (Ch)',
    )
    expect(extractNeutralCitation('[2024] UKSC 7')).toBe('[2024] UKSC 7')
  })

  it('stays linear on long space runs', () => {
    const value = `[2024] a${' '.repeat(100_000)}x`
    expect(fast(() => extractNeutralCitation(value))).toBeLessThan(50)
    expect(fast(() => courtFromCitation(value))).toBeLessThan(50)
  })

  it('collapses only runs of spaces', () => {
    expect(collapseSpaceRuns('a  b\t\tc   d')).toBe('a b\t\tc d')
  })
})
