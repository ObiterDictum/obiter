# Local Infrastructure — Docker

Local development backing services for Obiter. No production configuration lives here.

## Postgres

`compose.yaml` runs Postgres 16 matching the API's connection defaults in [`services/api/src/env.ts`](../../services/api/src/env.ts):

- `DATABASE_URL=postgres://obiter:obiter@localhost:5432/obiter`
- `TEST_DATABASE_URL=postgres://obiter:obiter@localhost:5432/obiter_test`

The `obiter_test` database (used by the API test suite, `NODE_ENV=test`) is created on first boot by `init/create-test-db.sh`.

## Meilisearch

`compose.yaml` also runs the single local Meilisearch (image tag pinned to
`.github/workflows/ci.yml`) alongside the API. The remote Halcyn instance
is abandoned: Postgres `legal_source_documents` is the system of record and
the index is derived, so any host holding a copy that cannot be rebuilt from
Postgres is a liability rather than a shortcut.

Local search configuration, in one place:

| What          | Value                                                 | Where set                                     |
| ------------- | ----------------------------------------------------- | --------------------------------------------- |
| Host          | `http://127.0.0.1:7700`                               | `MEILISEARCH_HOST` (API/ingestor default)     |
| Key           | `search-benchmark-key`                                | `MEILISEARCH_*_API_KEY`, compose master key   |
| Product index | `legal_authorities`                                   | `LEGAL_AUTHORITIES_INDEX` (API/ingestor)      |
| Benchmark     | throwaway `legal-authorities-benchmark-<pid>` per run | `packages/search-client/src/benchmark/run.ts` |

Product and benchmark share the instance but never share an index: the
benchmark creates its index at startup and deletes it on exit, so a
benchmark run cannot narrow or widen what product search serves.

### Rebuild the product index

The index is derived, never migrated. Rebuild it from Postgres with:

```sh
pnpm rebuild:search-index
```

Flags (`--database-url=`, `--host=`, `--admin-key=`, `--index=`) override
the matching env vars. The command reports docs read, documents indexed
(including how many were indexed from summaries only), and skipped rows
with reasons; any validation or indexing failure aborts with the product
index untouched and a non-zero exit. Verify with
`GET /api/search/readiness`, which reports `ready` with the document count.

### Run

```sh
docker compose up -d
docker compose ps            # wait for postgres to be "healthy"
```

### Apply migrations

There is no standalone migration runner script yet. Apply the SQL migrations in version order against both databases with `psql` (client and server both use the `obiter` superuser locally):

```sh
for db in obiter obiter_test; do
  for f in ../../packages/database/migrations/*.sql; do
    psql "postgres://obiter:obiter@localhost:5432/$db" -f "$f"
  done
done
```

> Run migrations from this directory (`infra/docker`) so the relative paths resolve. If a runner script is added later, update this section.

### Seed data

`pnpm seed` (shell-only: org, users, matters, documents) is M2 scope of the [App Shell Rebuild](../../docs/specs/app-shell/README.md). Not present yet.

### Stop / reset

```sh
docker compose down            # stop, keep data
docker compose down -v         # stop and delete the data volume
```
