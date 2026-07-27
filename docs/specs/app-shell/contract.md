# App Shell Component Contract

> **Freeze artifact.** This document defines the stable surface the Redact review UI ([PRD 2](../../prds/archive/redact-2-review-output.md)) and every future feature UI builds against. It freezes at the end of Milestone 1 of the [App Shell Rebuild PRD](../../prds/app-shell-rebuild.md). After freeze, any change here requires updating **both** this contract and Redact PRD 2, and is owned by the plan owner.

The Redact review UI imports only from `@obiter/ui`, `@obiter/app-shell` public exports, and `@obiter/contracts`. It never imports shell-internal modules.

## Change process

1. A needed primitive/token/route is missing or wrong → raise it against this doc, not against shell internals.
2. Plan owner updates this contract **and** the corresponding section of Redact PRD 2 in the same change.
3. Both tracks move together. No silent contract drift.

---

## 1. `@obiter/ui` primitive exports

Headless behaviour and a11y come from Base UI (`@base-ui-components/react`); `@obiter/ui` owns the visual layer. All components consume the `--obiter-*` tokens (section 2) and never hardcode color/spacing/radius/type values. All accept a `className` override and compose with `cn()`. Icons are Phosphor (`@phosphor-icons/react`) only — enforced by ESLint `no-restricted-imports`.

| Primitive   | Export                                                                                        | Stable props                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Button      | `Button`                                                                                      | `variant: 'primary' \| 'secondary' \| 'ghost' \| 'danger'`, `size: 'sm' \| 'md' \| 'lg'`, `loading?: boolean`, `iconStart?: ReactNode`, `iconEnd?: ReactNode`, plus native `<button>` props                                                                                                                                                                                                            |
| Input       | `Input`                                                                                       | `label?: ReactNode`, `helperText?: ReactNode`, `error?: ReactNode`, `invalid?: boolean`, plus native `<input>` props. Label above input, helper/error below (form rule).                                                                                                                                                                                                                               |
| Select      | `Select`                                                                                      | `options: { value: string; label: string }[]`, `label?: ReactNode`, `placeholder?: string`, `invalid?: boolean`, plus Base UI Select props                                                                                                                                                                                                                                                             |
| Dialog      | `Dialog`, `DialogTrigger`, `DialogContent`, `DialogTitle`, `DialogDescription`, `DialogClose` | Compound over Base UI Dialog. `DialogContent` takes `size?: 'sm' \| 'md' \| 'lg'`.                                                                                                                                                                                                                                                                                                                     |
| Table       | `Table`, `THead`, `TBody`, `TR`, `TH`, `TD`                                                   | Styled semantic table elements (no headless lib). `TH` takes `align?: 'start' \| 'end'`.                                                                                                                                                                                                                                                                                                               |
| Tabs        | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`                                              | Compound over Base UI Tabs. `value`/`defaultValue` controlled.                                                                                                                                                                                                                                                                                                                                         |
| Badge       | `Badge`                                                                                       | `tone: 'neutral' \| 'brand' \| 'info' \| 'success' \| 'warning' \| 'danger'`, children.                                                                                                                                                                                                                                                                                                                |
| Tooltip     | `Tooltip`, `TooltipTrigger`, `TooltipContent`                                                 | Compound over Base UI Tooltip.                                                                                                                                                                                                                                                                                                                                                                         |
| Toast       | `Toaster`, `useToast`                                                                         | `<Toaster />` mounted once in the app frame. `useToast()` returns `toast({ title, description?, tone? })`. `tone: 'info' \| 'success' \| 'warning' \| 'danger'`. Self-contained (aria-live region + per-toast timer), not Base UI's toast manager — Base UI 1.0.0-rc.0 does not export the manager hooks as runtime values. The API is stable; only the internals change if it moves to Base UI later. |
| EmptyState  | `EmptyState`                                                                                  | `title: ReactNode`, `body?: ReactNode`, `icon?: ReactNode`, `action?: ReactNode`.                                                                                                                                                                                                                                                                                                                      |
| Skeleton    | `Skeleton`                                                                                    | `className?`. Shimmer block; sizing via className.                                                                                                                                                                                                                                                                                                                                                     |
| ProgressBar | `ProgressBar`                                                                                 | `value?: number` (0–100; omit for indeterminate), `label?: ReactNode`, `helperText?: ReactNode`.                                                                                                                                                                                                                                                                                                       |

**Re-exports from `@obiter/ui` index:** the full set above, plus `cn` (the class-merge helper).

## 2. Design tokens (`--obiter-*`)

Source of truth is `packages/ui/src/tokens.css`, consumed by Tailwind v4 via `@theme`. **Token names are frozen; values may tune within the same theme.** Light is the default; dark is a persisted preference. Both themes must render every screen correctly (FR6).

### 2.1 Color (semantic, defined per theme)

`--obiter-bg`, `--obiter-surface`, `--obiter-surface-raised`, `--obiter-border`, `--obiter-border-strong`, `--obiter-text`, `--obiter-text-muted`, `--obiter-text-subtle`, `--obiter-brand`, `--obiter-brand-fg` (text on brand), `--obiter-brand-pressed`, `--obiter-ring` (focus ring), `--obiter-overlay` (scrim).

### 2.2 Status (defined per theme, each with `-fg` for text-on-fill)

`--obiter-status-info`, `--obiter-status-success`, `--obiter-status-warning`, `--obiter-status-danger` (each with a matching `--obiter-status-*-fg`).

### 2.3 Redaction span-category palette — CONTRACT SURFACE

One token per span category from `spanCategorySchema` (snake_case → kebab token). Each category is defined as a **`-bg` / `-fg` pair** so highlighted span text meets WCAG AA contrast in **both** light and dark themes, and categories are distinguishable by hue. A bare `--obiter-span-<category>` alias (= the `-bg` value) is also exported for the PRD's literal naming.

Categories (15 — the full `spanCategorySchema` set; `date` and `secret` were missing from the first draft and are required by PRD 2's FR5 color mapping):

| Span category        | Token prefix                       |
| -------------------- | ---------------------------------- |
| `person_name`        | `--obiter-span-person-name`        |
| `email`              | `--obiter-span-email`              |
| `phone`              | `--obiter-span-phone`              |
| `address`            | `--obiter-span-address`            |
| `date`               | `--obiter-span-date`               |
| `government_id`      | `--obiter-span-government-id`      |
| `secret`             | `--obiter-span-secret`             |
| `account_number`     | `--obiter-span-account-number`     |
| `passport`           | `--obiter-span-passport`           |
| `drivers_license`    | `--obiter-span-drivers-license`    |
| `url`                | `--obiter-span-url`                |
| `ip_address`         | `--obiter-span-ip-address`         |
| `national_insurance` | `--obiter-span-national-insurance` |
| `case_reference`     | `--obiter-span-case-reference`     |
| `organisation_name`  | `--obiter-span-organisation-name`  |

**Contract guarantees:** every category renders with AA-contrast text over its fill in both themes; adjacent categories are hue-distinguishable; saturation stays restrained (no neon), per the design skills. Exact hues are implementation; the names, the pair convention, and the accessibility contract are frozen.

### 2.4 Spacing, radius, elevation, type

- **Spacing:** `--obiter-space-*` numeric scale (exposed to Tailwind as `--spacing-*`).
- **Radius:** `--obiter-radius-sm | md | lg | xl | pill` (exposed as `--radius-*`).
- **Elevation:** `--obiter-shadow-sm | md | lg`, tinted to the background hue (no harsh black drop-shadows).
- **Type:** `--obiter-font-sans`, `--obiter-font-mono`, weight tokens `--obiter-font-weight-*`, and a `--obiter-text-*` size/line-height scale (exposed as Tailwind font-size utilities).

## 3. `@obiter/app-shell` public exports

### 3.1 `useCurrentUser()` — real `/api/me`

```ts
export function currentUserQueryOptions(): QueryOptions<MeResponse> // for route loaders
export function useCurrentUser(): UseSuspenseQueryResult<MeResponse> // for components
```

Backed by the real `GET /api/me`. Unauthenticated → the session/redirect layer sends the user to `/sign-in` (FR1). No demo me response exists on this path.

### 3.2 `apiFetch()` — auth + typed errors

```ts
export class ApiError extends Error {
  readonly code: ApiErrorCode // from @obiter/contracts apiErrorCodeSchema
  readonly status: number
  readonly requestId: string
}
export function apiFetch<T>(input: string, init?: RequestInit): Promise<T>
```

- Sends credentials (`credentials: 'include'`) so the better-auth session cookie travels.
- On non-2xx, parses the body through `apiErrorResponseSchema` and throws `ApiError` with the typed `code` (never a silent fallback).
- On 2xx, returns the parsed JSON as `T`.

### 3.3 Shared `QueryClient`

Provided at the app root via the TanStack Router context (already wired in `apps/web/src/integrations/tanstack-query/root-provider.ts`). `useCurrentUser()` and all shell queries run on that client. Feature UIs use `useQueryClient()` / `queryOptions` like the shell does — they do not create their own client.

### 3.4 Auth client

Sign-in is real, via `createAuthClient({ baseURL })` from `better-auth/client` with the matching `magicLink` client plugin. The shell exposes a `useAuth()` surface (`signIn`, `signOut`, `useSession`) that wraps it; feature UIs should not call better-auth directly. Email/password and magic-link are both supported (the API enables both).

## 4. Routes

- **Document detail (owned by this track):** `/matters/:matterId/documents/:documentId` — a **layout route** that renders document metadata + the redaction-runs region (list + "Create Redaction Run" CTA) and exposes a child `<Outlet />` for feature sub-routes.
- **Feature sub-route (owned by Redact PRD 2):** `redact/$runId` nests under the document detail layout route. The shell provides the parent chrome and the outlet; it does not implement the review screen.

In TanStack file-routing terms:

```
apps/web/src/routes/matters/$matterId/documents/$documentId.tsx   (layout: chrome + <Outlet/>)
apps/web/src/routes/matters/$matterId/documents/$documentId/redact/$runId.tsx   (Redact track)
```

## 5. Page scaffold

A layout primitive feature screens compose instead of building their own frame:

```ts
export function PageScaffold(props: {
  title: ReactNode
  eyebrow?: ReactNode
  actions?: ReactNode // slot for buttons/links in the header
  children: ReactNode // the content region
}): JSX.Element
```

Renders the consistent page heading (eyebrow + title + actions) and a content region that uses the token spacing scale. The Redact review screen renders inside `<PageScaffold>`.

## 6. App frame

`<AppShellLayout>` renders the sidebar + top bar + content region + mounted `<Toaster/>`, driven by real `useCurrentUser()` data. The sidebar preserves the **live / planned split** from `docs/current-product-scope.md`: planned entries (Drafting, Research, Redaction, Verification, Review Queue, Deadlines, Uploads, Evaluation, Developer API) stay visibly marked as planned and never look like active tools. User-facing copy uses **Obiter** throughout (FR6a).
