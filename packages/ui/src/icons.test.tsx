import { describe, expect, it } from 'bun:test'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as icons from './icons'
import type { IconProps, IconWeight } from './icon-base'

const WEIGHTS: IconWeight[] = ['regular', 'bold', 'fill']
const HAND_DRAWN = new Set(['Ratio'])

function isComponent(value: unknown): value is ComponentType<IconProps> {
  return (
    typeof value === 'function' ||
    (typeof value === 'object' && value !== null && '$$typeof' in value)
  )
}

describe('generated icons', () => {
  it('every Phosphor icon and weight renders the same SVG as Phosphor', async () => {
    for (const [name, Icon] of Object.entries(icons)) {
      if (HAND_DRAWN.has(name)) continue
      const module: Record<string, unknown> = await import(
        `@phosphor-icons/react/dist/csr/${name}`
      )
      const PhosphorIcon = module[name]
      if (!isComponent(PhosphorIcon))
        throw new Error(`${name} is not a Phosphor icon`)

      for (const weight of WEIGHTS) {
        expect(
          renderToStaticMarkup(createElement(Icon, { size: 16, weight })),
        ).toBe(
          renderToStaticMarkup(
            createElement(PhosphorIcon, { size: 16, weight }),
          ),
        )
      }
    }
  })
})

describe('hand-drawn icons', () => {
  it('Ratio thickens the line for bold and floods the face for fill', () => {
    const svg = (weight: IconWeight) =>
      renderToStaticMarkup(createElement(icons.Ratio, { size: 16, weight }))
    expect(svg('regular')).toContain('stroke-width="16"')
    expect(svg('bold')).toContain('stroke-width="24"')
    expect(svg('fill')).toContain('stroke-width="16"')
    expect(svg('regular')).toContain('128 222 Q 176 196 176 114" fill="none"')
    expect(svg('fill')).toContain(
      '128 222 Q 176 196 176 114" fill="currentColor"',
    )
  })
})
