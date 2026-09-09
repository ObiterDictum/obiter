import type { Pool } from 'pg'

import type { LegislationProvisionKind } from './legislation-kind'

/**
 * Postgres reads for Stage 1 legislation serving. Postgres is the record:
 * exact citation resolution reads these rows, never the derived
 * legislation_provisions index, so a stale index copy can never answer an
 * exact lookup. Keyword search may use the index; its misses fall back to
 * nothing, never to a guessed row.
 */

export interface StoredLegislationDocument {
  identity: string
  actType: string
  year: number
  number: number
  title: string
  sourceUrl: string
  extent: string
}

export interface StoredLegislationProvision {
  id: string
  documentIdentity: string
  labelPath: string
  label: string
  extent: string
  text: string
  hasUnappliedEffects: boolean
  effectsCheckedAt: string | null
  title: string
  year: number
  sourceUrl: string
}

export interface LegislationActListEntry extends StoredLegislationDocument {}

export interface StoredLegislationActProvision {
  label: string
  labelPath: string
  extent: string
  hasUnappliedEffects: boolean
  docOrder: number
  kind: LegislationProvisionKind
  parentLabelPath: string | null
  /** Holder for container heading text; empty for provision rows. */
  text: string
}

/**
 * Contents of one Act as rows for tree building: containers (part, chapter,
 * schedule, crossheading) plus P1 content rows (sections and schedule
 * paragraphs), in document order. P2..P5 sub-provisions stay on provision
 * pages and never render on the Act page. ORDER BY doc_order, never numeric
 * or lexical label sort: inserted sections (s. 13A between ss. 13 and 14)
 * sort wrong otherwise, and containers interleave with their content.
 *
 * provision_text is read for container rows only — the Act page renders
 * container heading text but never provision body text (the provision page
 * carries that gate) — so the query pulls the full body of the heaviest Act
 * (1.2 MB) just to discard it per page load. The case narrows the fetch to
 * headings. */
export async function listLegislationActProvisions(
  pool: Pick<Pool, 'query'>,
  identity: string,
): Promise<StoredLegislationActProvision[]> {
  const result = await pool.query<StoredLegislationActProvision>(
    `select label, label_path as "labelPath", extent,
            has_unapplied_effects as "hasUnappliedEffects",
            doc_order as "docOrder", kind,
            parent_label_path as "parentLabelPath",
            case when kind in ('part', 'chapter', 'schedule', 'crossheading')
                 then provision_text else '' end as text
       from legislation_provisions
      where document_identity = $1
        and (kind in ('part', 'chapter', 'schedule', 'crossheading') or kind = 'P1')
      order by doc_order`,
    [identity],
  )
  return result.rows
}

export async function getLegislationDocument(
  pool: Pick<Pool, 'query'>,
  identity: string,
): Promise<StoredLegislationDocument | null> {
  const result = await pool.query<StoredLegislationDocument>(
    `select identity, act_type as "actType", year, number, title,
            source_url as "sourceUrl", extent
       from legislation_documents where identity = $1`,
    [identity],
  )
  return result.rows[0] ?? null
}

export async function getLegislationProvision(
  pool: Pick<Pool, 'query'>,
  provisionId: string,
): Promise<StoredLegislationProvision | null> {
  const result = await pool.query<StoredLegislationProvision>(
    `select p.id, p.document_identity as "documentIdentity",
            p.label_path as "labelPath", p.label, p.extent,
            p.provision_text as text,
            p.has_unapplied_effects as "hasUnappliedEffects",
            p.effects_checked_at as "effectsCheckedAt",
            d.title, d.year, d.source_url as "sourceUrl"
       from legislation_provisions p
       join legislation_documents d on d.identity = p.document_identity
      where p.id = $1`,
    [provisionId],
  )
  return result.rows[0] ?? null
}

/** Whole act directory for citation suffix matching (~200 rows in scope). */
export async function listLegislationActs(
  pool: Pick<Pool, 'query'>,
): Promise<LegislationActListEntry[]> {
  const result = await pool.query<LegislationActListEntry>(
    `select identity, act_type as "actType", year, number, title,
            source_url as "sourceUrl", extent
       from legislation_documents order by year, number`,
  )
  return result.rows
}
