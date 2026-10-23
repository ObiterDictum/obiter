import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@obiter/ui'
import {
  verificationEvidenceResponseSchema,
  type VerificationFindingView,
} from '@obiter/contracts'
import { apiFetch } from '../../api'
import {
  verificationWordDiff,
  type DiffWord,
} from '../../verification-word-diff'

function HighlightedWords({
  words,
  start = 0,
  end = Infinity,
}: {
  words: DiffWord[]
  start?: number
  end?: number
}) {
  let offset = 0
  return words.map((word, index) => {
    const from = offset
    offset += word.text.length
    const text = word.text.slice(
      Math.max(0, start - from),
      Math.max(0, end - from),
    )
    if (!text) return null
    return word.changed ? (
      <mark
        key={index}
        className="rounded bg-warning/20 text-ink underline decoration-warning decoration-2 underline-offset-2"
      >
        {text}
      </mark>
    ) : (
      text
    )
  })
}

export function VerificationSourceEvidence({
  runId,
  finding,
}: {
  runId: string
  finding: VerificationFindingView
}) {
  const query = useQuery({
    queryKey: ['verification-runs', 'evidence', runId, finding.id],
    queryFn: async () =>
      verificationEvidenceResponseSchema.parse(
        await apiFetch(
          `/api/verification-runs/${encodeURIComponent(runId)}/findings/${encodeURIComponent(finding.id)}/evidence`,
        ),
      ),
    retry: false,
  })
  if (query.isPending)
    return (
      <p role="status" className="text-xs text-muted">
        Loading the checked source passage…
      </p>
    )
  if (query.isError)
    return (
      <p role="alert" className="text-xs text-danger">
        The checked source passage could not be loaded. Please try opening the
        evidence again.
      </p>
    )
  const passages = finding.evidence.map((item) =>
    query.data.passages.find((passage) => passage.evidenceId === item.id),
  )
  const source = passages.map((passage) => passage?.text ?? '').join('\n\n')
  const complete = passages.length > 0 && passages.every(Boolean)
  let sourceOffset = 0
  const diff =
    finding.type === 'quote_fidelity' && complete
      ? verificationWordDiff(finding.excerpt, source)
      : null
  return (
    <div className="flex max-h-[45vh] flex-col gap-3 overflow-y-auto text-sm">
      {finding.type === 'quote_fidelity' && complete ? (
        <div>
          <p className="text-xs font-medium text-subtle">Draft quotation</p>
          <p className="whitespace-pre-wrap">
            {diff ? <HighlightedWords words={diff.draft} /> : finding.excerpt}
          </p>
        </div>
      ) : null}
      {finding.evidence.map((item, index) => {
        const passage = passages[index]
        const start = sourceOffset
        sourceOffset += (passage?.text.length ?? 0) + 2
        return (
          <div key={item.id}>
            <p className="text-xs font-medium text-muted">
              {finding.authorityLabel} · {item.label}
            </p>
            {passage ? (
              <p className="mt-1 whitespace-pre-wrap leading-relaxed">
                {diff ? (
                  <HighlightedWords
                    words={diff.source}
                    start={start}
                    end={start + passage.text.length}
                  />
                ) : (
                  passage.text
                )}
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted">
                The checked source passage is unavailable for this evidence. Run
                verification again to preserve the source text.
              </p>
            )}
          </div>
        )
      })}
      {diff ? (
        <p className="text-xs text-subtle">
          Underlined highlights show differing words in the draft quotation and
          the closest source passage.
        </p>
      ) : null}
      {finding.type === 'quote_fidelity' && complete && !diff ? (
        <p className="text-xs text-muted">
          Word highlighting is unavailable for these long excerpts.
        </p>
      ) : null}
      {finding.evidence.length === 0 ? (
        <p className="text-xs text-muted">No source evidence attached.</p>
      ) : null}
    </div>
  )
}

export function VerificationEvidenceToggle(props: {
  runId: string
  finding: VerificationFindingView
}) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <Button
        size="sm"
        variant="ghost"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? 'Hide evidence' : 'View evidence'}
      </Button>
      {open ? <VerificationSourceEvidence {...props} /> : null}
    </div>
  )
}
