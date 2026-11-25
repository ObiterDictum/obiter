import { Component, lazy, Suspense, type ReactNode } from 'react'
import { HighlightedText, Paper } from './review-document-text'
import { PdfReviewDocument } from './pdf-review-document'
import type { DocumentTextLayout, RedactionRun } from './types'
import type { WordCoverage } from './word-review-marks'

const WordReviewSource = lazy(() => import('./word-review-source'))

const loadingWord = (
  <p className="p-5 text-meta text-muted" role="status">
    Loading Word pages and highlights…
  </p>
)

class WordPreviewBoundary extends Component<{
  children: ReactNode
  fallback: ReactNode
}> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export function ReviewSourceDocument({
  run,
  text,
  selectedId,
  focusRequest,
  onSelect,
  word,
  onWordCoverage,
  pdf,
}: {
  run: RedactionRun
  text: string
  selectedId: string | null
  focusRequest: { id: string } | null
  onSelect: (id: string) => void
  word: boolean
  onWordCoverage: (coverage: WordCoverage) => void
  pdf: { file: Blob; layout: DocumentTextLayout } | null
}) {
  if (pdf)
    return (
      <PdfReviewDocument
        file={pdf.file}
        layout={pdf.layout}
        spans={run.spans}
        decisions={run.decisions}
        selectedId={selectedId}
        onSelect={onSelect}
      />
    )

  const textView = (
    <Paper>
      <HighlightedText
        text={text}
        run={run}
        selectedId={selectedId}
        onSelect={onSelect}
      />
    </Paper>
  )
  if (!word) return textView

  const fallback = (
    <>
      <p
        className="border-b border-line px-5 py-3 text-meta text-muted"
        role="status"
      >
        The Word layout could not be matched to this review. Showing the
        extracted text.
      </p>
      {textView}
    </>
  )
  if (run.sourcePreview?.kind === 'docx' && !run.sourcePreview.available)
    return fallback
  return (
    <WordPreviewBoundary key={run.id} fallback={fallback}>
      <Suspense fallback={loadingWord}>
        <WordReviewSource
          run={run}
          selectedId={selectedId}
          focusRequest={focusRequest}
          onSelect={onSelect}
          onCoverage={onWordCoverage}
          fallback={fallback}
          loading={loadingWord}
        />
      </Suspense>
    </WordPreviewBoundary>
  )
}
