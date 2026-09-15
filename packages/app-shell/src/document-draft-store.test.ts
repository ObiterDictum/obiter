// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  DOCUMENT_DRAFT_SCHEMA_VERSION,
  clearAllDocumentDrafts,
  clearDocumentDraft,
  clearStoredDocumentDrafts,
  discardDocumentDrafts,
  documentDraftKey,
  documentDraftTabId,
  listDocumentDrafts,
  readDocumentDraft,
  rememberDocumentDraftUser,
  touchDocumentDraftWriterClaim,
  writeDocumentDraft,
} from './document-draft-store'
import {
  MapStorage,
  scope,
  stateWithText,
} from './document-draft-store-test-support'

describe('document draft keys', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('scopes by schema version, organisation, user, document and tab', () => {
    const key = documentDraftKey(scope)
    expect(key).toBe(
      `obiter.document-draft.${String(DOCUMENT_DRAFT_SCHEMA_VERSION)}.org_1.usr_1.doc_1.tab_1`,
    )
    expect(documentDraftKey({ ...scope, tabId: 'tab_2' })).not.toBe(key)
    expect(documentDraftKey({ ...scope, documentId: 'doc_2' })).not.toBe(key)
    expect(documentDraftKey({ ...scope, userId: 'usr_2' })).not.toBe(key)
    expect(documentDraftKey({ ...scope, organisationId: 'org_2' })).not.toBe(
      key,
    )
  })

  it('reuses the tab id it has already stored', () => {
    const storage = new MapStorage()
    const first = documentDraftTabId(storage)
    expect(documentDraftTabId(storage)).toBe(first)
  })

  it('falls back to a per-page id when the tab store is unavailable', () => {
    expect(documentDraftTabId(null)).toBe(documentDraftTabId(null))
  })
})

describe('document draft persistence', () => {
  it('round-trips a draft and its held changes', () => {
    const storage = new MapStorage()
    const held = [
      {
        id: 'held_1',
        label: 'a paragraph deletion',
        reason: 'The server rejected this change.',
        createdAt: '2026-09-14T00:00:00.000Z',
        state: stateWithText('held'),
      },
    ]
    expect(
      writeDocumentDraft(storage, scope, {
        baseVersionId: 'ver_1',
        state: stateWithText('hello'),
        held,
      }),
    ).toBe(true)

    const restored = readDocumentDraft(storage, scope, 'ver_1')
    expect(restored.status).toBe('restored')
    if (restored.status !== 'restored') throw new Error('expected restored')
    expect(restored.state.drafts).toEqual({ r1: 'hello' })
    expect(restored.state.format.paragraphStyles).toEqual({ p1: 'Heading1' })
    expect(restored.held).toEqual(held)
  })

  it('reports a draft recorded against another stored version as stale and keeps it', () => {
    const storage = new MapStorage()
    writeDocumentDraft(storage, scope, {
      baseVersionId: 'ver_1',
      state: stateWithText('hello'),
      held: [],
    })
    const restored = readDocumentDraft(storage, scope, 'ver_2')
    expect(restored).toEqual({ status: 'stale', baseVersionId: 'ver_1' })
    expect(
      listDocumentDrafts(storage, scope).some(
        (item) => item.status === 'parked',
      ),
    ).toBe(true)
    discardDocumentDrafts(storage, scope)
    expect(readDocumentDraft(storage, scope, 'ver_2')).toEqual({
      status: 'empty',
    })
  })

  it('parks a stale draft so new work in the same tab still persists', () => {
    const storage = new MapStorage()
    writeDocumentDraft(storage, scope, {
      baseVersionId: 'ver_1',
      state: stateWithText('stale work'),
      held: [],
    })
    expect(readDocumentDraft(storage, scope, 'ver_2').status).toBe('stale')
    // The active key is free again, so this tab can keep saving new drafts.
    expect(
      writeDocumentDraft(storage, scope, {
        baseVersionId: 'ver_2',
        state: stateWithText('new work'),
        held: [],
      }),
    ).toBe(true)
    const restored = readDocumentDraft(storage, scope, 'ver_2')
    expect(restored.status === 'restored' && restored.state.drafts).toEqual({
      r1: 'new work',
    })
    // A successful save clears the active draft and leaves the parked one for
    // the user to discard.
    clearDocumentDraft(storage, scope)
    expect(
      listDocumentDrafts(storage, scope).some(
        (item) => item.status === 'parked',
      ),
    ).toBe(true)
    expect(readDocumentDraft(storage, scope, 'ver_2')).toEqual({
      status: 'stale',
      baseVersionId: 'ver_1',
    })
  })

  it('drops malformed stored data instead of applying it', () => {
    const storage = new MapStorage()
    storage.setItem(documentDraftKey(scope), '{not json')
    expect(readDocumentDraft(storage, scope, 'ver_1')).toEqual({
      status: 'empty',
    })
    expect(storage.getItem(documentDraftKey(scope))).toBeNull()
  })

  it('drops a payload written by an older schema version', () => {
    const storage = new MapStorage()
    storage.setItem(
      documentDraftKey(scope),
      JSON.stringify({
        schemaVersion: DOCUMENT_DRAFT_SCHEMA_VERSION - 1,
        organisationId: 'org_1',
        userId: 'usr_1',
        documentId: 'doc_1',
        baseVersionId: 'ver_1',
        updatedAt: new Date().toISOString(),
        state: stateWithText('hello'),
        held: [],
      }),
    )
    expect(readDocumentDraft(storage, scope, 'ver_1')).toEqual({
      status: 'empty',
    })
    expect(storage.getItem(documentDraftKey(scope))).toBeNull()
  })

  it('refuses a payload that names another user, organisation or document', () => {
    for (const foreign of [
      { organisationId: 'org_2' },
      { userId: 'usr_2' },
      { documentId: 'doc_2' },
    ]) {
      const storage = new MapStorage()
      const foreignScope = { ...scope, ...foreign }
      writeDocumentDraft(storage, foreignScope, {
        baseVersionId: 'ver_1',
        state: stateWithText('someone else'),
        held: [],
      })
      // Move the payload under this session's key: a scope mismatch must still
      // stop it being offered to the wrong user or document.
      const key = documentDraftKey(scope)
      storage.entries.set(
        key,
        storage.getItem(documentDraftKey(foreignScope)) ?? '',
      )
      expect(readDocumentDraft(storage, scope, 'ver_1')).toEqual({
        status: 'empty',
      })
      expect(storage.getItem(key)).toBeNull()
    }
  })

  it('keeps two tabs on one document independent', () => {
    const storage = new MapStorage()
    const tabA = { ...scope, tabId: 'tab_a' }
    const tabB = { ...scope, tabId: 'tab_b' }
    writeDocumentDraft(storage, tabA, {
      baseVersionId: 'ver_1',
      state: stateWithText('from tab a'),
      held: [],
    })
    writeDocumentDraft(storage, tabB, {
      baseVersionId: 'ver_1',
      state: stateWithText('from tab b'),
      held: [],
    })
    touchDocumentDraftWriterClaim(storage, 'tab_a', 'instance-a')
    touchDocumentDraftWriterClaim(storage, 'tab_b', 'instance-b')

    const a = readDocumentDraft(storage, tabA, 'ver_1')
    const b = readDocumentDraft(storage, tabB, 'ver_1')
    expect(a.status === 'restored' && a.state.drafts).toEqual({
      r1: 'from tab a',
    })
    expect(b.status === 'restored' && b.state.drafts).toEqual({
      r1: 'from tab b',
    })

    clearDocumentDraft(storage, tabA)
    expect(readDocumentDraft(storage, tabA, 'ver_1')).toEqual({
      status: 'empty',
    })
    expect(readDocumentDraft(storage, tabB, 'ver_1').status).toBe('restored')
  })

  it('drops an expired draft', () => {
    const storage = new MapStorage()
    storage.setItem(
      documentDraftKey(scope),
      JSON.stringify({
        schemaVersion: DOCUMENT_DRAFT_SCHEMA_VERSION,
        organisationId: 'org_1',
        userId: 'usr_1',
        documentId: 'doc_1',
        baseVersionId: 'ver_1',
        updatedAt: '2020-01-01T00:00:00.000Z',
        state: stateWithText('old'),
        held: [],
      }),
    )
    expect(readDocumentDraft(storage, scope, 'ver_1')).toEqual({
      status: 'empty',
    })
  })

  it('reports a refused write instead of throwing', () => {
    const storage = new MapStorage()
    storage.failWrites = true
    expect(
      writeDocumentDraft(storage, scope, {
        baseVersionId: 'ver_1',
        state: stateWithText('hello'),
        held: [],
      }),
    ).toBe(false)
  })

  it('reports an unreadable store instead of throwing', () => {
    const storage = new MapStorage()
    storage.failReads = true
    expect(readDocumentDraft(storage, scope, 'ver_1')).toEqual({
      status: 'unavailable',
    })
  })

  it('clears every draft on sign-out and leaves unrelated keys alone', () => {
    const storage = new MapStorage()
    writeDocumentDraft(storage, scope, {
      baseVersionId: 'ver_1',
      state: stateWithText('a'),
      held: [],
    })
    writeDocumentDraft(
      storage,
      { ...scope, userId: 'usr_2', tabId: 'tab_2' },
      { baseVersionId: 'ver_1', state: stateWithText('b'), held: [] },
    )
    storage.setItem('obiter.something-else', 'keep')

    clearAllDocumentDrafts(storage)

    expect([...storage.entries.keys()]).toEqual(['obiter.something-else'])
  })

  it('clears browser drafts on sign-out', () => {
    rememberDocumentDraftUser('usr_1')
    window.localStorage.setItem(documentDraftKey(scope), 'a draft')
    window.localStorage.setItem(
      documentDraftKey({ ...scope, userId: 'usr_2', tabId: 'tab_2' }),
      'other user',
    )
    window.localStorage.setItem('obiter.something-else', 'keep')

    clearStoredDocumentDrafts()

    expect(window.localStorage.getItem(documentDraftKey(scope))).toBeNull()
    expect(
      window.localStorage.getItem(
        documentDraftKey({ ...scope, userId: 'usr_2', tabId: 'tab_2' }),
      ),
    ).toBe('other user')
    expect(window.localStorage.getItem('obiter.something-else')).toBe('keep')
    rememberDocumentDraftUser(null)
  })

  it('does not wipe every account when no user is remembered', () => {
    rememberDocumentDraftUser(null)
    window.localStorage.setItem(documentDraftKey(scope), 'a draft')
    clearStoredDocumentDrafts()
    expect(window.localStorage.getItem(documentDraftKey(scope))).toBe('a draft')
  })
})
