import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@obiter/app-shell'
import { redactionWordLayoutSchema } from '@obiter/contracts'
import type { RedactionRun } from './types'
import type { WordCoverage } from './word-review-marks'
import { WordReviewDocument } from './word-review-document'

export default function WordReviewSource({
  run,
  selectedId,
  focusRequest,
  onSelect,
  onCoverage,
  fallback,
  loading,
}: {
  run: RedactionRun
  selectedId: string | null
  focusRequest: { id: string } | null
  onSelect: (id: string) => void
  onCoverage: (coverage: WordCoverage) => void
  fallback: ReactNode
  loading: ReactNode
}) {
  const query = useQuery({
    queryKey: ['redaction-run-source', run.id, 'word-layout'],
    queryFn: async () => {
      const payload = await apiFetch<unknown>(
        `/api/redaction-runs/${encodeURIComponent(run.id)}/word-layout`,
      )
      const parsed = redactionWordLayoutSchema.safeParse(payload)
      if (!parsed.success) throw new Error('Word layout could not be read.')
      return parsed.data
    },
    retry: false,
    staleTime: Infinity,
  })
  if (query.isPending) return loading
  if (!query.data) return fallback
  return (
    <WordReviewDocument
      key={query.dataUpdatedAt}
      layout={query.data}
      runId={run.id}
      spans={run.spans}
      decisions={run.decisions}
      selectedId={selectedId}
      focusRequest={focusRequest}
      onSelect={onSelect}
      onCoverage={onCoverage}
    />
  )
}
