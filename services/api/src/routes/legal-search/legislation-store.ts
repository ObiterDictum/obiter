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
  /** Timestamp of the successful effects check that produced the flag,
   * null when the row was never checked (legacy default, skipped pass). */
  effectsCheckedAt: string | null
  docOrder: number
  kind: LegislationProvisionKind
  parentLabelPath: string | null
  /** Holder for container heading text; empty for provision rows. */
  text: string
}

/**
 * Fail-closed servability for provision text: current text serves only
 * after a successful effects check (non-null timestamp) found no unapplied
 * effects. A false flag with a null timestamp is a legacy row that was
 * never verified — it withholds like an unknown flag, never serves.
 * Containers never carry effects state; callers exempt them where needed.
 */
export function provisionTextServable(
  hasUnappliedEffects: StoredLegislationProvision['hasUnappliedEffects'],
  effectsCheckedAt: StoredLegislationProvision['effectsCheckedAt'],
): boolean {
  return hasUnappliedEffects === false && effectsCheckedAt !== null
}

export interface LegislationActProvisionsSnapshot {
  /** Document holds no NULL-kind row: the whole Act page may serve. */
  classified: boolean
  /** Containers plus P1 rows in document order, empty while unclassified. */
  rows: StoredLegislationActProvision[]
}

/**
 * One-statement read of the Act-page gate and its contents: the flag and
 * the rows come back from a single statement, so they share one snapshot
 * and always describe the same committed state. A --force-reparse rewrites
 * every row of a document in one transaction, so the read sees either all
 * of it (gate open, rows present) or none of it (legacy NULL-kind rows
 * filtered out, gate closed) — never the old torn mix where an independent
 * gate statement read post-commit at the same time the listing read
 * pre-commit, which served an empty tree as 200 instead of 503.
 *
 * Rows whose kind is NULL are pre-0022 legacy rows that no --force-reparse
 * has rewritten: their true classification is unknown, so they must never
 * reach the tree. The gate withholds the whole document until none remain
 * (fail-closed: any other outcome reads as not-classified).
 *
 * Contents arrive in document order via json_agg over the inner ORDER BY:
 * inserted sections (s. 13A between ss. 13 and 14) keep their enacted
 * position, and containers interleave with their content. provision_text is
 * read for container rows only — the Act page renders container heading
 * text but never provision body text (the provision page carries that
 * gate) — so the query never pulls full provision bodies. */
export async function getLegislationActProvisionsSnapshot(
  pool: Pick<Pool, 'query'>,
  identity: string,
): Promise<LegislationActProvisionsSnapshot> {
  const result = await pool.query<{
    classified: boolean
    rows: StoredLegislationActProvision[]
  }>(
    `select not exists(
        select 1 from legislation_provisions
         where document_identity = $1 and kind is null
      ) as "classified",
      coalesce((
        select json_agg(rows order by rows."docOrder")
          from (
            select label, label_path as "labelPath", extent,
                   has_unapplied_effects as "hasUnappliedEffects",
                   effects_checked_at as "effectsCheckedAt",
                   doc_order as "docOrder", kind,
                   parent_label_path as "parentLabelPath",
                   case when kind in ('part', 'chapter', 'schedule', 'crossheading')
                        then provision_text else '' end as text
              from legislation_provisions
             where document_identity = $1
               and kind is not null
               and (kind in ('part', 'chapter', 'schedule', 'crossheading') or kind = 'P1')
          ) rows
      ), '[]'::json) as "rows"`,
    [identity],
  )
  const row = result.rows[0]
  return { classified: row?.classified ?? false, rows: row?.rows ?? [] }
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

/**
 * True when a provision or container row exists at `labelPath` or beneath
 * it. The single-schedule fallback uses this to tell a numbered schedule the
 * Act holds from one it does not: a citation for Schedule 1 may only fall
 * back to an unnumbered schedule when the Act has no numbered Schedule 1
 * container at all.
 */
export async function legislationProvisionPathExists(
  pool: Pick<Pool, 'query'>,
  documentIdentity: string,
  labelPath: string,
): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
    `select exists(
       select 1 from legislation_provisions
        where document_identity = $1
          and (label_path = $2 or label_path like $2 || '/%')
     ) as exists`,
    [documentIdentity, labelPath],
  )
  return result.rows[0]?.exists ?? false
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
