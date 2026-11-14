import { Link } from '@tanstack/react-router'
import type { AgentSessionEvidence } from '@obiter/contracts'
import type { ReactNode } from 'react'
export function evidenceLabel(item: AgentSessionEvidence): string {
  if (item.kind === 'corpus_paragraph') {
    const citation = item.neutralCitation ? ` ${item.neutralCitation}` : ''
    return `${item.title}${citation}, para ${item.paragraphNumber}`
  }
  if (item.kind === 'legislation_provision')
    return `${item.title}, ${item.provisionPath}`
  if (item.kind === 'mcp_result') return item.summary
  return `${item.documentName}, characters ${item.start}–${item.end}`
}

export function EvidenceLink({
  matterId,
  evidence,
  className,
  children,
}: {
  matterId: string | null
  evidence: AgentSessionEvidence
  className?: string
  children: ReactNode
}) {
  if (evidence.kind === 'corpus_paragraph') {
    return (
      <Link
        to="/cases/$caseId"
        params={{ caseId: evidence.authorityId }}
        hash={`para-${evidence.paragraphNumber}`}
        className={className}
        aria-label={`Open ${evidenceLabel(evidence)}`}
      >
        {children}
      </Link>
    )
  }
  if (evidence.kind === 'legislation_provision')
    return (
      <Link
        to="/ln/$"
        params={{ _splat: evidence.provisionPath }}
        className={className}
      >
        {children}
      </Link>
    )
  if (evidence.kind === 'mcp_result' || !matterId)
    return <span>{children}</span>
  return (
    <Link
      to="/matters/$matterId/documents/$documentId"
      params={{ matterId, documentId: evidence.documentId }}
      className={className}
      aria-label={`Open ${evidenceLabel(evidence)}`}
    >
      {children}
    </Link>
  )
}
