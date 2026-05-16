---
name: production-pr-review
description: Production-grade pull request review for Ormont. Use whenever asked to review a PR, branch, diff, refactor, or change for correctness, security, architecture, data safety, tests, and release readiness. Builds repository context before reviewing and records durable architecture knowledge when a review knowledge repo is available.
---

# Production PR Review

## Mission

Review as a staff+ engineer protecting production correctness, user trust, legal-data safety, and long-term architecture. The goal is to find important bugs and logic issues, not to approve style preferences.

Do not rubber-stamp. Do not say a PR is ready unless the evidence supports it.

## Review Order

1. Establish repository and branch state.
2. Load the minimum authoritative context for the touched area.
3. Build a change map from the base branch to the review branch.
4. Build or update a mental architecture map before judging code.
5. Inspect changed files and all directly coupled files.
6. Run appropriate verification where possible.
7. Report only actionable findings, ranked by severity.
8. Record durable knowledge in the review knowledge repo if configured.

## Required Setup Commands

From the target repo:

```bash
git status --short --branch
git remote -v
git branch --show-current
git merge-base HEAD origin/main
git diff --stat origin/main...HEAD
git diff --name-status origin/main...HEAD
```

If the PR targets another base, replace `origin/main` with the actual base.

If GitHub CLI is available and a PR exists:

```bash
gh pr view --json number,title,baseRefName,headRefName,url,body,reviewDecision,mergeable,statusCheckRollup
```

## Context Loading

Always read, as applicable:

- `AGENTS.md`
- `RULES.md`
- `PR.md`
- `TESTING.md`
- docs linked by `AGENTS.md` for the touched area
- package-level READMEs or local docs near changed files

For Ormont, prioritize:

- `docs/architecture.md` for package boundaries and system shape
- `docs/data-and-compliance.md` for privacy, audit, and legal data constraints
- `docs/roadmap.md` / active milestone docs for sequencing
- `docs/specs/README.md` and linked specs for changed product behavior

Load only what is needed, but do not review without enough architecture context to understand the blast radius.

## Change Map

Create a concise map before detailed review:

- changed packages/apps/services
- public API or contract changes
- data model, migration, or schema changes
- auth, permissions, audit, storage, sync, legal verification, or redaction impact
- UI behavior and accessibility impact
- tests added/changed/missing
- docs updated/missing

Use search to find direct dependents of changed exports, types, routes, schemas, and database fields.

## Review Mindset

Look specifically for:

- incorrect domain modeling or flattened legal concepts
- schema drift between contracts, services, docs, database, and UI
- missing boundary validation for untrusted input
- client-side authorization masquerading as security
- data loss, silent overwrite, or weak conflict handling
- missing audit trail for sensitive actions
- raw sensitive data in logs, object keys, fixtures, tests, or telemetry
- hidden hosted processing of sensitive matter data
- non-idempotent background jobs or unsafe retry behavior
- race conditions around versions, sync, artifacts, audit logs, or jobs
- swallowed errors, broad catches, silent fallbacks, or optimistic names
- duplicated state machines across packages
- React lifecycle misuse, especially `useEffect` for derived state or data fetching
- desktop renderer access to privileged APIs
- accessibility regressions in focus, keyboard flow, labels, contrast, or hover-only state
- tests that assert implementation trivia instead of behavior
- missing failure-path tests in safety-critical flows

## Severity

Use this scale:

- **Blocker**: data loss, security/privacy breach, legal-critical incorrectness, broken build, impossible migration, or architecture violation that will be expensive to unwind.
- **High**: likely production bug, permission flaw, schema drift, race, bad state transition, missing validation, or missing test for high-risk behavior.
- **Medium**: maintainability or correctness risk that should be fixed before merge unless explicitly accepted.
- **Low**: minor issue, naming clarity, localized cleanup.
- **Nit**: optional style preference. Avoid nits unless they prevent misunderstanding.

Every finding must include:

- file path and line or smallest relevant location
- what is wrong
- why it matters
- concrete fix direction
- confidence level when useful

Do not include a finding unless it is actionable.

## Verification

Run the narrowest useful checks first, then broader checks if warranted:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Use package-specific scripts when available. For UI work, perform or request a manual pass for the changed flow. For legal-critical behavior, require happy path and failure path verification.

If checks cannot be run, state exactly why and do not imply they passed.

## Knowledge Graph / Review Repo

When a local review knowledge repo exists, usually under one of:

- `../review`
- `../ormont-review`
- `C:/Users/karl-/Documents/source/OrmontLex/review`

record durable context, not transient PR notes.

Suggested structure:

```text
review/
  ormont/
    architecture/
      packages.md
      data-boundaries.md
      route-map.md
    decisions/
      YYYY-MM-DD-short-title.md
    review-playbooks/
      frontend.md
      contracts.md
      security-data.md
    findings-patterns/
      YYYY-MM.md
```

Record:

- package ownership and dependency boundaries
- important domain invariants
- recurring bug patterns
- review heuristics that caught real issues
- ADR-like decisions that affect future reviews

Do not record secrets, private matter data, tokens, customer data, or raw legal document content.

If the review repo does not exist, mention that durable review memory is unavailable and propose creating/syncing it.

## Output Format

Use this structure:

```markdown
## Review Verdict

[Approve / Request changes / Not ready / Needs more context]

## Findings

- **Severity — title** (`path:line`)
  - Problem:
  - Why it matters:
  - Fix:

## Verification

- Commands run:
- Results:
- Not run / gaps:

## Architecture / Knowledge Notes

- Durable context learned or updated:
- Follow-up knowledge repo updates needed:
```

If there are no findings, say what was inspected and what verification supports that conclusion.
