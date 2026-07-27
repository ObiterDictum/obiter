# Repository Split PRD

Status: active. Defines how the Obiter monorepo separates into product, data-generation and operations repositories, and what deliberately stays together.

## Summary

`ObiterDictum/obiter` is public under Elastic 2.0 and currently holds four different kinds of thing: the product, the synthetic data-generation programme, internal operational tooling, and internal assessments of where the system is weak. Only the first has a reason to be public.

This splits along the boundary of what should be published, not along the boundary of what depends on what. The product's package graph is healthy and stays whole.

## Drivers

Three, in order of weight:

**Publication boundary.** Non-product material is being published by default because it happens to sit in the product repository. Data-generation code, doc tooling and the internal system assessment are not product, and publishing them is an accident of layout rather than a decision.

**Irreversibility.** Anything pushed to the public repository stays public: history, forks and caches all retain it. That makes the boundary decision urgent rather than tidy-up work, because every push before the split widens what has been published.

**Clarity.** Fifty files of corpus-generation machinery and its compliance rules sit beside twelve product packages, and a reader cannot tell which is which. That was the original complaint and it remains valid.

## What Is Not Being Split

**The product package graph stays whole.** `apps/*`, `packages/*` and `services/*` remain one workspace.

The dependency graph is healthy: `contracts`, `legal-schema`, `ui` and `database` are clean leaves with no internal dependencies, carrying five, three, four and zero dependents respectively. Splitting them into separate repositories converts free in-repo refactors into version-publish-consume cycles across four repositories, on interfaces that are still moving. `redact-ui` depends on `app-shell`, so they cannot be separated without severing that first.

This PRD explicitly rejects splitting product code. Where a boundary is wanted inside the product, the answer is a module boundary, not a repository boundary.

## Coupling Analysis

Verified 2026-07-27 against `dev`.

| Area                               | Imports from product packages                | Verdict    |
| ---------------------------------- | -------------------------------------------- | ---------- |
| `scripts/synthetic-v2/` (50 files) | none: node builtins, vitest, typescript only | Clean lift |
| `scripts/eval-redact.ts`           | none                                         | Clean lift |
| `scripts/export-training-data.ts`  | none                                         | Clean lift |
| `scripts/bench-guard.ts`           | none                                         | Clean lift |
| `scripts/architecture-*.py`        | none                                         | Clean lift |
| `data/evals/redact/*` fixtures     | loaded by three API test files               | **Pinned** |

The data-generation programme has zero build-time coupling to the product. That makes this a move rather than an untangling, and it is why this split is worth doing and the product split is not.

**The one real constraint:** seven fixtures under `data/evals/redact/` are loaded directly by product tests (`app.test.ts`, `document-extraction.test.ts`, `documents-upload.test.ts`): `demo-fixture.docx` and six PDF fixtures covering the text-layer, low-text, spaced-PII, zero-width and scanned-like cases that extraction must handle or reject. These are test fixtures for shipped code and stay with the code they test.

The rule that follows: **a fixture a product test loads stays; evaluation corpora and generation inputs move.**

## Target Repositories

Three repositories, not four.

| Repository      | Visibility       | Holds                                                                        |
| --------------- | ---------------- | ---------------------------------------------------------------------------- |
| `obiter`        | Public, ELv2     | Product: apps, packages, services, product PRDs and specs, infra, fixtures   |
| `obiter-corpus` | Private, renamed | The corpus programme: generation code, evaluation harness, and its artifacts |
| `obiter-ops`    | Private, exists  | Operating model, system reference and its generators, internal assessments   |

### Naming

`obiter-redaction-data-private` is renamed to `obiter-corpus`. Three problems with the old name:

- **Visibility does not belong in a name.** Whether a repository is private is a setting, not an identity. If the benchmark is ever released the name becomes a lie, and renaming under pressure is worse than renaming now.
- **`redaction-` scopes it too narrowly.** The programme already produces evaluation material that Search wants, and the benchmark is a general UK legal PII set rather than a Redact-only asset.
- **It is long,** against a house style where the existing sibling is `obiter-ops`.

GitHub redirects the old name after a rename, so existing clones and links keep working.

### Generation code and artifacts live together

An earlier draft of this document proposed a separate repository for generation code, keeping it apart from the artifacts. That was wrong. The corpus programme's evidence is hash-bound to its output: partition registries, canary receipts and manifests all reference specific artifacts by hash. Splitting the code from the artifacts it produced puts an audit trail across a repository boundary, which is exactly the trail that exists to prove a dataset was produced legitimately.

They are also governed by the same rules. One repository means one place for the compliance constraints rather than two that can drift.

## The Backend Question

`services/api` and `services/legal-ingestor` stay in the public repository under ELv2. This is a decision rather than an omission, so the reasoning is recorded.

**What was checked.** No secret value lives in any tracked file; every credential is read from the environment. The matches for "admin", "credential" and "secret" in `services/` are variable names, not values. Nothing in the backend is unpublishable on its face.

**Why public.** Elastic 2.0 already blocks the actual competitive threat, which is someone running Obiter as a managed service. Beyond that, the backend is where a buyer's questions get answered: how organisation scoping is enforced, how storage keys are validated, that redaction is applied server-side rather than in a client that could be bypassed. For a product sold on evidence and reviewability, an inspectable data path is an asset. Hiding it would be obscurity rather than security, since the authentication is standard `better-auth` and the genuinely strong properties, composite foreign keys and the storage key regex, are stronger for being checkable.

**The carve-out to name now.** Operational code is different from product code. When billing, tenant provisioning, admin surfaces or ops runbooks arrive, they belong in `obiter-ops`, not in `services/api`. Deciding that before the code exists is far cheaper than extracting it afterwards.

**One thing to confirm before the split.** `services/legal-ingestor` and the Find Case Law client implement acquisition against a licensed source. The licence plainly governs the data; whether it says anything about publishing the acquisition code is worth confirming rather than assuming, because publication cannot be undone. The code contains no licence-restricted specifics today, only standard client and rate-limiting logic.

## Inventory

### Moves to `obiter-corpus`

- `scripts/synthetic-v2/` entire directory, 50 files
- `scripts/generate-synthetic-data.ts`, `scripts/export-training-data.ts`, `scripts/eval-redact.ts`, `scripts/bench-guard.ts` and their tests
- `data/evals/redact/synthetic_validation.jsonl`, consumed by bench-guard and export-training-data
- `data/bench/uk-legal-pii/` release contract, including the unpublished benchmark's `LICENSE`, `DATASHEET.md` and manifest placeholder
- `docs/specs/redact/synthetic-v2-programme.md`
- The Synthetic Redaction Corpus rules currently in `AGENTS.md`

### Moves to `obiter-ops`

- `docs/architecture.html` and `scripts/architecture-diagrams.py`, `scripts/architecture-sections.py`

Generator and output move together. Separating them leaves a generated artifact nobody can regenerate, which is the stale-map failure the tooling exists to prevent.

- `docs/prds/redact-4-hardening.md`, at least until its Gate 1 lands. It is shaped like a PRD but reads as a write-up of an unfixed weakness in a privacy feature.

### Stays in `obiter`

- All of `apps/`, `packages/`, `services/`
- `data/evals/redact/` fixtures loaded by product tests, and `data/evals/search/`
- Product PRDs and specs, `RULES.md`, `TESTING.md`, `PR.md`, `AGENTS.md`
- `infra/`, `.github/`
- `scripts/generate-pdf-fixtures.mjs`, which builds the fixtures the product tests use

## What Breaks

Each of these must be handled in the same change that moves the files.

- **Root scripts.** Four `synthetic-v2:*` entries in `package.json` go. The `test` script loses its `vitest run scripts/synthetic-v2` tail and `typecheck` loses its synthetic-v2 tsconfig pass.
- **CI.** The `checks` job currently covers synthetic-v2 through those root scripts. `obiter-corpus` needs its own equivalent workflow, or the programme ships untested.
- **`AGENTS.md`.** The Synthetic Redaction Corpus section and the System Reference section both point at files that will have moved. Both need cross-repository pointers, following the precedent already set for `obiter-ops`.
- **Documentation cross-references.** `docs/prds/bench.md`, `docs/specs/redact/demo.md`, `fine-tuning.md`, `milestones.md` and `synthetic-data-plan.md` all reference `data/evals` or `data/bench` paths.
- **Agent context.** An agent working in `obiter` loses the system reference. This is a genuine cost, weighed against the reason for moving it.

## Migration Mechanics

Use `git subtree split -P scripts/synthetic-v2` to preserve history. That programme has an audit trail worth keeping: provider qualification evidence, spend records and the fail-closed work in PR #42 are all reasons a future reader needs to see why a decision was made.

For the smaller moves, a single import commit is sufficient and simpler.

**Removal from the public repository does not unpublish.** Files already pushed remain in history and in any fork or cache. Deleting them going forward reduces future exposure and nothing else. Treat anything already public as permanently public, and make the boundary decision before the next push rather than after.

## Rollout

**Gate 0: Decide the boundary.** Confirm the inventory above, particularly whether `redact-4-hardening.md` and the system reference are private. Blocking: nothing else should push until this is settled.

**Gate 1: Extract data generation.** Create `obiter-corpus`, subtree-split `scripts/synthetic-v2`, move the associated scripts and evaluation data, stand up its CI, and confirm it runs standalone before removing anything from `obiter`.
_Exit:_ the corpus programme runs green in its own repository; `obiter` still passes typecheck, lint and test after removal.

**Gate 2: Extract operations.** Move the system reference and its generators to `obiter-ops`, update `AGENTS.md` to point across repositories.
_Exit:_ the page regenerates in its new home; no dangling references in `obiter`.

**Gate 3: Prune and document.** Remove moved paths, update root scripts and CI, correct every cross-reference, and record the split in `docs/architecture.md`.
_Exit:_ no reference in `obiter` points at a path that has moved.

## Non-Goals

- Splitting `apps/`, `packages/` or `services/`. See [What Is Not Being Split](#what-is-not-being-split).
- Relicensing anything. The ELv2 position and any future permissive carve-out are separate decisions.
- Rewriting the corpus artifacts themselves. They move only by the repository rename.
- Retroactively removing published material, which is not achievable.

## Risks

- **Cross-repository references rot faster than in-repo ones.** Nothing type-checks a link between repositories. Mitigation is to keep the number of such references small and listed in one place per repo.
- **The corpus programme loses CI coverage in transit.** Gate 1 requires it green in the new repository before removal from the old, not after.
- **Agents lose the system map.** If this proves costly, the fallback is a short public summary in `obiter` pointing at the full private reference.
- **Compliance rules get orphaned.** The corpus governance rules in `AGENTS.md` protect against committing real personal data. They must land in `obiter-corpus` before the programme does, not after.

## Open Questions

- Does `obiter-corpus` need the fixtures `generate-pdf-fixtures.mjs` produces, or only the product?
- Does the Find Case Law licence say anything about publishing acquisition code, as distinct from the data? Blocking for `services/legal-ingestor` staying public.
- Where do billing and tenant provisioning land when they arrive: `obiter-ops`, or a fourth repository?
- Is `redact-4-hardening.md` private permanently, or public once Gate 1 of that PRD lands?
- Should `obiter` carry a public summary of the architecture, or nothing at all?
