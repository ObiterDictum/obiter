# Obiter Agent Guide

## Purpose

Use this file as the lightweight entry point for work in this repo.

## Read First

Only load the docs needed for the task.

- **Operating model & sync:** [github.com/ObiterDictum/obiter-ops](https://github.com/ObiterDictum/obiter-ops) (separate ops repo)
- Product and execution baseline: [README.md](README.md)
- Start order and milestones: [docs/roadmap.md](docs/roadmap.md)
- Foundation rules: [docs/phase-0.md](docs/phase-0.md)
- Architecture and stack: [docs/architecture.md](docs/architecture.md)
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

## Working Style

- Keep `AGENTS.md` small. Do not turn it into a second README.
- Put detailed planning in `docs/`, not here.
- Put implementation constraints and coding standards in `RULES.md`.
- Use `PR.md` only when preparing a PR or equivalent summary.
