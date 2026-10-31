import { Link } from '@tanstack/react-router'
import { Badge, Tooltip, TooltipContent, TooltipTrigger } from '@obiter/ui'
import { EyeSlash } from '@obiter/ui/icons'
import type { VersionRedaction } from './documents'
import { formatDate } from './format'

export function RedactedMark({
  redaction,
  producedAt,
}: {
  redaction: VersionRedaction | null | undefined
  producedAt: string
}) {
  if (!redaction) return null
  const line = `Produced by Redact on ${formatDate(producedAt)} by ${redaction.producedBy ?? 'another reviewer'}`
  const badge = (
    <Badge tone="info">
      <EyeSlash size={12} aria-hidden />
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
