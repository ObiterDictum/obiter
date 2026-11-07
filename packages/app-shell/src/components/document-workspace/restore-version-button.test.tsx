import '@obiter/test-dom'
import { afterEach, expect, it } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RestoreVersionButton } from './restore-version-button'

it('asks for confirmation and restores only after confirmation', () => {
  let restored = false
  render(
    <RestoreVersionButton
      versionNumber={1}
      onRestore={() => {
        restored = true
      }}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Restore this version' }))
  expect(screen.getByText('Restore version 1?')).toBeTruthy()
  expect(restored).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Restore version' }))
  expect(restored).toBe(true)
})

it('refuses restoration while there are unsaved changes', () => {
  render(
    <RestoreVersionButton
      versionNumber={1}
      disabledReason="Save or discard your changes first."
      onRestore={() => {
        throw new Error('Must not restore')
      }}
    />,
  )
  const button = screen.getByRole('button', { name: 'Restore this version' })
  expect(button.hasAttribute('disabled')).toBe(true)
  expect(button.getAttribute('title')).toBe(
    'Save or discard your changes first.',
  )
})

afterEach(cleanup)
