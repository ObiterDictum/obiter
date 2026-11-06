# PR Rules

## Purpose

Use this file when writing a pull request, merge request, or equivalent change summary.

## Summary Standard

A PR summary must explain:

- what changed
- why it changed
- how it was implemented
- what was tested
- what risks or limitations remain
- what follow-up work is expected

## Required Structure

Open with one to three plain sentences saying what a reviewer will see change
and why, before any heading. A reviewer who reads only that should know whether
the PR matters to them. Then use this structure unless the change is trivial:

### What Changed

- concise explanation of the behavior or structure that changed

### Why

- the user, product, or engineering reason for the change

### Implementation Notes

- important design choices
- migrations, schema changes, API changes, or UI constraints

### Testing

- the tests added or changed, by name, and which failed before the fix
- pass counts for the suites run; list commands only when they differ from the
  usual package `bun run test`, typecheck, lint and format
- manual and browser flows exercised
- end-to-end: which specs ran and their result, or "not run" and why. A change
  that edits `apps/web/e2e` without running it says so here
- what was not tested

### Risks / Follow-Ups

- remaining risks
- deferred work
- rollout considerations if relevant

## Verification Evidence

Back verification claims with a provenance block:

```
checkout HEAD: <sha> (dirty|clean)
served: <path the web server resolved to>
revision freshness: <yes|no|NOT CHECKED (no expected-marker given)>
api checkout HEAD: <sha> (when development provenance is available)
api served: <path> (when development provenance is available)
api env file: <path> (when development provenance is available; a development
API that resolved no .env prints `null [FAIL]` and fails the check)
```

The `checkout HEAD` line comes from `scripts/verify-provenance.sh` run
against the servers you tested against — the served path is the evidence
that the page came from the checkout named. This exists because two
verification rounds measured code that did not contain the fix: dev servers
kept serving an older checkout, and a stale build made S11 on #148 look
broken. Name the path so a mismatch is visible instead of persuasive.

The path match proves the server was started from that checkout, not that it
is running that commit. For any browser-observed claim where an edit must be
proven live, run the script with `--expect <marker>` and include its revision
freshness line. An absent marker points to stale or cached transformed modules.
Without `--expect`, state that only the checkout path was proven. Servers
started before a checkout, pull, or commit change keep serving the old code;
restart the dev server after any checkout change, then run the script again.

The requested `/api/health` check must be reachable, return a 2xx response,
and identify this stack; unreachable APIs, HTTP errors, and non-stack responses
fail. Development responses include the API commit SHA, absolute checkout
root and resolved `.env` path, which the script reports and compares with the
tested checkout. A same-root stale SHA therefore fails too. Production and
older API servers omit those fields; a reachable stack response with absent
provenance remains an honest, non-failing `API provenance not determinable`
result.

State the limit plainly: a screenshot proves what the page rendered, not what
the system recorded. Claims about persisted state — audit rows, stored
documents, database effects — need a read of that state, not a screenshot.
C12 on #148 could not have been verified by screenshot; show the read you
made.

## Keeping the PR current

The description describes the PR as it will merge, not as it was opened.
When later commits change what the PR does, rewrite the affected sections, not
just append to them: drop "draft", "not ready", "stacked on #n" and superseded
numbers once they stop being true. Reviewers read the top, not the history.

Link issues with `Closes #n` only when the PR fully resolves the issue. A
partial fix or a stopgap uses `Refs #n` and says what remains, so the issue
stays open for the rest.

## Before / After

A change with a user-visible surface — a screen, a control, an editor
behaviour, a rendered document, a printed page — carries before/after media in
the PR body, not only a prose claim that it works. The test for "relevant" is
whether a reviewer could look at the result and disagree that it is better; an
API, schema, migration or internal refactor gets no media.

Publish the media on the `evidence` branch — assets only, never merged — and
paste the block the script prints:

```bash
scripts/pr-evidence.sh before-01-search.png after-01-search.png
```

Take the AFTER media from the final pushed commit and post them as a PR
comment once the last commit is in, so a reviewer sees the result without
scrolling a long body. Refresh them if a later commit changes the surface.

The script writes `<branch>/<file>` through the GitHub git-data API and prints
`## Before / After` with `raw.githubusercontent.com` image tags, which render
in a PR body. Use `.gif` when motion matters; GitHub does not inline `.mp4` and
the script links video instead. Capture from the lane the provenance block
names, so the media and the committed sha agree. Synthetic or disposable data
only: never a client matter, a real name, or a private document on screen.

## Writing Rules

- Write like an engineer handing work to another engineer.
- Be direct, specific, and concrete.
- Mention actual files, behaviors, and constraints.
- Explain tradeoffs where they matter.
- If something is incomplete, say so plainly.
- Do not use "phase" in PR titles, branch names, or PR summaries. Prefer concrete product or implementation names such as "workspace foundation", "API contracts", or "app shell sidebar".

## Do Not

- do not write hypey or promotional summaries
- do not add agent, tool, or automation prefixes such as `[codex]` to PR titles
- do not add tool or agent attribution to PR descriptions or comments: no
  "Generated with Claude Code" line, no agent session links, no "made by"
  footers
- do not name private repositories, or their PRs, branches, paths or plans
  (see RULES.md); describe server work as "the API"
- do not write generic "improved performance" claims without saying how
- do not write "this should" or "hopefully" when you mean unverified
- do not bury risk or missing tests
- do not write in an obviously AI-generated tone
- do not use filler such as "seamlessly", "robust", "comprehensive", or "enhanced" unless the surrounding sentence proves it

## Human Tone

The summary should feel like:

- concise
- technically grounded
- aware of tradeoffs
- honest about what was and was not verified

It should not feel like:

- marketing copy
- autogenerated release notes
- a changelog pasted without explanation
