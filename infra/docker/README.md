# Local Infrastructure — Docker

Local development backing services for Obiter. No production configuration lives here.

## Postgres

`compose.yaml` runs Postgres 16 matching the API's connection defaults in [`services/api/src/env.ts`](../../services/api/src/env.ts):

- `DATABASE_URL=postgres://obiter:obiter@localhost:5432/obiter`
- `TEST_DATABASE_URL=postgres://obiter:obiter@localhost:5432/obiter_test`

The `obiter_test` database (used by the API test suite, `NODE_ENV=test`) is created on first boot by `init/create-test-db.sh`.

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
