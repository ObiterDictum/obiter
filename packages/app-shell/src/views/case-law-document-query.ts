import { queryOptions } from '@tanstack/react-query'
import type {
  CaseLawSummaryResponse,
  JudgmentCover,
  JudgmentPage,
  JudgmentParagraph,
} from '@obiter/contracts'
import { apiUrl } from '../lib/api-url'

export type CaseLawParagraph = JudgmentParagraph

export interface CaseLawDocument {
  id: string
  title: string
  neutralCitation: string | null
  court: string
  dateDecided: string
  sourceUrl: string
  paragraphs?: CaseLawParagraph[]
  cover?: JudgmentCover
}

export interface CaseLawWithdrawnNotice {
  withdrawn: true
  withdrawnAt: string
  officialUrl: string
  message: string
}

export interface CaseLawDocumentResponse {
  document: CaseLawDocument
  pages?: JudgmentPage[]
  pageCount?: number
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
