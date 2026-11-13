import '@obiter/test-dom'
import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { act, cleanup, render, screen } from '@testing-library/react'
import { setShellLayout, useShellLayout } from './shell-layout'

function LayoutProbe() {
  const layout = useShellLayout()
  return <p data-testid="layout">{layout}</p>
}

function layoutText() {
  return screen.getByTestId('layout').textContent
}

function blockReads() {
  return spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('storage blocked')
  })
}

function blockWrites() {
  return spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('storage blocked')
  })
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('shell layout preference', () => {
  it('defaults to the sidebar layout when nothing is stored', () => {
    render(<LayoutProbe />)
    expect(layoutText()).toBe('sidebar')
  })

  it('reads the layout stored on this device', () => {
    window.localStorage.setItem('obiter.layout', 'tabs')
    render(<LayoutProbe />)
    expect(layoutText()).toBe('tabs')
  })

  it('ignores a stored value that is not a layout', () => {
    window.localStorage.setItem('obiter.layout', 'grid')
    render(<LayoutProbe />)
    expect(layoutText()).toBe('sidebar')
  })

  it('writes the choice and updates every reader', () => {
    render(
      <>
        <LayoutProbe />
        <LayoutProbe />
      </>,
    )
    act(() => setShellLayout('clean'))
    expect(window.localStorage.getItem('obiter.layout')).toBe('clean')
    expect(screen.getAllByTestId('layout').map((el) => el.textContent)).toEqual(
      ['clean', 'clean'],
    )
  })

  it('falls back to the sidebar layout when storage cannot be read', () => {
    const reads = blockReads()
    try {
      render(<LayoutProbe />)
      expect(layoutText()).toBe('sidebar')
    } finally {
      reads.mockRestore()
    }
  })

  it('keeps working when the choice cannot be written', () => {
    const writes = blockWrites()
    try {
      render(<LayoutProbe />)
      act(() => setShellLayout('tabs'))
      expect(layoutText()).toBe('sidebar')
    } finally {
      writes.mockRestore()
    }
  })
})
