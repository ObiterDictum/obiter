import '@obiter/test-dom'
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import type { VerificationRun } from '@obiter/contracts'
import type { DocumentVersionRecord } from '../../documents'
import {
  DocumentEditorHeader,
  headerSaveState,
  readOnlyHeaderState,
} from './document-editor-header'
import { verifyStatus } from './document-verify-status'
import type { VerificationWorkspaceValue } from '../verification/verification-context'

const versions = [
  { id: 'ver_2', versionNumber: 2 },
  { id: 'ver_1', versionNumber: 1 },
] as DocumentVersionRecord[]

function run(overrides: Partial<VerificationRun>): VerificationRun {
  return {
    id: 'vr_1',
    organisationId: 'org_1',
    matterId: 'mtr_1',
    documentId: 'doc_1',
    documentVersionId: 'ver_2',
    status: 'completed',
    failureCode: null,
    createdBy: 'usr_1',
    createdAt: '2026-10-26T16:40:00.000Z',
    startedAt: '2026-10-26T16:40:00.000Z',
    completedAt: '2026-10-26T16:41:00.000Z',
    summary: {
      findingCount: 4,
      flaggedCount: 0,
      reviewRequiredCount: 0,
      dismissedCount: 0,
      notCheckedCount: 0,
    },
    documentCurrentVersionId: 'ver_2',
    stale: false,
    ...overrides,
  }
}

function verification(
  overrides: Partial<VerificationWorkspaceValue>,
): VerificationWorkspaceValue {
  return {
    run: null,
    stale: false,
    runsPending: false,
    openIndex: () => {},
    revealStart: () => {},
    ...overrides,
  } as VerificationWorkspaceValue
}

describe('headerSaveState', () => {
  const base = {
    versionLabel: 'version 2',
    offline: false,
    remoteChange: false,
  }

  it('says saved and keeps the version on the tooltip', () => {
    const state = headerSaveState({ ...base, state: { status: 'saved' } })
    expect(state.label).toBe('Saved')
    expect(state.detail).toContain('version 2')
  })

  it('keeps every state the save machine can reach', () => {
    expect(
      headerSaveState({ ...base, state: { status: 'unsaved' } }).label,
    ).toBe('Unsaved changes')
    expect(
      headerSaveState({ ...base, state: { status: 'saving' } }).label,
    ).toBe('Saving…')
    expect(
      headerSaveState({ ...base, state: { status: 'failed' } }).label,
    ).toBe('Save failed')
    expect(headerSaveState({ ...base, state: { status: 'stale' } })).toEqual({
      label: '',
      tone: null,
      detail: '',
      status: 'stale',
    })
    expect(
      headerSaveState({ ...base, state: { status: 'blocked' } }).label,
    ).toBe('Saved, history needs a reload')
  })

  it('says the changes are not saved while the browser is offline', () => {
    const state = headerSaveState({
      ...base,
      offline: true,
      state: { status: 'unsaved' },
    })
    expect(state.label).toBe('Offline · changes not saved')
    expect(state.detail).toContain('version 2')
  })

  it('reports a newer version on the server rather than implying a clean save', () => {
    expect(
      headerSaveState({
        ...base,
        remoteChange: true,
        state: { status: 'unsaved' },
      }).label,
    ).toBe('Newer version on the server')
  })
})

describe('verifyStatus', () => {
  it('says a run checked the version on screen', () => {
    const chip = verifyStatus(
      verification({ run: run({}) }),
      versions as DocumentVersionRecord[],
    )
    expect(chip.label).toBe('Checked · version 2')
    expect(chip.current).toBe(true)
    expect(chip.detail).toContain('not a statement of legal correctness')
  })

  it('names the older version a stale run checked, never the current text', () => {
    const chip = verifyStatus(
      verification({
        run: run({ documentVersionId: 'ver_1', stale: true }),
        stale: true,
      }),
      versions as DocumentVersionRecord[],
    )
    expect(chip.label).toBe('Check out of date · version 1')
    expect(chip.current).toBe(false)
    expect(chip.detail).toContain('has changed since')
  })

  it('says so when nothing has been checked', () => {
    expect(
      verifyStatus(verification({}), versions as DocumentVersionRecord[]).label,
    ).toBe('Not checked')
  })

  it('carries the finding counts of the run it names', () => {
    const chip = verifyStatus(
      verification({
        run: run({
          summary: {
            findingCount: 3,
            flaggedCount: 1,
            reviewRequiredCount: 2,
            dismissedCount: 0,
            notCheckedCount: 0,
          },
        }),
      }),
      versions as DocumentVersionRecord[],
    )
    expect(chip.label).toBe('Checked · version 2 · 1 flagged')
    expect(chip.tone).toBe('danger')
  })
})

describe('DocumentEditorHeader', () => {
  afterEach(cleanup)

  it('is one slim row carrying the name, the quiet state and the actions', () => {
    render(
      <DocumentEditorHeader
        filename="brief.docx"
        state={readOnlyHeaderState('version 3')}
        actions={<button type="button">More</button>}
      />,
    )

    const header = screen.getByRole('heading', { level: 1 }).closest('header')
    expect(header?.className).toContain('h-9')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'brief.docx',
    )
    expect(screen.getByText('Read only')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy()
    expect(header?.querySelector('a')).toBeNull()
    expect(header?.textContent).not.toContain('Track changes')
  })
})
