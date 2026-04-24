# Phase 0 App Shell Review Stack

This branch is prepared for review as a stacked change set. Review commits in order, or open stacked PRs using the branch map below.

## Branch Map

1. `review/01-workspace-foundation`
   - Base: `main`
   - Scope: pnpm workspace, package manifests, TypeScript config, lockfile, ignore rules.

2. `review/02-api-contracts`
   - Base: `review/01-workspace-foundation`
   - Scope: shared contracts, initial database migration, API service implementation and README update.

3. `review/03-app-shell-sidebar`
   - Base: `review/02-api-contracts`
   - Scope: shared UI package, app shell package, finished sidebar, web routes, desktop renderer/main process, assets.

4. `review/04-docs-guidance`
   - Base: `review/03-app-shell-sidebar`
   - Scope: documentation, phase 0 specs, repo rules, local design-agent guidance.

## Review Prompt

Use this prompt for an automated Codex review:

```text
Review this PR as a production engineering review. Prioritize bugs, behavioral regressions, unsafe assumptions, missing tests, accessibility issues, responsive layout problems, and maintainability risks. Do not suggest broad refactors unless they address a concrete risk. Assume a follow-up refactor PR will happen after bug fixes are reviewed.
```

## PR 1 Summary: Workspace Foundation

### What Changed

- Added the pnpm workspace root, package manager metadata, TypeScript base config, and package manifests for the app, packages, and API service.
- Added workspace ignore rules and lockfile state.

### Why

- Phase 0 needs a consistent monorepo layout before feature packages can be reviewed or built reliably.

### Implementation Notes

- Workspace packages are grouped under `apps/*`, `packages/*`, and `services/*`.
- Package scripts are intentionally narrow at this stage: typecheck/build/test entrypoints are scoped per package.

### Testing

- Later commits in this stack were verified with targeted typecheck and build commands.

### Risks / Follow-Ups

- The lockfile includes dependencies for packages added later in the stack. Review this PR as the foundation for the full stack, not as a standalone product feature.

## PR 2 Summary: API Contracts And Data Foundation

### What Changed

- Added shared contract types for auth, matters, documents, redaction, verification, research, audit, and shell snapshot data.
- Added the first phase 0 database migration.
- Added the Hono API service, environment parsing, database helper, auth integration point, and API tests.

### Why

- The app shell needs stable demo data and typed contracts before the web and desktop shells can consume the same model.

### Implementation Notes

- Contracts are centralized in `packages/contracts`.
- The API service is still phase 0 infrastructure and should be reviewed for boundaries, validation, and future migration risk.

### Testing

- `pnpm --filter @ormont/api typecheck`
- `pnpm --filter @ormont/api test`

### Risks / Follow-Ups

- Database execution was not exercised against a live PostgreSQL instance during sidebar iteration.
- Auth integration remains foundational and should be reviewed before real credentials or tenant data are introduced.

## PR 3 Summary: App Shell And Sidebar

### What Changed

- Added shared UI primitives and global styling.
- Added the app shell package with the finished Ormont sidebar, search, navigation groups, current matter, recent research, user card, and collapse behavior.
- Added web and desktop app entrypoints that consume the shared app shell.
- Added visual assets used by the sign-in and shell experience.

### Why

- This creates the first complete product surface for Ormont and gives the application a real navigation model instead of placeholder workspace screens.

### Implementation Notes

- Sidebar state is local to the app shell for now.
- The rail was removed in favor of one grouped navigation surface.
- The last active matter card is shown on dashboard routes as a quick return affordance.
- Web and Electron paint layers were set to black to avoid resize flash during viewport changes.

### Testing

- `pnpm --filter @ormont/app-shell typecheck`
- `pnpm --filter @ormont/app-shell test`
- `pnpm --filter @ormont/desktop typecheck`
- `pnpm --filter @ormont/web build`
- Manual browser/Electron checks were performed during sidebar iteration at `http://localhost:5173/#/workspace`.

### Risks / Follow-Ups

- The sidebar has deliberately not been refactored yet; review should focus on bugs and behavior first.
- Follow-up work should extract style tokens and reduce the size of `packages/app-shell/src/styles.css`.
- The current route content is still placeholder workspace content.

## PR 4 Summary: Docs And Guidance

### What Changed

- Updated project README, architecture notes, implementation rules, and phase 0 specs.
- Added local design/frontend agent guidance under `.agents`.

### Why

- The documentation needs to match the current implementation direction before broader review and refactor work begins.

### Implementation Notes

- Specs were expanded around auth, API behavior, schema shape, and phase 0 milestones.
- Local agent skills are committed so future Codex sessions have the same design guidance available in-repo.

### Testing

- Documentation was not rendered through a docs build.

### Risks / Follow-Ups

- Docs should be checked against the product roadmap after the bug-review pass.
- Some spec details may need tightening once the API and sidebar bugs are reviewed.
