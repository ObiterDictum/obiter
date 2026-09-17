/*
 * Recent legal-search queries, read from and written to sessionStorage.
 *
 * These live outside views/LegalSearchView because the app frame and Home both
 * render the recent-query list. Importing them from the view would pull the
 * whole search UI (command bar, results list, filter popovers) into the shared
 * navigation chunks that every route loads, for two functions that only touch
 * a string in sessionStorage.
 */
export const LEGAL_SEARCH_RECENT_SEARCHES_LIMIT = 5

const legalSearchRecentSearchesKey = 'obiter.search.recentSearches'

export function getRecentLegalSearches(
  storage: Pick<Storage, 'getItem'> | undefined,
) {
  if (!storage) return []

  const storedSearches = storage.getItem(legalSearchRecentSearchesKey)
  if (!storedSearches) return []

  try {
    const parsedSearches = JSON.parse(storedSearches) as unknown
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
