---
name: production-pr-review
description: Production-grade pull request review for Ormont. Use whenever asked to review a PR, branch, diff, refactor, or change for correctness, security, architecture, data safety, tests, and release readiness. Builds repository context before reviewing and records durable architecture knowledge when a review knowledge repo is available.
---

# Production PR Review

## Mission

Review as a staff+ engineer protecting production correctness, user trust, legal-data safety, data isolation, privacy, and long-term architecture. The goal is to find important bugs and logic issues, not to approve style preferences.

Do not rubber-stamp. Do not say a PR is ready unless the evidence supports it. Security, data protection, tenant isolation, auditability, and legal-data correctness are first-order review criteria, not optional hardening.

## Review Order

1. Establish repository and branch state.
2. Identify the PR's trust boundaries, data classes, and tenant/organisation isolation impact.
3. Load the minimum authoritative context for the touched area.
4. Build a change map from the base branch to the review branch.
5. Build or update a mental architecture map before judging code.
6. Inspect changed files and all directly coupled files.
7. Review tests and run appropriate verification where possible.
8. Prepare inline review comments for every actionable bug/security issue that has a stable diff location.
9. Prepare a final review summary that groups all findings by severity and category and includes a numeric review score.
10. Publish review comments to GitHub through the API when explicitly asked or when operating on a real PR with GitHub access.
11. Record durable knowledge in the review knowledge repo if configured and safe to store.

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

If the PR targets another base, replace `origin/main` with the actual base. For actual GitHub PRs, inspect PR metadata first and use `baseRefName`; do not assume `main`.

If GitHub CLI is available and a PR exists:

```bash
gh pr view <number-or-url> --json number,title,baseRefName,headRefName,url,body,reviewDecision,mergeable,statusCheckRollup,headRefOid
git fetch origin <baseRefName>
git fetch origin pull/<number>/head:pr-<number> --update-head-ok
git checkout pr-<number>
git merge-base HEAD origin/<baseRefName>
git diff --stat origin/<baseRefName>...HEAD
git diff --name-status origin/<baseRefName>...HEAD
```

When a PR number is supplied, prefer reviewing the local PR ref (`pr-<number>`) against `origin/<baseRefName>` so the diff, line numbers, and verification match GitHub.

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
- data classification changes: public legal corpus, private matter data, auth/session data, audit metadata, generated artifacts, telemetry/logs
- trust boundary changes: browser, Electron renderer, preload/main, API, workers, database, object storage, external AI/model providers, search/vector indexes, queues, email/auth providers
- auth, permissions, tenant isolation, audit, storage, sync, legal verification, or redaction impact
- UI behavior and accessibility impact
- tests added/changed/missing
- docs updated/missing

Use search to find direct dependents of changed exports, types, routes, schemas, database fields, permissions, queue payloads, storage keys, and audit event names.

## Review Mindset

Look specifically for:

- incorrect domain modeling or flattened legal concepts
- schema drift between contracts, services, docs, database, migrations, queues, storage, and UI
- missing boundary validation for untrusted input and deserialized data
- client-side authorization masquerading as security
- cross-organisation or cross-matter reads/writes caused by missing scoped queries, weak joins, cache-key collisions, shared object keys, or broad search filters
- data loss, silent overwrite, or weak conflict handling
- missing audit trail for sensitive actions
- raw sensitive data in logs, object keys, fixtures, tests, analytics, exceptions, traces, prompts, model calls, embeddings, queues, or telemetry
- hidden hosted processing of sensitive matter data, including indirect disclosure through summaries, embeddings, redaction spans, prompts, screenshots, or generated artifacts
- object storage, database, queue, cache, and search-index paths that fail to include organisation/matter boundaries where required
- non-idempotent background jobs or unsafe retry behavior
- race conditions around versions, sync, artifacts, audit logs, permissions, or jobs
- swallowed errors, broad catches, silent fallbacks, or optimistic names
- duplicated state machines across packages
- React lifecycle misuse, especially `useEffect` for derived state or data fetching
- desktop renderer access to privileged APIs, secrets, local files, or unrestricted IPC channels
- dependency/supply-chain changes without a concrete need, lockfile review, or safe transitive footprint
- accessibility regressions in focus, keyboard flow, labels, contrast, or hover-only state
- tests that assert implementation trivia instead of behavior
- missing failure-path, permission-boundary, tenant-isolation, and data-leakage tests in safety-critical flows

## Severity

Use this scale:

- **Blocker**: data loss, security/privacy breach, tenant isolation break, secret exposure, legal-critical incorrectness, broken build, impossible migration, or architecture violation that will be expensive to unwind.
- **High**: likely production bug, permission flaw, schema drift, race, bad state transition, missing validation, unsafe dependency, or missing test for high-risk behavior.
- **Medium**: maintainability or correctness risk that should be fixed before merge unless explicitly accepted.
- **Low**: minor issue, naming clarity, localized cleanup.
- **Nit**: optional style preference. Avoid nits unless they prevent misunderstanding.

Every finding must include:

- file path and line or smallest relevant location
- severity and category: bug, security, privacy, data isolation, architecture, maintainability, test gap, docs, nit
- what is wrong
- why it matters
- concrete fix direction
- confidence level when useful

Do not include a finding unless it is actionable. Prefer no comment over a vague comment.

## Verification

Run the narrowest useful checks first, then broader checks if warranted:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Use package-specific scripts when available. For UI work, perform or request a manual pass for the changed flow. For legal-critical behavior, require happy path and failure path verification.

For security, privacy, or isolation-sensitive changes, require targeted evidence for:

- organisation/matter scoping on reads and writes
- negative permission tests where applicable
- validation failures at API/worker/storage boundaries
- audit events without sensitive payload leakage
- logs/errors/telemetry redaction
- local-vs-hosted data path clarity
- retry/idempotency behavior for jobs and mutations

If checks cannot be run, state exactly why and do not imply they passed.

## Vulnerability Review

Treat every PR as a potential attack-surface change. Look for code-level vulnerabilities, not only product-level privacy issues.

Check for:

- broken access control: IDOR, missing organisation/matter filters, confused-deputy flows, privilege escalation, insecure direct object references
- authentication/session flaws: weak token handling, session fixation, missing expiry, CSRF exposure, insecure cookies, magic-link leakage
- injection risks: SQL/NoSQL/search-query injection, command injection, path traversal, template injection, prompt injection where model/tool output can influence actions
- unsafe file handling: unrestricted upload types, unsafe archive extraction, symlink traversal, filename trust, MIME spoofing, executable content, PDF/script hazards
- XSS and UI injection: unsafe HTML rendering, markdown sanitisation gaps, URL/script injection, unsafe iframe or opener behavior
- SSRF and network egress: user-controlled URLs reaching internal services, metadata endpoints, storage APIs, webhooks, or model/tool fetchers
- secrets exposure: env vars in client bundles, logs, errors, build output, source maps, CI output, screenshots, or telemetry
- cryptography mistakes: custom crypto, weak randomness, wrong key scope, nonce reuse, plaintext local storage of sensitive material, missing key rotation path
- dependency and supply-chain risk: new packages, install scripts, transitive risk, compromised actions, overbroad CI permissions, unpinned external actions
- unsafe deserialization/parsing: JSON/schema bypasses, YAML/entity expansion, XML XXE, zip bombs, malformed PDFs/docs, large payload DoS
- denial of service: unbounded loops, unbounded query result sets, regex backtracking, large uploads, missing rate limits, expensive sync work in request paths
- insecure Electron/native boundaries: Node integration, context isolation disabled, broad IPC, unsanitised preload bridges, filesystem access from renderer
- insecure caching: private responses cached globally, cache-key collisions, stale permission state, browser storage of sensitive matter data
- audit/log tampering: user-controlled audit fields, missing immutable event attributes, overwritable logs, sensitive audit payloads

For every security-sensitive finding, identify the attacker capability required and the data or privilege at risk.

## Security And Data Protection Gate

Before giving a positive verdict, explicitly ask:

1. Can this change expose one organisation's data to another organisation?
2. Can this change expose one matter's data in another matter, cache entry, search result, artifact, or audit view?
3. Can private matter data, filenames, legal text, secrets, tokens, embeddings, or prompts leave the intended local/hosted boundary?
4. Can logs, exceptions, analytics, traces, queue payloads, object keys, generated fixtures, screenshots, or test snapshots persist sensitive data?
5. Can a user perform the action by bypassing the UI and calling the API, worker, IPC bridge, or storage layer directly?
6. Can retry, concurrent execution, offline sync, or conflict resolution duplicate, lose, or silently overwrite data?
7. Is external AI/model processing visible in product state and audit logs when it touches matter data?
8. Are new dependencies, scripts, or GitHub Actions allowed the minimum access needed?
9. Did the review consider common vulnerability classes relevant to the changed code path?
10. Is there a realistic abuse case where malformed input, a malicious user, a compromised dependency, or a hostile document can cross a trust boundary?

If any answer is uncertain for sensitive code, the verdict cannot be `Approve`.

## GitHub Inline Review Comments

When reviewing an actual GitHub PR, produce inline comments for findings that map to changed lines. Inline comments should be thorough enough for the author to fix without guessing, but still focused on one issue.

Inline comment rules:

- Comment on the smallest changed line that demonstrates the issue.
- One issue per inline comment.
- Include severity/category at the start, for example: `High/security:` or `Medium/architecture:`.
- Explain the bug or risk, not just the preferred style.
- Include the impact, concrete fix direction, and the verification that would prove the fix when the issue is non-trivial.
- Do not post nit comments unless the nit prevents misunderstanding or future defects.
- Do not post comments containing secrets, private matter data, raw legal text, raw prompts, embeddings, sensitive stack traces, or screenshots.
- If a finding affects unchanged coupled code, mention it in the final summary and only inline-comment if there is a changed line that introduced or exposes the issue.

Before publishing, verify each inline comment is on a line present in the PR diff. If unsure, keep it in the summary instead of forcing an inline comment.

Preferred GitHub review workflow:

1. Inspect PR metadata and diff:
   ```bash
   gh pr view <number-or-url> --json number,title,baseRefName,headRefName,url,body,headRefOid
   gh pr diff <number-or-url> --name-only
   gh pr diff <number-or-url>
   ```
2. Draft all findings locally first.
3. Validate every inline target is in the PR diff. Use changed-line line numbers from `nl -ba <file>` plus the PR diff. If unsure, keep the issue in the summary only.
4. Publish inline comments for actionable findings with valid diff positions through the GitHub API, not high-level `gh pr review` output.
5. Submit one final review summary with the verdict, numeric score, and full severity-grouped list.
6. Confirm publication by listing PR review comments or the posted review.

### GitHub API publication rules

When asked to post inline comments or when operating on a real PR with GitHub access, use the GitHub Pull Request Reviews API so inline comments and the final summary are submitted together. Do not rely on `gh pr review` for publication; use `gh api repos/<owner>/<repo>/pulls/<number>/reviews` or the GitHub app review endpoint directly.

Prepare a UTF-8 JSON payload with ASCII-safe punctuation to avoid mojibake on Windows terminals:

```json
{
  "event": "REQUEST_CHANGES",
  "body": "## Review Verdict\n\nRequest changes\n\nScore: 62/100\n\n...",
  "comments": [
    {
      "path": "services/api/src/database.ts",
      "line": 123,
      "side": "RIGHT",
      "body": "High/security: ..."
    }
  ]
}
```

Then publish and verify:

```bash
gh api repos/<owner>/<repo>/pulls/<number>/reviews --method POST --input review-payload.json
gh api repos/<owner>/<repo>/pulls/<number>/comments --jq '.[] | {path,line,body}'
rm -f review-payload.json
```

Use `event` according to the evidence:

- `APPROVE` only when the security/data gate and verification support approval.
- `REQUEST_CHANGES` when blockers/high findings or must-fix issues exist.
- `COMMENT` when findings are informational, when more context is needed, or when GitHub rejects a formal review decision.

If GitHub rejects `REQUEST_CHANGES` or `APPROVE` because the authenticated identity is the PR author, retry with `event: "COMMENT"`, keep all inline comments, and state in the final summary that GitHub would not allow a formal decision from this identity. The local verdict should still be `Request changes` or `Approve` as appropriate.

Do not drop inline comments when the formal review event is blocked by author permissions. The fallback is an API-submitted `COMMENT` review with the same inline comments, the local verdict, and the score in the review body.

If the tooling makes inline publication unsafe or ambiguous, output an `Inline comments to add` section with exact `path:line` targets and bodies, then state that comments were not posted and why.

## Final PR Review Summary

The final summary must include all important findings discovered during review, including findings already posted inline. Group by severity and category so the author can fix them systematically.

Required summary sections:

- Verdict: approve, request changes, not ready, or needs more context
- Score: `N/100` with a short rationale. Use the score to communicate readiness; it does not replace the verdict.
- Scope reviewed: files/areas and coupled code inspected
- Blockers
- High findings
- Medium findings
- Low/nits, only when useful
- Security/data/isolation assessment
- Verification commands and results
- Test gaps and manual QA gaps
- Architecture/maintainability notes
- Knowledge repo updates made or needed

If requesting changes, make clear which issues must be fixed before approval.

## Knowledge Graph / Review Repo

The canonical local review knowledge repo for OrmontLex is:

- `C:/Users/karl-/Documents/source/OrmontLex/review`

Use that path for durable review knowledge. Do not create parallel knowledge bases under `../review`, `../ormont-review`, or inside the product repo unless explicitly instructed.

Record durable context, not transient PR notes.

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
- data classification and trust-boundary rules
- tenant, organisation, and matter isolation rules
- recurring bug patterns
- review heuristics that caught real issues
- ADR-like decisions that affect future reviews

Do not record secrets, private matter data, tokens, customer data, raw legal document content, raw prompts, embeddings, full stack traces with sensitive values, screenshots of private material, or object keys containing sensitive names.

Prefer abstract patterns over copied code or copied data. If a note needs an example, use synthetic names and minimal invented snippets.

If the review repo does not exist, mention that durable review memory is unavailable and propose creating/syncing it.

## Output Format

Use this structure:

```markdown
## Review Verdict

[Approve / Request changes / Not ready / Needs more context]

## Findings

- **Severity/category — title** (`path:line`)
  - Problem:
  - Why it matters:
  - Fix:
  - Inline comment: posted / draft only / summary only

## Inline Comments

- `path:line` — exact comment body, or `None posted` with reason

## Verification

- Commands run:
- Results:
- Not run / gaps:

## Architecture / Knowledge Notes

- Durable context learned or updated:
- Data/security/isolation implications:
- Follow-up knowledge repo updates needed:
```

If there are no findings, say what was inspected and what verification supports that conclusion, including the security/data/isolation checks considered.
