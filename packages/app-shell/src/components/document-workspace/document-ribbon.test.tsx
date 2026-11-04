import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { setTrackChanges, trackChangesState } from './editor-test-commands'
import {
  mountWorkspace,
  multiParagraphModel,
  paragraph,
} from './docx-workspace-harness'

function mountDocument() {
  return mountWorkspace({
    models: { doc_1: multiParagraphModel([paragraph('p1', 'Hello')]) },
  })
}

describe('ribbon track changes', () => {
  it('shows the on-state in the quick access row when the version tracks revisions', () => {
    mountWorkspace({
      models: {
        doc_1: {
          ...multiParagraphModel([paragraph('p1', 'Hello')]),
          trackRevisions: true,
        },
      },
    })

    expect(screen.getByText('Track changes on')).toBeTruthy()
  })

  it('turns tracking on from the Review tab and shows the indicator', async () => {
    mountDocument()

    expect(screen.queryByText('Track changes on')).toBeNull()
    setTrackChanges(true)

    await waitFor(() => expect(trackChangesState()).toBe('true'))
    expect(screen.getByText('Track changes on')).toBeTruthy()
  })

  it('keeps the verify status and both verify actions in the Review tab', () => {
    mountDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Review$/ }))

    expect(screen.getByRole('menuitemcheckbox', { name: 'Track changes' }))
    expect(screen.getByRole('menuitem', { name: 'Verify citations' }))
    expect(screen.getByRole('menuitem', { name: 'Check citations' }))
  })
})
