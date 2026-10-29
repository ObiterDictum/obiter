import { command, commandOrNull } from './editor-test-commands'

import '@obiter/test-dom'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import type { DocumentEditOperation } from '@obiter/contracts'

const documentHook = vi.hoisted(() => ({ useDocument: vi.fn() }))
const runsHook = vi.hoisted(() => ({
  useDocumentVerificationRuns: vi.fn(),
  useCreateVerificationRun: vi.fn(),
  useVerificationFindings: vi.fn(),
  latestVerificationRun: vi.fn(),
}))

const documentsModule = { ...(await import('../../documents')) }
const documentsModuleKeys = Object.fromEntries(
  Object.keys(await import('../../documents')).map((key) => [key, undefined]),
)
mock.module('../../documents', () =>
  Object.assign(
    { ...documentsModuleKeys },
    (() => {
      const actual = documentsModule
      return { ...actual, useDocument: documentHook.useDocument }
    })(),
  ),
)
const verificationRunsModule = { ...(await import('../../verification-runs')) }
const verificationRunsModuleKeys = Object.fromEntries(
  Object.keys(await import('../../verification-runs')).map((key) => [
    key,
    undefined,
  ]),
)
mock.module('../../verification-runs', () =>
  Object.assign(
    { ...verificationRunsModuleKeys },
    (() => {
      const actual = verificationRunsModule
      return {
        ...actual,
        useDocumentVerificationRuns: runsHook.useDocumentVerificationRuns,
        useCreateVerificationRun: runsHook.useCreateVerificationRun,
        useVerificationFindings: runsHook.useVerificationFindings,
        latestVerificationRun: runsHook.latestVerificationRun,
      }
    })(),
  ),
)

const { bodyEditor, mountSaveDocumentWorkspace, saveState, validationFailed } =
  await import('./docx-workspace-save-harness')

function mountGate(options: {
  editAsync?: ReturnType<typeof vi.fn>
  paragraphs?: readonly string[]
}) {
  return mountSaveDocumentWorkspace(options)
}

function verifyButton() {
  return command('Check citations') as HTMLButtonElement
}

function saveButton() {
  return command('Save') as HTMLButtonElement
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

  it('keeps verification disabled while a refused save leaves work pending', async () => {
    const editAsync = vi.fn().mockRejectedValue(validationFailed)
    mountGate({ editAsync })
    edit('Hello edited')
    await waitFor(() => expect(verifyButton().disabled).toBe(true))

    fireEvent.click(saveButton())
    await waitFor(() => {
      expect(screen.getByText(/rejected typed text/i)).toBeTruthy()
    })

    await waitFor(() => expect(saveState()).toBe('unsaved'))
    expect(saveButton().disabled).toBe(false)
    expect(verifyButton().disabled).toBe(true)
    expect(screen.getByText(/Save before verification/)).toBeTruthy()
  })

  it('keeps a partial-bold draft coherent when the save is rejected', async () => {
    const editAsync = vi.fn().mockRejectedValue(validationFailed)
    mountGate({ editAsync })
    edit('Hello!')
    const editor = bodyEditor()
    editor.setSelectionRange(0, 2)
    fireEvent.select(editor)
    fireEvent.mouseUp(editor)
    fireEvent.click(command('Bold'))
    await waitFor(() => expect(verifyButton().disabled).toBe(true))

    fireEvent.click(saveButton())
    await waitFor(() => expect(saveState()).toBe('unsaved'))
    expect(verifyButton().disabled).toBe(true)
    expect(screen.getByText(/Save before verification/)).toBeTruthy()
    expect(bodyEditor().value).toBe('Hello!')
    expect(bodyEditor().value).not.toBe('Hello!llo')
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
    mountGate({ editAsync, paragraphs: ['Hello', 'Second'] })
    fireEvent.click(screen.getByText('Hello'))
    fireEvent.change(bodyEditor(), { target: { value: 'Hello world' } })
    fireEvent.click(command('Delete paragraph'))
    await waitFor(() => expect(verifyButton().disabled).toBe(true))

    fireEvent.click(saveButton())
    await waitFor(() => expect(editAsync.mock.calls.length).toBeGreaterThan(1))

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

  it('opens the dock from the menu entry without starting a second run', async () => {
    mountGate({ editAsync: vi.fn() })
    await waitFor(() => expect(verifyButton().disabled).toBe(false))

    fireEvent.click(command('Verify citations'))
    expect(
      await screen.findByRole('region', { name: 'Verification' }),
    ).toBeTruthy()
  })

  it('carries the unsaved gate and its reason onto the header control', async () => {
    mountGate({ editAsync: vi.fn() })
    await waitFor(() => expect(verifyButton().disabled).toBe(false))

    edit('Hello world')

    await waitFor(() => expect(verifyButton().disabled).toBe(true))
    expect(screen.getByText(/Save before verification/)).toBeTruthy()
  })

  it('disables the header control while verification status is still loading', () => {
    runsHook.useDocumentVerificationRuns.mockReturnValue({
      isPending: true,
      isError: false,
      data: undefined,
    })
    mountGate({ editAsync: vi.fn() })
    expect(commandOrNull('Check citations')).toBeNull()
    expect(screen.getAllByText(/Checking…/).length).toBeGreaterThan(0)
  })

  it('disables the header control when verification runs are unavailable', () => {
    runsHook.useDocumentVerificationRuns.mockReturnValue({
      isPending: false,
      isError: true,
      error: new Error('runs service is down'),
      data: undefined,
    })
    mountGate({ editAsync: vi.fn() })
    expect(verifyButton()).toHaveProperty('disabled', true)
    expect(screen.getByText(/Verification runs are unavailable/i)).toBeTruthy()
  })

  it('disables the header control when the document is unavailable', () => {
    documentHook.useDocument.mockReturnValue({
      isPending: false,
      isError: true,
      data: undefined,
    })
    mountGate({ editAsync: vi.fn() })
    expect(verifyButton()).toHaveProperty('disabled', true)
    expect(screen.getByText(/This document is unavailable/i)).toBeTruthy()
  })

  it('disables the header control while a run start is already pending', () => {
    runsHook.useCreateVerificationRun.mockReturnValue({
      isPending: true,
      mutate: vi.fn(),
      error: null,
    })
    mountGate({ editAsync: vi.fn() })
    expect(verifyButton()).toHaveProperty('disabled', true)
    expect(
      screen.getByText(/A verification run is already starting/i),
    ).toBeTruthy()
  })
})
