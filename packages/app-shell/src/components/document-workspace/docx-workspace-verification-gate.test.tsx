// @vitest-environment jsdom
// The E45 recovery save owner and the V5 verification gate meet at one
// boundary: `DocxWorkspace` publishes its unsaved state, `VerificationRunPanel`
// reads it. These tests mount both inside the real provider, so a save owner
// that reports clean while work is still off-server fails here rather than in
// a user's verification run.
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentEditOperation } from '@obiter/contracts'
import { VerificationRunPanel } from '../verification-run-panel'
import {
  bodyEditor,
  mountSaveWorkspace,
  saveState,
  validationFailed,
} from './docx-workspace-save-harness'

const documentHook = vi.hoisted(() => ({ useDocument: vi.fn() }))
const runsHook = vi.hoisted(() => ({
  useDocumentVerificationRuns: vi.fn(),
  useCreateVerificationRun: vi.fn(),
  useVerificationFindings: vi.fn(),
  latestVerificationRun: vi.fn(),
}))

vi.mock('../../documents', () => ({ useDocument: documentHook.useDocument }))
vi.mock('../../verification-runs', () => ({
  useDocumentVerificationRuns: runsHook.useDocumentVerificationRuns,
  useCreateVerificationRun: runsHook.useCreateVerificationRun,
  useVerificationFindings: runsHook.useVerificationFindings,
  latestVerificationRun: runsHook.latestVerificationRun,
}))

function mountGate(options: { editAsync?: ReturnType<typeof vi.fn> }) {
  return mountSaveWorkspace({
    ...options,
    beside: <VerificationRunPanel documentId="doc_1" />,
  })
}

function verifyButton() {
  return screen.getByRole('button', {
    name: 'Run verification',
  }) as HTMLButtonElement
}

function saveButton() {
  return screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
}

function edit(text: string) {
  fireEvent.click(screen.getByText('Hello'))
  fireEvent.change(bodyEditor(), { target: { value: text } })
}

beforeEach(() => {
  documentHook.useDocument.mockReturnValue({
    isPending: false,
    isError: false,
    data: {
      document: {
        currentVersion: { id: 'ver_1', documentStatus: 'ready' },
      },
    },
  })
  runsHook.useDocumentVerificationRuns.mockReturnValue({
    isPending: false,
    isError: false,
    data: { runs: [] },
  })
  runsHook.useCreateVerificationRun.mockReturnValue({
    isPending: false,
    mutate: vi.fn(),
    error: null,
  })
  runsHook.useVerificationFindings.mockReturnValue({
    isPending: false,
    isError: false,
    findings: [],
  })
  runsHook.latestVerificationRun.mockReturnValue(null)
})

describe('V5 verification gate against the E45 save owner', () => {
  it('disables verification while the document has unsaved edits', async () => {
    mountGate({ editAsync: vi.fn() })
    await waitFor(() => expect(verifyButton().disabled).toBe(false))

    edit('Hello world')

    await waitFor(() => expect(verifyButton().disabled).toBe(true))
    expect(screen.getByText(/Save before verification/)).toBeTruthy()
  })

  it('keeps verification disabled when a rejected save holds the only work', async () => {
    const editAsync = vi.fn().mockRejectedValue(validationFailed)
    mountGate({ editAsync })
    edit('Hello edited')
    await waitFor(() => expect(verifyButton().disabled).toBe(true))

    fireEvent.click(saveButton())
    await waitFor(() => {
      expect(screen.getByText(/rejected typed text/i)).toBeTruthy()
    })

    // Nothing is left to send, so the workspace reports unsaved for the held
    // work rather than clean. A clean signal here would let verification run
    // against a stored version that is missing the user's edit.
    await waitFor(() => expect(saveState()).toBe('unsaved'))
    expect(saveButton().disabled).toBe(true)
    expect(verifyButton().disabled).toBe(true)
    expect(screen.getByText(/Save before verification/)).toBeTruthy()
  })

  it('re-enables verification once the save owner reports the work clean', async () => {
    const editAsync = vi.fn().mockResolvedValue({
      documentId: 'doc_1',
      versionId: 'ver_2',
      versionNumber: 2,
    })
    mountGate({ editAsync })
    edit('Hello world')
    await waitFor(() => expect(verifyButton().disabled).toBe(true))

    fireEvent.click(saveButton())

    await waitFor(() => expect(saveState()).toBe('saved'))
    await waitFor(() => expect(verifyButton().disabled).toBe(false))
    expect(screen.queryByText(/Save before verification/)).toBeNull()
  })

  it('keeps verification disabled when a save covers only part of the work', async () => {
    const editAsync = vi.fn(
      async (input: { operations: DocumentEditOperation[] }) => {
        if (input.operations.some((op) => op.type === 'delete_paragraph')) {
          throw validationFailed
        }
        return { documentId: 'doc_1', versionId: 'ver_2', versionNumber: 2 }
      },
    )
    mountGate({ editAsync })
    fireEvent.click(screen.getByText('Hello'))
    fireEvent.change(bodyEditor(), { target: { value: 'Hello world' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete paragraph' }))
    await waitFor(() => expect(verifyButton().disabled).toBe(true))

    fireEvent.click(saveButton())
    await waitFor(() => expect(editAsync.mock.calls.length).toBeGreaterThan(1))

    // The typed text reached the server; the deletion is held. The editor is
    // still not on the stored version, so verification stays disabled.
    await waitFor(() => expect(saveState()).toBe('unsaved'))
    expect(verifyButton().disabled).toBe(true)
    expect(screen.getByText(/Save before verification/)).toBeTruthy()
  })

  it('keeps verification disabled when text was typed while a save was in flight', async () => {
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
    mountGate({ editAsync })
    edit('Hello first')
    await waitFor(() => expect(verifyButton().disabled).toBe(true))
    fireEvent.click(saveButton())
    await waitFor(() => expect(editAsync).toHaveBeenCalledTimes(1))

    fireEvent.change(bodyEditor(), { target: { value: 'Hello second' } })
    await act(async () => {
      resolveFirst({
        documentId: 'doc_1',
        versionId: 'ver_2',
        versionNumber: 2,
      })
    })

    await waitFor(() => expect(saveState()).toBe('unsaved'))
    expect(verifyButton().disabled).toBe(true)
    expect(screen.getByText(/Save before verification/)).toBeTruthy()
  })
})
