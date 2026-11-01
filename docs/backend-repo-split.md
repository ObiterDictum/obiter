# Backend Repository Split

Status: stage 3 in progress (cut-over). Stage 2 landed the private `ObiterDictum/backend` repository with every moving path, its history and the `obiter/` submodule; this repository is removing its half. Planned 1 November 2026, assessed at `origin/dev` `abe9693f`.

## Decision

The Find Case Law licence does not permit the API's search and case-law code to
be published. Rather than draw a line through `services/api`, the whole backend
moves to a new private repository, `ObiterDictum/backend`. This repository stays
public under Elastic 2.0 and keeps the clients and the packages they share.

Case-law code is not confined to search. Verify resolves citations and checks
quotes against the corpus (`citation-resolution`, `authority-existence`,
`quote-fidelity`), and the API also owns the index rebuild, parity check,
hydration ledger and request budget. Research will add more. A search-only split
would need policing on every Verify and Research change; "server private, clients
public" is one rule a CI check can enforce.

This supersedes the "the line is bulk, not retrieval" rule in the private
`sources` README, which kept per-search retrieval in this repository.

## Target layout

| Workspace                                                                        | Goes to   | Reason                                                        |
| -------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------- |
| `services/api`                                                                   | `backend` | The API, including search, Verify and Redact routes           |
| `services/legal-ingestor`                                                        | `backend` | The only Find Case Law caller                                 |
| `packages/legal-source-provider`                                                 | `backend` | Find Case Law client and parsers                              |
| `packages/legal-schema`                                                          | `backend` | Used only by private packages                                 |
| `packages/search-client`                                                         | `backend` | Meilisearch client and search benchmark; used only by server  |
| `packages/verification-core`                                                     | `backend` | Citation resolution and quote fidelity; used only by the API  |
| `packages/database`                                                              | `backend` | Migrations, applied by the API at startup                     |
| `scripts/api-runtime`, `scripts/api-ingress`                                     | `backend` | Start and probe the API                                       |
| `scripts/search-corpus-relevance`, `scripts/legislation-relevance`               | `backend` | Search relevance over stored sources                          |
| `scripts/load` and any other script that starts or calls the API                 | `backend` | Listed and confirmed in stage 1                               |
| `apps/web`, `apps/desktop`                                                       | public    | Clients                                                       |
| `packages/app-shell`, `ui`, `redact-ui`, `test-dom`                              | public    | Client UI                                                     |
| `packages/contracts`, `config`, `ooxml`, `redaction-policy`, `rampart-inference` | public    | Shared with the backend, consumed from this repository        |
| `services/redaction-renderer`                                                    | public    | No case law; depends on `app-shell` to render as the app does |

`packages/contracts/src/legal-search.ts` and `legislation-paths.ts` stay public:
they are request and response shapes the app reads, not provider code. The
judgment view in `app-shell` stays public for the same reason.

Docs: implementation specs under `docs/specs/search`, `docs/specs/verify`,
`docs/specs/atlas` and `docs/specs/research`, and the Find Case Law sections of
`docs/architecture.md`, move to `backend/docs`. Product-level descriptions stay
here. `docs/architecture.html` keeps the system map and marks backend nodes as
living in `backend`.

## How the repositories connect

`backend` includes this repository as a git submodule at `obiter/`, pinned to a
commit, and lists `obiter/packages/{contracts,config,ooxml,redaction-policy,rampart-inference}`
as Bun workspaces. Nothing is published to a registry. `sources` already uses
this pin pattern (`.obiter-pin`) and a drift job; `backend` copies both.

Because `backend` contains the clients through the submodule, it is the one
place the whole stack runs: `dev:desktop:api`, the web Playwright suite (which
starts the API), the API runtime integration job and the Redact
acceptance checks all run there.

A change that spans both sides lands in this repository first, then a `backend`
PR bumps the submodule and makes the server change. About one merge in four
did that over the last 60.

`sources` re-points its imports (`moj-client`, `atom-parser`, `html-parser`,
`court-utils`, `source-store`) from `obiter` to `backend`, and its pin follows.

## CI and deployment

This repository keeps typecheck, lint, format, unit and DOM tests, the web and
desktop builds, bundle and desktop budgets, the web image and the desktop
release. It loses the Postgres and Meilisearch services, the search benchmark,
the Bun API runtime integration job and the API image builds.

A new check fails any PR here that adds a path in the private list or imports a
private package name.

`backend` gets the Postgres and Meilisearch test job, the API runtime
integration, the search benchmark, the web end-to-end suite and the API image
builds (`services/api/Dockerfile`, Bun default and Node rollback targets).

Dokploy's `api` application changes its source to `backend` with a read-only
deploy key. `web` and the renderer are unchanged.

## History purge

Every path moving to `backend`, including former names of those paths, is
purged from this repository's history. That is wider than strictly case-law
files, but it needs no file-by-file judgement and catches case-law wiring that
lived inline in shared API files.

Facts that shape the purge:

- No open PRs, 0 forks, 0 stars, 70 remote branches, 1 tag, 363 PRs in total.
- GitHub keeps `refs/pull/*` read-only. Old PR diffs and commits stay reachable
  by SHA after a force-push until GitHub Support purges them, so a support
  request is part of the purge, not optional.
- The private advisory fork `obiter-ghsa-mr77-qghc-8m3j` holds a copy of the
  history and is deleted or purged too.

Method:

1. Build the path list from `git log --all --name-only` filtered to the private
   workspaces and their former names. Review it before running anything.
2. Run `git filter-repo --invert-paths --paths-from-file` on a fresh
   `--mirror` clone, never in a working checkout.
3. Verify: no purged path appears in `git log --all --name-only`, and a grep of
   every rewritten blob for provider identifiers (`caselaw.nationalarchives`,
   `moj-client`, `atom-parser`, `legal-source-provider`) finds nothing outside
   paths that stay public by design.
4. Before force-pushing, seed `backend` from the original, unpurged history so
   nothing is lost: `git filter-repo --paths-from-file` keeps exactly those
   paths with their history.
5. Force-push all branches and tags. This step waits for explicit approval.
6. Ask GitHub Support to remove cached views and unreachable PR refs, and
   delete stale remote branches.
7. Every local clone and worktree re-clones; none is pulled across the rewrite.

## Stages

Each stage ends in a PR reviewed before the next starts.

1. **Inventory.** Exact file lists for both repositories, the scripts that start
   or call the API, the docs that move, and the purge path list. No changes.
2. **Create `backend`.** Seed it with the private paths and their history, add
   the submodule, workspaces, lockfile, CI and drift job. It builds, typechecks
   and passes the full API suite, the runtime integration on Node and Bun, and
   the web end-to-end suite.
3. **Cut over this repository.** Remove the private paths, CI jobs and root
   scripts; add the private-path check; update `README.md`, `AGENTS.md`,
   `docs/architecture.html` and the moved docs' stubs. Point Dokploy's `api` at
   `backend`, deploy and confirm health.
4. **Re-point `sources`** to `backend` and bump its pin.
5. **Purge history** as above, after explicit approval of the force-push.

## Decisions

- The National Archives is not notified. No licensed material or service built
  on it has been served to anyone; the purge and GitHub Support removal of old
  PR refs close the code's earlier publication.

## Open decisions

- Whether the renderer should move to `backend` later; doing so means consuming
  `app-shell` through the submodule.
