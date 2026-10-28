import { useQuery } from '@tanstack/react-query'
import {
  parseLegislationActPath,
  parseLegislationProvisionPath,
  resolveCaseDocumentIdFromSlug,
} from '@obiter/contracts'
import { caseLawDocumentQueryOptions } from './views/case-law-document-query'
import {
  legislationActQueryOptions,
  legislationProvisionQueryOptions,
} from './views/legislation-document-query'

/**
 * The source a page is showing, named for the breadcrumb. A source page is
 * reached from Search, so a trail that stops at "Search" leaves the reader
 * without the one thing the page is about.
 *
 * The title comes from the same query the page itself reads, so it is one
 * request, and it is null until that answer arrives rather than a slug-derived
 * guess (the slug drops capitalisation and punctuation).
 */
export function useSourceTitle(pathname: string): string | null {
  const caseId = caseIdFromPath(pathname)
  const caseDocument = useQuery({
    ...caseLawDocumentQueryOptions(caseId ?? ''),
    enabled: caseId !== null,
  })

  const legislationPath = legislationPathFromPath(pathname)
  const provisionPath =
    legislationPath && parseLegislationProvisionPath(legislationPath)
      ? legislationPath
      : null
  const actIdentity =
    legislationPath && !provisionPath
      ? (parseLegislationActPath(legislationPath)?.documentIdentity ?? null)
      : null
  const provision = useQuery({
    ...legislationProvisionQueryOptions(provisionPath ?? ''),
    enabled: provisionPath !== null,
  })
  const act = useQuery({
    ...legislationActQueryOptions(actIdentity ?? ''),
    enabled: actIdentity !== null,
  })

  if (caseId !== null) return caseDocument.data?.document.title ?? null
  if (provisionPath !== null) {
    const document = provision.data?.provision
    if (!document) return null
    return [document.provisionLabel, document.title].join(' · ')
  }
  if (actIdentity !== null) return act.data?.act.title ?? null
  return null
}

function caseIdFromPath(pathname: string): string | null {
  const slug = pathname.match(/^\/case\/(.+)$/)?.[1]
  if (slug) return resolveCaseDocumentIdFromSlug(decodeURIComponent(slug))
  const id = pathname.match(/^\/cases\/([^/]+)$/)?.[1]
  return id ? decodeURIComponent(id) : null
}

function legislationPathFromPath(pathname: string): string | null {
  const path = pathname.match(/^\/ln\/(.+)$/)?.[1]
  return path ? decodeURIComponent(path) : null
}
