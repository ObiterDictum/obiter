---
name: production-pr-author
description: Production-grade pull request authoring for Ormont. Use when creating, updating, or preparing PR titles/bodies/summaries. Produces clear engineering PR descriptions covering what changed, why, implementation details, tests, risks, security/data implications, architecture impact, rollout, and follow-ups.
---

# Production PR Author

## Mission

Write PR titles and descriptions that let another engineer review the change safely and quickly. The PR body must explain what changed, why it changed, how it was implemented, how it was verified, and what risks remain.

Do not write marketing copy, vague confidence language, or AI-flavored filler. Be precise, honest, and maintainable.

## Subagent Model Policy

Use the primary Codex model for the substantive engineering work: inspecting the diff, reading relevant rules and docs, deciding what changed, assessing security/data/privacy impact, identifying testing gaps, and choosing the final title/body claims.

After those facts are locked, any delegated PR-title or PR-body drafting subagent must be spawned with `model: "gpt-5.4-mini"`. Do not inherit the primary model for post-analysis prose drafting unless the user explicitly overrides this policy.

Give the mini-model subagent only the minimum sanitized packet: branch/base, changed-file summary, locked implementation notes, locked security/data/privacy assessment, exact tests run, known gaps, and wording constraints. Do not give it secrets, private matter data, raw legal text, raw prompts, embeddings, sensitive logs, private screenshots, or authority to inspect unrelated code.

The mini-model subagent must return draft text only. The primary model must validate the final PR text before posting: every claim must match the diff and verification evidence, no sensitive data may be disclosed, and no unrun test may be implied.

## Required Context

Before writing a non-trivial PR summary, inspect:

```bash
git status --short --branch
git branch --show-current
git diff --stat <base>...HEAD
git diff --name-status <base>...HEAD
git log --oneline <base>..HEAD
```

If a PR already exists, inspect it:

```bash
gh pr view --json number,title,baseRefName,headRefName,url,body,reviewDecision,mergeable,statusCheckRollup
```

Use the actual base branch. For Ormont this is usually `dev` unless explicitly stated.

Also read the relevant project rules:

- `AGENTS.md`
- `PR.md`
- `TESTING.md`
- `RULES.md` when architecture, security, or implementation behavior changed
- touched-area docs/specs when behavior changed

## PR Title Rules

A good title is specific and implementation/product oriented.

Use:

- `Add production PR review skill`
- `Refactor sidebar onto Base UI primitives`
- `Document review knowledge boundaries`

Avoid:

- `Updates`
- `Fix stuff`
- `Improve app`
- hype words such as robust, seamless, comprehensive, enhanced unless technically justified
- `phase` in Ormont PR titles

## Required PR Body Structure

Use this structure unless the change is truly trivial:

```markdown
## What Changed

- ...

## Why

- ...

## Implementation Notes

- ...

## Security / Data / Privacy

- ...

## Architecture / Maintainability

- ...

## Testing

- Commands run:
  - `...`
- Manual checks:
  - ...
- Not tested:
  - ...

## Risks / Follow-Ups

- ...
```

For UI PRs, add:

```markdown
## UI / Accessibility

- ...
```

For API/data/worker/security-sensitive PRs, add as relevant:

```markdown
## Data Model / Migrations

- ...

## Rollout / Operations

- ...
```

## What To Include

### What Changed

Explain the concrete behavior, files, packages, or structure changed. Mention important paths. Do not just restate commit titles.

### Why

Explain the engineering, product, security, or maintainability reason for the change. If it supports reviewability, future architecture, or safety, say how.

### Implementation Notes

Explain notable design choices and tradeoffs:

- package boundaries
- public contract changes
- new abstractions and why they exist
- removed/renamed files
- dependency changes and why they are needed
- compatibility considerations
- what was deliberately not changed

### Security / Data / Privacy

Always include this section for Ormont, even if the answer is "no sensitive data path changed." Cover:

- whether private matter data is touched
- whether auth/session/permissions are touched
- whether logs, telemetry, prompts, embeddings, object keys, queue payloads, or audit events changed
- local-vs-hosted processing implications
- tenant/organisation/matter isolation implications
- new dependencies, CI permissions, or external services

Never include secrets, private matter data, raw legal text, raw prompts, embeddings, sensitive object keys, or screenshots of private material.

### Architecture / Maintainability

Explain how the change affects future work:

- clearer ownership
- reduced duplication
- reusable primitives
- state/data-flow boundaries
- docs/spec alignment
- known limitations

### Testing

Be exact. Include commands actually run. Do not imply checks passed if they were not run.

Good:

```markdown
- Commands run:
  - `pnpm typecheck` - passed
  - `pnpm test` - passed
- Manual checks:
  - Opened the desktop shell and verified sidebar keyboard focus/order.
- Not tested:
  - No cross-browser pass; change is limited to shared shell markup/classes.
```

Bad:

```markdown
- Tested thoroughly.
```

### Risks / Follow-Ups

State remaining risk plainly:

- missing manual QA
- migration risk
- deferred tests
- known limitations
- rollout considerations
- follow-up PRs needed

## PR Creation Workflow

1. Determine base branch and current branch.
2. Inspect diff, changed files, and commits.
3. Read relevant rules/docs.
4. Draft title and body.
5. If asked to create the PR, use GitHub CLI:

```bash
gh pr create --base <base> --head <branch> --title "<title>" --body-file <body-file>
```

6. If updating an existing PR:

```bash
gh pr edit <number-or-url> --title "<title>" --body-file <body-file>
```

Use a temporary body file for multiline PR text. Delete it after use unless the user asks to keep it.

## Quality Checklist

Before posting, verify the PR body:

- states what changed and why
- names important files/packages
- describes implementation choices and tradeoffs
- includes security/data/privacy assessment
- includes architecture/maintainability impact
- includes exact tests run and gaps
- includes risks/follow-ups
- avoids filler and hype
- does not disclose sensitive data
- matches the actual diff

## Output When Not Posting

If only preparing the PR text, output:

```markdown
Title: ...

Body:
...
```

If posting to GitHub, output the PR URL and a short note of what was posted.
