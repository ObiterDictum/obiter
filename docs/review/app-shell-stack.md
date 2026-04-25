# App Shell Review Notes

This document is the review handoff for PR #4.

## Current Review Shape

- Repository: `OrmontLex/ormont`
- PR: `#4`
- Base: `main`
- Compare: `review/docs-guidance`
- Scope: documentation, implementation specs, repo rules, review handoff notes, and local design-agent guidance.

Earlier branch summaries below are historical context for how the app shell work was prepared. Do not review PR #4 as a stacked diff against `review/app-shell-sidebar`.

## Review Prompt

Use this prompt for an automated Codex review of PR #4:

```text
Review this PR as a documentation and project-guidance review. This PR updates README, architecture notes, implementation rules, specs, review handoff notes, and local design-agent guidance.

Prioritize incorrect statements, contradictions with the implemented code, unclear review instructions, missing risk notes, and guidance that could cause future agents or engineers to make poor implementation choices.

Do not review implementation code unless the docs make a claim that conflicts with it.
```

## PR 1 Summary: Workspace Foundation

### What Changed

- Added the pnpm workspace root, package manager metadata, TypeScript base config, and package manifests for the app, packages, and API service.
- Added workspace ignore rules and lockfile state.

### Why

- The product foundation needs a consistent monorepo layout before feature packages can be reviewed or built reliably.

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
- Added the first application database migration.
- Added the Hono API service, environment parsing, database helper, auth integration point, and API tests.

### Why

- The app shell needs stable demo data and typed contracts before the web and desktop shells can consume the same model.

### Implementation Notes

- Contracts are centralized in `packages/contracts`.
- The API service is still early infrastructure and should be reviewed for boundaries, validation, and future migration risk.

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

- Updated project README, architecture notes, implementation rules, and implementation specs.
- Added local design/frontend agent guidance under `.agents`.

### Why

- The documentation needs to match the current implementation direction before broader review and refactor work begins.

### Implementation Notes

- Specs were expanded around auth, API behavior, schema shape, and milestone tracking.
- Local agent skills are committed so future Codex sessions have the same design guidance available in-repo.

### Testing

- Documentation was not rendered through a docs build.

### Risks / Follow-Ups

- Docs should be checked against the product roadmap after the bug-review pass.
- Some spec details may need tightening once the API and sidebar bugs are reviewed.
