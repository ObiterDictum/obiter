import { describe, expect, it } from 'vitest'
import { buildOoxmlFixture } from '../fixtures/builder'
import { fixedPngBytes } from '../fixtures/fixture-parts'
import { isPackageImagePartName, readPackageImagePart } from './package-part'

describe('isPackageImagePartName', () => {
  it('accepts media images and rejects traversal and xml parts', () => {
    expect(isPackageImagePartName('word/media/image1.png')).toBe(true)
    expect(isPackageImagePartName('../word/media/image1.png')).toBe(false)
    expect(isPackageImagePartName('word/document.xml')).toBe(false)
  })
})

describe('readPackageImagePart', () => {
  it('returns the image bytes from the package', async () => {
    const source = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const part = await readPackageImagePart(source, 'word/media/image1.png')
    expect(part).toEqual({
      bytes: fixedPngBytes,
      contentType: 'image/png',
    })
  })

  it('refuses xml parts and missing names', async () => {
    const source = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    expect(
      await readPackageImagePart(source, 'word/document.xml'),
    ).toBeUndefined()
    expect(
      await readPackageImagePart(source, 'word/media/missing.png'),
    ).toBeUndefined()
  })
})
