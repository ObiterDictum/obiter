import { describe, expect, it } from 'bun:test'

import {
  A,
  outputParts,
  override,
  PIC,
  rel,
  W,
  WP,
} from './share-safe-probe-kit'

/**
 * R7 canonical package emission: shipped part names, `rId` values,
 * `Target` spellings and `[Content_Types].xml` are generated, never
 * inherited — a clean export carries no trace of how the source spelled
 * its internals. The shared harness and needle conventions match
 * `share-safe-r7-declarations-probes.test.ts`.
 */
describe('share-safe r7: canonical package emission', () => {
  // The one-pixel PNG the r3 suite ships: signature, IHDR, IDAT, IEND
  // with real CRCs — `inspectBinaryPayload` verifies the payload, so a
  // magic-prefix-only stub would refuse instead of exercising the copy.
  const PNG = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    // IHDR: 13 bytes of data.
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00,
    // IDAT.
    0x00, 0x00, 0x00, 0x02, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x00, 0x00,
    0x00, 0x00,
    // IEND.
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ])

  it('renumbers ids, rewrites owner pointers, renames the target part', async () => {
    const { parts } = await outputParts({
      documentRels:
        rel('rId9', 'styles', 'styles.xml') +
        rel('rId42', 'image', 'media/secretname.png'),
      body: `<w:p><w:r><w:drawing><wp:inline xmlns:wp="${WP}"><a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}"><pic:pic xmlns:pic="${PIC}"><pic:blipFill><a:blip r:embed="rId42"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
      parts: {
        'word/styles.xml': `<?xml version="1.0"?><w:styles xmlns:w="${W}"/>`,
        'word/media/secretname.png': PNG,
      },
      overrides: override('/word/styles.xml', 'styles'),
      defaults: '<Default Extension="png" ContentType="image/png"/>',
    })
    const rels = parts.get('word/_rels/document.xml.rels') ?? ''
    // Declarations renumber in document order; the source spellings —
    // ids and the author-chosen part name — never reach emitted bytes.
    expect(rels).toContain('Id="rId1"')
    expect(rels).toContain('Id="rId2"')
    expect(rels).toContain('Target="media/image1.png"')
    expect(rels).not.toContain('rId9')
    expect(rels).not.toContain('rId42')
    expect(rels).not.toContain('secretname')
    const story = parts.get('word/document.xml') ?? ''
    expect(story).toContain('r:embed="rId2"')
    expect(story).not.toContain('rId42')
    expect(parts.has('word/media/image1.png')).toBe(true)
    expect(parts.has('word/media/secretname.png')).toBe(false)
  })

  it('generates [Content_Types].xml from the plan, not the source', async () => {
    const { parts } = await outputParts({
      documentRels: rel('rId9', 'styles', 'styles.xml'),
      parts: {
        'word/styles.xml': `<?xml version="1.0"?><w:styles xmlns:w="${W}"/>`,
      },
      overrides: override('/word/styles.xml', 'styles'),
    })
    // The harness declares a `xml` Default the source needed; canonical
    // emission regenerates declarations wholesale, so only `rels` and
    // image-format Defaults plus per-part Overrides reach emitted bytes.
    const types = parts.get('[Content_Types].xml') ?? ''
    expect(types).toContain(
      'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"',
    )
    expect(types).toContain('PartName="/word/styles.xml"')
    expect(types).not.toContain('Extension="xml"')
    expect(types).not.toContain('<?xml version="1.0"?>')
  })
})
