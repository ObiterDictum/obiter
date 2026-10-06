import '@obiter/test-dom'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import {
  bodyEditor,
  mountSaveWorkspace,
  openReviewTab,
  saveState,
} from './docx-workspace-save-harness'

describe('E45 unsaved drafts must survive a reload', () => {
  it('restores typed text after the workspace remounts', async () => {
    mountSaveWorkspace({ editAsync: vi.fn() })
    fireEvent.click(screen.getByText('Hello'))
    fireEvent.change(bodyEditor(), { target: { value: 'Hello restored' } })

    cleanup()
    mountSaveWorkspace({ editAsync: vi.fn() })
    fireEvent.click(screen.getByText('Hello restored'))

    await waitFor(() => {
      expect(bodyEditor().value).toBe('Hello restored')
    })
    expect(screen.getByText(/restored from this browser/i)).toBeTruthy()
    expect(saveState()).toBe('unsaved')
  })

  it('clears the stored draft once the server has committed it', async () => {
    const editAsync = vi.fn().mockResolvedValue({
      documentId: 'doc_1',
      versionId: 'ver_2',
      versionNumber: 2,
    })
    mountSaveWorkspace({ editAsync })
    fireEvent.click(screen.getByText('Hello'))
    fireEvent.change(bodyEditor(), { target: { value: 'Hello world' } })
    openReviewTab()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(saveState()).toBe('saved'))

    cleanup()
    mountSaveWorkspace({ editAsync: vi.fn() })
    fireEvent.click(screen.getByText('Hello'))
    await waitFor(() => {
      expect(bodyEditor().value).toBe('Hello')
    })
  })

  it('does not apply a draft recorded against an older stored version', async () => {
    mountSaveWorkspace({ editAsync: vi.fn() })
    fireEvent.click(screen.getByText('Hello'))
    fireEvent.change(bodyEditor(), { target: { value: 'Hello stale' } })

    cleanup()
    mountSaveWorkspace({
      editAsync: vi.fn(),
      versionId: 'ver_2',
      body: 'Hello',
    })
    fireEvent.click(screen.getByText('Hello'))

    await waitFor(() => {
      expect(bodyEditor().value).toBe('Hello')
    })
    expect(screen.getByText(/earlier version of this document/i)).toBeTruthy()
  })

  it('restores a draft after the tab is closed and the document is reopened', async () => {
    mountSaveWorkspace({ editAsync: vi.fn() })
    fireEvent.click(screen.getByText('Hello'))
    fireEvent.change(bodyEditor(), { target: { value: 'Hello after close' } })
    await waitFor(() => {
      expect(window.localStorage.length).toBeGreaterThan(0)
    })

    cleanup()
    window.sessionStorage.clear()
    mountSaveWorkspace({ editAsync: vi.fn() })
    fireEvent.click(screen.getByText('Hello after close'))

    await waitFor(() => {
      expect(bodyEditor().value).toBe('Hello after close')
    })
    expect(saveState()).toBe('unsaved')
    expect(screen.queryByText('All changes saved')).toBeNull()
  })
})
