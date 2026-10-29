import type { Pool } from 'pg'

import type { LegislationProvisionKind } from './legislation-kind'

export interface StoredLegislationDocument {
  identity: string
  actType: string
  year: number
  number: number
  title: string
  sourceUrl: string
  extent: string
  acquiredAt: string | null
}

export interface StoredLegislationProvision {
  id: string
  documentIdentity: string
  labelPath: string
  label: string
  heading: string
  extent: string
  text: string
  ownText: string | null
  parentLabelPath?: string | null
  hasUnappliedEffects: boolean
  effectsCheckedAt: string | null
  title: string
  year: number
  sourceUrl: string
  acquiredAt: string | null
}

export type LegislationActListEntry = Omit<
  StoredLegislationDocument,
  'acquiredAt'
>

export interface StoredLegislationActProvision {
  label: string
  labelPath: string
  heading: string
  extent: string
  hasUnappliedEffects: boolean
  effectsCheckedAt: string | null
  docOrder: number
  kind: LegislationProvisionKind
  parentLabelPath: string | null
  text: string
}

export function provisionTextServable(
  hasUnappliedEffects: StoredLegislationProvision['hasUnappliedEffects'],
  effectsCheckedAt: StoredLegislationProvision['effectsCheckedAt'],
): boolean {
  return hasUnappliedEffects === false && effectsCheckedAt !== null
}

export interface LegislationActProvisionsSnapshot {
  classified: boolean
  rows: StoredLegislationActProvision[]
}

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
            select label, label_path as "labelPath", heading, extent,
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
            source_url as "sourceUrl", extent,
            acquired_at as "acquiredAt"
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
            p.label_path as "labelPath", p.label, p.heading, p.extent,
            p.provision_text as text, p.own_text as "ownText",
            p.has_unapplied_effects as "hasUnappliedEffects",
            p.effects_checked_at as "effectsCheckedAt",
            d.title, d.year, d.source_url as "sourceUrl",
            d.acquired_at as "acquiredAt"
       from legislation_provisions p
       join legislation_documents d on d.identity = p.document_identity
      where p.id = $1`,
    [provisionId],
  )
  return result.rows[0] ?? null
}

export async function listLegislationProvisionTree(
  pool: Pick<Pool, 'query'>,
  documentIdentity: string,
  labelPath: string,
): Promise<StoredLegislationProvision[]> {
  const result = await pool.query<StoredLegislationProvision>(
    `with recursive node as (
       select id, document_identity as "documentIdentity",
              label_path as "labelPath", label, heading, extent,
              provision_text as text, own_text as "ownText",
              has_unapplied_effects as "hasUnappliedEffects",
              effects_checked_at as "effectsCheckedAt", doc_order,
              parent_label_path as "parentLabelPath"
         from legislation_provisions
        where document_identity = $1 and label_path = $2
       union all
       select p.id, p.document_identity as "documentIdentity",
              p.label_path as "labelPath", p.label, p.heading, p.extent,
              p.provision_text as text, p.own_text as "ownText",
              p.has_unapplied_effects as "hasUnappliedEffects",
              p.effects_checked_at as "effectsCheckedAt", p.doc_order,
              p.parent_label_path as "parentLabelPath"
         from legislation_provisions p
         join node on p.parent_label_path = node."labelPath"
        where p.document_identity = $1
     )
     select * from node order by doc_order`,
    [documentIdentity, labelPath],
  )
  return result.rows
}

export type StoredProvisionPathResolution =
  | { status: 'held'; provision: StoredLegislationProvision }
  | { status: 'missing'; labelPath: string }
  | { status: 'underspecified' }

export interface StoredProvisionPathLookup {
  getProvision(provisionId: string): Promise<StoredLegislationProvision | null>
  pathExists(documentIdentity: string, labelPath: string): Promise<boolean>
}

export async function resolveStoredProvisionPath(
  lookup: StoredProvisionPathLookup,
  identity: string,
  labelPath: string,
): Promise<StoredProvisionPathResolution> {
  const exact = await lookup.getProvision(`${identity}/${labelPath}`)
  if (exact) return { status: 'held', provision: exact }
  if (!labelPath.startsWith('schedule/')) {
    return { status: 'missing', labelPath }
  }
  const numbered = labelPath.match(/^schedule\/(\d+)\//)
  if (!numbered) {
    const hasNumberedSchedule = await lookup.pathExists(identity, 'schedule/1')
    return hasNumberedSchedule
      ? { status: 'underspecified' }
      : { status: 'missing', labelPath }
  }
  const scheduleNumber = numbered[1]!
  const hasNumberedSchedule = await lookup.pathExists(
    identity,
    `schedule/${scheduleNumber}`,
  )
  if (scheduleNumber !== '1' || hasNumberedSchedule) {
    return { status: 'missing', labelPath }
  }
  const alternateLabelPath = labelPath.replace(/^schedule\/1\//, 'schedule/')
  const alternate = await lookup.getProvision(
    `${identity}/${alternateLabelPath}`,
  )
  return alternate
    ? { status: 'held', provision: alternate }
    : { status: 'missing', labelPath: alternateLabelPath }
}

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
