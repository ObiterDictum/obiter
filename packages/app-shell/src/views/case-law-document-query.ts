import { queryOptions } from '@tanstack/react-query'
import type { CaseLawSummaryResponse } from '@obiter/contracts'
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
  courtParagraphNumbers?: boolean
  acquiredAt?: string | null
  judges?: string[]
  summary?: CaseLawSummaryResponse | null
  withdrawn?: CaseLawWithdrawnNotice
}

export function caseLawDocumentQueryOptions(caseId: string) {
  return queryOptions({
    queryKey: ['case-law-document', caseId],
    staleTime: 0,
    retry: 1,
    refetchOnMount: 'always',
    queryFn: async () => {
      const response = await fetch(
        apiUrl(`/api/search/documents/${encodeURIComponent(caseId)}`),
      )

      if (!response.ok) {
        throw new Error('Case law document was not found.')
      }

      // SAFETY: non-ok responses throw above; /api/search/documents/:id returns CaseLawDocumentResponse per the search API contract.
      return (await response.json()) as CaseLawDocumentResponse
    },
  })
}
