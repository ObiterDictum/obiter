import {
  parseLegislationActPath,
  parseLegislationProvisionPath,
} from '@obiter/contracts/legislation-paths'
import { queryOptions, type QueryClient } from '@tanstack/react-query'
import { notFound } from '@tanstack/react-router'
import { apiFetch, isApiNotFound } from '../api'
import type { LegislationStatus } from '../legislation-status'
import { guardNotFound } from '../route-loaders'

import type { LegislationProvisionSubsection } from '@obiter/contracts/legislation-reader'

export interface LegislationAmendment {
  id: string
  effect: string
  changedProvision: string
  changedLabelPath: string | null
  affecting: {
    identity: string
    citation: string
    provision: string
    href: string | null
    officialUrl: string
  }
  inForceDate: string | null
  applied: boolean | null
  prospective: boolean | null
}

export interface LegislationAmendmentHistory {
  items: LegislationAmendment[]
  truncated: boolean
}

interface LegislationProvisionDocument {
  id: string
  documentIdentity: string
  title: string
  year: number
  provisionLabel: string
  labelPath: string
  heading?: string
  extent: string
  legislationStatus: LegislationStatus
  repealedFrom?: string
  text?: string
  subsections?: LegislationProvisionSubsection[]
  officialUrl: string
  sourceUrl: string
  acquiredAt?: string
  notice?: string
  canonicalUrl: string
  amendments?: LegislationAmendmentHistory
}

export interface LegislationProvisionResponse {
  provision: LegislationProvisionDocument
}

export function legislationProvisionQueryOptions(provisionPath: string) {
  return queryOptions({
    queryKey: ['legislation-provision', provisionPath],
    staleTime: 0,
    retry: (count, error) => !isApiNotFound(error) && count < 1,
    refetchOnMount: 'always',
    queryFn: () =>
      apiFetch<LegislationProvisionResponse>(
        `/api/search/legislation/${provisionPath}`,
      ),
  })
}

export type LegislationActContentsKind =
  | 'part'
  | 'chapter'
  | 'schedule'
  | 'crossheading'
  | 'P1'
  | 'P2'
  | 'P3'
  | 'P4'
  | 'P5'

export interface LegislationActContentsNode {
  label: string
  docOrder?: number
  labelPath: string
  href: string
  extent: string
  withheld: boolean
  repealed?: boolean
  repealedFrom?: string
  kind: LegislationActContentsKind
  text?: string
  heading?: string
  children: LegislationActContentsNode[]
}

export interface LegislationActDocument {
  identity: string
  title: string
  year: number
  number: number
  chapter: string
  extent: string
  officialUrl: string
  sourceUrl: string
  acquiredAt?: string
  canonicalUrl: string
  status?: 'in_force' | 'repealed'
  repealedFrom?: string
  enactmentDate?: string
  totalCount: number
  withheldCount: number
  repealedCount?: number
  contents: LegislationActContentsNode[]
}

export interface LegislationActResponse {
  act: LegislationActDocument
}

interface LegislationActsResponse {
  acts: Array<{ identity: string }>
}

export function legislationActsQueryOptions() {
  return queryOptions({
    queryKey: ['legislation-acts'],
    staleTime: 60_000,
    retry: 1,
    queryFn: () =>
      apiFetch<LegislationActsResponse>('/api/search/legislation/acts'),
  })
}

export function legislationActQueryOptions(identity: string) {
  return queryOptions({
    queryKey: ['legislation-act', identity],
    staleTime: 0,
    retry: (count, error) => !isApiNotFound(error) && count < 1,
    refetchOnMount: 'always',
    queryFn: () => {
      const encodedIdentity = identity
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/')
      return apiFetch<LegislationActResponse>(
        `/api/search/legislation/${encodedIdentity}`,
      )
    },
  })
}
export function prefetchLegislationPage(client: QueryClient, path: string) {
  const act = parseLegislationActPath(path)
  if (act) {
    return guardNotFound(() =>
      client.ensureQueryData(legislationActQueryOptions(act.documentIdentity)),
    )
  }
  if (!parseLegislationProvisionPath(path)) throw notFound()
  return guardNotFound(() =>
    client.ensureQueryData(legislationProvisionQueryOptions(path)),
  )
}
