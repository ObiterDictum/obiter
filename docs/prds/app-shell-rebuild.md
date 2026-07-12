# App Shell Rebuild: Design System, Real Data, and the Feature Contract

## Summary

Rebuild `packages/app-shell` from the ground up: a consistent design system on Base UI primitives, exactly one icon pack, design tokens instead of 3,200 lines of hand-rolled CSS, and — critically — real API wiring throughout. The current shell renders hardcoded Phase 0 fixture data on every surface except Search; after this rebuild, every visible screen is backed by the real API and the fixture layer (`createPhaseZeroShellSnapshot`, demo current-user) is deleted.

This PRD is also a coordination document. The shell rebuild runs **in parallel** with the Redact feature track ([Redact PRD 2: Review and Output](redact-2-review-output.md)), built by separate agents. The two tracks meet at the **component contract** defined below: the shell team freezes the contract at Milestone 1, and the Redact review UI builds only against contract exports, never against shell internals.

## Problem

Verified against the codebase (July 2026):

1. **The UI is fixture-driven.** The only real API call in the entire web app is `POST /api/search/fetch`. Sign-in does not authenticate (the current user is a canned demo response), Home renders fixture content, and the matters list/detail screens render fixture matters whose IDs do not exist in the database. No code in `apps/` or `packages/` calls `/api/matters` despite a complete, org-scoped, audited matters API existing in `services/api`.
2. **The presentation layer is unmaintainable and inconsistent.** Styling is a single 3,219-line `styles.css` of `.obiter-*` classes with hardcoded colors (black background, no theming, no tokens). `packages/ui` is an empty stub. There is no component library: each view hand-rolls its own markup and styles.
3. **Docs overstated completion.** `docs/current-product-scope.md` listed Matters and Home as implemented; they were screens over fixtures. The doc now uses three verified tiers; this PRD is the plan that moves the "API implemented, UI is demo fixture" tier to genuinely implemented.
4. **Feature teams have nothing stable to build on.** The Redact review UI (PRD 2) needs layout primitives, tokens, a query client, an auth hook, and a document detail route. Today none of these exist in a form worth building against.

## Product Principles

- **Real data or nothing.** No fixture snapshot survives this rebuild. Development uses seeded database data, not in-memory fakes. A screen that cannot show real data does not ship as "implemented".
- **One component library, one icon pack.** Every interactive element comes from `@obiter/ui`; every icon comes from the single chosen pack. No per-view one-offs.
- **Tokens, not hex codes.** All color, spacing, radius, and type decisions live in design tokens (CSS variables). Components never hardcode values. Light and dark themes are both first-class.
- **The shell is a platform, not a feature.** Feature UIs (Redact review, Verification, Research) are consumers. The shell's job is frame, navigation, auth, data access conventions, and primitives — it does not implement feature screens.
- **No feature invention during the rebuild.** Scope is the existing surfaces (auth, Home, Matters, Search) rebuilt properly, plus the document detail route that Redact needs. New product capability belongs to feature PRDs.
- **Calm, dense, professional.** The audience is solicitors and paralegals working long sessions in document-heavy workflows. Information density over decoration; strong hierarchy; no gratuitous motion.

## Stack Decisions

Verified current stack: React 19, TanStack Router + Query + Start, Vite 8, TypeScript, pnpm workspace, Vitest. Electron desktop app (`apps/desktop`) consumes `@obiter/app-shell`.

| Decision                 | Choice                                                                              | Rationale                                                                                                                                                                                                                                                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework, routing, data | **Keep**: React 19, TanStack Router/Query/Start, Vite 8                             | Modern, working, and the Search surface already proves the pattern. A framework swap would discard working infrastructure for no stated deficiency.                                                                                                                                                                                                  |
| Component primitives     | **Add**: Base UI (`@base-ui-components/react`)                                      | Headless, accessible primitives (dialog, menu, popover, select, tabs, tooltip) from the Radix/MUI lineage. We own the visual layer; Base UI owns focus management, ARIA, and interaction correctness.                                                                                                                                                |
| Styling                  | **Add**: Tailwind CSS v4, driven by design tokens as CSS variables                  | Replaces the 3,219-line hand-rolled stylesheet. Tokens (`--obiter-*` CSS variables) are the source of truth; Tailwind consumes them via `@theme`. Note: Redact PRD 2's category color mapping consumes these tokens.                                                                                                                                 |
| Component library        | **Build**: `@obiter/ui` becomes real                                                | The existing stub package becomes the styled component library: Button, Input, Select, Dialog, Table, Tabs, Badge, Toast, EmptyState, Skeleton, etc., built on Base UI + tokens.                                                                                                                                                                     |
| Icons                    | **One pack**: Phosphor (`@phosphor-icons/react`); remove `@heroicons/react`         | Deliberately not Lucide — the founder wants a less generic visual identity than the default stack. Phosphor: 1,200+ icons, first-class React package, multiple weights (regular/bold/duotone/fill) that give the UI distinctive character while staying coherent. Enforced by an ESLint `no-restricted-imports` rule against any other icon package. |
| Fixture layer            | **Delete**: `createPhaseZeroShellSnapshot`, demo `MeResponse`, `demo-shell.test.ts` | Replaced by real endpoints + a `pnpm seed` development dataset.                                                                                                                                                                                                                                                                                      |
| Effect TS                | **Not used**                                                                        | The proposed Redact detection-module pilot was never implemented. Detection ships as plain TypeScript; a future Effect evaluation requires its own decision. Do not add `effect` as a dependency of `@obiter/ui`, `@obiter/app-shell`, or `@obiter/web`; async/data concerns in the UI belong to TanStack Query.                                     |

## Scope

### In Scope

- **Branding**: the user-facing product name is **Obiter** — all screen copy, titles, sidebar headings, and aria-labels use it (decided July 2026; committed rename). `@obiter/*` package names, `--obiter-*` token prefixes, and "Obiter" in internal planning docs remain internal identifiers; renaming them is out of scope and tracked separately.
- **Design tokens**: color (including semantic status colors and the span-category palette Redact consumes), spacing, radius, elevation, type scale. Light and dark themes; **light is the default**.
- **`@obiter/ui` component library** on Base UI: the primitive set listed above, each with stories/fixtures and component tests.
- **App frame**: sidebar (preserving the live/planned split from `docs/current-product-scope.md` — planned entries stay visibly planned), top bar, page scaffold, responsive behaviour, toast/error surfaces.
- **Auth wiring**: real sign-in against the auth API, session handling, `useCurrentUser()` from the real me endpoint, signed-out redirect. The cosmetic sign-in screen becomes functional.
- **Matters, live**: matters list from `GET /api/matters`, matter creation, matter detail with its documents list from the documents API.
- **Document detail route**: `/matters/:matterId/documents/:documentId` — document metadata, redaction runs list, "Create Redaction Run" CTA. This route is contract surface for Redact PRD 2 (its review route nests beneath it).
- **Home (`/workspace`)**: a minimal honest version — recent matters and recent activity from real data. No invented dashboard widgets.
- **Search restyle**: `LegalSearchView` and `CaseLawDocumentView` migrate to the new components/tokens. Logic and API behaviour unchanged.
- **Desktop parity, not just compatibility**: `apps/desktop` ships the same rebuilt design — new tokens, components, and typefaces in the Electron renderer, legacy stylesheet deleted. The redesign covers **every user-facing surface**: sign-in, app frame, Home, Matters, document detail, Search, stored case pages, and the desktop renderer. No screen a user can reach keeps the legacy design after M3 (clarified July 2026 — "the whole UI" means the whole UI).
- **Development seed data**: a `pnpm seed` script creating an org, users, matters, and documents so every screen has real data locally.

### Out of Scope

- Feature UIs: Redact review screens (PRD 2 owns them), Verification, Research, Drafting, Bench.
- New product features of any kind, including role-based Home content beyond what the me endpoint already provides.
- Marketing site (`apps/marketing`) and docs site.
- Route renames (e.g. `/workspace` → `/home`) — tracked separately per the naming rules in `current-product-scope.md`.
- Binary document upload UI (arrives with Redact PRD 3's upload work; the document detail route ships with the metadata-based flow first).

## The Component Contract (parallel-track coordination)

Two agents build in parallel: one on this rebuild, one on Redact. The contract is what makes that safe. It freezes at Milestone 1; changes after freeze require updating both this PRD and Redact PRD 2.

The shell guarantees, as stable exports:

1. **From `@obiter/ui`**: the primitive component set (Button, Input, Select, Dialog, Table, Tabs, Badge, Tooltip, Toast, EmptyState, Skeleton, ProgressBar) with documented props.
2. **Design tokens**: the `--obiter-*` CSS variable set, including a named color token per redaction span category (`--obiter-span-person-name`, etc.) so PRD 2's category coloring is token-driven, not hardcoded.
3. **From `@obiter/app-shell`**: `useCurrentUser()`; the shared `QueryClient` provided at the root; an `apiFetch` helper that applies auth headers and normalises the API error envelope (`apiErrorCodeSchema` from `@obiter/contracts`) into typed errors.
4. **Routes**: the document detail route exists at `/matters/:matterId/documents/:documentId` with a stable outlet/navigation pattern for feature sub-routes such as `redact/$runId`.
5. **Page scaffold**: a layout component (title, actions slot, content region) that feature screens compose instead of building their own frames.

The Redact review UI imports only from `@obiter/ui`, `@obiter/app-shell` public exports, and `@obiter/contracts`. It never imports shell-internal modules. The Redact track may begin UI work as soon as the contract freeze lands, against the real components.

## Users

- **Legal professional**: gets a coherent, calm, fast interface where every screen reflects real matter data.
- **Feature builder (Redact/Verification agents)**: gets a stable contract to build against without coordinating on internals.
- **Firm evaluator**: sees a product whose demo flow runs on real data end-to-end, not a facade.

## Functional Requirements

- **FR1.** Sign-in authenticates against the real auth API; an invalid session redirects to `/sign-in`; `useCurrentUser()` returns the real me response.
- **FR2.** Matters list renders `GET /api/matters` data with loading, empty, and error states; matter creation posts to the API and appears in the list without reload.
- **FR3.** Matter detail renders the real matter and its documents list; each document links to the document detail route.
- **FR4.** Document detail route (`/matters/:matterId/documents/:documentId`) renders document metadata and a redaction runs region (list + create CTA), and exposes a child outlet for feature sub-routes.
- **FR5.** All screens use `@obiter/ui` components and tokens exclusively; a lint rule blocks imports from more than one icon package; no `.obiter-*` legacy classes remain.
- **FR6.** Light and dark themes both render correctly on every screen; light is the default; theme preference persists.
- **FR6a.** All user-facing copy uses the product name Obiter; no user-visible "Obiter" remains in the rebuilt shell.
- **FR7.** The fixture layer is deleted: `createPhaseZeroShellSnapshot` and the demo me response do not exist in the codebase; `pnpm seed` provides development data.
- **FR8.** Search surfaces are visually migrated with zero behaviour change (existing tests pass unmodified or with styling-only updates).
- **FR9.** `apps/desktop` builds and renders the rebuilt shell with full design parity: the Electron renderer uses the new tokens, components, and self-hosted typefaces; the legacy `styles.css` is deleted from both web and desktop paths. After M3, no user-reachable screen on any platform renders the legacy design.
- **FR10.** `docs/current-product-scope.md` tiers updated on completion: Auth, Home, Matters, Documents move to "Implemented end-to-end".

## Non-Functional Requirements

- **NFR1.** Route-level code splitting; initial JS for the authenticated frame under a defined budget (measure current, set target at M1).
- **NFR2.** Keyboard navigability and visible focus on all interactive elements (Base UI provides the foundation; the styled layer must not break it).
- **NFR3.** All `@obiter/ui` components have component tests; shell data wiring has integration tests against a test API.
- **NFR4.** No console errors or warnings in development on any screen.

## Rollout

### Milestone 1 — Foundation and contract freeze

Design tokens, Tailwind v4 setup, `@obiter/ui` primitive set, app frame, auth wiring, `apiFetch` + `useCurrentUser`, empty document-detail route scaffold. **Contract freeze at the end of M1** — the Redact track starts its UI build here.

### Milestone 2 — Live surfaces

Matters list/create/detail, documents list, document detail content, Home, seed script. Delete the fixture layer. This is the moment the "demo data" tier ceases to exist.

### Milestone 3 — Migration and polish

Search and stored-case-page restyle; **desktop parity pass** (Electron renderer on the new tokens/components/typefaces, legacy `styles.css` deleted everywhere — FR9); theming pass, lint enforcement, scope-doc update, dead CSS removal. Web deployability: `apps/web` Dockerfile + Dokploy same-domain Traefik routing (`/api` → api app) per [docs/specs/deployment.md](../specs/deployment.md). Exit check: click through every reachable screen on web and desktop — none may render the legacy design.

> **Status (July 2026, M3 close):** the Search/case restyle itself shipped earlier in PR #24 (`app-shell-ui-redesign`), which moved `LegalSearchView` / `CaseLawDocumentView` onto the `--obiter-*` tokens and `@obiter/ui` and deleted the 3,219-line `packages/app-shell/src/styles.css`. M3 closes the residue honestly: the two remaining orphaned legacy files (`packages/ui/src/styles.css`, `packages/ui/src/index.tsx`) are deleted; the hex-color lint guard is added (the icon-pack rule already existed); the desktop window background picks light/dark via `nativeTheme.shouldUseDarkColors`; the `apps/web` Dockerfile + dependency-free SSR host + Dokploy/Traefik same-domain routing are in place (see deployment.md). One verification gap is documented: `docker build` was not run in the dev environment (no Docker there); the SSR host was exercised against a local build instead. Desktop parity is verified grep-only (no Electron runtime in the dev environment) — desktop shares the web shell's views and CSS by construction, so the web proof covers it.

### Definition of Done

All FRs met; both themes verified on every screen; contract exports documented; Redact review UI (built in parallel) renders inside the shell without contract violations; `pnpm typecheck` and all tests pass across `@obiter/ui`, `@obiter/app-shell`, `@obiter/web`.

## Risks

| Risk                                                                          | Likelihood | Impact | Mitigation                                                                                                                                               |
| ----------------------------------------------------------------------------- | ---------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parallel-track drift: Redact UI needs a component or token the contract lacks | Medium     | Medium | Contract freeze at M1 with an explicit change process (both PRDs updated together); the plan owner reviews both tracks at each milestone.                |
| Base UI gaps (it is a newer library) for a needed primitive                   | Low-Medium | Medium | The styled layer lives in `@obiter/ui`, so a single primitive can be swapped (e.g. hand-rolled or another headless source) without feature-code changes. |
| Search regression during restyle                                              | Medium     | Medium | Search logic untouched; existing tests must pass; restyle is markup/class-level only.                                                                    |
| Desktop (Electron) breakage from new CSS pipeline                             | Medium     | Low    | M3 includes an explicit desktop build-and-render verification step.                                                                                      |
| Auth API assumptions (session shape, cookie vs token) don't match the UI plan | Medium     | Medium | M1 starts with a half-day spike reading `services/api/src/auth.ts` and the auth spec before component work begins.                                       |

## Open Questions

1. **Icon pack** — _Resolved (July 2026)_: Phosphor (`@phosphor-icons/react`). Explicitly not Lucide.
2. **Theme default** — _Resolved (July 2026)_: light by default; dark ships as a persisted preference.
3. **Seed data shape** — should `pnpm seed` create the Redact demo fixture matter (PRD 3's skeleton argument) so both tracks share one dataset? Recommended: yes, coordinate with the Redact track at M2.
