import { Link } from '@tanstack/react-router'
import { Scales } from '@phosphor-icons/react'
import { cn } from '@obiter/ui'
import { caseResultLocation } from '../../case-navigation'
import { provisionResultLocation } from '../../legislation-navigation'
import {
  judgmentExtractLabel,
  legislationExtractLabel,
  snippetParagraphHash,
} from './provenance'
import type {
  CaseLawSnippet,
  LegalSearchResult,
  LegislationSearchResultHit,
} from './searchTypes'

/** A snippet is the source's own text, so terms the index matched are marked. */
export function SearchSnippet({
  snippet,
  className,
}: {
  snippet: CaseLawSnippet
  className?: string
}) {
  const terms = snippet.matchedTerms.filter(Boolean)
  return (
    <p className={cn('text-meta leading-relaxed text-muted', className)}>
      {highlightTerms(snippet.text, terms).map((part, index) =>
        part.marked ? (
          <mark
            key={index}
            className="rounded-sm bg-brand-soft px-0.5 text-ink"
          >
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </p>
  )
}

export function JudgmentExtractProvenance({
  hit,
  snippet,
}: {
  hit: LegalSearchResult
  snippet: CaseLawSnippet
}) {
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-subtle">
      <Scales aria-hidden size={12} />
      <span>{judgmentExtractLabel(snippet)}</span>
      <span aria-hidden>·</span>
      <Link
        {...caseResultLocation(hit)}
        hash={snippetParagraphHash(snippet)}
        className="text-ink underline-offset-2 hover:underline"
      >
        Open paragraph
      </Link>
    </p>
  )
}

export function LegislationExtractProvenance({
  hit,
}: {
  hit: LegislationSearchResultHit
}) {
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-subtle">
      <Scales aria-hidden size={12} />
      <span>{legislationExtractLabel(hit)}</span>
      <span aria-hidden>·</span>
      <Link
        {...provisionResultLocation(hit)}
        className="text-ink underline-offset-2 hover:underline"
      >
        Open provision
      </Link>
    </p>
  )
}

function highlightTerms(text: string, terms: string[]) {
  if (terms.length === 0) return [{ text, marked: false }]
  const escaped = terms
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .filter(Boolean)
  if (escaped.length === 0) return [{ text, marked: false }]
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi')
  return text.split(pattern).map((part, index) => ({
    text: part,
    marked: index % 2 === 1,
  }))
}
