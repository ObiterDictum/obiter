import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { vi } from '../../../../../scripts/test/vitest-compat'
import { isMacPlatform } from '../../keyboard-platform'
import { command, commandDisabled } from './editor-test-commands'
import {
  bodyEditor,
  mountSaveDocumentWorkspace,
  saveState,
} from './docx-workspace-save-harness'

const saved = {
  documentId: 'doc_1',
  versionId: 'ver_2',
  versionNumber: 2,
}

function saveButton() {
  return command('Save')
}

function edit(text: string) {
  fireEvent.click(screen.getByText('Hello'))
  fireEvent.change(bodyEditor(), { target: { value: text } })
}

function pressPrimarySave() {
  const workspace = document.getElementById('document-workspace')
  if (!workspace) throw new Error('the workspace is not mounted')
  fireEvent.keyDown(workspace, {
    key: 's',
    ...(isMacPlatform() ? { metaKey: true } : { ctrlKey: true }),
  })
}

describe('ribbon save', () => {
  it('saves from the ribbon icon and is disabled while the work is clean', async () => {
    const editAsync = vi.fn(async () => saved)
    mountSaveDocumentWorkspace({ editAsync })

    expect(commandDisabled(saveButton())).toBe(true)
    edit('Hello world')
    await waitFor(() => expect(commandDisabled(saveButton())).toBe(false))

    fireEvent.click(saveButton())

    await waitFor(() => expect(editAsync).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(saveState()).toBe('saved'))
    expect(commandDisabled(saveButton())).toBe(true)
  })

  it('saves on the platform save shortcut', async () => {
    const editAsync = vi.fn(async () => saved)
    mountSaveDocumentWorkspace({ editAsync })

    edit('Hello shortcut')
    await waitFor(() => expect(commandDisabled(saveButton())).toBe(false))
    pressPrimarySave()

    await waitFor(() => expect(editAsync).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(saveState()).toBe('saved'))
  })
})
