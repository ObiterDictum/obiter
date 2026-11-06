import {
  InlineChangeReview,
  useInlineReviewValue,
} from './inline-change-review'
import type { ReactNode } from 'react'
import type { DocumentStructureToolbar } from './ribbon-types'
import { TableStructureSurface } from './table-structure-surface'

export function WorkspaceTableSurface({
  structure,
  children,
  review,
  onReview,
}: {
  structure: DocumentStructureToolbar
  children: ReactNode
  review: Parameters<typeof useInlineReviewValue>[0]
  onReview: () => void
}) {
  const value = useInlineReviewValue(review, onReview)
  return (
    <InlineChangeReview value={value}>
      <TableStructureSurface
        unavailable={structure.tableStructureUnavailable}
        onChange={structure.onTableStructure}
      >
        {children}
      </TableStructureSurface>
    </InlineChangeReview>
  )
}
