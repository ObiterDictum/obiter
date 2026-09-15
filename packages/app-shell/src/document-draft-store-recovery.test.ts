// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  discardDocumentDrafts,
  listRecoverableDocumentDrafts,
  readDocumentDraft,
  resolveDocumentDraftWriter,
  touchDocumentDraftWriterClaim,
  writeDocumentDraft,
} from './document-draft-store'
import {
  MapStorage,
  scope,
  stateWithText,
} from './document-draft-store-test-support'

// The suite title matches document-draft-store.test.ts: these cases were split
// out of the same `document draft persistence` suite so the file stays under
// the 500-line ceiling without renaming any collected test.
describe('document draft persistence', () => {
  it('discovers a draft after the tab that wrote it has gone', () => {
    const storage = new MapStorage()
    writeDocumentDraft(
      storage,
      { ...scope, tabId: 'closed-tab' },
      {
        baseVersionId: 'ver_1',
        state: stateWithText('closed tab work'),
        held: [],
      },
    )

    const restored = readDocumentDraft(
      storage,
      { ...scope, tabId: 'new-tab' },
      'ver_1',
    )
    expect(restored.status).toBe('restored')
    if (restored.status !== 'restored') throw new Error('expected restored')
    expect(restored.state.drafts).toEqual({ r1: 'closed tab work' })
  })

  it('does not let a duplicated session identity write the original draft key', () => {
    const storage = new MapStorage()
    const session = new MapStorage()
    const originalWriter = resolveDocumentDraftWriter(
      session,
      storage,
      'instance-a',
      1_000,
    )
    writeDocumentDraft(
      storage,
      { ...scope, tabId: originalWriter },
      {
        baseVersionId: 'ver_1',
        state: stateWithText('from the original tab'),
        held: [],
      },
    )

    const duplicatedSession = new MapStorage()
    duplicatedSession.setItem('obiter.document-draft.tab', originalWriter)
    const duplicateWriter = resolveDocumentDraftWriter(
      duplicatedSession,
      storage,
      'instance-b',
      1_500,
    )
    expect(duplicateWriter).not.toBe(originalWriter)

    writeDocumentDraft(
      storage,
      { ...scope, tabId: duplicateWriter },
      {
        baseVersionId: 'ver_1',
        state: stateWithText('from the duplicate tab'),
        held: [],
      },
    )

    const original = readDocumentDraft(
      storage,
      { ...scope, tabId: originalWriter },
      'ver_1',
    )
    expect(original.status === 'restored' && original.state.drafts).toEqual({
      r1: 'from the original tab',
    })
  })

  it('asks which draft to restore when two abandoned writers exist', () => {
    const storage = new MapStorage()
    writeDocumentDraft(
      storage,
      { ...scope, tabId: 'gone-a' },
      {
        baseVersionId: 'ver_1',
        state: stateWithText('draft a'),
        held: [],
      },
    )
    writeDocumentDraft(
      storage,
      { ...scope, tabId: 'gone-b' },
      {
        baseVersionId: 'ver_1',
        state: stateWithText('draft b'),
        held: [],
      },
    )

    const result = readDocumentDraft(
      storage,
      { ...scope, tabId: 'new-tab' },
      'ver_1',
    )
    expect(result.status).toBe('choice')
    if (result.status !== 'choice') throw new Error('expected choice')
    expect(result.drafts.map((item) => item.writerId).sort()).toEqual([
      'gone-a',
      'gone-b',
    ])
  })

  it('does not offer a live sibling tab as recoverable', () => {
    const storage = new MapStorage()
    const tabA = { ...scope, tabId: 'tab_a' }
    const tabB = { ...scope, tabId: 'tab_b' }
    writeDocumentDraft(storage, tabA, {
      baseVersionId: 'ver_1',
      state: stateWithText('from tab a'),
      held: [],
    })
    touchDocumentDraftWriterClaim(storage, 'tab_a', 'instance-a')

    expect(listRecoverableDocumentDrafts(storage, tabB)).toEqual([])
  })

  it('rebuilds recovery from payloads when the registry is corrupt', () => {
    const storage = new MapStorage()
    writeDocumentDraft(storage, scope, {
      baseVersionId: 'ver_1',
      state: stateWithText('payload wins'),
      held: [],
    })
    storage.setItem(
      'obiter.document-draft.registry.1.org_1.usr_1.doc_1',
      '{not json',
    )
    const restored = readDocumentDraft(storage, scope, 'ver_1')
    expect(restored.status === 'restored' && restored.state.drafts).toEqual({
      r1: 'payload wins',
    })
  })

  it('discards a parked draft without deleting live work', () => {
    const storage = new MapStorage()
    writeDocumentDraft(storage, scope, {
      baseVersionId: 'ver_1',
      state: stateWithText('parked'),
      held: [],
    })
    expect(readDocumentDraft(storage, scope, 'ver_2').status).toBe('stale')
    writeDocumentDraft(storage, scope, {
      baseVersionId: 'ver_2',
      state: stateWithText('live work'),
      held: [],
    })

    discardDocumentDrafts(storage, scope)
    const live = readDocumentDraft(storage, scope, 'ver_2')
    expect(live.status === 'restored' && live.state.drafts).toEqual({
      r1: 'live work',
    })
  })
})
