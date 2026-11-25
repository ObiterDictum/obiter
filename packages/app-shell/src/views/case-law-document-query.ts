import { queryOptions } from '@tanstack/react-query'
import type {
  CaseLawSummaryResponse,
  JudgmentCover,
  JudgmentPage,
  JudgmentParagraph,
} from '@obiter/contracts'
import { apiFetch, isApiNotFound } from '../api'

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
    retry: (count, error) => !isApiNotFound(error) && count < 1,
    refetchOnMount: 'always',
    queryFn: () =>
      apiFetch<CaseLawDocumentResponse>(
        `/api/search/documents/${encodeURIComponent(caseId)}`,
      ),
  })
}
