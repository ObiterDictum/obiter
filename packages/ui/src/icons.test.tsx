import { describe, expect, it } from 'bun:test'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as icons from './icons'
import type { IconProps, IconWeight } from './icon-base'

const WEIGHTS: IconWeight[] = ['regular', 'bold', 'fill']

function isComponent(value: unknown): value is ComponentType<IconProps> {
  return (
    typeof value === 'function' ||
    (typeof value === 'object' && value !== null && '$$typeof' in value)
  )
}

describe('generated icons', () => {
  it('every icon and weight renders the same SVG as Phosphor', async () => {
    for (const [name, Icon] of Object.entries(icons)) {
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
