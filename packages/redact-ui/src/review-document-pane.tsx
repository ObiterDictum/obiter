import { useState } from 'react'
import { SplitScaleProvider } from '@obiter/app-shell'
import { cn } from '@obiter/ui'
import type { RedactionRun, DocumentTextLayout } from './types'
import type { WordCoverage } from './word-review-marks'
import { ReviewSourceDocument } from './review-source-document'
import { ReviewZoomControls } from './review-zoom'

export function ReviewDocumentPane({
  run,
  text,
  selectedId,
  focusRequest,
  onSelect,
  word,
  onWordCoverage,
  pdf,
  className,
}: {
  run: RedactionRun
  text: string
  selectedId: string | null
  focusRequest: { id: string } | null
  onSelect: (id: string) => void
  word: boolean
  onWordCoverage: (coverage: WordCoverage) => void
  pdf: { file: Blob; layout: DocumentTextLayout } | null
  className?: string
}) {
  const [zoom, setZoom] = useState(100)
  return (
    <SplitScaleProvider active zoom={zoom} onZoom={setZoom}>
      <div
        className={cn('flex min-h-0 min-w-0 flex-1 flex-col', className)}
        data-review-pane="document"
      >
        {word || pdf ? (
          <div className="flex shrink-0 items-center justify-end border-b border-line bg-surface px-4 py-1.5">
            <ReviewZoomControls />
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto bg-canvas">
          <ReviewSourceDocument
            run={run}
            text={text}
            selectedId={selectedId}
            focusRequest={focusRequest}
            onSelect={onSelect}
            word={word}
            onWordCoverage={onWordCoverage}
            pdf={pdf}
          />
        </div>
      </div>
    </SplitScaleProvider>
  )
}
