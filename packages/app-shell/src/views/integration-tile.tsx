import { cn } from '@obiter/ui'
import type { CSSProperties } from 'react'
import { INTEGRATION_MARKS } from '../integration-marks'
import type { Integration } from '../integrations-catalogue'

type Rgb = readonly [number, number, number]
type TileTone = 'solid' | 'quiet'

const WHITE: Rgb = [255, 255, 255]
const BLACK: Rgb = [0, 0, 0]
const INK: Rgb = [34, 28, 21]

const SIZES = {
  card: {
    box: 'size-9 rounded-lg',
    glyph: 'size-[18px]',
    letter: 'text-[13px]',
  },
  featured: {
    box: 'size-11 rounded-lg',
    glyph: 'size-[22px]',
    letter: 'text-[15px]',
  },
  detail: {
    box: 'size-[72px] rounded-xl',
    glyph: 'size-9',
    letter: 'text-[30px]',
  },
} as const

function toRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.replace('#', ''), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function mix(hex: string, to: Rgb, amount: number) {
  const channels = toRgb(hex).map((value, index) =>
    Math.round(value + (to[index] - value) * amount),
  )
  return `#${channels.map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

function alpha(hex: string, opacity: number) {
  return `rgba(${toRgb(hex).join(', ')}, ${opacity})`
}

function luminance(hex: string) {
  const [red, green, blue] = toRgb(hex)
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
}

export function integrationHex(integration: Integration) {
  const visual = integration.visual
  return visual.kind === 'mark'
    ? `#${INTEGRATION_MARKS[visual.key].hex}`
    : visual.hex
}

export function brandWash(integration: Integration, strength: string) {
  const hex = integrationHex(integration)
  return `linear-gradient(100deg, color-mix(in srgb, ${hex} ${strength}, transparent) 0%, color-mix(in srgb, ${hex} 6%, transparent) 46%, transparent 78%)`
}

interface TilePaint {
  style: CSSProperties
  inverted: boolean
}

function tileStyle(integration: Integration, tone: TileTone): TilePaint {
  const hex = integrationHex(integration)
  const inverted = integration.visual.kind === 'mark' && luminance(hex) > 0.62
  if (inverted) {
    return {
      inverted,
      style: {
        color: mix(hex, INK, 0.12),
        background: `light-dark(#fff, color-mix(in srgb, ${hex} 14%, var(--obiter-surface)))`,
        boxShadow: `inset 0 0 0 1px light-dark(${alpha(hex, 0.24)}, ${alpha(hex, 0.32)}), 0 1px 2px rgba(24, 18, 12, 0.1)`,
      },
    }
  }
  const fill = `linear-gradient(180deg, ${mix(hex, WHITE, 0.16)} 0%, ${hex} 52%, ${mix(hex, BLACK, 0.16)} 100%)`
  return {
    inverted: false,
    style: {
      color: '#fff',
      background: fill,
      boxShadow:
        tone === 'quiet'
          ? `inset 0 1px 0 rgba(255, 255, 255, 0.22)`
          : `inset 0 1px 0 rgba(255, 255, 255, 0.34), inset 0 -1px 0 rgba(0, 0, 0, 0.14), 0 1px 2px rgba(24, 18, 12, 0.16), 0 6px 12px -6px ${alpha(hex, 0.55)}`,
      filter: tone === 'quiet' ? 'saturate(0.3)' : undefined,
    },
  }
}

export function IntegrationTile({
  integration,
  size = 'card',
  tone = 'solid',
}: {
  integration: Integration
  size?: keyof typeof SIZES
  tone?: TileTone
}) {
  const visual = integration.visual
  const mark = visual.kind === 'mark' ? INTEGRATION_MARKS[visual.key] : null
  const { style, inverted } = tileStyle(integration, tone)
  return (
    <span
      aria-hidden
      style={style}
      className={cn(
        'grid shrink-0 place-items-center',
        SIZES[size].box,
        inverted && 'ring-1 ring-inset ring-black/5',
      )}
    >
      {mark ? (
        <svg viewBox="0 0 24 24" className={SIZES[size].glyph}>
          <path d={mark.path} fill="currentColor" />
        </svg>
      ) : visual.kind === 'lettermark' ? (
        <span
          className={cn(
            'font-semibold tracking-tight',
            SIZES[size].letter,
            visual.letters.length > 2 && 'tracking-[-0.04em]',
          )}
        >
          {visual.letters}
        </span>
      ) : null}
    </span>
  )
}
