import '@obiter/test-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { useState } from 'react'
import { SidePanel } from '../side-panel'

function Harness() {
  const [open, setOpen] = useState(true)
  return (
    <SidePanel open={open} onOpenChange={setOpen} title="Document information">
      <p>Version 2</p>
    </SidePanel>
  )
}

describe('SidePanel', () => {
  it('is announced as a dialog named by its title', () => {
    render(<Harness />)
    expect(
      screen.getByRole('dialog', { name: 'Document information' }),
    ).toBeTruthy()
  })

  it('dismisses on Escape and reports the change to its owner', () => {
    render(<Harness />)
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
