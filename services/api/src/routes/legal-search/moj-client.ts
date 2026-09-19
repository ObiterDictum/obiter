import type { LegalAuthority } from '@obiter/legal-schema'
import { getDocument, indexDocuments } from '@obiter/search-client'
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
  try {
    const stored = await withTimeout(
      legalAuthorityStore.get(documentId),
      storedSearchTimeoutMs,
    )
    return Boolean(stored?.withdrawn)
  } catch {
    return false
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | null> {
  let timeout: ReturnType<typeof setTimeout>

  return Promise.race([
    promise.finally(() => clearTimeout(timeout)),
    new Promise<null>((resolve) => {
      timeout = setTimeout(() => resolve(null), timeoutMs)
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

export async function indexFetchedAuthorities(
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

export async function hydrateMojAuthoritiesFromSearch(
  env: ApiEnv,
  reads: LegalAuthorityReadStore,
  writes: LegalAuthorityWriteStore,
  indexClient: Parameters<typeof indexDocuments>[0],
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
  indexClient: Parameters<typeof indexDocuments>[0],
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

    await indexFetchedAuthorities(indexClient, indexName, documents)
  } catch {
    // Provider data has already been captured when possible; indexing is best-effort cache hydration.
  }
}
