import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import type { VerificationRun } from '@obiter/contracts'
import type { DocumentVersionRecord } from '../../documents'
import { headerSaveState } from './document-editor-header'
import { verifyChipState } from './document-verify-chip'
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
    summary: { findingCount: 4, flaggedCount: 0, reviewRequiredCount: 0 },
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

  it('names the version the work on screen is saved as', () => {
    expect(headerSaveState({ ...base, state: { status: 'saved' } }).label).toBe(
      'Saved · version 2',
    )
  })

  it('keeps every state the save machine can reach', () => {
    expect(
      headerSaveState({ ...base, state: { status: 'unsaved' } }).label,
    ).toBe('Unsaved changes · version 2')
    expect(
      headerSaveState({ ...base, state: { status: 'saving' } }).label,
    ).toBe('Saving…')
    expect(
      headerSaveState({ ...base, state: { status: 'failed' } }).label,
    ).toBe('Save failed: your work is not on the server')
    expect(headerSaveState({ ...base, state: { status: 'stale' } }).label).toBe(
      'The document has changed on the server',
    )
    expect(
      headerSaveState({ ...base, state: { status: 'blocked' } }).label,
    ).toBe('Saved, but the edit history needs a reload')
  })

  it('says the changes are not saved while the browser is offline', () => {
    expect(
      headerSaveState({
        ...base,
        offline: true,
        state: { status: 'unsaved' },
      }).label,
    ).toBe('Offline · changes not saved')
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

describe('verifyChipState', () => {
  it('says a run checked the version on screen', () => {
    const chip = verifyChipState(
      verification({ run: run({}) }),
      versions as DocumentVersionRecord[],
    )
    expect(chip.label).toBe('Checked · version 2')
    expect(chip.current).toBe(true)
  })

  it('names the older version a stale run checked, never the current text', () => {
    const chip = verifyChipState(
      verification({
        run: run({ documentVersionId: 'ver_1', stale: true }),
        stale: true,
      }),
      versions as DocumentVersionRecord[],
    )
    expect(chip.label).toBe('Checked version 1 · out of date')
    expect(chip.current).toBe(false)
    expect(chip.detail).toContain('has changed since')
  })

  it('says so when nothing has been checked', () => {
    expect(
      verifyChipState(verification({}), versions as DocumentVersionRecord[])
        .label,
    ).toBe('Not checked')
  })

  it('carries the finding counts of the run it names', () => {
    const chip = verifyChipState(
      verification({
        run: run({
          summary: { findingCount: 3, flaggedCount: 1, reviewRequiredCount: 2 },
        }),
      }),
      versions as DocumentVersionRecord[],
    )
    expect(chip.label).toBe('Checked · version 2 · 1 flagged')
    expect(chip.tone).toBe('danger')
  })
})
