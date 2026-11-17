import { cn } from '@obiter/ui'
import type { CSSProperties } from 'react'
import { INTEGRATION_MARKS } from '../integration-marks'
import type { Integration } from '../integrations-catalogue'

type Rgb = readonly [number, number, number]

const WHITE: Rgb = [255, 255, 255]
const INK: Rgb = [36, 30, 23]

function toRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.replace('#', ''), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function mix(from: string, to: Rgb, amount: number) {
  const channels = toRgb(from).map((value, index) =>
    Math.round(value + (to[index] - value) * amount),
  )
  const hex = channels
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
  return `#${hex}`
}

function luminance(hex: string) {
  const [red, green, blue] = toRgb(hex)
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
}

function brandInk(hex: string) {
  return {
    light: luminance(hex) > 0.55 ? mix(hex, INK, 0.45) : hex,
    dark: mix(hex, WHITE, 0.35),
  }
}

export function integrationHex(integration: Integration) {
  const visual = integration.visual
  return visual.kind === 'mark'
    ? `#${INTEGRATION_MARKS[visual.key].hex}`
    : visual.hex
}

export function IntegrationTile({
  integration,
  size = 'card',
}: {
  integration: Integration
  size?: 'card' | 'detail'
}) {
  const visual = integration.visual
  const mark = visual.kind === 'mark' ? INTEGRATION_MARKS[visual.key] : null
  const ink = brandInk(integrationHex(integration))
  const style: CSSProperties = {
    color: `light-dark(${ink.light}, ${ink.dark})`,
    backgroundColor: `light-dark(color-mix(in srgb, ${ink.light} 12%, var(--obiter-surface)), color-mix(in srgb, ${ink.dark} 14%, var(--obiter-surface)))`,
    boxShadow: `inset 0 0 0 1px light-dark(color-mix(in srgb, ${ink.light} 18%, transparent), color-mix(in srgb, ${ink.dark} 22%, transparent))`,
  }
  return (
    <span
      aria-hidden
      style={style}
      className={cn(
        'grid shrink-0 place-items-center',
        size === 'detail' ? 'size-14 rounded-xl' : 'size-12 rounded-lg',
      )}
    >
      {mark ? (
        <svg viewBox="0 0 24 24" className="size-[54%]">
          <path d={mark.path} fill="currentColor" />
        </svg>
      ) : visual.kind === 'lettermark' ? (
        <span
          className={cn(
            'font-semibold tracking-tight',
            visual.letters.length > 2 ? 'text-meta' : 'text-item',
          )}
        >
          {visual.letters}
        </span>
      ) : null}
    </span>
  )
}
