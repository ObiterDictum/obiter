# Obiter Rules

## Purpose

These rules are mandatory unless a documented architectural decision explicitly overrides them.

Use this file for implementation behavior. Use [PR.md](C:\Users\karl-\Documents\source\Obiter\PR.md) when preparing pull requests and [TESTING.md](C:\Users\karl-\Documents\source\Obiter\TESTING.md) when deciding what to verify.

## Product Rules

- Desktop is the primary serious workspace.
- Web must mirror the same product model and shared code where possible.
- Security is a first-order requirement, not a later hardening pass.
- Offline desktop support is real scope, not a placeholder.
- Legal work must use immutable versions and must never silently overwrite conflicts.
- Verify must be conservative. If support is weak, surface uncertainty.
- The product must not silently learn from client matter data.

## React Rules

- Use React with TanStack Start, TanStack Router, and TanStack Query.
- Prefer server state in TanStack Query, route state in TanStack Router, and local UI state only where needed.
- Do not use `useEffect` by default.
- `useEffect` is only allowed for unavoidable external synchronization such as browser APIs, subscriptions, timers, Electron/native bridges, or lifecycle cleanup that cannot be expressed another way.
- Do not use `useEffect` for data fetching.
- Do not use `useEffect` for derived state.
- Do not use `useEffect` for prop-to-state syncing unless there is a real external boundary and the reason is documented.
- Prefer derived values, route loaders, query hooks, event handlers, and explicit actions over lifecycle-style code.
- Avoid `useMemo` and `useCallback` unless profiling, referential contracts, or a real performance constraint justifies them.
- Prefer controlled data flow over implicit component-local orchestration.

## Code Rules

- Keep code explicit, typed, and easy to trace.
- Prefer TypeScript everywhere except where Python is explicitly justified, such as redaction workers.
- Share contracts and schemas across apps and services rather than duplicating shapes.
- Prefer small, composable modules over large framework-heavy abstractions.
- Names must describe the real behavior of the code. Do not hide incomplete behavior behind optimistic names.
- Model domain concepts directly. Do not flatten legal, matter, auth, audit, or storage concepts into generic blobs unless the spec explicitly allows it.
- Keep side effects at clear boundaries such as API handlers, workers, Electron bridges, storage adapters, and command handlers.
- Keep pure domain logic separate from framework glue so it can be tested without booting the app.
- Validate untrusted input at the boundary with shared schemas where possible.
- Do not use `any`, unsafe casts, or non-null assertions to force code through typechecking unless the reason is documented next to the code.
- Prefer discriminated unions for state machines, job statuses, sync states, and legal findings.
- Exhaustively handle status and enum branches. Unknown legal-critical states must fail loudly.
- Add comments only when they explain intent, constraints, or non-obvious reasoning.
- Do not add decorative comments or comments that restate the code.
- Do not introduce hidden magic, implicit globals, or clever metaprogramming.
- Do not add production mocks, fake data paths, or hardcoded demo behavior outside clearly named demo or test modules.
- Authentication must always use a real server-side session and `GET /api/me`. Do not add development auto-login, synthetic sessions, default credentials, or client-side auth bypasses. Fixtures must not provide runtime auth context; test fixtures may remain clearly isolated.
- Fail loudly in legal-critical flows. Do not add silent fallbacks that hide uncertainty or data loss.

## Architecture Rules

- Follow the current milestone order. Build only the foundation needed for the active milestone unless a later concern must shape an interface now.
- Put shared contracts in `packages/contracts`; do not copy request, response, enum, or schema shapes between apps and services.
- Keep `apps/web` and `apps/desktop` thin. Shared product screens and shell logic belong in `packages/app-shell` unless platform behavior genuinely differs.
- Keep `packages/ui` presentation-focused. It should not know about auth, storage, legal verification, or network calls.
- Service code should expose clear domain functions behind API handlers rather than placing all business logic inside route files.
- Electron renderer code must not access Node, filesystem, secrets, or privileged APIs directly. Use explicit preload or main-process bridges.
- Background jobs must be idempotent by stable ids and safe to retry.
- New dependencies require a concrete reason. Prefer existing stack choices and standard library capabilities before adding packages.
- Do not introduce a second framework for a solved concern without documenting the architectural decision.

## File Size Rules

- Target under 300 lines for most source files.
- Treat 500 lines as a hard ceiling for source files unless there is a documented reason.
- Split files before they become hard to scan.
- Target under 200 lines for most docs.
- Treat 400 lines as a hard ceiling for planning docs unless the document is intentionally top-level and cannot be split cleanly.
- If a doc grows beyond that, split it by module, milestone, or concern.

## UI Rules

- Build shared UI once and reuse it across web and desktop.
- Prioritize clarity, evidence visibility, and reviewability over flashy interactions.
- Loading states must explain what is happening.
- Legal evidence views must support large result sets without rendering everything at once.
- Accessibility is required, especially keyboard flow, focus behavior, and readable contrast.
- Do not hide important legal state behind hover-only or animation-only interaction.

## Data And Security Rules

- Treat client matter data as sensitive by default.
- Keep hosted data in the EU.
- Use encrypted transport everywhere.
- Preserve auditability for auth, matter actions, document actions, and artifact access.
- Prefer soft delete by default, with explicit hard-delete paths only where required.
- Hosted redaction must be clearly distinguishable from local desktop redaction.
- Do not move sensitive workflows into hosted infrastructure without making that boundary explicit in the product.
- Do not log raw document contents, auth secrets, magic-link tokens, private keys, or full sensitive spans.
- Object keys must not include client names, matter names, original filenames, or raw legal text.
- Database writes for immutable document versions, sync conflict handling, and audit logs must be transactional where correctness depends on multiple records.
- Access control checks must happen server-side. UI hiding is not authorization.
- Cross-organisation access must never leak private record contents.
- External AI or model calls must be visible in product state and audit logs when they touch matter data.
- Real client documents must not be used in development fixtures, demos, or tests unless explicitly approved and handled under the security rules.

## Documentation Rules

- Update docs when scope, sequencing, architecture, or behavior changes materially.
- If implementation changes a spec, either update the spec or deliberately mark the deviation.
- Keep examples small and accurate.
- Do not duplicate the same guidance across multiple files when one canonical rule file will do.
- `AGENTS.md` must stay small and act as the linker, not the rule body.

## PR Rules

- Follow [PR.md](C:\Users\karl-\Documents\source\Obiter\PR.md) for every pull request or equivalent change summary.
- PR summaries must explain what changed, why it changed, what was tested, what remains risky, and any follow-up work.
- PR summaries must read like they were written by an engineer for another engineer.
- Do not write AI-flavored filler, generic confidence language, or empty summaries.

## Testing Rules

- Follow [TESTING.md](C:\Users\karl-\Documents\source\Obiter\TESTING.md) when deciding what verification is required.
- Do not claim something is done if it has not been verified at the appropriate level.
- Prefer targeted tests close to the changed behavior over broad, unfocused additions.
- For legal-critical flows, test the failure path as well as the happy path.
- Tests must cover contracts, validation, state transitions, permissions, retries, and conflict behavior when those areas change.
- Do not mock the behavior being tested. Mock only external boundaries such as network, object storage, email, clocks, and filesystem where needed.
- UI changes need at least one meaningful manual pass unless they are purely internal refactors.
- Bug fixes should add or update a test that would have caught the bug when practical.

## Quality Bar

- No placeholder architecture in production code.
- No fake implementations hidden behind optimistic names.
- No silent fallbacks in legal-critical flows.
- No swallowed errors. Catch only when adding useful context, converting to a documented error shape, or performing cleanup.
- No broad `try/catch` around legal-critical workflows that lets execution continue in an uncertain state.
- No unchecked schema drift between docs, contracts, database migrations, and API handlers.
- No duplicated state machines across web, desktop, API, and workers.
- No avoidable race conditions around document versions, sync state, artifact generation, or audit logging.
- No implementation of later milestones before the current milestone is stable.
- No merging work that leaves the repo materially less understandable than before.
