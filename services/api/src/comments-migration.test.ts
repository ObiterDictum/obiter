import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL(
    '../../../packages/database/migrations/0014_document_comments.sql',
    import.meta.url,
  ),
  'utf8',
)

describe('document comments migration', () => {
  it('is an additive and repeatable new-table migration', () => {
    expect(migration).toContain('create table if not exists document_comments')
    expect(migration.match(/create index if not exists/gu)).toHaveLength(2)
    expect(migration).not.toMatch(
      /alter table|drop table|delete from|update /iu,
    )
  })

  it('pins tenant-safe document and version relationships', () => {
    expect(migration).toContain(
      'foreign key (matter_id, organisation_id)\n    references matters(id, organisation_id)',
    )
    expect(migration).toContain(
      'foreign key (document_id, matter_id, organisation_id)\n    references matter_documents(id, matter_id, organisation_id) on delete cascade',
    )
    expect(migration).toContain(
      'anchor_version_id, document_id, matter_id, organisation_id\n  ) references document_versions(id, matter_document_id, matter_id, organisation_id)\n    on delete set null (anchor_version_id)',
    )
  })

  it('pins bounded anchors, body text, and paired resolution state', () => {
    expect(migration).toContain('start_offset >= 0')
    expect(migration).toContain('end_offset >= start_offset')
    expect(migration).toContain('length(body) <= 10000')
    expect(migration).toContain(
      '(resolved_at is null and resolved_by is null)\n    or (resolved_at is not null and resolved_by is not null)',
    )
  })
})
