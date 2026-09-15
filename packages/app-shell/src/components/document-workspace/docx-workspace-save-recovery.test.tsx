// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DocumentEditOperation } from '@obiter/contracts'
import { ApiError } from '../../api'
import {
  bodyEditor,
  mountSaveWorkspace,
  openReviewTab,
  STYLE_ID,
  saveState,
  validationFailed,
} from './docx-workspace-save-harness'

describe('E45 a rejected save must not poison later saves', () => {
  it('addresses a style applied to an unsaved paragraph to that paragraph', async () => {
    const editAsync = vi.fn().mockResolvedValue({
      documentId: 'doc_1',
      versionId: 'ver_2',
      versionNumber: 2,
    })
    mountSaveWorkspace({ editAsync })
    fireEvent.click(screen.getByText('Hello'))
    fireEvent.click(screen.getByRole('button', { name: 'Insert paragraph' }))
    fireEvent.change(screen.getByLabelText('Pending paragraph text'), {
      target: { value: 'Draft insight' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Heading 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(editAsync).toHaveBeenCalledTimes(1))
    const operations = editAsync.mock.calls[0]?.[0].operations as
      DocumentEditOperation[] | undefined
    const insert = operations?.find(
      (operation) => operation.type === 'insert_paragraph_after',
    )
    expect(insert).toMatchObject({
      type: 'insert_paragraph_after',
      paragraphId: 'p1',
      styleId: STYLE_ID,
    })
    // Every addressed node must exist on the server. The unsaved paragraph has
    // no server id, so a separate set_paragraph_style for it is unaddressable
    // and would fail this and every later save.
    for (const operation of operations ?? []) {
      const addressed =
        'paragraphId' in operation
          ? operation.paragraphId
          : 'runId' in operation
            ? operation.runId
            : undefined
      if (addressed !== undefined && addressed !== 'p1' && addressed !== 'r1') {
        throw new Error(
          `operation addresses ${addressed}, which is not in the stored model: ${JSON.stringify(operation)}`,
        )
      }
    }
  })

  it('saves later valid work when the server rejects one change in the batch', async () => {
    // Models the server's atomic batch rule for this document: one paragraph
    // and no inserts means deleting every paragraph is rejected. The typed text
    // in the same batch is valid and must still reach the server.
    const saved: string[] = []
    const editAsync = vi.fn(
      async (input: { operations: DocumentEditOperation[] }) => {
        if (input.operations.some((op) => op.type === 'delete_paragraph')) {
          throw validationFailed
        }
        const version = `ver_${String(saved.length + 2)}`
        saved.push(
          ...input.operations
            .filter((op) => op.type === 'replace_run_text')
            .map((op) => ('text' in op ? op.text : '')),
        )
        return { documentId: 'doc_1', versionId: version, versionNumber: 2 }
      },
    )
    mountSaveWorkspace({ editAsync })
    fireEvent.click(screen.getByText('Hello'))
    fireEvent.change(bodyEditor(), { target: { value: 'Hello world' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete paragraph' }))
    openReviewTab()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(saved).toContain('Hello world')
    })
    expect(editAsync.mock.calls.length).toBeGreaterThan(1)
    expect(screen.getByText(/rejected a paragraph deletion/i)).toBeTruthy()
  })

  it('does not discard it when the save is rejected and then retried', async () => {
    const editAsync = vi
      .fn()
      .mockRejectedValueOnce(validationFailed)
      .mockResolvedValue({
        documentId: 'doc_1',
        versionId: 'ver_2',
        versionNumber: 2,
      })
    mountSaveWorkspace({ editAsync })
    fireEvent.click(screen.getByText('Hello'))
    fireEvent.change(bodyEditor(), { target: { value: 'Hello world' } })
    openReviewTab()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(screen.getByText(/rejected typed text/i)).toBeTruthy()
    })
    expect(editAsync).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(editAsync).toHaveBeenCalledTimes(1)
    expect(bodyEditor().value).toBe('Hello')
    expect(screen.getByText(/rejected typed text/i)).toBeTruthy()
  })

  it('keeps text typed while a save was in flight', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined
    const editAsync = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockResolvedValue({
        documentId: 'doc_1',
        versionId: 'ver_3',
        versionNumber: 3,
      })
    mountSaveWorkspace({ editAsync })
    fireEvent.click(screen.getByText('Hello'))
    fireEvent.change(bodyEditor(), { target: { value: 'Hello first' } })
    openReviewTab()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(editAsync).toHaveBeenCalledTimes(1))

    // The user keeps typing while the request is in flight. That text was not
    // in the request, so the successful response must not clear it.
    fireEvent.change(bodyEditor(), { target: { value: 'Hello second' } })
    await act(async () => {
      resolveFirst({
        documentId: 'doc_1',
        versionId: 'ver_2',
        versionNumber: 2,
      })
    })

    await waitFor(() => expect(saveState()).toBe('unsaved'))
    expect(bodyEditor().value).toBe('Hello second')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(editAsync).toHaveBeenCalledTimes(2))
    expect(editAsync.mock.calls[1]?.[0].operations).toEqual([
      { type: 'replace_run_text', runId: 'r1', text: 'Hello second' },
    ])
  })

  it('ignores a second save while the first is still in flight', async () => {
    const editAsync = vi.fn().mockResolvedValue({
      documentId: 'doc_1',
      versionId: 'ver_2',
      versionNumber: 2,
    })
    mountSaveWorkspace({ editAsync })
    fireEvent.click(screen.getByText('Hello'))
    fireEvent.change(bodyEditor(), { target: { value: 'Hello world' } })

    // Ctrl+S bypasses the disabled Save button.
    const shell = document.getElementById('document-workspace')
    if (!shell) throw new Error('expected the workspace shell')
    fireEvent.keyDown(shell, { key: 's', ctrlKey: true })
    fireEvent.keyDown(shell, { key: 's', ctrlKey: true })

    await waitFor(() => expect(editAsync).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(editAsync).toHaveBeenCalledTimes(1)
  })

  it('says a draft could not be stored when the browser refuses', async () => {
    const originalSetItem = Storage.prototype.setItem
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(function (this: Storage, key: string, value: string) {
        if (this === window.localStorage) throw new Error('QuotaExceededError')
        originalSetItem.call(this, key, value)
      })
    try {
      mountSaveWorkspace({ editAsync: vi.fn() })
      fireEvent.click(screen.getByText('Hello'))
      fireEvent.change(bodyEditor(), { target: { value: 'Hello unstored' } })

      await waitFor(() => {
        expect(screen.getByText(/could not store a draft/i)).toBeTruthy()
      })
      expect(saveState()).toBe('unsaved')
    } finally {
      spy.mockRestore()
    }
  })

  it('explains that work is unsaved and offers a retry instead of a generic invalid-request message', async () => {
    const editAsync = vi.fn().mockRejectedValue(validationFailed)
    mountSaveWorkspace({ editAsync })
    fireEvent.click(screen.getByText('Hello'))
    fireEvent.change(bodyEditor(), { target: { value: 'Hello world' } })
    openReviewTab()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByText(/rejected typed text/i)).toBeTruthy()
    })
    expect(screen.getByText(/not been saved|held here/i)).toBeTruthy()
    expect(saveState()).toBe('unsaved')
  })

  it('holds a single rejected slot and does not resend it on retry', async () => {
    const editAsync = vi.fn().mockRejectedValue(validationFailed)
    mountSaveWorkspace({ editAsync })
    fireEvent.click(screen.getByText('Hello'))
    fireEvent.change(bodyEditor(), { target: { value: 'Hello edited' } })
    openReviewTab()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByText(/rejected typed text/i)).toBeTruthy()
    })
    expect(editAsync).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(editAsync).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/could not be identified/i)).toBeNull()
  })

  it('keeps text typed while a containment probe is in flight', async () => {
    let resolveProbe: (value: unknown) => void = () => undefined
    const editAsync = vi.fn(
      async (input: { operations: DocumentEditOperation[] }) => {
        if (input.operations.some((op) => op.type === 'set_paragraph_style')) {
          throw validationFailed
        }
        return new Promise((resolve) => {
          resolveProbe = resolve
        })
      },
    )
    mountSaveWorkspace({ editAsync })
    fireEvent.click(screen.getByText('Hello'))
    fireEvent.change(bodyEditor(), { target: { value: 'Hello world' } })
    fireEvent.click(screen.getByRole('button', { name: 'Heading 1' }))
    openReviewTab()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(editAsync).toHaveBeenCalledTimes(2))

    fireEvent.change(bodyEditor(), {
      target: { value: 'Hello typed during probe' },
    })
    await act(async () => {
      resolveProbe({
        documentId: 'doc_1',
        versionId: 'ver_2',
        versionNumber: 2,
      })
    })

    await waitFor(() => expect(saveState()).toBe('unsaved'))
    expect(bodyEditor().value).toBe('Hello typed during probe')
  })

  it('keeps same-slot text typed while a rejected save settles', async () => {
    let rejectFirst: (reason: unknown) => void = () => undefined
    const editAsync = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectFirst = reject
          }),
      )
      .mockResolvedValue({
        documentId: 'doc_1',
        versionId: 'ver_2',
        versionNumber: 2,
      })
    mountSaveWorkspace({ editAsync })
    fireEvent.click(screen.getByText('Hello'))
    fireEvent.change(bodyEditor(), { target: { value: 'Hello doomed' } })
    openReviewTab()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(editAsync).toHaveBeenCalledTimes(1))

    // The same rejected slot is extended while the request is in flight.
    // Holding the slot must keep the newer typing editable, not swallow it.
    fireEvent.change(bodyEditor(), {
      target: { value: 'Hello doomed plus newer typing' },
    })
    await act(async () => {
      rejectFirst(validationFailed)
    })

    await waitFor(() => expect(screen.getByText(/held here/i)).toBeTruthy())
    expect(bodyEditor().value).toBe('Hello doomed plus newer typing')
    expect(saveState()).toBe('unsaved')
  })

  it('asks for confirmation before reload-and-discard destroys unsaved work', async () => {
    const editAsync = vi
      .fn()
      .mockRejectedValue(
        new ApiError(
          'storage_unavailable',
          'The request failed.',
          503,
          'req_2',
        ),
      )
    mountSaveWorkspace({ editAsync })
    fireEvent.click(screen.getByText('Hello'))
    fireEvent.change(bodyEditor(), { target: { value: 'Hello keep me' } })
    openReviewTab()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Reload and discard' }),
      ).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Reload and discard' }))
    expect(bodyEditor().value).toBe('Hello keep me')
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(bodyEditor().value).toBe('Hello keep me')
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Reload and discard' }))
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy()
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Discard unsaved work' }),
    )
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(bodyEditor().value).toBe('Hello')
  })
})
