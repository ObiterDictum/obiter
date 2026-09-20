import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LegalAuthority } from '@obiter/legal-schema'
import { indexFetchedAuthoritiesAfterWrite } from '../moj-client'
import type {
  LegalAuthorityReadStore,
  StoredLegalAuthorityRecord,
} from '../source-store'

const searchClientMock = vi.hoisted(() => ({
  indexDocuments: vi.fn(),
  deleteDocuments: vi.fn(),
}))

vi.mock('@obiter/search-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@obiter/search-client')>()),
  indexDocuments: searchClientMock.indexDocuments,
  deleteDocuments: searchClientMock.deleteDocuments,
}))

const indexName = 'legal_authorities'
// Both index functions are mocked, so the client is never dereferenced; the
// assertion only satisfies the structural client type.
const indexClient = {} as Parameters<
  typeof indexFetchedAuthoritiesAfterWrite
>[1]

const authority: LegalAuthority = {
  id: 'race-doc-1',
  title: 'Withdrawal Ordering Race Judgment',
  neutralCitation: null,
  court: 'uksc',
  jurisdiction: 'england-and-wales',
  dateDecided: '2026-03-03',
  sourceType: 'judgment',
  sourceUrl: 'https://caselaw.nationalarchives.gov.uk/uksc/2026/1',
  paragraphs: [],
}

const provider = {
  documentUri: '/uksc/2026/1',
  sourceUri: '/uksc/2026/1',
  xmlUri: '/uksc/2026/1/data.xml',
  pdfUri: null,
  contentHash: 'race-test',
  rawAtomEntry: '<entry />',
}

const withdrawn = {
  at: '2026-09-02T00:00:00.000Z',
  checkedUris: ['/uksc/2026/1'],
  runIds: ['race-run'],
}

function createStore() {
  let isWithdrawn = false
  return {
    setWithdrawn(value: boolean) {
      isWithdrawn = value
    },
    async get(documentId: string): Promise<StoredLegalAuthorityRecord | null> {
      if (documentId !== authority.id) return null
      return {
        summary: authority,
        provider,
        withdrawn: isWithdrawn ? withdrawn : null,
      }
    },
  } satisfies LegalAuthorityReadStore & {
    setWithdrawn(value: boolean): void
  }
}

let indexed: Set<string>

beforeEach(() => {
  indexed = new Set<string>()
  searchClientMock.indexDocuments.mockReset()
  searchClientMock.deleteDocuments.mockReset()
  searchClientMock.indexDocuments.mockImplementation(
    async (_client, _index, documents: LegalAuthority[]) => {
      for (const document of documents) indexed.add(document.id)
      return {
        indexedCount: documents.length,
        failedCount: 0,
        errors: [],
      }
    },
  )
  searchClientMock.deleteDocuments.mockImplementation(
    async (_client, _index, documentIds: string[]) => {
      for (const documentId of documentIds) indexed.delete(documentId)
      return { deletedCount: documentIds.length }
    },
  )
})

describe('indexFetchedAuthoritiesAfterWrite', () => {
  it('leaves a live document indexed', async () => {
    const store = createStore()

    await indexFetchedAuthoritiesAfterWrite(store, indexClient, indexName, [
      authority,
    ])

    expect(indexed.has(authority.id)).toBe(true)
    expect(searchClientMock.deleteDocuments).not.toHaveBeenCalled()
  })

  it('removes a document a withdrawal re-added after the hydration index write', async () => {
    // The previously surviving ordering, forced with a gate rather than hoped
    // for: the hydration index write is in flight, the withdrawal marks the row
    // and removes the index copy, and only then does the index write land.
    let releaseIndex!: () => void
    const indexGate = new Promise<void>((resolve) => {
      releaseIndex = resolve
    })
    searchClientMock.indexDocuments.mockImplementation(
      async (_client, _index, documents: LegalAuthority[]) => {
        await indexGate
        for (const document of documents) indexed.add(document.id)
        return {
          indexedCount: documents.length,
          failedCount: 0,
          errors: [],
        }
      },
    )
    indexed.add(authority.id)
    const store = createStore()

    const hydration = indexFetchedAuthoritiesAfterWrite(
      store,
      indexClient,
      indexName,
      [authority],
    )

    store.setWithdrawn(true)
    await searchClientMock.deleteDocuments(indexClient, indexName, [
      authority.id,
    ])

    releaseIndex()
    await hydration

    expect(indexed.has(authority.id)).toBe(false)
    expect(searchClientMock.deleteDocuments).toHaveBeenCalledTimes(2)
  })

  it('converges when concurrent hydration requests race one withdrawal', async () => {
    let releaseIndex!: () => void
    const indexGate = new Promise<void>((resolve) => {
      releaseIndex = resolve
    })
    searchClientMock.indexDocuments.mockImplementation(
      async (_client, _index, documents: LegalAuthority[]) => {
        await indexGate
        for (const document of documents) indexed.add(document.id)
        return {
          indexedCount: documents.length,
          failedCount: 0,
          errors: [],
        }
      },
    )
    indexed.add(authority.id)
    const store = createStore()

    const first = indexFetchedAuthoritiesAfterWrite(
      store,
      indexClient,
      indexName,
      [authority],
    )
    const second = indexFetchedAuthoritiesAfterWrite(
      store,
      indexClient,
      indexName,
      [authority],
    )

    store.setWithdrawn(true)
    await searchClientMock.deleteDocuments(indexClient, indexName, [
      authority.id,
    ])

    releaseIndex()
    await Promise.all([first, second])

    expect(indexed.has(authority.id)).toBe(false)
  })

  it('reports a post-index read failure instead of assuming the row is live', async () => {
    const store: LegalAuthorityReadStore = {
      async get(): Promise<StoredLegalAuthorityRecord | null> {
        throw new Error('store read failed')
      },
    }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await indexFetchedAuthoritiesAfterWrite(store, indexClient, indexName, [
      authority,
    ])

    expect(searchClientMock.deleteDocuments).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
