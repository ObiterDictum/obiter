import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { buildOoxmlFixture } from '../fixtures/builder'
import { ooxmlFixtureManifest } from '../fixtures/manifest'
import { documentModelWireSchema, parseDocx } from './index'

describe('OOXML model and corpus contract', () => {
  it('covers the complete fixture manifest bar', () => {
    const coverage = new Set(
      ooxmlFixtureManifest.flatMap((fixture) => [...fixture.covers]),
    )
    expect(coverage).toEqual(
      new Set([
        'numbering-and-list-restarts',
        'style-inheritance-and-linked-styles',
        'section-breaks-with-differing-headers-and-footers',
        'footnotes',
        'endnotes',
        'cross-references',
        'styleref-field',
        'seq-field',
        'toc-field',
        'ref-field',
        'merged-and-nested-tables',
        'comments',
        'content-controls',
        'embedded-images',
        'tracked-ins',
        'tracked-del',
        'tracked-move-from',
        'tracked-move-to',
        'tracked-paragraph-properties',
        'tracked-run-properties',
        'identity-with-w14-ids',
        'identity-without-w14-ids',
      ]),
    )
  })

  it('validates an idempotent shared model JSON shape', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const json = JSON.stringify(document.model)
    expect(documentModelWireSchema.parse(JSON.parse(json))).toEqual(
      document.model,
    )
  })

  it('returns curated errors without parser diagnostics', async () => {
    const emptyZip = await new JSZip().generateAsync({ type: 'uint8array' })
    await expect(parseDocx(emptyZip)).rejects.toEqual(
      expect.objectContaining({
        name: 'OoxmlError',
        code: 'invalid-package',
        message: 'The document package is invalid.',
      }),
    )

    const fixture = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const malformedZip = await JSZip.loadAsync(fixture)
    malformedZip.file('word/document.xml', '<w:document>raw diagnostic marker')
    const malformed = await malformedZip.generateAsync({ type: 'uint8array' })
    await expect(parseDocx(malformed)).rejects.toEqual(
      expect.objectContaining({
        name: 'OoxmlError',
        code: 'invalid-xml-part',
        message: 'The document contains invalid XML.',
      }),
    )
  })
})
