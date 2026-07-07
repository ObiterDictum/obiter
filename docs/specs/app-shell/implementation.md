# App Shell Rebuild — M1 Implementation Plan

Milestone 1 scope only, per [PRD](../../prds/app-shell-rebuild.md). Ends at the **contract freeze**. M2 (live surfaces + fixture deletion) and M3 (search restyle + desktop polish) resume after review.

The frozen surface this plan delivers is [contract.md](contract.md).

## Design-token derivation

**Brand signal (from `ormont-wordmark.svg`):** fill `#F5F2EB` (warm cream), Cormorant Garamond serif, wide tracking (`letter-spacing: 22`). This is an editorial, ink-on-paper identity — not a cold zinc/SaaS palette. The current shell's pure-black background is explicitly rejected (light default, FR6).

**Direction:** warm-neutral "ink on paper" system. Warm off-white/cream surfaces in light; warm near-black charcoal ink (never pure `#000`); one restrained, desaturated brand accent. The design skills' neutrals/contrast/accessibility/density rules apply; their motion/flash rules (Framer, magnetic buttons, bento choreography, OLED black) are **overridden** by the PRD ("calm, dense, professional; no gratuitous motion"):

- **Motion:** none beyond short CSS transitions on `transform`/`opacity`. No Framer Motion dependency in M1.
- **Type:** sans-serif for all UI and body — `Satoshi` (Fontshare, warm geometric sans, pairs with the cream brand, avoids the banned Inter/Helvetica defaults). `Geist Mono` (or `JetBrains Mono`) for IDs, hashes, and tabular numbers in dense views. The brand serif stays as the wordmark **asset only** — not introduced into UI text in M1 (a theming pass can revisit).
- **Density:** information-dense, strong hierarchy, hairline borders and spacing over boxed cards where elevation isn't earned (skill rule 4 + PRD density principle).
- **Accessibility:** visible focus (`--ormont-ring`), keyboard flow from Base UI, AA contrast everywhere; the span palette (contract §2.3) gets explicit AA verification in both themes.

> Type family choice is the one aesthetic decision flagged for ratification at the M1 review; the palette and system are decided. It is not contract surface — contract is token **names**, not typeface.

## Scope boundary for this pass (M1)

- **In:** tokens + Tailwind v4; `@ormont/ui` primitive set; app frame (sidebar with live/planned split, top bar, `PageScaffold`, `Toaster`); real auth (`createAuthClient` + magic-link client plugin); `apiFetch`; `useCurrentUser` from real `/api/me`; document-detail layout route with `<Outlet/>`; Phosphor + ESLint one-icon-pack rule; `infra/docker/compose.yaml`.
- **Out (M2):** matters/home/documents wired to real data; fixture layer deletion (`createPhaseZeroShellSnapshot`, demo me, `demo-shell.test.ts`); `pnpm seed`.
- **Out (M3):** search restyle, desktop verification pass, final dead-CSS removal.
- **Boundary note:** the existing Home/Matters views remain fixture-driven until M2. The **demo localStorage auth is removed in M1** because real sign-in is an M1 deliverable and the two cannot coexist honestly. The demo sign-in test is updated accordingly.

## M1 task list

### 0. Local verification foundation
- [x] Add `infra/docker/compose.yaml`: Postgres 16, user/db/pass `ormont`/`ormont`/`ormont`, port `5432`, plus an `ormont_test` database (for `TEST_DATABASE_URL`). Volumes for persistence.
- [x] Update `infra/docker/README.md`: verification path is `docker compose up -d`, run migrations, then `pnpm dev:api`.
- [x] Confirm migrations apply against the compose DB; document the migration command if none is scripted.

### 1. Design tokens + Tailwind v4
- [x] `packages/ui`: add `tailwindcss` (v4) + `@tailwindcss/vite` (dev), `@base-ui-components/react`, `@phosphor-icons/react`. Add `clsx` (or a tiny local `cn`) + `tailwind-merge`.
- [x] `packages/ui/src/tokens.css`: full `--ormont-*` set per [contract §2](contract.md) — color, status, the 15 span-category `-bg/-fg` pairs (the full `spanCategorySchema` set including `date` and `secret`; light + dark), spacing, radius, elevation, type. Light default; `[data-theme="dark"]` overrides.
- [x] Tailwind v4 entry: `packages/ui/src/tailwind.css` with `@import "tailwindcss"; @theme { ... }` mapping tokens to Tailwind's `--color-*`, `--spacing-*`, `--radius-*`, `--font-*`. Verify cross-package content scanning (`@source`) so utility classes authored in `@ormont/ui` compile in the apps.
- [x] Export `tokens.css` and `tailwind.css` from `@ormont/ui`.

### 2. `@ormont/ui` primitives
- [x] Implement the 12 primitives in [contract §1](contract.md), each `<300` lines, on Base UI where a primitive exists (Button, Input, Select, Dialog, Tabs, Tooltip, ProgressBar); styled semantic elements where none does (Table). Toast = Base UI-backed `Toaster` + `useToast`.
- [x] Phosphor only; one global weight convention.
- [x] Component tests (Vitest + Testing Library): each primitive renders, forwards className, exposes its stable props; focus/keyboard preserved; loading/disabled/invalid states covered.
- [x] Verify AA contrast for status tones and a representative sample of span pairs in both themes (assert computed contrast in a token test, not eyeballing).

### 3. Real auth + data helpers (`packages/app-shell`)
- [x] Add `better-auth` client deps to `apps/web` (`createAuthClient` + `magicLink` client plugin); add `@ormont/ui`, keep `@ormont/contracts`; **swap `@heroicons/react` → `@phosphor-icons/react`**.
- [x] `apiFetch<T>()` + `ApiError` (contract §3.2) in `packages/app-shell/src/api.ts`: `credentials: 'include'`, parse errors through `apiErrorResponseSchema`, throw typed `ApiError`.
- [x] `useCurrentUser()` + `currentUserQueryOptions()` (contract §3.1): real `GET /api/me` via `apiFetch`.
- [x] `useAuth()` wrapper (`signIn`, `signOut`, session) over the auth client.
- [x] Remove demo localStorage auth + `createDemoMeResponse`-on-this-path; update `demo-shell.test.ts` to the real auth boundary (M2 deletes it outright).
- [x] Tests: `apiFetch` success path, error-envelope parse for each `ApiErrorCode`, 401 handling; `useCurrentUser` against a stubbed `/api/me`.

### 4. App frame + page scaffold
- [x] Rebuild `<AppShellLayout>` on tokens + `@ormont/ui`: sidebar (live/planned split from `current-product-scope.md`), top bar, content region, mounted `<Toaster/>`, driven by real `useCurrentUser()`.
- [x] `<PageScaffold title eyebrow actions>` (contract §5).
- [x] Responsive behaviour; visible focus ring everywhere; no console warnings.
- [x] Obiter copy on all user-facing strings (FR6a); `@ormont/*` package/token prefixes stay internal.

### 5. Document detail layout route
- [x] `apps/web/src/routes/matters/$matterId/documents/$documentId.tsx`: layout route rendering document metadata + redaction-runs region (list + "Create Redaction Run" CTA) + `<Outlet/>` for `redact/$runId` (contract §4). M1 ships the scaffold + outlet; run content is Redact's.
- [x] Uses `PageScaffold`; loading/empty states via `@ormont/ui`. (M1 can render against a loading/empty state since documents wiring is M2 — the route, its chrome, and its outlet are the M1 deliverable.)

### 6. Web wiring + icon-pack enforcement
- [x] `apps/web` Vite: add `@tailwindcss/vite`; root CSS imports `@ormont/ui` token/tailwind entry; remove the inline `#000` backgrounds in `__root.tsx`.
- [x] Sign-in route uses real `useAuth()`; signed-out redirect to `/sign-in`.
- [x] Add a minimal ESLint flat config with `no-restricted-imports` banning every icon package except `@phosphor-icons/react` (FR5). (If ESLint is not yet set up repo-wide, add the minimal config scoped to this rule.)

## Verification

Per [TESTING.md](../../../TESTING.md) and the project rule **"never claim verified without having run it."**

- [x] `pnpm -r typecheck` — all 10 packages clean, including `@ormont/desktop` (the desktop-types risk is cleared).
- [x] `pnpm --filter @ormont/ui --filter @ormont/app-shell test` — 47 tests, including the `tokens.css` WCAG-AA contrast test for every `-fg`/base pair in both themes (all ≥ 4.5; `--ormont-status-warning` tuned `#9a6b1c`→`#8a5e16` to clear 5.36).
- [x] `pnpm --filter @ormont/web build` — clean, no CSS warnings; proves the Tailwind v4 cross-package pipeline compiles (`@theme inline` + `@source` generate semantic utilities; tokens + all 15 span `-bg/-fg` pairs emit).
- [x] `pnpm lint` — clean; `no-restricted-imports` icon-pack rule enforced.

**Not runnable here (no Docker) — hand-over steps, unverified until run:**
- `docker compose up -d` (infra/docker/compose.yaml) → migrate both DBs → `pnpm dev:api` → `pnpm dev:web`, then manually verify: real sign-in round-trip via better-auth; `/api/me` returns the real user; document-detail route (`/matters/:matterId/documents/:documentId`) renders its scaffold + `<Outlet/>`; light/dark toggle renders with no console errors; sign-out returns to `/sign-in`.
- `pnpm -r test` is not a clean signal here: `@ormont/api` tests need `TEST_DATABASE_URL` (Postgres). M1 did not touch the API; that suite is out of scope for this pass.

## M2 carry-ins from the M1 review (plan owner, July 2026)

- [ ] **Self-host the typefaces.** Satoshi + JetBrains Mono are ratified, but the Fontshare CDN `<link>` in `apps/web/src/routes/__root.tsx` must go: a legal-confidentiality product should not leak visitor IPs to a third-party font CDN (including on the sign-in page), and the Electron desktop app needs fonts offline. Vendor the woff2 files (ITF Free Font License permits self-hosting; include the licence file), serve via `@font-face`, remove the CDN link and preconnect.
- [ ] **SSR cookie forwarding pass** before any M2 route loader prefetches `/api/me`: forward the incoming request cookie on server-side fetches so the initial render is authenticated. Client-side auth already works.

## Risks / spikes

- **Tailwind v4 across a workspace package** (utility classes authored in `@ormont/ui` must compile in `apps/web`/`apps/desktop`). Early spike: confirm `@source`/content config compiles classes from a dependency. Fallback: ship precompiled CSS from `@ormont/ui`. Resolved before building primitives on top of it.
- **better-auth client session lifecycle in SSR (TanStack Start)** — confirm cookie travels on the server fetch for the initial `/api/me`. The half-day auth spike from the PRD risk table.
- **Desktop (Electron) must keep rendering.** M1 changes the CSS pipeline; confirm `apps/desktop` still builds even though the formal desktop pass is M3.
