import type { LegalAuthority } from '@obiter/legal-schema'
import {
  deleteDocuments,
  getDocument,
  indexDocuments,
} from '@obiter/search-client'
import {
  atomEntryToAuthoritySummary,
  fetchMojAuthorityDetail,
  fetchMojAuthoritySummaries,
  providerMetadataFromAtomEntry,
  type AtomEntry,
  type MojRateLimiter,
  type ProviderSourceMetadata,
} from '@obiter/legal-source-provider'
import type { ApiEnv } from '../../env'
import type { LegalFetchRequest } from '@obiter/legal-source-provider'
import {
  type AuthorityWriteResult,
  type LegalAuthorityReadStore,
  type LegalAuthorityWriteStore,
} from './source-store'

/**
 * Storage and index hydration for provider results. Retrieval and parsing live
 * in `@obiter/legal-source-provider`, which bulk ingestion shares.
 */

// Re-exported so the proxy routes and their tests keep one import site for the
// provider surface they use.
export {
  atomEntryToAuthoritySummary,
  fetchMojAuthorityDocumentById,
  fetchMojAuthorityDocumentFromRecord,
  fetchMojAuthoritySummaries,
  providerMetadataFromAtomEntry,
} from '@obiter/legal-source-provider'

const storedSearchTimeoutMs = 350

/** The index client hydration needs: a document write and a document delete. */
type HydrationIndexClient = Parameters<typeof indexDocuments>[0] &
  Parameters<typeof deleteDocuments>[0]

/**
 * Persist one provider summary. Returns null when the write did not happen, so
 * the caller never mistakes a failed write for a stored row. The failure is
 * reported, not discarded: a background hydration that silently stopped
 * persisting would look exactly like one that had nothing to do.
 */
export async function upsertLegalAuthoritySummary(
  writeStore: LegalAuthorityWriteStore,
  summary: LegalAuthority,
  provider: ProviderSourceMetadata,
): Promise<AuthorityWriteResult | null> {
  try {
    return await writeStore.upsertSummary(summary, provider)
  } catch (error) {
    console.error('Corpus summary write failed; summary not stored', {
      reason: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export async function upsertLegalAuthorityDocument(
  writeStore: LegalAuthorityWriteStore,
  document: LegalAuthority,
  provider: ProviderSourceMetadata,
): Promise<AuthorityWriteResult | null> {
  try {
    return await writeStore.upsertDocument(document, provider)
  } catch (error) {
    console.error('Corpus document write failed; document not stored', {
      reason: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/** `unknown` keeps an unreadable store distinct from a confirmed live row. */
type WithdrawalState = 'withdrawn' | 'live' | 'unknown'

async function readWithdrawalState(
  legalAuthorityStore: LegalAuthorityReadStore,
  documentId: string,
): Promise<WithdrawalState> {
  try {
    const stored = await withTimeout(
      legalAuthorityStore.get(documentId),
      storedSearchTimeoutMs,
    )
    return stored?.withdrawn ? 'withdrawn' : 'live'
  } catch {
    return 'unknown'
  }
}

/**
 * True only when the store explicitly reports the row withdrawn. A miss,
 * timeout, or error returns false so transient store trouble cannot block
 * hydration of live rows; withdrawn rows already stored are still hidden by
 * the read-time guards in the proxy routes.
 */
async function isWithdrawnInStore(
  legalAuthorityStore: LegalAuthorityReadStore,
  documentId: string,
): Promise<boolean> {
  return (
    (await readWithdrawalState(legalAuthorityStore, documentId)) === 'withdrawn'
  )
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>

  return Promise.race([
    promise.finally(() => clearTimeout(timeout)),
    new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error('Stored record lookup timed out.')),
        timeoutMs,
      )
    }),
  ])
}

export async function getStoredAuthorityDocument(
  indexClient: Parameters<typeof getDocument>[0],
  indexName: string,
  documentId: string,
) {
  try {
    return await withTimeout(
      getDocument(indexClient, indexName, documentId),
      storedSearchTimeoutMs,
    )
  } catch {
    return null
  }
}

async function indexFetchedAuthorities(
  indexClient: Parameters<typeof indexDocuments>[0],
  indexName: string,
  documents: LegalAuthority[],
) {
  if (documents.length === 0) {
    return { indexedCount: 0, failedCount: 0, errors: [] }
  }

  try {
    return await indexDocuments(indexClient, indexName, documents)
  } catch {
    return {
      indexedCount: 0,
      failedCount: documents.length,
      errors: [],
    }
  }
}

/**
 * Index freshly written authorities and reconcile the derived index against
 * the record. The write's own `indexable` decision orders it against a
 * withdrawal that serialised with the write, but two Meilisearch operations
 * are not ordered against each other: a withdrawal whose index delete lands
 * after the write but before this index call re-adds the document. The
 * withdrawal marks the row before it deletes the index copy, so re-reading
 * after the index write and deleting again when the flag is present closes
 * that ordering. A failed re-read is reported, not treated as live.
 */
export async function indexFetchedAuthoritiesAfterWrite(
  reads: LegalAuthorityReadStore,
  indexClient: HydrationIndexClient,
  indexName: string,
  documents: LegalAuthority[],
) {
  await indexFetchedAuthorities(indexClient, indexName, documents)
  await removeWithdrawnIndexCopies(reads, indexClient, indexName, documents)
}

async function removeWithdrawnIndexCopies(
  reads: LegalAuthorityReadStore,
  indexClient: HydrationIndexClient,
  indexName: string,
  documents: LegalAuthority[],
) {
  for (const document of documents) {
    const state = await readWithdrawalState(reads, document.id)
    if (state === 'live') continue
    if (state === 'unknown') {
      console.error(
        'Could not confirm a stored withdrawal state after indexing a corpus document; the derived index may hold a withdrawn copy. Run the search parity check.',
      )
      continue
    }
    try {
      await deleteDocuments(indexClient, indexName, [document.id])
    } catch (error) {
      console.error(
        'Indexed a withdrawn corpus document and could not remove it from the derived index. Run the search parity check.',
        { reason: error instanceof Error ? error.message : String(error) },
      )
    }
  }
}

export async function hydrateMojAuthoritiesFromSearch(
  env: ApiEnv,
  reads: LegalAuthorityReadStore,
  writes: LegalAuthorityWriteStore,
  indexClient: HydrationIndexClient,
  indexName: string,
  request: LegalFetchRequest,
  rateLimiter: MojRateLimiter,
) {
  try {
    const mojResult = await fetchMojAuthoritySummaries(
      env,
      request,
      rateLimiter,
    )
    if (mojResult.status !== 'ok') return

    for (const entry of mojResult.entries) {
      // Background hydration must not resurrect withdrawals: skip rows the
      // checker marked. Unknown store state proceeds — the read-time
      // cross-check still hides withdrawn hits from search responses.
      const summary = atomEntryToAuthoritySummary(env, entry)
      if (await isWithdrawnInStore(reads, summary.id)) continue
      await upsertLegalAuthoritySummary(
        writes,
        summary,
        providerMetadataFromAtomEntry(entry),
      )
    }

    await hydrateAndIndexMojAuthorities(
      env,
      reads,
      writes,
      indexClient,
      indexName,
      mojResult.entries,
      rateLimiter,
    )
  } catch {
    // Search has already returned from Obiter-owned sources; provider hydration is best effort.
  }
}

export async function hydrateAndIndexMojAuthorities(
  env: ApiEnv,
  reads: LegalAuthorityReadStore,
  writes: LegalAuthorityWriteStore,
  indexClient: HydrationIndexClient,
  indexName: string,
  entries: AtomEntry[],
  rateLimiter: MojRateLimiter,
) {
  if (entries.length === 0) return

  try {
    const detailTasks = entries
      .slice(0, 5)
      .map(async (entry) => fetchMojAuthorityDetail(env, entry, rateLimiter))
    const detailResults = await Promise.all(detailTasks)
    const documents: LegalAuthority[] = []
    for (const result of detailResults) {
      if (result.status !== 'ok') continue
      if (await isWithdrawnInStore(reads, result.document.id)) continue
      // The write decides whether the row may be indexed, from the state it
      // left behind. A serialized withdrawal is therefore respected: either
      // the merge saw the flag and refuses the index write, or the withdrawal
      // lands after and removes the indexed copy. Indexing on the strength of
      // the read above would put a withdrawn judgment back in the shared
      // index, where every lane would see it until the next rebuild.
      const written = await upsertLegalAuthorityDocument(
        writes,
        result.document,
        result.provider,
      )
      if (!written?.indexable) continue
      documents.push(result.document)
    }

    await indexFetchedAuthoritiesAfterWrite(
      reads,
      indexClient,
      indexName,
      documents,
    )
  } catch {
    // Provider data has already been captured when possible; indexing is best-effort cache hydration.
  }
}
