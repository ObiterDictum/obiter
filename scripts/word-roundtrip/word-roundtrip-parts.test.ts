import { describe, expect, it } from 'bun:test'

import { buildOoxmlFixture } from '../../packages/ooxml/fixtures/builder'
import { parseDocx } from '../../packages/ooxml/src/parse'
import { createOpaquePart } from '../../packages/ooxml/src/parts/opaque'
import { serialiseDocx } from '../../packages/ooxml/src/serialise'
import { compare, summarise } from './summary'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/*
 * The cycle-1 vs cycle-2 semantic comparison. Every case stands in for what
 * the harness really sees: two Obiter exports parsed back into summaries.
 * The cycle-2 side is built by mutating a parsed package's source parts and
 * serialising, which is exactly what a Word save's extra or missing parts
 * look like after the Obiter export preserves them.
 */
type Parsed = Awaited<ReturnType<typeof parseDocx>>

async function cycledDocx(mutate?: (doc: Parsed) => void) {
  const fixture = await buildOoxmlFixture('full-fidelity-with-w14-ids')
  const doc = await parseDocx(fixture)
  mutate?.(doc)
  return serialiseDocx(doc)
}

const WORD_APP_XML = `<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Office Word</Application><AppVersion>16.0000</AppVersion></Properties>`

const wordAppXml = () =>
  createOpaquePart('docProps/app.xml', 'xml', encoder.encode(WORD_APP_XML))

function relsPart(name: string, mutate: (xml: string) => string) {
  return (doc: Parsed) => {
    const part = doc.sourceParts.get(name)
    if (!part) throw new Error(`${name} missing from fixture`)
    doc.sourceParts.set(
      name,
      createOpaquePart(
        name,
        'xml',
        encoder.encode(mutate(decoder.decode(part.originalPayload))),
      ),
    )
  }
}

const DOCUMENT_RELS = 'word/_rels/document.xml.rels'

async function summaries(secondMutate: (doc: Parsed) => void) {
  const first = await summarise(await cycledDocx())
  const second = await summarise(await cycledDocx(secondMutate))
  return { first, second, checks: compare(first, second) }
}

function namedCheck(checks: ReturnType<typeof compare>, name: string) {
  const check = checks.find((candidate) => candidate.name === name)
  if (!check) throw new Error(`compare() must emit a "${name}" check`)
  return check
}

describe('word-roundtrip source-part preservation', () => {
  it('passes a conforming Word-labelled output that only adds metadata', async () => {
    // The defect R3 proved live: the producer evidence the harness requires
    // (docProps/app.xml naming Word) is itself a part the cycle-1 export
    // lacks, so a part-count comparison can never pass a conforming leg.
    const { checks } = await summaries((doc) => {
      doc.sourceParts.set('docProps/app.xml', wordAppXml())
    })
    expect(checks.every((check) => check.pass)).toBe(true)
    const additions = namedCheck(checks, 'package part additions')
    expect(additions.detail).toContain('docProps/app.xml')
  })

  it('fails when a source part is dropped', async () => {
    const { checks } = await summaries((doc) => {
      doc.sourceParts.delete('customXml/item1.xml')
      doc.sourceParts.set('docProps/app.xml', wordAppXml())
    })
    const preserved = namedCheck(checks, 'source parts preserved')
    expect(preserved.pass).toBe(false)
    expect(preserved.detail).toContain('customXml/item1.xml')
    expect(checks.every((check) => check.pass)).toBe(false)
  })

  it('fails an equal-count substitution — a count is not preservation proof', async () => {
    // One opaque part out, one in: the totals agree and only the identities
    // expose the dropped content.
    const { first, second, checks } = await summaries((doc) => {
      doc.sourceParts.delete('customXml/item1.xml')
      doc.sourceParts.set('docProps/app.xml', wordAppXml())
    })
    expect(first.packageParts.length).toBe(second.packageParts.length)
    const preserved = namedCheck(checks, 'source parts preserved')
    expect(preserved.pass).toBe(false)
    expect(preserved.detail).toContain('customXml/item1.xml')
  })

  it('fails when a surviving part changes role', async () => {
    // Removing the header relationship demotes header1.xml to an orphan the
    // parser no longer types — the part survives but its preservation role
    // changed, which a name-only check would miss.
    const { checks } = await summaries(
      relsPart(DOCUMENT_RELS, (xml) =>
        xml.replace(/<Relationship Id="rId3"[^>]+\/>/, ''),
      ),
    )
    const preserved = namedCheck(checks, 'source parts preserved')
    expect(preserved.pass).toBe(false)
    expect(preserved.detail).toContain('word/header1.xml')
    expect(preserved.detail).toContain('story')
    expect(preserved.detail).toContain('opaque')
  })

  it('fails on an unexpected active part addition', async () => {
    const { checks } = await summaries((doc) => {
      doc.sourceParts.set('docProps/app.xml', wordAppXml())
      doc.sourceParts.set(
        'customXml/_rels/item1.xml.rels',
        createOpaquePart(
          'customXml/_rels/item1.xml.rels',
          'xml',
          encoder.encode(
            '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps1.xml"/></Relationships>',
          ),
        ),
      )
    })
    const additions = namedCheck(checks, 'package part additions')
    expect(additions.pass).toBe(false)
    expect(additions.detail).toContain('customXml/_rels/item1.xml.rels')
    expect(additions.detail).toContain('relationships')
  })

  it('fails on an external relationship addition inside a surviving part', async () => {
    // No part is added or dropped: the injection lives inside an existing
    // .rels payload, which only the binding comparison can see.
    const { checks } = await summaries(
      relsPart(DOCUMENT_RELS, (xml) =>
        xml.replace(
          '</Relationships>',
          '<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://uninvited.invalid/" TargetMode="External"/></Relationships>',
        ),
      ),
    )
    const preserved = namedCheck(checks, 'relationships preserved')
    expect(preserved.pass).toBe(false)
    expect(preserved.detail).toContain('uninvited.invalid')
    expect(preserved.detail).toContain('external')
    expect(checks.every((check) => check.pass)).toBe(false)
  })
})
