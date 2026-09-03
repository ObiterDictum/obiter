# Obiter Rules

Mandatory unless a documented architectural decision explicitly overrides them.

Only load [PR.md](PR.md) when writing a PR summary. Only load [TESTING.md](TESTING.md) when deciding verification.

## Product

- Desktop is the primary workspace; web mirrors the same product model and shared code.
- Security is a first-order requirement, not a later pass. Offline desktop is real scope.
- Legal work uses immutable versions, never silent overwrites. Verify is conservative: surface uncertainty.
- Never silently learn from client matter data.

## React

- TanStack Start + Router + Query. Server state in Query, route state in Router, local UI state only where needed.
- No `useEffect` for data fetching, derived state, or prop-to-state sync. Allowed only for unavoidable external sync (browser APIs, subscriptions, timers, Electron bridges, cleanup) with the reason documented.
- Prefer derived values, route loaders, query hooks, event handlers over lifecycle code. Skip `useMemo`/`useCallback` without a profiling or referential-contract reason.

## Code

- Explicit, typed, traceable TypeScript (Python only where justified, e.g. redaction workers). No `any`, unsafe casts, or non-null assertions without a documented reason next to the code.
- Share contracts via `packages/contracts`; never duplicate shapes. Small composable modules over framework-heavy abstractions.
- Side effects live at boundaries (API handlers, workers, bridges, storage adapters). Pure domain logic stays testable without booting the app. Validate untrusted input at the boundary with shared schemas.
- Discriminated unions for state machines and statuses; exhaustively handle branches. Unknown legal-critical states fail loudly — no silent fallbacks, no swallowed errors, no broad `try/catch` that continues in an uncertain state.
- Names describe real behavior. No hidden magic, implicit globals, metaprogramming, or production mocks/fake data outside clearly named demo or test modules.
- Authentication must always use a real server-side session and `GET /api/me`. No development auto-login, synthetic sessions, default credentials, or client-side auth bypasses. Fixtures must not provide runtime auth context; test fixtures may remain clearly isolated.
- Comments explain intent or constraints only, never restate code.

## Architecture

- Follow roadmap milestone order. Build only the foundation the active milestone needs.
- `apps/web` and `apps/desktop` stay thin; shared screens live in `packages/app-shell`. `packages/ui` is presentation-only (no auth, storage, verification, network).
- Domain functions sit behind API handlers, not inside route files. Renderer code never touches Node, filesystem, or secrets directly — use preload/main bridges.
- Jobs are idempotent by stable ids and safe to retry. New dependencies need a concrete reason; no second framework for a solved concern without a documented decision.

## File sizes

- Source: target under 300 lines, hard ceiling 500 unless documented. Split before hard to scan.
- Docs: target under 200 lines, ceiling 400 unless top-level and unsplittable. Split by module, milestone, or concern.

## UI

- Build shared UI once, reuse across web and desktop. Clarity and evidence visibility over flash.
- Loading states explain what is happening. Large result sets render incrementally. Keyboard flow, focus behavior, and contrast are required. Never hide legal state behind hover-only or animation-only interaction.

## Data and security

- Client matter data is sensitive by default. EU hosting, encrypted transport, server-side access checks (UI hiding is not authorization). Never leak across organisations.
- No raw document contents, secrets, tokens, or private keys in logs. Object keys contain no client/matter names, filenames, or legal text.
- Soft delete by default. Multi-record writes for immutable versions, sync conflicts, and audit logs are transactional. Auth, matter, document, and artifact access are auditable.
- Hosted vs local-desktop redaction stays visibly distinct. External AI/model calls touching matter data appear in product state and audit logs. No real client documents in fixtures, demos, or tests without explicit approval.

## Docs

- Update docs when scope, sequencing, architecture, or behavior changes materially. Spec deviations get fixed or explicitly marked.
- One canonical location per rule; do not duplicate guidance across files. `AGENTS.md` stays a linker, not a rule body.

## PRs and tests

- PR summaries: what changed, why, implementation notes, exact tests run, risks and follow-ups. Engineer-to-engineer tone, no filler. Details in [PR.md](PR.md).
- Verify proportionate to risk; legal-critical paths need happy path plus failure path. Do not claim done without the appropriate verification. Details in [TESTING.md](TESTING.md).

## Quality bar

- No placeholder architecture, fake implementations, or silent fallbacks in production code.
- No schema drift between docs, contracts, migrations, and handlers. No duplicated state machines across platforms.
- No avoidable races around versions, sync, artifacts, or audit logs. No later-milestone work before the current milestone is stable.
- No merges that leave the repo materially less understandable.
