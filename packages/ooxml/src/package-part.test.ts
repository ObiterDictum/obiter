import { describe, expect, it } from 'vitest'
import { buildOoxmlFixture } from '../fixtures/builder'
import { fixedPngBytes } from '../fixtures/fixture-parts'
import { isPackageImagePartName, readPackageImageParts } from './package-part'

describe('isPackageImagePartName', () => {
  it('accepts media images and rejects traversal and xml parts', () => {
    expect(isPackageImagePartName('word/media/image1.png')).toBe(true)
    expect(isPackageImagePartName('../word/media/image1.png')).toBe(false)
    expect(isPackageImagePartName('word/document.xml')).toBe(false)
  })
})

describe('readPackageImageParts', () => {
  it('returns image bytes and omits xml and missing names', async () => {
    const source = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const parts = await readPackageImageParts(source)
    expect(parts.get('word/media/image1.png')).toEqual({
      bytes: fixedPngBytes,
      contentType: 'image/png',
    })
    expect(parts.has('word/document.xml')).toBe(false)
    expect(parts.has('word/media/missing.png')).toBe(false)
  })
})
