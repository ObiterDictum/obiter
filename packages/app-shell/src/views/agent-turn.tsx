import type { AgentSessionRun } from '@obiter/contracts'
import { EvidenceLink, evidenceLabel } from '../agent-evidence'

export function AgentTurn({ run }: { run: AgentSessionRun }) {
  return (
    <article className="flex flex-col gap-5 py-6">
      <p className="whitespace-pre-wrap text-body font-medium text-ink">
        {run.goal}
      </p>
      <div className="min-h-12 text-body text-ink">
        {run.status === 'completed' ? (
          <>
            {run.deliverables.map((block, index) =>
              block.kind === 'prose' ? (
                <div key={index} className="flex flex-col gap-3">
                  {block.sentences.map((sentence, i) => (
                    <p key={i}>
                      {sentence.text}
                      {sentence.evidenceIds.map((id) => {
                        const number = run.evidence.findIndex(
                          (item) => item.evidenceId === id,
                        )
                        const evidence = run.evidence[number]
                        return evidence ? (
                          <EvidenceLink
                            key={id}
                            matterId={run.matterId}
                            evidence={evidence}
                            className="ml-1 align-super text-caption text-brand"
                          >
                            [{number + 1}]
                          </EvidenceLink>
                        ) : null
                      })}
                    </p>
                  ))}
                </div>
              ) : block.kind === 'scope_caveats' ? (
                <p key={index} className="text-meta text-muted">
                  {block.caveats.join(' ')}
                </p>
              ) : null,
            )}
            <ol aria-label="Sources" className="mt-4 flex flex-col gap-2">
              {run.evidence.map((item, i) => (
                <li key={item.evidenceId} className="text-meta text-muted">
                  {i + 1}.{' '}
                  <EvidenceLink
                    matterId={run.matterId}
                    evidence={item}
                    className="text-brand underline"
                  >
                    {evidenceLabel(item)}
                  </EvidenceLink>
                  {item.kind === 'document_span' ? (
                    <blockquote className="mt-1 border-l-2 border-line pl-2 text-ink">
                      {item.excerpt}
                    </blockquote>
                  ) : null}
                </li>
              ))}
            </ol>
          </>
        ) : run.status === 'failed' ? (
          <p role="alert">{run.message}</p>
        ) : run.status === 'refused' ? (
          <p>{run.refusal.message}</p>
        ) : run.status === 'cancelled' ? (
          <p>This turn was cancelled.</p>
        ) : (
          <p aria-live="polite" className="text-muted">
            {run.status === 'waiting_for_approval'
              ? 'Waiting for approval.'
              : run.status === 'queued'
                ? 'Waiting to start…'
                : 'Researching your question…'}
          </p>
        )}
      </div>
    </article>
  )
}
