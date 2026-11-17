import '@obiter/test-dom'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import type { AgentPresence } from '@obiter/contracts'
import { RatioMascot } from '../ratio-mascot'

afterEach(() => {
  cleanup()
  mock.restore()
})

const states: Array<[AgentPresence, string]> = [
  ['idle', 'Ratio, idle'],
  ['thinking', 'Ratio, thinking'],
  ['working', 'Ratio, working'],
  ['needs_approval', 'Ratio, needs approval'],
  ['done', 'Ratio, done'],
  ['stuck', 'Ratio, stuck'],
]

const css = readFileSync(resolve(__dirname, '../ratio-mascot.css'), 'utf8')

function classOf(name: string) {
  return screen.getByRole('img', { name }).getAttribute('class') ?? ''
}

describe('RatioMascot', () => {
  for (const [state, name] of states)
    it(`names the ${state} mascot as Ratio and its state`, () => {
      render(<RatioMascot state={state} />)
      const mascot = screen.getByRole('img', { name })
      expect(mascot.getAttribute('data-state')).toBe(state)
    })

  for (const [state, name] of states)
    it(`animates a live ${state} mascot with its own pose class`, () => {
      render(<RatioMascot state={state} />)
      expect(classOf(name)).toContain(`ratio-mascot--${state}`)
      expect(classOf(name)).toContain('ratio-mascot--live')
    })

  it('keeps a past turn still so history does not keep moving', () => {
    render(<RatioMascot state="done" live={false} />)
    expect(classOf('Ratio, done')).toContain('ratio-mascot--still')
    expect(classOf('Ratio, done')).not.toContain('ratio-mascot--live')
  })

  it('swaps the pose class when the run moves to a new state', () => {
    const { rerender } = render(<RatioMascot state="thinking" />)
    expect(classOf('Ratio, thinking')).toContain('ratio-mascot--thinking')
    rerender(<RatioMascot state="done" />)
    expect(classOf('Ratio, done')).toContain('ratio-mascot--done')
    expect(classOf('Ratio, done')).not.toContain('ratio-mascot--thinking')
  })

  it('keeps motion at 32px while dropping the gown and brief', () => {
    render(<RatioMascot state="thinking" size={32} />)
    const small = screen.getByRole('img', { name: 'Ratio, thinking' })
    expect(small.getAttribute('data-variant')).toBe('small')
    expect(small.getAttribute('class')).toContain('ratio-mascot--small')
    expect(small.getAttribute('class')).toContain('ratio-mascot--live')
    expect(small.querySelector('.ratio-body')).toBeNull()
    expect(small.querySelector('.ratio-head')).toBeTruthy()
    expect(small.querySelector('.ratio-dot')).toBeTruthy()
  })

  it('keeps the amber ring and tick on small live mascots', () => {
    const { rerender } = render(
      <RatioMascot state="needs_approval" size={32} />,
    )
    expect(
      screen
        .getByRole('img', { name: 'Ratio, needs approval' })
        .querySelector('.ratio-ring'),
    ).toBeTruthy()
    rerender(<RatioMascot state="done" size={32} />)
    expect(
      screen
        .getByRole('img', { name: 'Ratio, done' })
        .querySelector('.ratio-tick'),
    ).toBeTruthy()
  })

  it('keeps the gown and brief at 40px and above', () => {
    render(<RatioMascot state="working" size={40} />)
    const full = screen.getByRole('img', { name: 'Ratio, working' })
    expect(full.getAttribute('data-variant')).toBe('full')
    expect(full.querySelector('.ratio-body')).toBeTruthy()
  })

  it('removes animation only when the reader prefers reduced motion', () => {
    const base = window.matchMedia('(prefers-reduced-motion: reduce)')
    spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      ...base,
      media: query,
      matches: query.includes('prefers-reduced-motion'),
    }))
    render(<RatioMascot state="working" />)
    const mascot = screen.getByRole('img', { name: 'Ratio, working' })
    expect(mascot.getAttribute('data-motion')).toBe('still')
    expect(mascot.getAttribute('class')).toContain('ratio-mascot--still')
    expect(mascot.getAttribute('class')).not.toContain('ratio-mascot--live')
  })

  it('keeps every animation behind the live and reduced-motion gate', () => {
    const media = css.indexOf('@media (prefers-reduced-motion: no-preference)')
    const firstAnimation = css.indexOf('animation:')
    expect(media).toBeGreaterThan(-1)
    expect(firstAnimation).toBeGreaterThan(media)
    expect(css).toContain('.ratio-mascot--live')
  })
})
