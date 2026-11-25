import { Button } from '@obiter/ui'
import type { LegalSearchFetchResponse } from './searchTypes'

export function SearchPagination({
  response,
  loading,
  error,
  onLoadMore,
}: {
  response: LegalSearchFetchResponse
  loading?: boolean
  error?: string
  onLoadMore: () => void
}) {
  const pagination = response.pagination
  if (!pagination) {
    return response.estimatedTotalHits &&
      response.estimatedTotalHits > response.hits.length ? (
      <p className="text-meta text-subtle">
        Top {response.hits.length} judgments shown. Refine the search to narrow
        the results.
      </p>
    ) : null
  }
  if (!pagination.hasMore && !error) return null

  return (
    <div className="flex flex-col items-start gap-2 border-t border-line pt-4">
      <p className="text-meta text-subtle">
        Showing {response.hits.length} of about {pagination.estimatedTotalHits}{' '}
        judgments
      </p>
      {error ? (
        <p className="text-meta text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <Button
        variant="secondary"
        size="sm"
        loading={loading}
        onClick={onLoadMore}
      >
        Load more
      </Button>
    </div>
  )
}
