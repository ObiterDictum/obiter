import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

const migration = readFileSync(
  new URL(
    '../../../packages/database/migrations/0014_document_comments.sql',
    import.meta.url,
  ),
  'utf8',
)

const threadsMigration = readFileSync(
  new URL(
    '../../../packages/database/migrations/0030_document_comment_threads.sql',
    import.meta.url,
  ),
  'utf8',
)

const fingerprintMigration = readFileSync(
  new URL(
    '../../../packages/database/migrations/0031_comment_reply_imported_parent.sql',
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

describe('comment threads migration 0030', () => {
  it('is safe to re-apply: the scoped key is never dropped', () => {
    expect(threadsMigration).not.toMatch(
      /drop constraint if exists document_comments_scoped_id_key/u,
    )
    expect(threadsMigration).toMatch(
      /if not exists[\s\S]*document_comments_scoped_id_key[\s\S]*add constraint document_comments_scoped_id_key/u,
    )
    expect(threadsMigration).toContain(
      "target_relation regclass := 'document_comments'::regclass",
    )
    expect(threadsMigration).toContain('conrelid = target_relation')
  })

  it('converges the client-key indexes to the author-scoped definition', () => {
    for (const table of ['document_comments', 'document_comment_replies']) {
      const name = `${table}_client_key_idx`
      expect(threadsMigration).toContain(`drop index if exists ${name};`)
      expect(threadsMigration).toContain(
        `create unique index ${name}\n  on ${table} (document_id, author_id, client_key)\n  where client_key is not null`,
      )
    }
  })

  it('pins the replies table to exactly one parent in scope', () => {
    expect(threadsMigration).toContain(
      '(comment_id is null) <> (imported_comment_id is null)',
    )
    expect(threadsMigration).toContain(
      'references document_comments(id, document_id, matter_id, organisation_id)\n    on delete cascade',
    )
  })
})

describe('comment reply fingerprint migration 0031', () => {
  it('adds the fingerprint column and its length check idempotently', () => {
    expect(fingerprintMigration).toContain(
      'add column if not exists imported_parent_fingerprint text',
    )
    expect(fingerprintMigration).toContain(
      'drop constraint if exists document_comment_replies_fingerprint_check',
    )
    expect(fingerprintMigration).toContain(
      'imported_parent_fingerprint is null\n    or length(imported_parent_fingerprint) = 64',
    )
  })
})
