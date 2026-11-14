import { Robot } from '@obiter/ui/icons'
import type { AgentSessionRun } from '@obiter/contracts'
import { EvidenceLink, evidenceLabel } from '../agent-evidence'

export function AgentTurn({ run }: { run: AgentSessionRun }) {
  return (
    <article className="flex flex-col gap-5 py-4">
      <p className="ml-auto max-w-[80%] whitespace-pre-wrap rounded-xl bg-fill px-4 py-3 text-body text-ink">
        {run.goal}
      </p>
      <div className="min-h-12 text-body text-ink">
        <div className="mb-3 flex items-center gap-1.5 text-caption text-muted">
          <Robot size={14} aria-hidden />
          Agent
        </div>
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
                          <a
                            key={id}
                            href={`#source-${run.id}-${number}`}
                            className="ml-1 align-super text-caption text-brand"
                            onFocus={() =>
                              document
                                .getElementById(`source-${run.id}-${number}`)
                                ?.scrollIntoView?.({ block: 'nearest' })
                            }
                            onClick={(event) => {
                              event.preventDefault()
                              document
                                .getElementById(`source-${run.id}-${number}`)
                                ?.focus()
                            }}
                          >
                            [{number + 1}]
                          </a>
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
            <ol
              aria-label="Sources"
              className="mt-4 flex flex-col gap-2 border-t border-line pt-3"
            >
              {run.evidence.map((item, i) => (
                <li
                  key={item.evidenceId}
                  id={`source-${run.id}-${i}`}
                  tabIndex={-1}
                  className="text-meta text-muted focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="mr-2 text-subtle">{i + 1}</span>
                  <EvidenceLink
                    matterId={run.matterId}
                    evidence={item}
                    className="text-ink hover:underline"
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
          <p aria-live="polite" className="text-meta text-muted">
            <span
              aria-hidden
              className="mr-2 inline-block motion-safe:animate-pulse"
            >
              •••
            </span>
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
