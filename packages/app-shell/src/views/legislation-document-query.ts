import { queryOptions } from '@tanstack/react-query'
import { apiUrl } from '../lib/api-url'
import type { LegislationStatus } from '../legislation-status'

export interface LegislationProvisionSubsection {
  label: string
  labelPath: string
  href: string
  legislationStatus: LegislationStatus
  repealedFrom?: string
  text?: string
  children: LegislationProvisionSubsection[]
}

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
    retry: 1,
    refetchOnMount: 'always',
    queryFn: async () => {
      const response = await fetch(
        apiUrl(`/api/search/legislation/${provisionPath}`),
      )
      if (response.status === 404) {
        throw new Error('Legislation provision was not found.')
      }
      if (!response.ok) {
        throw new Error('Legislation provision could not be loaded.')
      }
      // SAFETY: 404 and other non-ok statuses throw above; /api/search/legislation/:path returns LegislationProvisionResponse per the search API contract.
      return (await response.json()) as LegislationProvisionResponse
    },
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

interface LegislationActDocument {
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

export function legislationActQueryOptions(identity: string) {
  return queryOptions({
    queryKey: ['legislation-act', identity],
    staleTime: 0,
    retry: 1,
    refetchOnMount: 'always',
    queryFn: async () => {
      const encodedIdentity = identity
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/')
      const response = await fetch(
        apiUrl(`/api/search/legislation/${encodedIdentity}`),
      )
      if (response.status === 404) {
        throw new Error('Legislation Act was not found.')
      }
      if (!response.ok) {
        throw new Error('Legislation Act could not be loaded.')
      }
      // SAFETY: 404 and other non-ok statuses throw above; /api/search/legislation/:identity returns LegislationActResponse per the search API contract.
      return (await response.json()) as LegislationActResponse
    },
  })
}
