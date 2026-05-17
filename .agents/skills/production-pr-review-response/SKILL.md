---
name: production-pr-review-response
description: Production-grade workflow for responding to Ormont PR reviews. Use when asked to validate review feedback, implement required fixes, update the PR, post a response comment, and resolve GitHub review threads or inline comments after verification.
---

# Production PR Review Response

## Mission

Turn PR review feedback into verified fixes without losing review context, hiding risk, or contaminating the PR with unrelated work. Validate every finding, implement the minimum correct change, add or update tests first where practical, push the fix, update the PR, reply clearly, and resolve review threads only when the issue is actually addressed.

This skill complements `production-pr-review` and `production-pr-author`:

- Use `production-pr-review` thinking to validate whether feedback is correct and whether additional related issues exist.
- Use `production-pr-author` standards when updating PR bodies and writing reviewer-facing summaries.

## When To Use

Use this skill when the user asks to:

- address a PR review
- validate PR comments or review findings
- implement requested changes
- respond to reviewer feedback
- close or resolve inline comments / review threads
- update a PR after review
- make review-response behavior consistent

## Required Safety Rules

- Do not mix unrelated local changes into the review-response commit.
- Do not resolve a review thread until the fix is pushed and verification has passed, or until you have explicitly explained why no code change is needed.
- Do not dismiss a finding just because tests pass. Validate it against code, schema, docs, and runtime behavior.
- Do not post comments containing secrets, private matter data, raw legal text, raw prompts, embeddings, sensitive object keys, stack traces with sensitive values, or screenshots of private material.
- If GitHub CLI cannot post or resolve threads, provide exact manual actions with links/thread ids.

## Workflow

### 1. Establish PR And Working Tree State

From the product repo:

```bash
git status --short --branch
gh pr view <number-or-url> --json number,title,baseRefName,headRefName,url,body,reviewDecision,mergeable,statusCheckRollup,headRefOid,comments,reviews
```

If the current branch is not the PR branch:

```bash
git fetch origin <headRefName>
git switch <headRefName>
```

If unrelated files are modified, stop and protect them before editing. Options:

- ask the user what to do
- commit only explicitly related files
- leave unrelated files unstaged
- stash only with explicit intent and restore it afterward

### 2. Load Review Comments And Threads

`gh pr view` shows top-level comments and reviews, but not all unresolved inline threads. Query review threads explicitly:

```bash
gh api graphql \
  -F owner='<owner>' \
  -F repo='<repo>' \
  -F number=<pr-number> \
  -f query='query($owner:String!,$repo:String!,$number:Int!){ repository(owner:$owner,name:$repo){ pullRequest(number:$number){ reviewThreads(first:100){ nodes { id isResolved path line startLine comments(first:20){ nodes { id url body author { login } createdAt } } } } } } }'
```

Build a checklist with:

- top-level review findings
- unresolved inline review threads
- reviewer comments that are informational only
- any review findings that cannot be mapped to a thread

### 3. Validate Each Finding

For each finding, record one of:

- **Accepted**: issue is real and requires a fix.
- **Partially accepted**: issue is real but the fix differs from the suggestion.
- **Not accepted**: issue is not correct; gather code/docs/test evidence before responding.
- **Needs clarification**: reviewer intent is ambiguous or the safe fix depends on product direction.

Validation should include the relevant source files, docs/specs, tests, and runtime constraints. For data/API/security review feedback, check:

- database constraints and migrations
- request validation and route behavior
- tenant/organisation scoping
- object key and storage boundaries
- audit logging
- transaction and rollback behavior
- tests that would have caught the issue

### 4. Use TDD For Fixes Where Practical

Before changing production code, add or update focused tests that fail for the reviewed issue when practical.

Examples:

- object key/schema mismatch: database test proves the generated key matches the DB constraint shape
- missing audit: route test proves the audit event is appended
- cross-org read: route or database test proves organisation scoping
- transaction bug: database test proves rollback/commit behavior

Run the targeted test to confirm it fails for the expected reason when feasible, then implement the fix.

### 5. Implement Minimal Fixes

Make the smallest production change that addresses the validated issue and preserves the intended architecture.

After implementation, run the relevant checks:

```bash
pnpm --filter <package> typecheck
pnpm --filter <package> test
```

For broader or cross-package changes, run the root checks if practical:

```bash
pnpm typecheck
pnpm test
```

### 6. Commit And Push

Inspect the staged diff before committing:

```bash
git status --short
git diff --stat
git diff --check
git diff --cached --stat
git diff --cached --check
```

Commit only related files:

```bash
git add <related-files>
git commit -m "Address <area> review findings"
git push
```

### 7. Update The PR Body When Scope Or Testing Changes

If the fix changes behavior, data boundaries, tests, risks, or rollout notes, update the PR body using `production-pr-author` standards:

```bash
gh pr edit <number-or-url> --body-file <body-file>
```

Delete temporary body files afterward.

### 8. Post A Review Response Comment

Always post a concise PR comment after pushing review fixes. Include:

- commit hash or link
- each finding addressed
- how it was fixed or why no code change was needed
- exact verification commands and results
- any remaining limitations or follow-ups

Example:

```bash
gh pr comment <number-or-url> --body "Addressed the review findings in <commit>. <summary>. Re-ran \`...\`; passed."
```

Keep the comment factual. Do not use filler or imply unrun verification.

### 9. Resolve Inline Review Threads

Resolve only threads that are genuinely addressed and pushed. Query unresolved threads again after pushing:

```bash
gh api graphql \
  -F owner='<owner>' \
  -F repo='<repo>' \
  -F number=<pr-number> \
  -f query='query($owner:String!,$repo:String!,$number:Int!){ repository(owner:$owner,name:$repo){ pullRequest(number:$number){ reviewThreads(first:100){ nodes { id isResolved path line comments(first:20){ nodes { url body author { login } } } } } } } }'
```

Resolve each addressed thread:

```bash
gh api graphql \
  -F threadId='<thread-id>' \
  -f query='mutation($threadId:ID!){ resolveReviewThread(input:{threadId:$threadId}) { thread { id isResolved } } }'
```

Do not resolve a thread if:

- the reviewer asked a question that still needs an answer
- the fix was not pushed
- verification failed
- you only partially addressed the issue
- the thread is informational and not yours to close without clear resolution

If the review was a top-level comment, not an inline thread, reply with the PR comment instead of trying to resolve a nonexistent thread.

### 10. Verify Thread And PR State

After posting and resolving:

```bash
gh pr view <number-or-url> --json reviewDecision,mergeable,statusCheckRollup,comments,reviews
```

For threads:

```bash
gh api graphql \
  -F owner='<owner>' \
  -F repo='<repo>' \
  -F number=<pr-number> \
  -f query='query($owner:String!,$repo:String!,$number:Int!){ repository(owner:$owner,name:$repo){ pullRequest(number:$number){ reviewThreads(first:100){ nodes { id isResolved path line } } } } }'
```

Report any unresolved threads and why they remain open.

## Output Format

When done, respond with:

```markdown
## Review Response Complete

- PR: <url>
- Commit(s): <hashes>
- Findings addressed:
  - ...
- Comments posted:
  - <url or summary>
- Threads resolved:
  - <thread/path/line or none>
- Verification:
  - `<command>` — passed/failed
- Remaining open items:
  - ...
```

If not done, respond with the blocker and the safest next step.
