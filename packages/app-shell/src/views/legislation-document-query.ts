/*
 * Legislation page data: the response shapes and the queries that fetch them.
 *
 * These live apart from their views for the same reason the case-law query
 * does: the top bar's breadcrumb names the source, so it needs the query
 * without dragging a page's components into the entry chunk.
 */
import { queryOptions } from '@tanstack/react-query'
import { apiUrl } from '../lib/api-url'

/**
 * One addressable level beneath the provision being read: a subsection, a
 * sub-paragraph, or a further level. `text` is that level's own words, and is
 * absent when the level's wording is withheld.
 */
export interface LegislationProvisionSubsection {
  label: string
  labelPath: string
  href: string
  legislationStatus: 'current' | 'amended_not_held'
  text?: string
  children: LegislationProvisionSubsection[]
}

interface LegislationProvisionDocument {
  id: string
  documentIdentity: string
  title: string
  year: number
  provisionLabel: string
  labelPath: string
  /** The provision's own published heading, where the source carries one. */
  heading?: string
  extent: string
  legislationStatus: 'current' | 'amended_not_held'
  text?: string
  subsections?: LegislationProvisionSubsection[]
  officialUrl: string
  sourceUrl: string
  acquiredAt?: string
  notice?: string
  canonicalUrl: string
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
  kind: LegislationActContentsKind
  /** Heading text for container rows; never set for provision rows. */
  text?: string
  /** A provision's own published heading, so a section reads
   * "s. 13 Direct discrimination" rather than a bare number. */
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
  /** When this corpus read the Act's data.xml; absent when not recorded. */
  acquiredAt?: string
  canonicalUrl: string
  /** Content rows only: sections plus schedule paragraphs. Containers
   * (Part, Chapter, Schedule, crossheading) are headings, never withheld,
   * and excluded from both counts. */
  totalCount: number
  withheldCount: number
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
      // Encode per segment so identity slashes stay as separators while
      // unsafe characters inside a segment cannot break the request path.
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
