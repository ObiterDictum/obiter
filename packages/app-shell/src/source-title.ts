import { useQuery } from '@tanstack/react-query'
import { resolveCaseDocumentIdFromSlug } from '@obiter/contracts/case-paths'
import {
  parseLegislationActPath,
  parseLegislationProvisionPath,
} from '@obiter/contracts/legislation-paths'
import { caseLawDocumentQueryOptions } from './views/case-law-document-query'
import {
  legislationActQueryOptions,
  legislationProvisionQueryOptions,
} from './views/legislation-document-query'

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
