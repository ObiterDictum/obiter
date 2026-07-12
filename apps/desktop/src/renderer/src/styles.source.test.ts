import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Guards the Tailwind v4 @source directives in styles.css.
 * Wrong relative depth (e.g. four `../` instead of five) silently resolves
 * outside the monorepo packages and starves the desktop renderer of utilities.
 */
const stylesPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  './styles.css',
)
const stylesDir = dirname(stylesPath)
const stylesCss = readFileSync(stylesPath, 'utf8')

const sourcePaths = [...stylesCss.matchAll(/@source\s+"([^"]+)"\s*;/g)].map(
  (match) => match[1]!,
)

describe('desktop renderer Tailwind @source paths', () => {
  it('declares at least the workspace package sources', () => {
    expect(sourcePaths.length).toBeGreaterThanOrEqual(3)
    expect(sourcePaths.some((p) => p.includes('packages/ui/src'))).toBe(true)
    expect(sourcePaths.some((p) => p.includes('packages/app-shell/src'))).toBe(
      true,
    )
    expect(sourcePaths.some((p) => p.includes('packages/redact-ui/src'))).toBe(
      true,
    )
  })

  it('resolves every @source path to an existing directory', () => {
    expect(sourcePaths.length).toBeGreaterThan(0)
    for (const source of sourcePaths) {
      const absolute = resolve(stylesDir, source)
      expect(
        existsSync(absolute),
        `@source "${source}" must resolve to an existing path (got ${absolute})`,
      ).toBe(true)
    }
  })
})
