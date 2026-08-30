# Obiter Agent Guide

## Purpose

Use this file as the lightweight entry point for work in this repo.

## Read First

Only load the docs needed for the task.

- **Operating model & sync:** [github.com/ObiterDictum/obiter-ops](https://github.com/ObiterDictum/obiter-ops) (separate ops repo)
- Product and execution baseline: [README.md](README.md)
- Start order and milestones: [docs/roadmap.md](docs/roadmap.md)
- Foundation rules: [docs/phase-0.md](docs/phase-0.md)
- System map (what runs where): [docs/architecture.html](docs/architecture.html)
- Architecture decisions and rationale: [docs/architecture.md](docs/architecture.md)
- Security and data rules: [docs/data-and-compliance.md](docs/data-and-compliance.md)
- Detailed specs: [docs/specs/README.md](docs/specs/README.md)
- Implementation rules: [RULES.md](RULES.md)
- PR writing rules: [PR.md](PR.md)
- Testing rules: [TESTING.md](TESTING.md)

## Build Order

Follow the roadmap. Do not jump ahead because a later feature looks interesting.

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

## Working Style

- Keep `AGENTS.md` small. Do not turn it into a second README.
- Put detailed planning in `docs/`, not here.
- Put implementation constraints and coding standards in `RULES.md`.
- Use `PR.md` only when preparing a PR or equivalent summary.
