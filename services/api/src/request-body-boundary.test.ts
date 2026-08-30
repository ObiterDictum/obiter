import { readdir, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const srcDirectory = new URL('./', import.meta.url)

const unboundedBodyPatterns = [
  /c\.req\.raw\.body\b/,
  /c\.req\.raw\.json\s*\(/,
  /c\.req\.raw\.text\s*\(/,
  /c\.req\.raw\.arrayBuffer\s*\(/,
  /c\.req\.raw\.blob\s*\(/,
  /c\.req\.raw\.formData\s*\(/,
  /\.body\.getReader\s*\(/,
  /\breadBoundedBodyBytes\s*\(/,
]

const allowlistedPaths = new Set([
  'limited-request-body.ts',
  'request-body-limit.ts',
])

describe('request body architecture boundary', () => {
  it('registers app-layer body limits after session and before Better Auth', async () => {
    const source = await readFile(new URL('./app.ts', srcDirectory), 'utf8')
    const sessionIndex = source.indexOf('auth.api.getSession')
    const authHandlerIndex = source.indexOf(
      "app.on(['GET', 'POST'], '/api/auth/*'",
    )
    const bodyLimitImport = /from '\.\/request-body-limit'/.test(source)
    const bodyLimitUse =
      /app\.use\(\s*'\*',\s*createRequestBodyLimitMiddleware\s*\(/.test(source)
    const bodyLimitUseIndex = source.search(
      /app\.use\(\s*'\*',\s*createRequestBodyLimitMiddleware\s*\(/,
    )

    expect(bodyLimitImport).toBe(true)
    expect(bodyLimitUse).toBe(true)
    expect(sessionIndex).toBeGreaterThan(-1)
    expect(authHandlerIndex).toBeGreaterThan(-1)
    expect(bodyLimitUseIndex).toBeGreaterThan(-1)
    expect(sessionIndex).toBeLessThan(bodyLimitUseIndex)
    expect(bodyLimitUseIndex).toBeLessThan(authHandlerIndex)
  })

  it('prevents route and source modules from reading the unbounded raw body stream', async () => {
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
      if (unboundedBodyPatterns.some((pattern) => pattern.test(source))) {
        bypasses.push(file)
      }
    }

    expect(bypasses).toEqual([])
  })
})
