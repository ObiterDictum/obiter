/*
 * Case-law document data: the response shape and the query that fetches it.
 *
 * These live apart from views/CaseLawDocumentView so the `/cases/$caseId`
 * redirect route can resolve an id to its canonical slug without importing the
 * view. While both routes imported the view module the bundler shared it across
 * two dynamic routes and hoisted it into the entry chunk every route preloads.
 */
import { queryOptions } from '@tanstack/react-query'
import { apiUrl } from '../lib/api-url'

export interface CaseLawParagraph {
  id: string
  paragraphNumber: number
  text: string
}

export interface CaseLawDocument {
  id: string
  title: string
  neutralCitation: string | null
  court: string
  dateDecided: string
  sourceUrl: string
  paragraphs?: CaseLawParagraph[]
}

export interface CaseLawWithdrawnNotice {
  withdrawn: true
  withdrawnAt: string
  officialUrl: string
  message: string
}

export interface CaseLawDocumentResponse {
  document: CaseLawDocument
  withdrawn?: CaseLawWithdrawnNotice
}

export function caseLawDocumentQueryOptions(caseId: string) {
  return queryOptions({
    queryKey: ['case-law-document', caseId],
    // Withdrawal banners must appear without a reload: never serve this
    // from cache on mount, so a judgment withdrawn since the last visit
    // revalidates and the banner renders on fresh data.
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async () => {
      const response = await fetch(
        apiUrl(`/api/search/documents/${encodeURIComponent(caseId)}`),
      )

      if (!response.ok) {
        throw new Error('Case law document was not found.')
      }

      return (await response.json()) as CaseLawDocumentResponse
    },
  })
}
