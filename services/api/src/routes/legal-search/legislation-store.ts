import type { Pool } from 'pg'

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
}

/**
 * Top-level contents of one Act in document order. In the current ingest
 * these rows are all sections: schedules survive only as paragraph-level
 * rows (schedule/1/paragraph/1) and Parts are not stored, so there is no
 * schedule or Part row to list. Subsections likewise stay on their
 * provision pages; the Act page lists the addressable top level, where
 * label_path carries exactly one slash. ORDER BY doc_order, never numeric
 * or lexical label sort: inserted sections (s. 13A between ss. 13 and 14)
 * sort wrong otherwise.
 */
export async function listLegislationActProvisions(
  pool: Pick<Pool, 'query'>,
  identity: string,
): Promise<StoredLegislationActProvision[]> {
  const result = await pool.query<StoredLegislationActProvision>(
    `select label, label_path as "labelPath", extent,
            has_unapplied_effects as "hasUnappliedEffects",
            doc_order as "docOrder"
       from legislation_provisions
      where document_identity = $1
        and label_path not like '%/%/%'
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
