import { Link } from '@tanstack/react-router'
import { SealCheck } from '@phosphor-icons/react'
import { Badge, Tooltip, TooltipContent, TooltipTrigger } from '@obiter/ui'
import type { VersionRedaction } from './documents'
import { formatDate } from './format'

/**
 * Anything Redact produced is marked wherever it appears, so a copy that left
 * the review screen never reads as an ordinary version. Text and an icon rather
 * than a colour, and the mark names when and by whom the run produced it. The
 * badge is the link to the run for a reader who may open it; a reader who may
 * not still sees that the document came through Redact.
 */
export function RedactedMark({
  redaction,
  producedAt,
}: {
  redaction: VersionRedaction | null | undefined
  /** When the version was created: the moment Redact produced this copy. */
  producedAt: string
}) {
  if (!redaction) return null
  const line = `Produced by Redact on ${formatDate(producedAt)} by ${redaction.producedBy ?? 'another reviewer'}`
  const badge = (
    <Badge tone="info">
      <SealCheck size={12} aria-hidden />
      Redacted
    </Badge>
  )
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="inline-flex" aria-label={line} />}
      >
        {redaction.canOpen ? (
          <Link
            to="/redact/$runId"
            params={{ runId: redaction.runId }}
            aria-label={`${line}. Open the Redact run.`}
            className="inline-flex rounded-sm"
          >
            {badge}
          </Link>
        ) : (
          badge
        )}
      </TooltipTrigger>
      <TooltipContent>
        {line}
        {redaction.canOpen ? ' · Open the Redact run' : null}
      </TooltipContent>
    </Tooltip>
  )
}
