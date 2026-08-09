---
name: obiter-code-quality
description: Obiter code authoring and self-review. Use before and after writing Obiter code (services/api, apps/web, apps/desktop, packages/*, SQL migrations, scripts) to produce clean, minimal, correct code that conforms to RULES.md. Covers stack practice for TanStack Start, Hono, Zod contracts, Postgres and Electron, the repository's conventions, and a mandatory self-review pass before a change is done.
---

# Obiter Code Quality

## Mission

Write Obiter code that is correct, clean, and as small as it can honestly be. Then
self-review it against the rules before calling it done.

Two things make the bar here higher than usual. Obiter handles client matter data,
so a privacy or isolation defect is a professional-negligence event, not a bug. And
the owner does not read the agent-written code: the review is the only reading it
gets before it ships. Assume nobody will catch what you leave behind.

`RULES.md` is the arbiter. When this skill and `RULES.md` disagree, `RULES.md` wins.
This skill does not restate it (its own Documentation Rules forbid duplicating
guidance); it covers **how** to satisfy it in this stack, and **how to check** you
have.

## Read first

- `AGENTS.md`, the linker: it names the docs a given task needs
- `RULES.md`, mandatory implementation rules
- `TESTING.md` when deciding what to verify, `PR.md` when writing the PR
- `docs/roadmap.md` for build order: Phase 0, Search, Redact, Verify, Verify
  Advanced, Research. Build only what the active milestone needs.
- `docs/data-and-compliance.md` for anything touching matter data
- The specific spec sections named in your task script, not `docs/specs/` wholesale

## Stack practice

`RULES.md` states the rules. This is how they land in the frameworks we use.

### TanStack Start, Router and Query

The `useEffect` ban in `RULES.md` is not stylistic; the framework has a better answer
for every case people reach for it.

- **Fetch in route loaders, not components.** Loaders run before the component
  renders, and can run before the component's bundle has even been evaluated.
- **Bridge Router and Query with `queryClient.ensureQueryData()`** in the loader, not
  `prefetchQuery`. It respects the cache, awaits when the data is missing, and
  returns the data.
- **Let one library own caching.** With Query in play, turn the Router's own caching
  off rather than having two caches disagree. `defaultPreloadStaleTime` is the knob
  that still matters.
- **Use Suspense and error boundaries at the route**, so components can be written
  for the happy path instead of hand-rolling loading and error branches.
- Derived values instead of state-plus-effect. Route state in the Router, server
  state in Query, local state only for genuine UI ephemera.
- `useEffect` remains legitimate for external synchronisation only: browser APIs,
  subscriptions, timers, Electron bridges, cleanup. Document the boundary in a
  comment when you use one.
- Debounced search uses refs and timers, not `useEffect`. This is an existing repo
  convention.

### Hono

- **Validate at the boundary with the shared Zod schemas** from
  `packages/contracts`, via `@hono/zod-validator`. Never redefine a request shape
  locally.
- **Do not ship the default validator error.** `zValidator` returns a 400 carrying
  the whole `ZodError`, which leaks internal shape and reads badly to clients. Give
  it an error handler that maps to the repo's documented error shape.
- **Route files stay thin.** They parse, authorise, call a domain function, and
  serialise. Business logic lives in a module that can be tested without booting the
  app: `redaction-detection.ts` and `document-extraction.ts` are the pattern,
  `routes/*.ts` is the seam.
- Middleware carries the cross-cutting concerns (auth, request context, logging,
  error mapping) rather than each handler repeating them.
- Authorisation is server-side, in the handler or middleware, before any lookup.
  `authz.ts` is the home for those decisions. UI hiding is not authorisation.

### Contracts and Zod

- One shape, one place: `packages/contracts`. Enums are Zod enums with an inferred
  type next to them (`matterStatusSchema` plus `MatterStatus`), which is the existing
  convention. Follow it rather than inventing a parallel style.
- Additive changes only, unless the task is explicitly a contract migration: adding
  an optional member is safe, changing an existing member's shape breaks every
  consumer including `apps/desktop`.
- Discriminated unions for state machines (document status, sync state, job state,
  findings). Handle every branch. An unhandled legal-critical state fails loudly, it
  does not fall through to a default.

### Postgres and migrations

- Migrations are additive and idempotent (`if not exists`), numbered in sequence,
  and never edited after they have been applied anywhere.
- Multi-record correctness is transactional: immutable document versions, sync
  conflict handling and audit logs all qualify.
- Guard against check-then-act. Reading a row, deciding, then writing is a race under
  concurrency. Use a single conditional statement, or `SELECT ... FOR UPDATE`, or a
  unique constraint that makes the second write fail.
- Object keys must not contain client names, matter names, original filenames or raw
  legal text.
- Soft delete by default; hard delete only where a documented requirement demands it.

### Electron

- The renderer never touches Node, the filesystem, secrets or privileged APIs.
  Everything crosses an explicit preload or main-process bridge, and the bridge
  surface is as narrow as the feature needs.
- Offline behaviour is real scope. A feature that silently degrades when offline is
  incomplete, not "web-first".

### Background work

Jobs are idempotent by stable id and safe to retry. A job that is safe to run once
and corrupting to run twice is a defect, because it will run twice.

### Tailwind and UI

- Shared UI once, in `packages/ui` (presentation only, no auth, storage, network or
  verification knowledge) and `packages/app-shell` for product screens. `apps/web`
  and `apps/desktop` stay thin.
- Use the existing design tokens and component primitives rather than ad hoc
  utility stacks. A native `window.confirm` where the repo has a dialog component is
  a defect, not a shortcut.
- Loading states say what is happening. Large evidence sets virtualise rather than
  rendering everything. Keyboard flow, focus behaviour and contrast are requirements.
- Never hide important legal state behind hover-only or animation-only interaction.

## Self-review workflow

Run this before reporting done. It is not optional and it is not a summary of what
you did.

**1. Diff pass.** Read your own diff top to bottom as a reviewer would. Anything you
cannot justify out loud comes out.

**2. Minimality pass.** Is this the smallest change that delivers the script's scope?
Delete speculative abstractions, unused exports, placeholder routes, commented-out
code and any "might need later" parameter. Did you add a dependency? Justify it
twice or remove it.

**3. Duplication pass.** Search before you accept your own new helper. Does this
shape already exist in `packages/contracts`? Does this utility already exist
elsewhere in the tree? Is this a third way of doing something the repo already does
two ways (error shapes, validation, pagination, auth checks)? Cite what you found.

**4. Correctness pass.** Walk the failure paths, not the happy path: invalid input,
absent rows, concurrent writers, retries, partial failure. For anything touching
matter data, walk the isolation path explicitly: can this return another
organisation's or another matter's data under any input?

**5. Test pass.** For each test you added, ask: would this fail if the
implementation were wrong? If it asserts on a mocked value, it is tautological and
proves nothing. Mock external boundaries only (network, object storage, email,
clocks, filesystem), never the behaviour under test. Bug fixes carry a test that
would have caught the bug.

**6. Gates.** Run them and keep the output:

```bash
pnpm typecheck && pnpm test && pnpm format:check && pnpm lint
```

**7. Registry pass.** Check your change against
`obiter-ops/reference/obiter-defect-patterns.md` and state which patterns applied
and how you avoided them.

**8. Done.** Report what you built, the gates with their commands and output, and
what you did not test and why. "Tests pass" without the command is not evidence.

## Anti-slop checklist

How agent-written code fails in this repo specifically. Every item is a real failure
mode, not a hypothetical.

- [ ] No `any`, unsafe cast, or non-null assertion added to get past the typechecker
- [ ] No swallowed error. Catch only to add context, convert to a documented shape,
      or clean up
- [ ] No broad `try/catch` wrapped around a legal-critical flow that lets execution
      continue in an uncertain state
- [ ] No silent fallback that hides uncertainty or data loss
- [ ] No optimistic name for incomplete behaviour: `ready` means ready
- [ ] No production mock, fake data path, demo behaviour, or auth bypass outside a
      clearly named test or demo module
- [ ] No development auto-login, synthetic session or default credential. Auth is a
      real server-side session and `GET /api/me`
- [ ] No decorative comments and no comments restating the code
- [ ] No file pushed past 500 lines without a documented reason; target 300
- [ ] No raw document content, auth secret, magic-link token, private key or full
      sensitive span in a log line
- [ ] No real client document in a fixture, demo or test
- [ ] No schema drift left between docs, contracts, migrations and handlers
- [ ] No duplicated state machine across web, desktop, API and workers
- [ ] No `useEffect` for data fetching or derived state
- [ ] No em-dashes, and British English in prose
- [ ] The `scripts/synthetic-v2/` pricing and provider fixtures are data. Do not
      "update" model ids in them

## Recurring defect patterns

The prevention checklist lives in `obiter-ops/reference/obiter-defect-patterns.md`
and is carried in every implementer and reviewer packet. A finding that matches a
known pattern is a recurrence: it means a prevention failed, and that is
investigated before the run closes rather than the pattern simply being re-added.
