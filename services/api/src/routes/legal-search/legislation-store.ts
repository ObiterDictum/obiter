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
  sourceUrl: string
}

export interface LegislationActListEntry extends StoredLegislationDocument {}

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
            d.title, d.source_url as "sourceUrl"
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
