# Obiter Agent Guide

Start with [README.md](README.md) and [docs/roadmap.md](docs/roadmap.md). Load anything else only when the task needs it.

Operating model and sync lives in the separate [`obiter-ops`](https://github.com/ObiterDictum/obiter-ops) repo.

## On-demand docs

- Rules: [RULES.md](RULES.md) — always follow, load once per task.
- PR summaries: [PR.md](PR.md) — only when writing one.
- Verification: [TESTING.md](TESTING.md) — only when deciding what to test.
- Foundation: [docs/phase-0.md](docs/phase-0.md) — only for shell, auth, matter, storage work.
- System map: [docs/architecture.html](docs/architecture.html) — what runs where.
- Architecture rationale: [docs/architecture.md](docs/architecture.md) — only for structural decisions.
- Security: [docs/data-and-compliance.md](docs/data-and-compliance.md) — only when touching matter data, storage, auth, or infra.
- Specs: [docs/specs/README.md](docs/specs/README.md) — only for the module being built.

## Build order

Follow the roadmap. Do not jump ahead.

1. Phase 0 foundation
2. Search
3. Redact
4. Verify
5. Verify Advanced
6. Research

## Synthetic Redaction Corpus

- Keep the synthetic-v2 pipeline, label policy, schemas, manifests, and evaluation harness in this repository.
- Do not commit generated private training/development documents, raw provider output, run logs, or human-review annotations here; use the separate private corpus store/repository.
- Publish a frozen, versioned benchmark separately once approved so external redaction systems can evaluate against it without product-repository coupling.
- Never put corpus material or raw legal text in the `review` knowledge repository.
- Read [synthetic-v2-programme.md](docs/specs/redact/synthetic-v2-programme.md) before changing synthetic-v2 stages, data splits, or evaluation criteria.

## System Reference

`docs/architecture.html` maps workspaces, routes, migrations, configuration, boundaries, and known divergences. A stale map is worse than none, so keep it current in the same change, not afterwards.

- Update it when a change adds or removes a workspace, an API route, a migration, a required environment variable, or a boundary rule.
- Regenerate diagrams with `python scripts/architecture-diagrams.py --apply`, then run Prettier. Do not hand-edit the inline SVG; the generator computes layout and fails closed on overlapping nodes, nodes outside the viewBox, and dangling marker references.
- Section order and the sidebar both come from `scripts/architecture-sections.py`. Add a new section's id and label there rather than editing the page in two places.
- If the code deliberately departs from a PRD, record it in the Known Divergences table. Do not leave the PRD silently wrong.

## Assessing repository state

Before assessing repository state, fetch and state the exact commit you are assessing: `git fetch origin && git rev-parse origin/<branch>`. Put that commit at the top of any report about branch state. After a merge, re-fetch before doing anything further. An assessment of a stale checkout reads as authoritative and is worse than no assessment.

## Working style

- Keep `AGENTS.md` a linker, not a rule body. Planning goes in `docs/`, constraints in `RULES.md`.
- `PR.md` is for PR summaries only.
