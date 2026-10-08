import { readFileSync } from 'node:fs'
import type { PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createTestPool } from './test-database.test-support'

/**
 * The comment threads migrations applied for real, twice, against a live
 * database: the scoped key the replies foreign key depends on must survive
 * re-application, the foreign key must still cascade, and a stale draft
 * index of the same name must converge to the author-scoped columns rather
 * than silently survive `if not exists`.
 *
 * Every scenario runs in a throwaway schema inside one rolled-back
 * transaction, so the real tables are untouched. The migrations' unqualified
 * relation names resolve through search_path, which each scenario points at
 * its scratch schema, exactly as the runner would.
 */

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

const scopedKey = 'document_comments_scoped_id_key'
const repliesFk = 'document_comment_replies_comment_fk'

describe('comment threads migrations 0030+0031 (db)', () => {
  const pool = createTestPool()
  let client: PoolClient
  let schemaCount = 0

  beforeAll(async () => {
    client = await pool.connect()
    await client.query('begin')
  })

  afterAll(async () => {
    await client.query('rollback')
    client.release()
    await pool.end()
  })

  /**
   * A fresh schema holding the pre-0030 relations the migrations alter or
   * reference: document_comments at its 0014 shape minus the foreign keys
   * (irrelevant to what 0030/0031 change), plus the targets the replies
   * table's foreign keys point at.
   */
  async function scratchSchema(): Promise<string> {
    const schema = `comment_threads_${schemaCount++}`
    await client.query(`create schema ${schema}`)
    await client.query(`set local search_path to ${schema}`)
    await client.query(`
      create table matters (
        id text,
        organisation_id text,
        primary key (id, organisation_id)
      );
      create table matter_documents (
        id text,
        matter_id text,
        organisation_id text,
        primary key (id, matter_id, organisation_id)
      );
      create table users (id text primary key);
      create table document_comments (
        id text primary key,
        organisation_id text not null,
        matter_id text not null,
        document_id text not null,
        paragraph_id text not null,
        start_offset integer not null,
        end_offset integer not null,
        body text not null,
        author_id text not null,
        constraint document_comments_end_offset_check
          check (end_offset >= start_offset)
      );
    `)
    return schema
  }

  /**
   * Run a statement inside a savepoint so a hard failure leaves the shared
   * transaction usable for assertions and the next scenario.
   */
  async function runSql(sql: string): Promise<string | null> {
    await client.query('savepoint before_statement')
    try {
      await client.query(sql)
      await client.query('release savepoint before_statement')
      return null
    } catch (error) {
      await client.query('rollback to savepoint before_statement')
      return error instanceof Error ? error.message : String(error)
    }
  }

  async function constraintCount(
    schema: string,
    table: string,
    name: string,
  ): Promise<number> {
    const { rows } = await client.query<{ n: number }>(
      `select count(*)::int as n
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       join pg_namespace n on n.oid = t.relnamespace
       where n.nspname = $1 and t.relname = $2 and c.conname = $3`,
      [schema, table, name],
    )
    return rows[0]?.n ?? 0
  }

  async function indexDefinition(
    schema: string,
    name: string,
  ): Promise<string | null> {
    const { rows } = await client.query<{ def: string }>(
      `select pg_get_indexdef(i.indexrelid) as def
       from pg_index i
       join pg_class t on t.oid = i.indrelid
       join pg_class ic on ic.oid = i.indexrelid
       join pg_namespace n on n.oid = t.relnamespace
       where n.nspname = $1 and ic.relname = $2`,
      [schema, name],
    )
    return rows[0]?.def ?? null
  }

  it('re-applies twice with the scoped key and the dependent reply FK intact', async () => {
    const schema = await scratchSchema()

    await client.query(threadsMigration)
    await client.query(fingerprintMigration)
    // Second application must be a no-op. Dropping document_comments_scoped_id_key
    // here would fail hard: the replies foreign key depends on it.
    await client.query(threadsMigration)
    await client.query(fingerprintMigration)

    expect(await constraintCount(schema, 'document_comments', scopedKey)).toBe(
      1,
    )
    expect(
      await constraintCount(schema, 'document_comment_replies', repliesFk),
    ).toBe(1)
    expect(
      await constraintCount(
        schema,
        'document_comment_replies',
        'document_comment_replies_fingerprint_check',
      ),
    ).toBe(1)

    for (const table of ['document_comments', 'document_comment_replies']) {
      expect(
        await indexDefinition(schema, `${table}_client_key_idx`),
      ).toContain('btree (document_id, author_id, client_key)')
    }

    const columns = await client.query<{ n: number }>(
      `select count(*)::int as n
       from information_schema.columns
       where table_schema = $1 and table_name = 'document_comment_replies'
         and column_name = 'imported_parent_fingerprint'`,
      [schema],
    )
    expect(columns.rows[0]?.n).toBe(1)

    // The surviving foreign key must still be functional: a reply attaches to
    // a parent inside its scope and cascades on delete.
    await client.query(`insert into matters values ('m1', 'o1')`)
    await client.query(`insert into matter_documents values ('d1', 'm1', 'o1')`)
    await client.query(`insert into users values ('u1')`)
    await client.query(
      `insert into document_comments (
         id, organisation_id, matter_id, document_id,
         paragraph_id, start_offset, end_offset, body, author_id
       ) values ('cmt_a', 'o1', 'm1', 'd1', 'p1', 0, 1, 'b', 'u1')`,
    )
    await client.query(
      `insert into document_comment_replies (
         id, organisation_id, matter_id, document_id,
         comment_id, body, author_id, author_name
       ) values ('cmtr_a', 'o1', 'm1', 'd1', 'cmt_a', 'b', 'u1', 'A')`,
    )
    await client.query(`delete from document_comments where id = 'cmt_a'`)
    const orphans = await client.query<{ n: number }>(
      `select count(*)::int as n from ${schema}.document_comment_replies`,
    )
    expect(orphans.rows[0]?.n).toBe(0)
  })

  it('converges a stale draft index to the author-scoped columns', async () => {
    const schema = await scratchSchema()
    // A draft deployment added client_key but shaped the index without
    // author_id; `if not exists` alone would leave it there and let different
    // authors' keys collide.
    await client.query(
      `alter table document_comments add column client_key text`,
    )
    await client.query(
      `create unique index document_comments_client_key_idx
       on document_comments (document_id, client_key)
       where client_key is not null`,
    )

    await client.query(threadsMigration)
    expect(
      await indexDefinition(schema, 'document_comments_client_key_idx'),
    ).toContain('btree (document_id, author_id, client_key)')

    // The replies index converges the same way on re-application.
    await client.query(`drop index document_comment_replies_client_key_idx`)
    await client.query(
      `create unique index document_comment_replies_client_key_idx
       on document_comment_replies (document_id, client_key)
       where client_key is not null`,
    )
    await client.query(threadsMigration)
    expect(
      await indexDefinition(schema, 'document_comment_replies_client_key_idx'),
    ).toContain('btree (document_id, author_id, client_key)')
  })

  it('keeps the fingerprint check enforced after re-application', async () => {
    await scratchSchema()
    await client.query(threadsMigration)
    await client.query(fingerprintMigration)
    await client.query(fingerprintMigration)

    await client.query(`insert into matters values ('m1', 'o1')`)
    await client.query(`insert into matter_documents values ('d1', 'm1', 'o1')`)
    await client.query(`insert into users values ('u1')`)

    const rejected = await runSql(
      `insert into document_comment_replies (
         id, organisation_id, matter_id, document_id,
         imported_comment_id, body, author_id, author_name,
         imported_parent_fingerprint
       ) values ('cmtr_b', 'o1', 'm1', 'd1', 'ooxml-1', 'b', 'u1', 'A',
         'not-64-hex')`,
    )
    expect(rejected).toContain('document_comment_replies_fingerprint_check')
  })
})
