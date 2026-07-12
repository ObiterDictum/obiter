import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Enforces the contrast guarantee from contract §2.3: every `-fg` token must
 * reach WCAG AA (>= 4.5:1) over its matching base token, in BOTH light and dark
 * themes. Parses tokens.css directly so it verifies the real artifact, not a
 * parallel data structure.
 */

type RGB = [number, number, number]

const tokensCss = readFileSync(resolve(__dirname, '../tokens.css'), 'utf8')

function extractBlock(source: string, selector: string): string {
  // Prettier normalizes CSS attribute-selector quotes to single quotes; match
  // either quote style so this raw-source assertion survives reformatting.
  // Escape the selector for RegExp, then loosen each `"` into `["']`.
  const re = new RegExp(
    selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/"/g, "['\"]"),
  )
  let from = 0
  // The selector may also appear in comments; only accept an occurrence that is
  // followed (ignoring whitespace) by a `{`.
  for (;;) {
    const match = re.exec(source.slice(from))
    expect(match, `theme block ${selector} must exist`).toBeTruthy()
    const start = from + match!.index
    let i = start + match![0].length
    while (i < source.length && /\s/.test(source[i] ?? '')) i += 1
    if (source[i] === '{') {
      const braceEnd = source.indexOf('}', i)
      return source.slice(i + 1, braceEnd)
    }
    from = start + 1
  }
}

const lightBlock = extractBlock(tokensCss, ':root')
const darkBlock = extractBlock(tokensCss, '[data-theme="dark"]')

function declarations(block: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const rawLine of block.split(';')) {
    const line = rawLine.trim()
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const key = line.slice(0, colon).trim()
    const value = line.slice(colon + 1).trim()
    if (key && value) map.set(key, value)
  }
  return map
}

function parseHsl(value: string): RGB | null {
  const match = value.match(/hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/i)
  if (!match) return null
  return hslToRgb(
    Number(match[1]),
    Number(match[2]) / 100,
    Number(match[3]) / 100,
  )
}

function parseHex(value: string): RGB | null {
  const match = value.match(/^#([0-9a-f]{6})$/i)
  if (!match) return null
  const hex = match[1]
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ]
}

function parseColor(value: string): RGB | null {
  return parseHex(value) ?? parseHsl(value) ?? parseRgba(value)
}

function parseRgba(value: string): RGB | null {
  const match = value.match(/rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0
  let g = 0
  let b = 0
  if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0]
  else if (hp < 2) [r, g, b] = [x, c, 0]
  else if (hp < 3) [r, g, b] = [0, c, x]
  else if (hp < 4) [r, g, b] = [0, x, c]
  else if (hp < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = l - c / 2
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ]
}

function relativeLuminance([r, g, b]: RGB): number {
  const channel = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

function contrastCases(block: string): Array<{ name: string; ratio: number }> {
  const decls = declarations(block)
  const cases: Array<{ name: string; ratio: number }> = []
  for (const [key, value] of decls) {
    if (!key.endsWith('-fg')) continue
    const baseKey = key.slice(0, -'-fg'.length)
    const baseValue = decls.get(`${baseKey}-bg`) ?? decls.get(baseKey)
    if (!baseValue) continue
    const fg = parseColor(value)
    const bg = parseColor(baseValue)
    if (!fg || !bg) continue // skip rgba overlays that have no opaque base
    cases.push({ name: baseKey, ratio: contrastRatio(fg, bg) })
  }
  return cases
}

describe('design token contrast (WCAG AA >= 4.5)', () => {
  it.each([
    ['light', lightBlock],
    ['dark', darkBlock],
  ])('meets AA for every -fg/base pair in the %s theme', (_theme, block) => {
    const cases = contrastCases(block).sort((a, b) => a.ratio - b.ratio)
    expect(
      cases.length,
      'at least the status + brand + span pairs must be covered',
    ).toBeGreaterThan(5)
    const failures = cases.filter((c) => c.ratio < 4.5)
    expect(failures.map((c) => `${c.name}: ${c.ratio.toFixed(2)}`)).toEqual([])
  })

  it('covers all 15 redaction span categories in both themes', () => {
    const spanCategories = [
      'person-name',
      'email',
      'phone',
      'address',
      'date',
      'government-id',
      'account-number',
      'secret',
      'passport',
      'drivers-license',
      'url',
      'ip-address',
      'national-insurance',
      'case-reference',
      'organisation-name',
    ]
    for (const category of spanCategories) {
      const baseKey = `--obiter-span-${category}`
      expect(lightBlock).toContain(`${baseKey}-bg:`)
      expect(lightBlock).toContain(`${baseKey}-fg:`)
      expect(darkBlock).toContain(`${baseKey}-bg:`)
      expect(darkBlock).toContain(`${baseKey}-fg:`)
    }
  })
})
