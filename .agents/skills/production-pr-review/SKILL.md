---
name: production-pr-review
description: Production-grade pull request review for Obiter. Use whenever asked to review a PR, branch, diff, refactor, or change for correctness, security, architecture, data safety, tests, and release readiness. Builds repository context before reviewing and records durable architecture knowledge when a review knowledge repo is available.
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
5. Load the relevant durable System Map from the review knowledge repo and validate the touched portions against current code.
6. Build a written PR Coverage Map that overlays the diff onto the System Map before judging code.
7. Inspect changed files and all directly coupled files.
8. Review tests and run appropriate verification where possible.
9. Prepare inline review comments for every actionable bug/security issue that has a stable diff location.
10. Finalize the verdict, score, findings, inline targets, and verification evidence before any comment-drafting delegation.
11. Prepare a standalone overall review comment that explains the verdict, score, findings, impact, fix direction, verification, system coverage, and remaining risk clearly enough to understand without opening inline threads.
12. Prepare a final review summary that groups all findings by severity and category and includes a numeric review score.
13. Publish review comments to GitHub through the API when explicitly asked or when operating on a real PR with GitHub access.
14. Record durable internal workings, invariants, and recurring review knowledge in the review knowledge repo if safe to store.

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

For Obiter, prioritize:

- Skill-local references:
  - `references/scoring.md` for the numeric score rubric and caps
  - `references/system-map.md` for the durable mapping workflow
  - `references/coverage-map-template.md` for the per-review coverage map shape
  - `references/maps/` for agent-readable maps and human visual HTML maps
- The review knowledge repo (`ObiterDictum/review`), checked out alongside this
  repo as a sibling directory. Its per-product directory is still named `ormont/`
  from before the rename:
  - `../review/ormont/architecture/` for the durable System Map and
    package/data-boundary notes
  - `../review/ormont/review-playbooks/` for area-specific review heuristics
  - `../review/ormont/findings-patterns/` for recurring Obiter bug patterns
- `../obiter-ops/reference/obiter-defect-patterns.md` for the confirmed defect
  patterns carried in every review packet
- `docs/architecture.md` for package boundaries and system shape
- `docs/data-and-compliance.md` for privacy, audit, and legal data constraints
- `docs/roadmap.md` / active milestone docs for sequencing
- `docs/specs/README.md` and linked specs for changed product behavior

Load only what is needed, but do not review without enough architecture context to understand the blast radius.

## System Map

Load `references/system-map.md` and the relevant files under `references/maps/` before judging a PR. Use Markdown maps as the agent-readable source and HTML maps as human visual companions.

Validate every touched map entry against current code. Treat stale or missing map entries as review uncertainty until resolved. If the reviewer cannot explain a sensitive flow from entrypoint to persistence or external boundary, confidence cannot be high and the verdict cannot be `Approve`.

**If the knowledge repo is unavailable entirely, say so and act on it.** Reporting "the durable review knowledge repository was unavailable" and then returning `Approve` breaks the rule above; it happened on PR #65 and nothing downstream caught it. When the repo cannot be read:

- Say which paths you tried and that the check could not be performed.
- Judge whether the diff touches a sensitive flow. If it does, the verdict is capped below `Approve` and the reason is the missing context, not the code.
- If the diff touches no sensitive flow (a pure helper, a test, a config default with no data path), `Approve` is still available, but the report must record that the System Map check was skipped and why.

A missing precondition is a finding about the review, not a detail to mention in passing.

## PR Coverage Map

Create a written coverage map before detailed review using `references/coverage-map-template.md`. The map must list changed packages, loaded System Map entries, touched contracts, data classes, trust boundaries, isolation impacts, direct dependents, tests, docs, and unmapped uncertainty.

Use search to find direct dependents of changed exports, types, routes, schemas, database fields, permissions, queue payloads, storage keys, audit event names, and other cross-boundary contracts.

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

**When operating under the agent-orchestrator contract, map onto its three-level scale
and do not under-sell risk.** The orchestrator's report contract and metrics use
critical / important / suggestion; the mapping is Blocker+High -> critical, Medium
-> important, Low+Nit -> suggestion. M8 filed a live-document purge risk, a cursor
overflow that 500'd instead of 400'ing, and a check-then-act idempotency race all
as "suggestion"; each is at least important (High-class) under these anchors. When
a label undersells the risk, the label is wrong, not the risk: the rework loop and
the milestone metrics key off severity.

Every finding must include:

- file path and line or smallest relevant location
- severity and category: bug, security, privacy, data isolation, architecture, maintainability, test gap, docs, nit
- what is wrong
- why it matters
- concrete fix direction
- confidence level when useful

Do not include a finding unless it is actionable. Prefer no comment over a vague comment.

## Score Calibration

Apply `references/scoring.md`. The score communicates merge readiness and residual risk; it does not replace the verdict. Do not invent a score outside the rubric or ignore the caps.

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

## UI Review Checklist

For UI changes (staff screens, viewer screens, dialogs, tables), check these
explicitly, not just the code paths. M8's holistic review found four findings all
of this class: native `window.confirm` instead of the repo dialog component,
em-dashes in copy, and a confirmation sheet that stayed open after a successful
mutation. Verify:

- Destructive confirmations (purge, archive, delete, revoke) use the repo's
  dialog component (shadcn `AlertDialog`/`FocusSheet` pattern), never native
  `window.confirm`; the confirm button is the only submit path.
- The mutation's `onSuccess` closes the dialog and invalidates the exact TanStack
  query keys the screen reads; a stuck-open dialog or stale list after success is
  a finding.
- No em-dashes (U+2014) in prose or UI copy; plain hyphens only.
- Nav entries and actions are role-gated against the server's capability set
  (the UI hiding is presentation, but it must not _promise_ a capability the
  server denies, and must not show a control the role cannot use).
- No `dangerouslySetInnerHTML` for untrusted text; metadata rendered as text,
  never HTML.
- Empty, error, loading and 401/403 states are handled, not just the happy path.
- Keyboard flow: focus, Escape/backdrop close, disabled-while-pending.

For destructive flows, the server gate is the enforcement and the UI must match
it: if the server requires a capability the UI would not show, or the UI shows an
action the server denies, that is a P9-style mismatch and a finding.

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

## Post-Review Comment Drafting Subagents

Use the primary reviewer model for the actual review: code inspection, security analysis, correctness judgment, severity assignment, verdict, score, and verification decisions. Do not delegate finding discovery, score selection, or approval/request-changes judgment to a cheaper subagent.

After the review is complete and the findings are locked, any delegated comment-drafting subagent must be spawned with `model: "opencode-go/deepseek-v4-flash"`. Do not inherit the primary review model for this post-review prose work unless the user explicitly overrides this policy. Use the mini-model subagent only for drafting or polishing:

- GitHub inline comment bodies for already validated findings.
- The overall review body using the locked verdict and `N/100` score.
- A concise local final summary for the user.

Give the subagent only the minimum sanitized review packet:

- verdict, score, merge readiness, and confidence
- validated findings with severity/category, exact `path:line`, problem, impact, fix direction, and verification
- exact commands and pass/fail verification evidence
- API publication constraints, including direct GitHub API inline comments and the selected review event
- any explicit wording constraints from the user

Do not provide secrets, private matter data, raw legal text, raw prompts, embeddings, sensitive logs, private screenshots, or unrelated repository context. The subagent must not inspect more code unless explicitly asked by the primary reviewer for prose context.

Require the subagent to return only draft text, not publication commands. The primary reviewer must validate every inline body and the overall body before posting: confirm that no severity changed, no new unverified claim was introduced, no finding was softened or exaggerated, the score stayed unchanged, and every inline target still maps to the PR diff. If the draft fails any check, edit it directly or rerun the subagent with a tighter sanitized packet.

Example subagent prompt:

```text
Use `model: "opencode-go/deepseek-v4-flash"` for comment drafting only. Do not perform a new PR review and do not change the verdict, score, severity, finding set, file targets, or verification claims.

Draft GitHub-ready inline comment bodies and one overall review body from this locked review packet:
[verdict, score, findings, path:line targets, verification results, publication constraints]

Return only:
1. Inline comment drafts keyed by path:line.
2. Overall review body.
```

## Overall Review Comment

Before publishing any GitHub review, write the top-level review body first. The body must stand alone: a maintainer should be able to understand why the review was approved, blocked, or commented without expanding inline comments.

The overall comment must include:

- a `Review Verdict` section that is not just a label and score. It must include:
  - `Decision`: approve, request changes, not ready, or needs more context
  - `Score`: `N/100`
  - `Merge readiness`: whether this can merge now, and if not, the exact condition blocking merge
  - `Why`: two to five concrete sentences naming the highest-impact issue(s), affected area(s), and production risk
  - `What would change the verdict`: the smallest set of fixes or evidence needed for approval
  - `Confidence`: high/medium/low, with a short reason when confidence is not high
- a `Must Fix` section for blockers/high findings, or `None` when there are no must-fix issues
- a `Findings` section for all remaining medium/low/nit findings, grouped by severity, or `None` when every finding is already covered in `Must Fix`; each finding has:
  - title and changed file path/line
  - problem: what is wrong
  - impact: what can break, leak, regress, or become hard to unwind
  - fix direction: the concrete correction expected
  - verification: the test, check, or manual proof that would demonstrate the fix
- a `Security / Data / Isolation` section that explicitly states the reviewed trust boundaries and any residual uncertainty
- a `System / Coverage Map` section that names the System Map entries loaded, internal flows traced, direct dependents inspected, and unmapped uncertainty
- a `Verification` section with exact commands and pass/fail results
- a `Gaps / Follow-Ups` section for unrun checks, manual QA gaps, or non-blocking cleanup

Do not make the verdict generic, diplomatic, or a teaser such as "there are two bugs below." The verdict must name the blocking bugs or the decisive reason for approval. Avoid empty phrases such as "directionally sound", "looks good overall", "solid foundation", or "needs a few fixes" unless the following sentence names the concrete risk. Do not rely on inline comments as the only explanation; GitHub UIs often collapse or reorder them.

For a full request-changes body example, see `references/review-comment-example.md`.

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
4. Draft the overall review comment using the `Overall Review Comment` rules. It must explain the findings directly and include enough detail to be useful if inline comments are not visible.
5. Publish inline comments for actionable findings with valid diff positions through the GitHub API, not high-level `gh pr review` output.
6. Submit the overall review comment as the GitHub review `body` with the verdict, numeric score, and full severity-grouped list.
7. Confirm publication by listing PR review comments or the posted review.

### GitHub API publication rules

When asked to post inline comments or when operating on a real PR with GitHub access, use the GitHub Pull Request Reviews API so inline comments and the final summary are submitted together. Do not rely on `gh pr review` for publication; use `gh api repos/<owner>/<repo>/pulls/<number>/reviews` or the GitHub app review endpoint directly.

Prepare a UTF-8 JSON payload with ASCII-safe punctuation to avoid mojibake on Windows terminals:

```json
{
  "event": "REQUEST_CHANGES",
  "body": "## Review Verdict\n\nDecision: Request changes\n\nScore: 62/100\n\nMerge readiness: Not mergeable until [specific condition].\n\nWhy: [Name the concrete blocking issue, affected area, and production/user/security risk in two to five sentences.]\n\nWhat would change the verdict: [Smallest fix/evidence set needed for approval.]\n\nConfidence: High/Medium/Low. [Reason if not high.]\n\n## Must Fix\n\n- **High/security - Title** (`path:line`)\n  - Problem: ...\n  - Impact: ...\n  - Fix direction: ...\n  - Verification: ...\n\n## Findings\n\n- **Medium/architecture - Title** (`path:line`)\n  - Problem: ...\n  - Impact: ...\n  - Fix direction: ...\n  - Verification: ...\n\n## Security / Data / Isolation\n\n...\n\n## Verification\n\n...\n\n## Gaps / Follow-Ups\n\n...",
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
- `COMMENT` when findings are informational, when more context is needed, or when the authenticated GitHub identity is the PR author.

If the authenticated GitHub identity is the PR author, use `event: "COMMENT"` directly as the default publication event. Keep the evidence-based `Decision` text as `Request changes`, `Approve`, `Not ready`, or `Needs more context` according to the review outcome.

Do not mention GitHub author-permission limitations, fallback mechanics, or "local verdict" caveats in the GitHub review body, inline comments, or local final summary. This is known operational behavior and should stay out of PR reviews. Do not drop inline comments or shorten the overall body when using `COMMENT`; submit the same findings, score, and standalone explanation under the comment review event.

If the tooling makes inline publication unsafe or ambiguous, output an `Inline comments to add` section with exact `path:line` targets and bodies, then state that comments were not posted and why.

## Final PR Review Summary

The final summary must include all important findings discovered during review, including findings already posted inline. Group by severity and category so the author can fix them systematically.

Required summary sections:

- Verdict: approve, request changes, not ready, or needs more context
- Score: `N/100` with a short rationale. Use the score to communicate readiness; it does not replace the verdict.
- System map validated: durable map entries loaded, touched internal flows traced, and stale/missing map areas
- PR coverage map: changed packages, contracts, data classes, trust boundaries, direct dependents, tests, and docs
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

The canonical local review knowledge repo for Obiter is:

- `C:/Users/karl-/Documents/source/OrmontLex/review`

Use that path for durable review knowledge. Do not create parallel knowledge bases under `../review`, `../obiter-review`, or inside the product repo unless explicitly instructed.

Skill-local maps and rubric references live under `references/`. Keep reusable review process there. Keep validated Obiter project facts, internal flows, invariants, and recurring findings in the review repo, using skill-local maps as the operating structure.

Record durable context, not transient PR notes.

Suggested structure:

```text
review/
  obiter/
    architecture/
      system-map.md
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
- internal workings from entrypoint to persistence, search, queue, audit, external provider, or UI state
- important domain invariants
- data classification and trust-boundary rules
- tenant, organisation, and matter isolation rules
- source-of-truth versus derived-state boundaries
- direct dependents of important contracts, routes, schemas, audit events, queue payloads, and storage keys
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

## System / Coverage Map

- System map entries loaded:
- Internal flows traced:
- Direct dependents inspected:
- Stale/missing map areas:

## Findings

- **Severity/category - title** (`path:line`)
  - Problem:
  - Why it matters:
  - Fix:
  - Inline comment: posted / draft only / summary only

## Inline Comments

- `path:line` - exact comment body, or `None posted` with reason

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
