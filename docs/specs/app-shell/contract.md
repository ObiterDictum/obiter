# App Shell Component Contract

> **Freeze artifact.** This document defines the stable surface the Redact review UI ([PRD 2](../../prds/archive/redact-2-review-output.md)) and every future feature UI builds against. It freezes at the end of Milestone 1 of the [App Shell Rebuild PRD](../../prds/archive/app-shell-rebuild.md). After freeze, any change here requires updating **both** this contract and Redact PRD 2, and is owned by the plan owner.

The Redact review UI imports only from `@obiter/ui`, `@obiter/app-shell` public exports, and `@obiter/contracts`. It never imports shell-internal modules.

## Change process

1. A needed primitive/token/route is missing or wrong → raise it against this doc, not against shell internals.
2. Plan owner updates this contract **and** the corresponding section of Redact PRD 2 in the same change.
3. Both tracks move together. No silent contract drift.

---

## 1. `@obiter/ui` primitive exports

Headless behaviour and a11y come from Base UI (`@base-ui-components/react`); `@obiter/ui` owns the visual layer. All components consume the `--obiter-*` tokens (section 2) and never hardcode color/spacing/radius/type values. All accept a `className` override and compose with `cn()`. Icons are Phosphor (`@phosphor-icons/react`) only — enforced by ESLint `no-restricted-imports`.

| Primitive   | Export                                                                                                                             | Stable props                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Button      | `Button`                                                                                                                           | `variant: 'primary' \| 'secondary' \| 'ghost' \| 'danger'`, `size: 'sm' \| 'md' \| 'lg'`, `loading?: boolean`, `iconStart?: ReactNode`, `iconEnd?: ReactNode`, plus native `<button>` props                                                                                                                                                                                                            |
| Input       | `Input`                                                                                                                            | `label?: ReactNode`, `helperText?: ReactNode`, `error?: ReactNode`, `invalid?: boolean`, plus native `<input>` props. Label above input, helper/error below (form rule).                                                                                                                                                                                                                               |
| Select      | `Select`                                                                                                                           | `options: { value: string; label: string }[]`, `label?: ReactNode`, `placeholder?: string`, `invalid?: boolean`, plus Base UI Select props                                                                                                                                                                                                                                                             |
| Dialog      | `Dialog`, `DialogTrigger`, `DialogContent`, `DialogTitle`, `DialogDescription`, `DialogClose`, `DialogCloseButton`, `DialogFooter` | Compound over Base UI Dialog. `DialogContent` takes `size?: 'sm' \| 'md' \| 'lg'`.                                                                                                                                                                                                                                                                                                                     |
| Table       | `Table`, `THead`, `TBody`, `TR`, `TH`, `TD`                                                                                        | Styled semantic table elements (no headless lib). `TH` takes `align?: 'start' \| 'end'`.                                                                                                                                                                                                                                                                                                               |
| Tabs        | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`                                                                                   | Compound over Base UI Tabs. `value`/`defaultValue` controlled.                                                                                                                                                                                                                                                                                                                                         |
| Badge       | `Badge`                                                                                                                            | `tone: 'neutral' \| 'brand' \| 'info' \| 'success' \| 'warning' \| 'danger'`, children.                                                                                                                                                                                                                                                                                                                |
| Tooltip     | `Tooltip`, `TooltipTrigger`, `TooltipContent`                                                                                      | Compound over Base UI Tooltip.                                                                                                                                                                                                                                                                                                                                                                         |
| Toast       | `Toaster`, `useToast`                                                                                                              | `<Toaster />` mounted once in the app frame. `useToast()` returns `toast({ title, description?, tone? })`. `tone: 'info' \| 'success' \| 'warning' \| 'danger'`. Self-contained (aria-live region + per-toast timer), not Base UI's toast manager — Base UI 1.0.0-rc.0 does not export the manager hooks as runtime values. The API is stable; only the internals change if it moves to Base UI later. |
| EmptyState  | `EmptyState`                                                                                                                       | `title: ReactNode`, `body?: ReactNode`, `icon?: ReactNode`, `action?: ReactNode`.                                                                                                                                                                                                                                                                                                                      |
| Skeleton    | `Skeleton`                                                                                                                         | `className?`. Static placeholder; sizing via className. Never implies progress after failure.                                                                                                                                                                                                                                                                                                          |
| ProgressBar | `ProgressBar`                                                                                                                      | `value?: number` (0–100; omit for indeterminate), `label?: ReactNode`, `helperText?: ReactNode`.                                                                                                                                                                                                                                                                                                       |

Additional presentation primitives (no domain state):

| Primitive     | Export                                                          | Stable props                                                                                                                                                                                                                                                                                                             |
| ------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Popover       | `Popover`, `PopoverPortal`, `PopoverPositioner`, `PopoverPopup` | Base UI compound; non-modal by default. The popup is a hairline surface with no padding of its own — the caller sets it.                                                                                                                                                                                                 |
| List row      | `ListRow`                                                       | Native div props, `leading?: ReactNode`, `trailing?: ReactNode`, `children`. Minimum 52px, 16px vertical padding; interaction belongs to the caller.                                                                                                                                                                     |
| Side panel    | `SidePanel`                                                     | `open: boolean`, `onOpenChange: (open: boolean) => void`, `title: ReactNode`, `action?: ReactNode`, `footer?: ReactNode`, `children`. A right-hand panel built on Base UI Dialog, so it traps focus, closes on Escape and returns focus to its opener; the screen owns the open state and the close control in `action`. |
| Status dot    | `StatusDot`                                                     | `children: string` (required visible label), `tone?: 'neutral' \| 'info' \| 'success' \| 'warning' \| 'danger'`, `className?`. Decorative dot never carries status alone.                                                                                                                                                |
| Keyboard hint | `KeyboardHint`                                                  | Native `kbd` props. Hidden inside a disabled control.                                                                                                                                                                                                                                                                    |

`DialogFooter` lays out the confirmation button row with 24px top space and 8px gaps. Controls use 6px radii, panels 10px; button sizes are 28/32/40px for sm/md/lg; the side panel is 380px wide (`--obiter-panel-width`) and shrinks to the viewport. Table cells retain native table layout, 16px vertical padding and rows at least 52px tall.

**Re-exports from `@obiter/ui` index:** the full set above, plus `cn` (the class-merge helper, which registers the semantic type scale so a size utility never drops the colour utility beside it).

## 2. Design tokens (`--obiter-*`)

Source of truth is `packages/ui/src/tokens.css`, consumed by Tailwind v4 via `@theme`. **Token names are frozen; values may tune within the same theme.** Light is the token default (`:root`); dark is an explicit `[data-theme="dark"]` override. Both themes must render every screen correctly (FR6). The current shell still seeds and persists dark, and auth routes still force dark; switching the application default and removing the auth override are deferred to redesign Stage 2 because they span the frame, theme hook and document roots.

### 2.1 Color (semantic, defined per theme)

`--obiter-bg`, `--obiter-surface`, `--obiter-surface-raised`, `--obiter-border`, `--obiter-border-strong`, `--obiter-text`, `--obiter-text-muted`, `--obiter-text-subtle`, `--obiter-brand`, `--obiter-brand-fg` (text on brand), `--obiter-brand-pressed`, `--obiter-ring` (focus ring), `--obiter-overlay` (scrim).

Additional surfaces: `--obiter-inset` (charcoal document surround in dark), `--obiter-fill`, `--obiter-fill-hover`, `--obiter-paper`, `--obiter-paper-ink`, `--obiter-paper-muted`. Paper stays near-white in both themes. Interaction washes: `--obiter-hover`, `--obiter-brand-hover`, `--obiter-brand-soft`. Status tints: `--obiter-status-{info,success,warning,danger}-soft`.

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

- **Spacing:** `--obiter-space-{0,4,8,12,16,24,32,40,48,56}` in pixels, mapped to the corresponding Tailwind 4px-grid utilities. `--obiter-row-height` is 52px; `--obiter-control-{compact,default,large}` are 28/32/40px; `--obiter-panel-width` is 380px.
- **Radius:** `--obiter-radius-sm | md | lg | xl | pill` (exposed as `--radius-*`).
- **Elevation:** `--obiter-shadow-sm | md | lg`, tinted to the background hue (no harsh black drop-shadows).
- **Type:** `--obiter-font-sans`, `--obiter-font-mono`, `--obiter-font-serif` (paper and auth display panel only), and weight tokens `--obiter-font-weight-*`. Six `--obiter-text-{page,section,item,body,meta,caption}` levels, each with `-line-height`, `-weight`, `-tracking`: 28/600/1.2, 18/600/1.3, 14/500/1.4, 14/400/1.55, 13/400/1.45 muted, 12/400/1.4 subtle. Only page/section titles have tracking (−0.02/−0.01em). Exposed as `text-page` through `text-caption`; semantic colour remains explicit.

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

`<AppShellLayout>` renders night workspace chrome: top mode bar (Home + Search / Matters / Verify / Redact), content-column app search, persistent icon mode rail (collapsed brand strip on Home; mode shortcuts with hover-expand on other modes), content region, floating Agent widget, and mounted `<Toaster/>`, driven by real `useCurrentUser()` data. Verify is a live surface over real verification runs; the Agent widget remains an honest “in development” surface — not a fake tool. User-facing copy uses **Obiter** throughout (FR6a).
