# Backend Repository Split Inventory

Status: stage 1 inventory for [backend-repo-split.md](backend-repo-split.md). Assessed at `origin/dev` `abe9693f`, branch `docs/backend-repo-split`. This document changes no code, CI, package files or other docs. It records what stages 2 to 5 must move, split, edit or purge.

## Method

Facts were read from `origin/dev` with these commands. Historical facts use remote refs only, so local agent checkpoint refs (`refs/t3`, `refs/orca`) are excluded.

```sh
git fetch origin
git rev-parse origin/dev
git ls-tree -r --name-only origin/dev
git grep -n -E '<pattern>' origin/dev -- <paths>
git log --remotes --tags --name-only --format=
git log --remotes --tags --name-status -M --format=
git rev-list --remotes --tags --objects
git cat-file --batch
gh api repos/ObiterDictum/sources/git/trees/main?recursive=1
git ls-remote --heads origin
git for-each-ref refs/remotes/origin --no-merged origin/dev
```

The blob scan reads every remote-reachable blob and matches the seven provider identifiers. Path attribution comes from `git rev-list --remotes --tags --objects`.

## 1. Files moving to `backend`

Seven workspaces move whole. Every tracked path under these prefixes moves; the prefixes below are the exact `filter-repo` paths, and the subdirectory counts show the shape.

| Workspace                        |   Files | Subdirectories                         |
| -------------------------------- | ------: | -------------------------------------- |
| `services/api`                   |     346 | `src/` 334, `test-fixtures/` 8, root 4 |
| `services/legal-ingestor`        |      22 | `src/` 19, root 3                      |
| `packages/legal-source-provider` |      23 | `src/` 21, root 2                      |
| `packages/legal-schema`          |       5 | `src/` 2, root 3                       |
| `packages/search-client`         |      21 | `src/` 18, root 3                      |
| `packages/verification-core`     |      27 | `src/` 24, root 3                      |
| `packages/database`              |      42 | `migrations/` 40, root 2               |
| **Total**                        | **486** |                                        |

Command:

```sh
git ls-tree -r --name-only origin/dev -- services/api services/legal-ingestor \
  packages/legal-source-provider packages/legal-schema packages/search-client \
  packages/verification-core packages/database | wc -l
```

### Public workspace import check

Public workspaces checked: `apps/web`, `apps/desktop`, `packages/app-shell`, `packages/ui`, `packages/redact-ui`, `packages/test-dom`, `packages/contracts`, `packages/config`, `packages/ooxml`, `packages/redaction-policy`, `packages/rampart-inference`, `services/redaction-renderer`.

Commands:

```sh
git grep -n -E '@obiter/(legal-source-provider|legal-schema|search-client|verification-core|database|api|legal-ingestor)' \
  origin/dev -- <public workspaces>
git grep -n -E '(services/api|services/legal-ingestor|packages/legal-source-provider|packages/legal-schema|packages/search-client|packages/verification-core|packages/database)' \
  origin/dev -- <public workspaces>
```

No public `package.json` lists a moving package. No public TypeScript file imports a moving package or file. `packages/contracts/src/legal-search.ts` and `legislation-paths.ts` import only `zod` and local code, so they stay public as the plan says.

Violations found, not fixed:

| Path                                   | Line | Violation                                                                                                                      | Disposition                                                                                |
| -------------------------------------- | ---: | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `apps/web/playwright.config.ts`        |   44 | Starts `bun run --filter @obiter/api dev` as a Playwright `webServer`, so the public web e2e suite cannot run without the API. | Stays in public, must be parameterised; the suite is executed from `backend` per the plan. |
| `apps/web/e2e/document-print.spec.ts`  |  204 | Uses `../../../services/api` as the working directory for a `bun -e` child, resolving `unpdf` from API `node_modules`.         | Stays in public, must resolve the module from the public tree or accept an explicit path.  |
| `apps/desktop/electron-builder.yml`    |   12 | Comment names `services/api`.                                                                                                  | Comment only; edit at cut-over.                                                            |
| `apps/web/Dockerfile`                  |   35 | Comment names `services/api`.                                                                                                  | Comment only; edit at cut-over.                                                            |
| `packages/rampart-inference/README.md` |   35 | Mentions the `services/api` test.                                                                                              | Doc only; edit at cut-over.                                                                |

The web e2e suite also reads Postgres and Meilisearch in `apps/web/e2e/global-setup.ts` and `apps/web/journey-target.mjs`. It is the only public suite that needs either service, and it runs from `backend`.

## 2. Scripts

`scripts/` holds 150 tracked files: 77 move, 5 split, 68 stay.

### Moves

| Path                                     | Files | Reason                                                                                                                                  |
| ---------------------------------------- | ----: | --------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/api-ingress/`                   |     8 | Builds the API images, starts the API through Traefik, calls `/api/health`, `/api/me`, `/api/matters`, and writes fixtures with `psql`. |
| `scripts/api-runtime/`                   |    14 | Starts the Bun and Node API entry points against Postgres, probes `/api/*`, and uses `psql`.                                            |
| `scripts/load/`                          |    23 | Load-tests API uploads and probes, and provisions fixtures through `psql`.                                                              |
| `scripts/search-corpus-relevance/`       |     7 | Calls `/api/search/readiness` and `/api/search/fetch`, then re-checks ids in Postgres.                                                  |
| `scripts/legislation-relevance/`         |     8 | Calls the legislation search routes and `/api/search/readiness`, then re-checks Postgres.                                               |
| `scripts/word-roundtrip/`                |    13 | Creates an account and matter over the API, uploads, edits and exports documents, and verifies with `psql`.                             |
| `scripts/eval-redact.ts`                 |     1 | Imports `services/api/src/redaction-detection`.                                                                                         |
| `scripts/prefetch-rampart-model.ts`      |     1 | Imports `services/api/src/env` and `packages/rampart-inference`.                                                                        |
| `scripts/generate-upload-corpus.py`      |     1 | Generates the API upload-corpus fixtures.                                                                                               |
| `scripts/test_generate_upload_corpus.py` |     1 | Tests the upload-corpus generator.                                                                                                      |

Path edits required in `backend`:

- `scripts/word-roundtrip` imports `../../packages/ooxml`, `../../packages/contracts` and `../../packages/config`; these become `../../obiter/packages/...`.
- `scripts/word-roundtrip` imports `../../apps/web/lane-target.mjs`; this becomes `../../obiter/apps/web/lane-target.mjs`.
- `scripts/prefetch-rampart-model.ts` imports `../packages/rampart-inference`; this becomes `../obiter/packages/rampart-inference`.
- `scripts/load` and `scripts/word-roundtrip` test files reference `apps/web/lane-target.mjs`; the same rewrite applies.

### Splits

| Path                                | Files | Split                                                                                                                                                                                                                              |
| ----------------------------------- | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/generate-pdf-fixtures.mjs` |     1 | Writes public `data/evals/redact/` PDF fixtures and private `services/api/test-fixtures/upload-corpus/`. Keep the redact half public; move the upload-corpus half.                                                                 |
| `scripts/test/`                     |     3 | `vitest-compat.ts`, `dom-preload.ts` and `expect-rejection.ts` are used by public and moving package tests. Keep public; copy to `backend/scripts/test/` because moving package scripts use `../../scripts/test/vitest-compat.ts`. |
| `scripts/verify-provenance.sh`      |     1 | Probes both the web and API dev servers. Keep the web probe public; move or copy the API probe.                                                                                                                                    |

### Stays

| Path                                       | Files | Reason                                                                                                                   |
| ------------------------------------------ | ----: | ------------------------------------------------------------------------------------------------------------------------ |
| `scripts/architecture-diagrams.py`         |     1 | Generates public `docs/architecture.html`; edit to mark backend nodes.                                                   |
| `scripts/architecture-sections.py`         |     1 | Section order and sidebar for the public system map; stays.                                                              |
| `scripts/bench-guard.ts` and test          |     2 | Synthetic-v2 and redaction benchmark guard; no API.                                                                      |
| `scripts/ci-local.sh`                      |     1 | Mirrors public CI; remove the Postgres, Meilisearch, migration, API runtime and benchmark steps.                         |
| `scripts/export-training-data.ts` and test |     2 | Redaction training export; no API.                                                                                       |
| `scripts/generate-synthetic-data.ts`       |     1 | Redaction synthetic data; no API.                                                                                        |
| `scripts/lint/check-comments.mjs`          |     1 | Lint; stays.                                                                                                             |
| `scripts/perf/`                            |     6 | Web bundle and desktop size budgets; no API.                                                                             |
| `scripts/pr-evidence.sh`                   |     1 | PR evidence branch helper; no API.                                                                                       |
| `scripts/redact-acceptance/`               |     2 | Synthetic generator acceptance test; no API. The whole-stack Redact acceptance is `scripts/word-roundtrip`, which moves. |
| `scripts/synthetic-v2/`                    |    50 | Redaction corpus pipeline; `AGENTS.md` keeps it in this repository.                                                      |

### Root `package.json` scripts

| Script                                                                                                     | Disposition | Reason / change                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build`                                                                                                    | Stays       | Workspace build over remaining workspaces.                                                                                                                                                                          |
| `db:migrate`, `rebuild:search-index`, `rebuild:legislation-index`, `check:search-parity`                   | Move        | Run `services/api` entry points.                                                                                                                                                                                    |
| `dev:api`, `dev:api:node`, `dev:api:bun`                                                                   | Move        | Start the API.                                                                                                                                                                                                      |
| `dev:desktop`                                                                                              | Stays       | Desktop only.                                                                                                                                                                                                       |
| `dev:desktop:api`                                                                                          | Move        | Starts the API and desktop together; `backend` owns the whole stack.                                                                                                                                                |
| `dev:web`                                                                                                  | Stays       | Web only.                                                                                                                                                                                                           |
| `format`, `format:check`, `lint`                                                                           | Stay        | Public gates; lint config may need removed paths excluded.                                                                                                                                                          |
| `prefetch:rampart`                                                                                         | Move        | Imports API env.                                                                                                                                                                                                    |
| `bench:guard`                                                                                              | Stays       | Redaction/synthetic guard.                                                                                                                                                                                          |
| `perf:bundle-budget`, `perf:desktop-budget`                                                                | Stay        | Public budgets.                                                                                                                                                                                                     |
| `load:upload-extraction`                                                                                   | Move        | Starts the load harness against the API.                                                                                                                                                                            |
| `benchmark:search`, `benchmark:search-corpus`, `benchmark:legislation-corpus`                              | Move        | Search benchmark and real-corpus relevance.                                                                                                                                                                         |
| `synthetic-v2:smoke`, `synthetic-v2:canary`, `synthetic-v2:tournament`, `synthetic-v2:tournament:assemble` | Stay        | Redaction corpus pipeline.                                                                                                                                                                                          |
| `test:e2e`                                                                                                 | Change      | Remove from public; `backend` runs the `apps/web` Playwright suite from the submodule.                                                                                                                              |
| `test`                                                                                                     | Change      | Drop moving workspace tests and the `scripts/api-runtime`, `api-ingress`, `load`, `search-corpus-relevance`, `legislation-relevance`, `word-roundtrip` arguments; keep `perf`, `synthetic-v2`, `redact-acceptance`. |
| `typecheck`                                                                                                | Change      | Drop moving workspace typechecks and the `search-corpus-relevance`, `legislation-relevance`, `word-roundtrip` tsconfig projects; keep `synthetic-v2`, `redact-acceptance`.                                          |

`workspaces` stays `apps/*`, `packages/*`, `services/*`; the moving directories disappear physically. Root `better-auth` is not used by a public workspace and should be checked before keeping it.

### Root config coupled to moving paths

- `knip.jsonc`: remove the `packages/search-client` and `services/api` workspaces. Move the root entries `scripts/api-runtime/database-target-proof.mjs` and `scripts/eval-redact.ts`; keep `scripts/generate-pdf-fixtures.mjs` only if the public half remains.
- `bunfig.toml`: preloads `scripts/test/vitest-compat.ts`. `backend` needs its own `bunfig.toml` preloading `backend/scripts/test/vitest-compat.ts`.
- `.github/fontconfig-liberation.conf`: stays public for the renderer; `backend` needs a copy for the API PDF glyph tests.
- Root `.dockerignore`: stays for the web image; `backend` needs its own.

### `infra/` and `data/`

| Path                                                                                   | Files | Disposition | Reason                                                                                                 |
| -------------------------------------------------------------------------------------- | ----: | ----------- | ------------------------------------------------------------------------------------------------------ |
| `infra/docker/`                                                                        |     3 | Move        | Postgres and Meilisearch compose services, test database init and README; `backend` needs them.        |
| `infra/traefik/`                                                                       |     2 | Move        | API ingress timeouts and header limits, validated by `scripts/api-ingress`.                            |
| `infra/monitoring/`, `infra/nginx/`, `infra/terraform/`                                |     3 | Stay        | Placeholder READMEs, product-level.                                                                    |
| `data/evals/search/`                                                                   |     5 | Move        | Judgment search datasets and benchmark fixtures; used by the search benchmark and relevance harnesses. |
| `data/evals/redact/`, `data/bench/`, `data/seed/`, `data/fixtures/`, `data/synthetic/` |    22 | Stay        | Redaction and product fixtures.                                                                        |

## 3. CI

### `.github/workflows/ci.yml`

| Job / step                                   | Lines   | Disposition | Reason                                                                                                                      |
| -------------------------------------------- | ------- | ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| `checks` job env `FONTCONFIG_FILE`           | 21-22   | Stay        | Renderer PDF tests need the Liberation font mapping.                                                                        |
| `checks` services: `meilisearch`, `postgres` | 23-43   | Move        | Only moving workspaces and moving scripts need them after the split.                                                        |
| Runner diagnostics                           | 51-64   | Move        | Forensics for the API `pdf-glyph-layout` flake.                                                                             |
| Checkout, setup Bun and Node, cache, install | 45-84   | Stay        | Public gates still need the toolchain.                                                                                      |
| Typecheck                                    | 86-87   | Stay        | Script shrinks per section 2.                                                                                               |
| Format check                                 | 91-92   | Stay        | Public gate.                                                                                                                |
| Lint                                         | 96-97   | Stay        | Public gate.                                                                                                                |
| Build web                                    | 105-106 | Stay        | Public client.                                                                                                              |
| Bundle budget                                | 112-113 | Stay        | Public budget.                                                                                                              |
| Build provenance                             | 118-119 | Stay        | Public web provenance.                                                                                                      |
| Build desktop                                | 126-127 | Stay        | Public client.                                                                                                              |
| Desktop budget                               | 134-135 | Stay        | Public budget.                                                                                                              |
| Apply database migrations                    | 137-181 | Split       | Fontconfig and Liberation font install stays for the renderer; `postgresql-client` and the migration run move to `backend`. |
| Install Playwright Chromium                  | 186-187 | Stay        | `services/redaction-renderer` tests still need it.                                                                          |
| Test                                         | 189-192 | Change      | Public `bun run test` drops moving workspaces and scripts; remove the unused `TEST_DATABASE_URL`.                           |
| Search correctness benchmark                 | 194-199 | Move        | Needs Meilisearch and `packages/search-client`.                                                                             |
| Upload search benchmark report               | 201-207 | Move        | Follows the benchmark.                                                                                                      |
| `bun-api` job                                | 214-291 | Move        | Starts the API on Bun and Node against Postgres.                                                                            |
| `docker-web` job                             | 298-319 | Stay        | Public web image.                                                                                                           |
| `docker-api` job                             | 326-343 | Move        | Builds `services/api/Dockerfile`, Bun default and Node rollback targets.                                                    |

### `.github/workflows/desktop-release.yml`

Every step stays: checkout, setup Bun and Node, install, build the Windows installer, upload the artifact. `bun install` simply stops installing the moving workspaces.

### Postgres and Meilisearch in the public test run

Today `bun run test` needs both because `--workspaces` includes `services/api` (which needs `TEST_DATABASE_URL`) and `packages/search-client` (which needs Meilisearch). `apps/web`'s unit tests do not. After the split, no remaining public workspace test needs Postgres or Meilisearch. The only public suite that needs them is the `apps/web` Playwright suite, which runs from `backend`.

## 4. Docs

### Docs that move to `backend/docs`

Nineteen files move whole:

| Path                   | Files |
| ---------------------- | ----: |
| `docs/specs/search/`   |     2 |
| `docs/specs/verify/`   |     7 |
| `docs/specs/atlas/`    |     5 |
| `docs/specs/research/` |     5 |

New location: `backend/docs/specs/{search,verify,atlas,research}/`.

### `docs/architecture.md` Find Case Law sections

The file stays public; the provider, ingestion, search and corpus sections are copied to `backend/docs` and replaced with a short pointer. Line ranges at `abe9693f`:

| Lines     | Section                                                     | Disposition                                                                  |
| --------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 880-948   | Public search, changelog, and health                        | Mixed: keep the public-route policy; move the hydration and provider detail. |
| 949-1012  | Hydration admission is a cluster-wide Postgres ledger       | Move.                                                                        |
| 1013-1077 | Find Case Law HTTP attempts draw on one cluster-wide budget | Move.                                                                        |
| 1078-1143 | The user-facing API is corpus-only                          | Move.                                                                        |
| 1626-1732 | Stage 1 legislation search                                  | Move.                                                                        |
| 1733-1783 | Act contents hierarchy                                      | Move.                                                                        |
| 1930-1941 | Legal-corpus reads get their own database seam              | Move.                                                                        |
| 1942-1951 | A dedicated corpus writer seam                              | Move.                                                                        |

The Monorepo Layout at lines 29-62 must also be edited to remove or mark the moving workspaces. The Backend and Retrieval stack sections at 83-106 stay product-level.

### Docs edited at cut-over

| Path                                                                                                                                                   | Change                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                                                                                                                                            | Remove `services/api`, `services/legal-ingestor`, `packages/database`, `legal-schema` and `search-client` from the workspace list; point Search, Verify, Research and the API to `backend`; replace `dev:api`, `db:migrate` and `prefetch:rampart` setup steps.                                                              |
| `AGENTS.md`                                                                                                                                            | Link Search, Verify, Atlas and Research specs to `backend`; add the `ObiterDictum/backend` ownership rule; keep the synthetic corpus rules unchanged.                                                                                                                                                                        |
| `docs/architecture.html`                                                                                                                               | Mark `@obiter/api`, `legal-ingestor`, `legal-source-provider`, `legal-schema`, `search-client`, `verification-core` and `database` as living in `backend`; update their GitHub links, the `MOJ_FIND_CASE_LAW_*` env table and the source-size list; regenerate with `scripts/architecture-diagrams.py --apply` and Prettier. |
| `docs/architecture.md`                                                                                                                                 | Replace the eight ranges above with a pointer; update the Monorepo Layout.                                                                                                                                                                                                                                                   |
| `docs/specs/deployment.md`                                                                                                                             | API source becomes `backend`; Dockerfile path `backend/services/api/Dockerfile`; migrations `backend/packages/database`; env defaults `backend/services/api/src/env.ts`; ingress harness `backend/scripts/api-ingress`; Dokploy `api` application source.                                                                    |
| `docs/specs/README.md`                                                                                                                                 | Remove or mark Search, Atlas, Verify and Research as `backend` specs.                                                                                                                                                                                                                                                        |
| `docs/README.md`                                                                                                                                       | Same, and update the Search, Verify and Research links.                                                                                                                                                                                                                                                                      |
| `docs/roadmap.md`                                                                                                                                      | Mark the Atlas, Verify and Research milestones as `backend` work.                                                                                                                                                                                                                                                            |
| `TESTING.md`                                                                                                                                           | Move the real-corpus relevance sections and the API runtime and e2e prerequisites to `backend`; keep the public gates.                                                                                                                                                                                                       |
| `docs/specs/desktop-release.md`                                                                                                                        | Replace the `services/api` model path reference.                                                                                                                                                                                                                                                                             |
| `docs/evidence/e13-conformance/coverage-map.md`                                                                                                        | Replace the `scripts/word-roundtrip` path.                                                                                                                                                                                                                                                                                   |
| `docs/anti-slop-pass-c-triage.md`                                                                                                                      | Replace the `packages/legal-source-provider/src/moj-provider.ts` reference or archive the note.                                                                                                                                                                                                                              |
| `docs/specs/redact/api.md`, `build-plan.md`, `milestones.md`                                                                                           | Replace `@obiter/api` and `services/api` commands and paths with `backend`.                                                                                                                                                                                                                                                  |
| `docs/prds/redact-4-hardening.md`, `docs/review/app-shell-stack.md`, `docs/specs/app-shell/implementation.md`                                          | Replace `@obiter/api` test and typecheck commands.                                                                                                                                                                                                                                                                           |
| `docs/guide.md`, `docs/implementation-plan.md`, `docs/phase-0-codex.md`, `docs/phase-1-atlas.md`, `docs/phase-1-verify.md`, `docs/phase-1-research.md` | Replace workspace paths; add `backend` links for implementation detail.                                                                                                                                                                                                                                                      |
| `docs/prds/repository-split.md`                                                                                                                        | Mark superseded by `docs/backend-repo-split.md`.                                                                                                                                                                                                                                                                             |
| `docs/prds/search.md`, `docs/specs/bench/README.md`                                                                                                    | Update links to the moved specs.                                                                                                                                                                                                                                                                                             |

`docs/current-product-scope.md`, `docs/data-and-compliance.md`, `docs/product-thesis.md` and the design mockups keep their Find Case Law attribution and need no edit.

## 5. Purge path list

Run on a fresh `--mirror` clone with `git filter-repo --invert-paths --paths-from-file`. Every line is a plain path or directory prefix. The seven workspace prefixes cover every current file and every historical file under them. `services/atlas-ingestor/` is the only former workspace name outside those prefixes. `scripts/bun-runtime-eval/` is a historical API runtime harness on the unmerged `bun-serve-runtime-evaluation` branch; it starts the API and names the provider package, so it is included rather than left on a public branch.

```text
services/api/
services/legal-ingestor/
services/atlas-ingestor/
packages/legal-source-provider/
packages/legal-schema/
packages/search-client/
packages/verification-core/
packages/database/
scripts/api-ingress/
scripts/api-runtime/
scripts/load/
scripts/search-corpus-relevance/
scripts/legislation-relevance/
scripts/word-roundtrip/
scripts/eval-redact.ts
scripts/prefetch-rampart-model.ts
scripts/generate-upload-corpus.py
scripts/test_generate_upload_corpus.py
scripts/bun-runtime-eval/
docs/specs/search/
docs/specs/verify/
docs/specs/atlas/
docs/specs/research/
data/evals/search/
infra/docker/
infra/traefik/
```

### Historical paths under the moving prefixes

Thirty-three historical paths under the seven moving prefixes no longer exist at `abe9693f`. The prefixes above cover all of them; they are listed so stage 5 can verify the rewrite.

```text
packages/database/migrations/0008_organisationless_users.sql
packages/database/migrations/0011_redaction_detection_mode.sql
packages/database/migrations/0012_redaction_detection_provenance_and_retry.sql
packages/database/migrations/0035_redaction_run_docx_source_text.sql
packages/search-client/src/benchmark/curl.ts
services/api/src/document-artifact-store.ts
services/api/src/redaction-docx-occurrences.ts
services/api/src/redaction-docx-round3.test.ts
services/api/src/redaction-docx-round4.test.ts
services/api/src/redaction-output-boundary.test.ts
services/api/src/routes/atlas-proxy.test.ts
services/api/src/routes/atlas-proxy.ts
services/api/src/routes/atlas.ts
services/api/src/routes/legal-search/atom-parser.ts
services/api/src/routes/legal-search/court-utils.ts
services/api/src/routes/legal-search/document-utils.ts
services/api/src/routes/legal-search/fetch-schema.ts
services/api/src/routes/legal-search/html-parser.ts
services/api/src/routes/legal-search/index.ts
services/api/src/routes/legal-search/moj-client.ts
services/api/src/routes/legal-search-proxy.test.ts
services/api/src/routes/legal-search-proxy.ts
services/api/src/routes/legal-search/rate-limiter.ts
services/api/src/routes/legal-search/__tests__/hydration-budget-boundary.test.ts
services/api/src/routes/legal-search/__tests__/hydration-index-race.test.ts
services/api/src/routes/legal-search/__tests__/hydration-ledger-unavailable.test.ts
services/api/src/routes/legal-search/__tests__/moj-request-budget-outage.db.test.ts
services/api/src/routes/legal-search.ts
services/api/src/routes/organisation-scoping-routes.test.ts
services/api/src/routes/redaction-matter-docx.db.test.ts
services/api/src/routes/redact.ts
services/api/src/scripts/seed-user.ts
services/api/src/seed.ts
```

The eight historical `services/atlas-ingestor/` paths are covered by that prefix: `package.json`, `README.md`, `tsconfig.json`, `src/env.ts`, `src/env.test.ts`, `src/index.ts`, `src/index.test.ts` and `src/fixtures/sample-judgments.ts`.

Rename chains found with `git log --remotes --tags --name-status -M`:

```text
services/api/src/routes/atlas.ts -> services/api/src/routes/legal-search.ts -> services/api/src/routes/legal-search/search-routes.ts
services/api/src/routes/atlas-proxy.ts -> services/api/src/routes/legal-search-proxy.ts
services/api/src/routes/atlas-proxy.test.ts -> services/api/src/routes/legal-search-proxy.test.ts -> services/api/src/routes/legal-search/__tests__/proxy-routes.test.ts
services/api/src/routes/legal-search/atom-parser.ts -> packages/legal-source-provider/src/atom-parser.ts
services/api/src/routes/legal-search/court-utils.ts -> packages/legal-source-provider/src/court-utils.ts
services/api/src/routes/legal-search/document-utils.ts -> packages/legal-source-provider/src/document-utils.ts
services/api/src/routes/legal-search/fetch-schema.ts -> packages/legal-source-provider/src/fetch-schema.ts
services/api/src/routes/legal-search/html-parser.ts -> packages/legal-source-provider/src/html-parser.ts
services/api/src/routes/legal-search/rate-limiter.ts -> packages/legal-source-provider/src/rate-limiter.ts
services/api/src/document-artifact-store.ts -> services/api/src/document-derived-store.ts
packages/database/migrations/0012_redaction_detection_provenance_and_retry.sql -> packages/database/migrations/0011_redaction_detection_provenance_and_retry.sql
services/atlas-ingestor/ -> services/legal-ingestor/
```

### Historical paths not in the list

| Path                                                                                               | Why it is separate                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm-lock.yaml`                                                                                   | Historical root lockfile that names `@obiter/legal-source-provider`. It is public metadata, not provider logic; leaving it means the strict identifier grep still hits a lockfile.                     |
| `scripts/perf/` historical files                                                                   | Deleted API and web performance harnesses (`operations.ts`, `gateway.mjs`, `web-load-runner.mjs`, `page-metrics.mjs`). They call `/api/*` but contain no provider identifier and are not moving paths. |
| `docs/architecture.md`                                                                             | Stays public by design; its moved sections cannot be removed from history by path. The cut-over edit removes them from the current file only.                                                          |
| `docs/architecture.html`                                                                           | Stays public by design as the system map; it contains provider names and env vars by design.                                                                                                           |
| `services/bench-runner/`, `services/redact-worker/`, `services/verify-worker/`, `services/worker/` | README-only placeholders, never former names of a moving path and no provider identifier.                                                                                                              |
| Local `refs/t3` checkpoint objects                                                                 | Not present in a fresh `--mirror` clone. The remote-reachable scan is the purge basis.                                                                                                                 |

## 6. Provider identifiers outside moving paths

Identifiers searched: `caselaw.nationalarchives`, `moj-client`, `atom-parser`, `html-parser`, `legal-source-provider`, `find-case-law`, `MOJ_FIND_CASE_LAW`.

### Current HEAD

`origin/dev` has 61 hits across 18 paths outside the purge list. `docs/backend-repo-split.md` on this branch adds one more path; this inventory file will add another. Both are plan text, not provider logic.

| Path                                                                | Hits | Identifier                                   | Assessment                                                                                             |
| ------------------------------------------------------------------- | ---: | -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `docs/design/ui-redesign/final/search.html`                         |   17 | `caselaw.nationalarchives`                   | Mockup links to published judgments; harmless user-facing attribution.                                 |
| `docs/design/ui-redesign/final/verify.html`                         |    5 | `caselaw.nationalarchives`                   | Mockup links; harmless.                                                                                |
| `docs/design/ui-redesign/final/judgment.html`                       |    3 | `caselaw.nationalarchives`                   | Mockup links; harmless.                                                                                |
| `docs/design/ui-redesign/final/legislation-provision.html`          |    3 | `caselaw.nationalarchives`                   | Mockup links; harmless.                                                                                |
| `packages/app-shell/src/views/CaseLawDocumentView.test.tsx`         |    5 | `caselaw.nationalarchives`                   | Test URLs for the public judgment view; harmless.                                                      |
| `packages/app-shell/src/views/LegalSearchView.test.tsx`             |    4 | `caselaw.nationalarchives`                   | Test URLs; harmless.                                                                                   |
| `packages/app-shell/src/components/search/provenance.ts`            |    2 | `caselaw.nationalarchives`                   | Maps the host to the “Find Case Law” source label and builds a URL; user-facing attribution, harmless. |
| `packages/app-shell/src/legal-search-state.ts`                      |    1 | `caselaw.nationalarchives`                   | Builds the “search on Find Case Law” fallback URL; harmless.                                           |
| `packages/app-shell/src/components/search/SearchResults.test.tsx`   |    1 | `caselaw.nationalarchives`                   | Test URL; harmless.                                                                                    |
| `packages/app-shell/src/components/search/searchResultRows.test.ts` |    1 | `caselaw.nationalarchives`                   | Test URL; harmless.                                                                                    |
| `packages/app-shell/src/components/search/sourceProvenance.test.ts` |    1 | `caselaw.nationalarchives`                   | Test URL; harmless.                                                                                    |
| `packages/app-shell/src/views/verify.test.tsx`                      |    1 | `caselaw.nationalarchives`                   | Test URL; harmless.                                                                                    |
| `apps/desktop/src/main/navigation-guard.test.ts`                    |    1 | `caselaw.nationalarchives`                   | External-URL safety test; harmless.                                                                    |
| `docs/implementation-plan.md`                                       |    1 | `caselaw.nationalarchives`                   | Link to the TNA licence application; harmless.                                                         |
| `docs/architecture.html`                                            |    5 | `legal-source-provider`, `MOJ_FIND_CASE_LAW` | System map names the package and env vars; must be edited, but no logic.                               |
| `docs/architecture.md`                                              |    4 | `moj-client`, `MOJ_FIND_CASE_LAW`            | Decision-log text; sections move, file stays public by design.                                         |
| `docs/anti-slop-pass-c-triage.md`                                   |    1 | `legal-source-provider`                      | Stale file-path reference; harmless but should be edited.                                              |
| `bun.lock`                                                          |    5 | `legal-source-provider`                      | Workspace lockfile metadata; harmless, regenerated at cut-over.                                        |

### All remote history

The remote-reachable blob scan produced 831 path-blob-identifier records. 327 of them lie outside the purge list, across 22 paths. No provider logic was found outside the purge list.

| Path                                                                                | Records | Assessment                                                                            |
| ----------------------------------------------------------------------------------- | ------: | ------------------------------------------------------------------------------------- |
| `docs/architecture.html`                                                            |     187 | Many regenerated versions of the public system map; provider names and env vars only. |
| `docs/architecture.md`                                                              |      29 | Decision-log text; public by design.                                                  |
| `packages/app-shell/src/views/LegalSearchView.test.tsx`                             |      24 | Test URLs.                                                                            |
| `packages/app-shell/src/components/search/SearchResults.test.tsx`                   |      17 | Test URLs.                                                                            |
| `packages/app-shell/src/demo-shell.test.ts`                                         |      15 | Historical test URLs.                                                                 |
| `pnpm-lock.yaml`                                                                    |      12 | Historical lockfile metadata.                                                         |
| `bun.lock`                                                                          |       9 | Lockfile metadata.                                                                    |
| `packages/app-shell/src/views/CaseLawDocumentView.test.tsx`                         |       7 | Test URLs.                                                                            |
| `packages/app-shell/src/views/verify.test.tsx`                                      |       5 | Test URLs.                                                                            |
| `docs/implementation-plan.md`                                                       |       5 | TNA licence link.                                                                     |
| `packages/app-shell/src/components/search/provenance.ts`                            |       3 | User-facing attribution.                                                              |
| `packages/app-shell/src/components/search/searchResultRows.test.ts`                 |       3 | Test URLs.                                                                            |
| `packages/app-shell/src/legal-search-state.ts`                                      |       2 | User-facing fallback URL.                                                             |
| `apps/desktop/src/main/navigation-guard.test.ts`                                    |       1 | External-URL safety test.                                                             |
| `packages/app-shell/src/components/search/sourceProvenance.test.ts`                 |       1 | Test URL.                                                                             |
| `docs/anti-slop-pass-c-triage.md`                                                   |       1 | Stale path reference.                                                                 |
| `docs/backend-repo-split.md`                                                        |       1 | Plan text on this branch.                                                             |
| `docs/design/ui-redesign/final/{judgment,legislation-provision,search,verify}.html` |       4 | Mockup links, one each.                                                               |
| `scripts/bun-runtime-eval/build-compiled.sh`                                        |       1 | Historical API harness alias list; covered by the added purge prefix.                 |

No `find-case-law` hit exists outside `services/legal-ingestor`. No `atom-parser` or `html-parser` hit exists outside the moved search spec. The `<unmapped>` blobs in the first scan were local checkpoint objects and are absent from the remote-reachable set.

## 7. `sources` repository

Read-only inspection of `ObiterDictum/sources` at `main`. Fifteen files import obiter packages. The `@obiter/*` specifiers stay the same; resolution moves from `../obiter/packages/*` to `../backend/packages/*`.

| File                                        | Imports                                         |
| ------------------------------------------- | ----------------------------------------------- |
| `src/analyse-paragraphs.ts`                 | `@obiter/search-client`, `@obiter/legal-schema` |
| `src/analyse-quotation-structure.ts`        | `@obiter/legal-schema`                          |
| `src/benchmark/cases.test.ts`               | `@obiter/legal-schema`                          |
| `src/benchmark/cases.ts`                    | `@obiter/legal-schema`                          |
| `src/benchmark/corpus.ts`                   | `@obiter/legal-schema`                          |
| `src/benchmark/judgements-corpus.test.ts`   | `@obiter/legal-schema`                          |
| `src/benchmark/paragraph-structure.test.ts` | `@obiter/legal-schema`                          |
| `src/benchmark/paragraph-structure.ts`      | `@obiter/legal-schema`                          |
| `src/benchmark/run.ts`                      | `@obiter/search-client`, `@obiter/legal-schema` |
| `src/find-case-law/availability.ts`         | `@obiter/legal-source-provider`                 |
| `src/find-case-law/collections.test.ts`     | `@obiter/legal-source-provider`                 |
| `src/find-case-law/walk.test.ts`            | `@obiter/legal-source-provider`                 |
| `src/find-case-law/walk.ts`                 | `@obiter/legal-source-provider`                 |
| `src/ingest.ts`                             | `@obiter/legal-source-provider`                 |
| `src/snapshot/verify.ts`                    | `@obiter/legal-schema`                          |

Path changes:

- `package.json`: `link:../obiter/packages/legal-schema` becomes `link:../backend/packages/legal-schema`; the same for `legal-source-provider` and `search-client`.
- `.github/workflows/ci.yml` and `.github/workflows/obiter-drift.yml`: `repository: ObiterDictum/obiter` becomes `ObiterDictum/backend`; the checkout `path: obiter` becomes `path: backend`; `working-directory: obiter` becomes `backend`; the `pnpm install --filter` names stay.
- `.obiter-pin`: pins a `backend` commit after the split.
- `README.md` lines 36-48 and `AGENTS.md` lines 29-46: replace `obiter` with `backend` for the sibling checkout and the ingestion path. The licence and “never commit” rules stay.

## 8. Branches and refs

At `abe9693f`:

- 71 remote heads, 1 tag (`gh-attach-assets`), 18 heads merged into `origin/dev`, 53 not merged.
- `main` is the release branch and is unmerged by design. `docs/backend-repo-split` is this PR. The evidence branches are stale and can be deleted in stage 5 step 6.
- `pr/264` is a local remote-tracking ref, not an `origin` head, so it is excluded.

Unmerged remote heads:

```text
audit/document-editor-completion
bun-serve-runtime-evaluation
chore/root-tidy-tier1
design-evidence/ui-redesign-6a-editor-frame
docs/backend-repo-split
docs/redaction-matters
docs/redact-prd-consolidation
docs/search-prd
docs/testing-policy
e34-evidence-198
e52-evidence-212
e54-evidence-201
e55-evidence-200
e56-evidence-203
e57-formatting-across-breaks-evidence
e61-evidence
e6-redo-evidence
evidence
evidence-pr-e1
evidence-pr-e2
evidence-pr-e3
evidence-pr-e4
evidence-pr-e5
evidence-pr-e6a
evidence-pr-e6b
evidence-pr-e7a
feat/editor-compare-versions
fix/redaction-source-file-active-content
fix/ssr-api-origin-evidence
fix/synthetic-v2-tournament-failures
main
product-workspace-shell
redact-degraded-detection-visibility
redact-detection-config-acceptance
redact-docx-proportional-detection
redact-synthetic-v2
refactor/redact-owned-docx-burn
s19-evidence-210
s20-evidence
search-engine-ranking
search-gate-1-correctness
search-index-tuning
search-match-consistency
search-quality-evidence-metadata
search-ranking-perf
search-word-boundary
split-redact-routes
tests/rule-recovery-ooxml
v5-evidence-208
v5-repair-evidence-208
verify-contextual-evidence-shots
web/production-commands-bun-evidence
web/vite-dev-bun-evidence
```

## Counts

| Section           | Count                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------- |
| Moving workspaces | 7 workspaces, 486 files                                                                      |
| Scripts           | 150 files: 77 move, 5 split, 68 stay; 29 root scripts                                        |
| CI                | 4 jobs in `ci.yml`, 1 in `desktop-release.yml`                                               |
| Docs              | 19 moving files, 8 `architecture.md` ranges, 27 edited files                                 |
| Purge list        | 26 entries; 33 historical paths under the seven prefixes; 8 under `services/atlas-ingestor/` |
| Provider hits     | 61 at HEAD across 18 paths; 327 historical records across 22 paths                           |
| `sources`         | 15 importing files, 3 package links, 2 workflows                                             |
| Branches and tags | 71 heads, 1 tag, 53 unmerged                                                                 |
