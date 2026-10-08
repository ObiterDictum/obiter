import '@obiter/test-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, mock } from 'bun:test'

import { InsertAuthorityDialog } from './insert-authority-dialog'

function renderDialog(
  props: Partial<Parameters<typeof InsertAuthorityDialog>[0]> = {},
) {
  const onInsert = mock((_citation: string) => {})
  render(
    <InsertAuthorityDialog
      open
      onOpenChange={() => {}}
      disabled={false}
      citationStyle="oscola"
      onInsert={onInsert}
      {...props}
    />,
  )
  return { onInsert }
}

function typeCitation(value: string) {
  fireEvent.change(screen.getByLabelText('Citation'), {
    target: { value },
  })
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
}

describe('InsertAuthorityDialog', () => {
  it('inserts a supported neutral citation as typed', () => {
    const { onInsert } = renderDialog()
    typeCitation('[2024] UKSC 3')
    submit()
    expect(onInsert).toHaveBeenCalledWith('[2024] UKSC 3')
  })

  it('inserts a canonical legislation path', () => {
    const { onInsert } = renderDialog()
    typeCitation('/ln/ukpga/1998/42')
    submit()
    expect(onInsert).toHaveBeenCalledWith('/ln/ukpga/1998/42')
  })

  it('refuses free text with an accessible error and inserts nothing', () => {
    const { onInsert } = renderDialog()
    typeCitation('the first defendant')
    submit()
    expect(onInsert).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain(
      'not a citation this editor recognises',
    )
  })

  it('accepts an unsupported court with a review warning shown up front', () => {
    const { onInsert } = renderDialog()
    typeCitation('[2024] EAT 12')
    expect(
      screen.getByText(/outside the grammars Verify resolves/),
    ).toBeTruthy()
    submit()
    expect(onInsert).toHaveBeenCalledWith('[2024] EAT 12')
  })

  it('shows the house-style helper when that style is active', () => {
    renderDialog({ citationStyle: 'house' })
    typeCitation('[2024] UKSC 3')
    expect(screen.getByText(/inserted in italics/)).toBeTruthy()
  })

  it('clears a shown rejection when the input changes', () => {
    renderDialog()
    typeCitation('not a citation at all')
    submit()
    expect(screen.getByRole('alert')).toBeTruthy()
    typeCitation('[2024] UKSC 3')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('cannot submit an empty input', () => {
    const { onInsert } = renderDialog()
    expect(
      (screen.getByRole('button', { name: 'Insert' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(onInsert).not.toHaveBeenCalled()
  })
})
