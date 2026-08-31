import { readdir, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const srcDirectory = new URL('./', import.meta.url)

const mediaBodyResponsePatterns = [
  /new Response\(\s*Uint8Array\.from\(\s*part\.bytes/,
  /new Response\([^)]*\bpart\.bytes\b/,
  /c\.body\([^)]*\bpart\.bytes\b/,
]

const allowlistedPaths = new Set(['document-media-response.ts'])

const mediaRoutePattern = /\/api\/documents\/:id\/media\b/

describe('document media response architecture boundary', () => {
  it('serves stored image parts only through createDocumentMediaResponse', async () => {
    const source = await readFile(
      new URL('./routes/document-media.ts', srcDirectory),
      'utf8',
    )

    expect(source).toMatch(/from '\.\.\/document-media-response'/)
    expect(source).toMatch(/createDocumentMediaResponse\s*\(/)
  })

  it('prevents route modules from constructing media bodies outside the helper', async () => {
    const routeDirectory = new URL('./routes/', srcDirectory)
    const files = (await readdir(routeDirectory)).filter(
      (file) => file.endsWith('.ts') && !file.includes('.test'),
    )
    const mediaRoutesWithoutHelper: string[] = []

    for (const file of files) {
      const source = await readFile(new URL(file, routeDirectory), 'utf8')
      if (!mediaRoutePattern.test(source)) continue
      if (!/from '\.\.\/document-media-response'/.test(source)) {
        mediaRoutesWithoutHelper.push(file)
      }
    }

    expect(mediaRoutesWithoutHelper).toEqual([])
  })

  it('prevents source modules from building stored image-part Responses directly', async () => {
    const files = (await readdir(srcDirectory, { recursive: true })).filter(
      (file) =>
        typeof file === 'string' &&
        file.endsWith('.ts') &&
        !file.includes('.test'),
    )
    const bypasses: string[] = []

    for (const file of files) {
      if (allowlistedPaths.has(file)) continue
      const source = await readFile(new URL(file, srcDirectory), 'utf8')
      if (mediaBodyResponsePatterns.some((pattern) => pattern.test(source))) {
        bypasses.push(file)
      }
    }

    expect(bypasses).toEqual([])
  })
})
