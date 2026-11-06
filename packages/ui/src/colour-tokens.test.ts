import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const SOURCE = join(import.meta.dir)
const BUILT_IN = new Set([
  'transparent',
  'current',
  'inherit',
  'black',
  'white',
])

function definedColours(): Set<string> {
  const css = readFileSync(join(SOURCE, 'tailwind.css'), 'utf8')
  return new Set([...css.matchAll(/--color-([a-z0-9-]+):/g)].map((m) => m[1]!))
}

function backgroundTokens(source: string): string[] {
  return [
    ...source.matchAll(/(?<![\w-])bg-([a-z][a-z0-9-]*)(?:\/\d+)?(?![\w-[])/g),
  ]
    .map((m) => m[1]!)
    .filter(
      (token) =>
        !/^(clip|origin|no-repeat|repeat|fixed|local|scroll|cover|contain|center|none|linear|radial|conic|gradient|blend)/.test(
          token,
        ),
    )
}

describe('colour tokens', () => {
  it('every bg- colour class in the UI package names a defined token', () => {
    const colours = definedColours()
    const unknown: string[] = []
    for (const file of readdirSync(SOURCE).filter((name) =>
      name.endsWith('.tsx'),
    )) {
      for (const token of backgroundTokens(
        readFileSync(join(SOURCE, file), 'utf8'),
      ))
        if (!colours.has(token) && !BUILT_IN.has(token))
          unknown.push(`${file}: bg-${token}`)
    }
    expect(unknown).toEqual([])
  })
})
