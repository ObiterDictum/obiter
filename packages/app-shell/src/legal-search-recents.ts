export const LEGAL_SEARCH_RECENT_SEARCHES_LIMIT = 5

const legalSearchRecentSearchesKey = 'obiter.search.recentSearches'

export function getRecentLegalSearches(
  storage: Pick<Storage, 'getItem'> | undefined,
) {
  if (!storage) return []

  const storedSearches = storage.getItem(legalSearchRecentSearchesKey)
  if (!storedSearches) return []

  try {
    const parsedSearches: unknown = JSON.parse(storedSearches)
    if (!Array.isArray(parsedSearches)) return []

    return dedupeRecentLegalSearches(
      parsedSearches.filter(
        (search): search is string => typeof search === 'string',
      ),
    )
  } catch {
    return []
  }
}

export function clearRecentLegalSearches(
  storage: Pick<Storage, 'removeItem'> | undefined,
) {
  storage?.removeItem(legalSearchRecentSearchesKey)
}

export function writeRecentLegalSearch(
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined,
  query: string,
) {
  if (!storage) return []

  const recentSearches = dedupeRecentLegalSearches([
    query,
    ...getRecentLegalSearches(storage),
  ])
  storage.setItem(legalSearchRecentSearchesKey, JSON.stringify(recentSearches))
  return recentSearches
}

function dedupeRecentLegalSearches(searches: string[]) {
  const seen = new Set<string>()
  const recentSearches: string[] = []

  for (const search of searches) {
    const trimmedSearch = search.trim()
    const normalizedSearch = trimmedSearch.toLowerCase()
    if (!trimmedSearch || seen.has(normalizedSearch)) continue

    seen.add(normalizedSearch)
    recentSearches.push(trimmedSearch)
    if (recentSearches.length >= LEGAL_SEARCH_RECENT_SEARCHES_LIMIT) break
  }

  return recentSearches
}
