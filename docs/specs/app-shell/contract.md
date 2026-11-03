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
| Button      | `Button`                                                                                                                           | `variant: 'primary' \| 'secondary' \| 'ghost' \| 'danger'`, `size: 'sm' \| 'md' \| 'lg'`, `loading?: boolean`, `iconStart?: ReactNode`, `iconEnd?: ReactNode`, `nativeButton?: boolean` (pass `false` when `render` produces a link), plus native `<button>` props                                                                                                                                     |
| Input       | `Input`                                                                                                                            | `label?: ReactNode`, `helperText?: ReactNode`, `error?: ReactNode`, `invalid?: boolean`, plus native `<input>` props. Label above input, helper/error below (form rule).                                                                                                                                                                                                                               |
| Select      | `Select`                                                                                                                           | `options: { value: string; label: string }[]`, `label?: ReactNode`, `ariaLabel?: string` (name when no visible label sits beside it), `placeholder?: string`, `invalid?: boolean`, plus Base UI Select props                                                                                                                                                                                           |
| Dialog      | `Dialog`, `DialogTrigger`, `DialogContent`, `DialogTitle`, `DialogDescription`, `DialogClose`, `DialogCloseButton`, `DialogFooter` | Compound over Base UI Dialog. `DialogContent` takes `size?: 'sm' \| 'md' \| 'lg'` and `surface?: 'dialog' \| 'palette'` (the palette surface is top-anchored, padded by its own rows, and does not scroll as a whole).                                                                                                                                                                                 |
| Table       | `Table`, `THead`, `TBody`, `TR`, `TH`, `TD`                                                                                        | Styled semantic table elements (no headless lib). `TH` takes `align?: 'start' \| 'end'`.                                                                                                                                                                                                                                                                                                               |
| Tabs        | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`                                                                                   | Compound over Base UI Tabs. `value`/`defaultValue` controlled.                                                                                                                                                                                                                                                                                                                                         |
| Badge       | `Badge`                                                                                                                            | `tone: 'neutral' \| 'brand' \| 'info' \| 'success' \| 'warning' \| 'danger'`, children.                                                                                                                                                                                                                                                                                                                |
| Tooltip     | `Tooltip`, `TooltipTrigger`, `TooltipContent`                                                                                      | Compound over Base UI Tooltip.                                                                                                                                                                                                                                                                                                                                                                         |
| Menu        | `Menu`, `MenuTrigger`, `MenuContent`, `MenuItem`, `MenuSeparator`                                                                  | Compound over Base UI Menu. Roving focus, typeahead, and Escape-returns-focus come from Base UI; `MenuContent` takes `aria-label` for the menu's name.                                                                                                                                                                                                                                                 |
| Toast       | `Toaster`, `useToast`                                                                                                              | `<Toaster />` mounted once in the app frame. `useToast()` returns `toast({ title, description?, tone? })`. `tone: 'info' \| 'success' \| 'warning' \| 'danger'`. Self-contained (aria-live region + per-toast timer), not Base UI's toast manager — Base UI 1.0.0-rc.0 does not export the manager hooks as runtime values. The API is stable; only the internals change if it moves to Base UI later. |
| EmptyState  | `EmptyState`                                                                                                                       | `title: ReactNode`, `body?: ReactNode`, `icon?: ReactNode`, `action?: ReactNode`.                                                                                                                                                                                                                                                                                                                      |
| Skeleton    | `Skeleton`                                                                                                                         | `className?`. Static placeholder; sizing via className. Never implies progress after failure.                                                                                                                                                                                                                                                                                                          |
| ProgressBar | `ProgressBar`                                                                                                                      | `value?: number` (0–100; omit for indeterminate), `label?: ReactNode`, `helperText?: ReactNode`.                                                                                                                                                                                                                                                                                                       |

Additional presentation primitives (no domain state):

| Primitive     | Export                                                                            | Stable props                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Popover       | `Popover`, `PopoverTrigger`, `PopoverPortal`, `PopoverPositioner`, `PopoverPopup` | Base UI compound; non-modal by default. The popup is a hairline surface with no padding of its own — the caller sets it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Date picker   | `DatePicker`, `parseDdMmYyyy`, `formatDdMmYyyy`                                   | `label?: ReactNode`, `value: string` (ISO `YYYY-MM-DD`, `''` for empty), `onChange: (iso: string) => void`, `name?`, `className?`, `helperText?`. Typed and displayed as **dd/mm/yyyy** — the product is UK-facing and the browser's `<input type="date">` renders in the browser's locale — while the value crossing the boundary is ISO. Its calendar expands beneath the field rather than floating, so a filter column does not depend on the overlay graph; an unparseable entry is never pushed up as a value.                                                                           |
| List row      | `ListRow`                                                                         | Native div props, `leading?: ReactNode`, `trailing?: ReactNode`, `children`. Minimum 52px, 16px vertical padding; interaction belongs to the caller.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Side panel    | `SidePanel`                                                                       | `open: boolean`, `onOpenChange: (open: boolean) => void`, `title: ReactNode`, `action?: ReactNode`, `footer?: ReactNode`, `children`. A right-hand **modal** drawer built on Base UI Dialog, so it traps focus, closes on Escape and returns focus to its opener; the screen owns the open state and the close control in `action`. Use `DockedPanel` for a panel beside a page that must stay editable.                                                                                                                                                                                       |
| Docked panel  | `DockedPanel`                                                                     | `title: ReactNode`, `titleText?: string` (accessible name when the title is not a string), `onClose: () => void`, `action?: ReactNode`, `footer?: ReactNode`, `children`, `className?`. A right-hand `<aside>` docked beside the page: **not** modal, so the page stays visible and interactive — no backdrop, no focus trap, no portal, and no focus move on open. Escape handling and returning focus to the trigger belong to the screen that owns the trigger. Built on `DockedPanel`'s own markup rather than Base UI Dialog for exactly that reason; `SidePanel` stays the modal drawer. |
| Status dot    | `StatusDot`                                                                       | `children: string` (required visible label), `tone?: 'neutral' \| 'info' \| 'success' \| 'warning' \| 'danger'`, `className?`. Decorative dot never carries status alone.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Keyboard hint | `KeyboardHint`                                                                    | Native `kbd` props. Hidden inside a disabled control.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Card          | `Card`, `CardHead`, `CardBody`, `CardFoot`                                        | `Card`: native section props. `CardHead`: `title: ReactNode`, `titleId?`, `children?` (the card’s one action). `CardBody`/`CardFoot`: native div props. The one raised surface — a quiet surface step with no border or shadow, 24px inner padding — so screens stop repeating `rounded-lg bg-surface` and inventing their own heading and padding.                                                                                                                                                                                                                                            |

`DialogFooter` lays out the confirmation button row with 24px top space and 8px gaps. Controls use 6px radii, panels 10px; button sizes are 28/32/40px for sm/md/lg; the side panel is 380px wide (`--obiter-panel-width`) and shrinks to the viewport. Table cells retain native table layout, 16px vertical padding and rows at least 52px tall.

**Re-exports from `@obiter/ui` index:** the full set above, plus `cn` (the class-merge helper, which registers the semantic type scale so a size utility never drops the colour utility beside it).

**Link-styled actions.** `buttonClassName({ variant?, size?, className? })` returns the same visual classes for a navigation `Link`. A link stays a link to the browser and to assistive technology, instead of an anchor carrying `role="button"`; use `Button` for actions and `buttonClassName` on a `Link` for navigation.

## 2. Design tokens (`--obiter-*`)

Source of truth is `packages/ui/src/tokens.css`, consumed by Tailwind v4 via `@theme`. `@obiter/ui/tailwind.css` imports with `source(none)`, so every app declares its own source trees with `@source`: automatic detection scans whatever is on disk, and in the production image build (no `.gitignore`) the SSR pass rescanned the client pass's `dist/` output and named a stylesheet the client never emitted. **Token names are frozen; values may tune within the same theme.** Light is the token default (`:root`); dark is an explicit `[data-theme="dark"]` override. Both themes must render every screen correctly (FR6). Light is the default the product renders; the saved choice is light, dark, or **match system**, and matching the system follows `prefers-color-scheme` live (a media-query subscription, not an effect on derived state).

### 2.1 Color (semantic, defined per theme)

`--obiter-bg`, `--obiter-surface`, `--obiter-surface-raised`, `--obiter-border`, `--obiter-border-strong`, `--obiter-text`, `--obiter-text-muted`, `--obiter-text-subtle`, `--obiter-brand`, `--obiter-brand-fg` (text on brand), `--obiter-brand-pressed`, `--obiter-ring` (focus ring), `--obiter-overlay` (scrim).

The canvas is `--obiter-canvas`: the solid colour behind every pane, warm in light and darker than the panes in dark. Additional surfaces: `--obiter-inset` (charcoal document surround in dark), `--obiter-fill`, `--obiter-fill-hover`, `--obiter-paper`, `--obiter-paper-ink`, `--obiter-paper-muted`. Paper stays near-white in both themes. Interaction washes: `--obiter-hover`, `--obiter-brand-hover`, `--obiter-brand-soft`. Status tints: `--obiter-status-{info,success,warning,danger}-soft`.

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

- **Spacing:** `--obiter-space-{0,4,8,12,16,24,32,40,48,56}` in pixels, mapped to the corresponding Tailwind 4px-grid utilities. `--obiter-row-height` is 52px; `--obiter-control-{compact,default,large}` are 28/32/40px; `--obiter-panel-width` is 380px; the command palette's own surface uses `--obiter-palette-width` (36rem) and `--obiter-palette-offset` (its top inset).
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
- **Search query parameter:** `/search` accepts an optional `q`. Both routers validate it, the view runs that search on load, and both the command palette and the contents panel's stored recent searches link through it. A `/search` link without `q` still opens the empty search view.

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
  eyebrow?: ReactNode // quiet line above the title: Home's date
  description?: ReactNode // one line under the title: what the page is for
  actions?: ReactNode // slot for buttons/links in the header
  children: ReactNode // the content region
  className?: string
}): JSX.Element
```

Renders the approved page heading on the frame's content column: title at 28/600 with −0.02em tracking, description at body size on a 68ch measure, header actions vertically centred against the title and stacked below it when the pane is narrower than 1088px, 56px top and bottom padding, and a 40px gap between content sections. Content stops at 1216px; the gutter is 48px, and 32px when the pane is narrower than 896px. **Page layouts measure the pane, not the window.** The main content pane is a CSS container (`container-type: inline-size`, Tailwind `@container`), and page-level layout uses container variants — 896px (`@pane`) for the gutter, 1088px (`@pane-wide`) for side-by-side headers and two-column pages, 1248px (`@pane-full`) for a third column. Viewport breakpoints stay in the shell only (rail, bottom bar, overlay), because the space a page gets now depends on the sidebar, the contents panel and the right slot rather than on the window. The document workspace is excluded: its pane is not a query container, so the paper page keeps rendering exactly as it did. There is no uppercase label above the title. The optional eyebrow is quiet metadata (Home's date, `Monday 26 Oct 2026`), which the dashboard mock-up places above the greeting; it aligns on the same left edge as the title. Screens that are working surfaces rather than pages do not compose it: the Redact review screen carries its own document header (filename as the title, matter and review state beneath, actions at the end) on the frame's content gutter, because a reviewer works in it for the length of a run and the approved mock-up sets it at document scale. The Redact finalised screen is a page and does render inside `<PageScaffold>`.

## 6. App frame

`<AppShellLayout>` renders the workspace chrome the approved design describes, driven by real `useCurrentUser()` data:

- **Canvas and panes.** One solid canvas (`--obiter-canvas`: warm in light, darker than the panes in dark) with no grid or texture. Work areas sit in 14px-radius panes with a 1px hairline border on an 8px gutter. The sidebar or rail spans the full height of the window on the left, so the title bar is the top row of the right-hand column. Inside a section, the contents column and the page are **one** pane split by a hairline: the page on `--obiter-surface-raised`, the contents column one shade off it on `--obiter-surface`. The page in that pane is the layout container every page-level container query reads.
- **Sidebar, Home only.** 236px, drawn straight on the canvas rather than in a pane: the Obiter monogram with the organisation name level with the title bar, the modules Home, Matters, Search, Verify and Redact with their counts and alert dots, an Agent row that toggles the right slot and shows its shortcut, recent matters, then settings, theme and account at the foot. Research has no route, so no entry is invented for it. Counts come from queries the frame already runs and follow one rule (`packages/app-shell/src/open-work.ts`): active matters; open findings on each document's newest Verify run, plus one for a run that stopped; and redaction runs awaiting a decision. A module whose count has no cheap source shows no count.
- **Rail.** Every other section, and Home once the sidebar is collapsed: a 46px icon column with a labelled control per module and a tooltip naming the module and its shortcut. The count moves into the accessible name and the alert dot. An Agent control with the right-slot shortcut, settings, theme and account sit at the foot. At 767px and under the rail becomes a bottom bar.
- **Title bar**, 40px, on the canvas: the top row of the right-hand column, so its controls start exactly at the pane's left edge and move with the sidebar, with the contents panel and on narrow layouts, without a hard-coded offset. Left to right: the sidebar toggle, back and forward, the breadcrumb (`Organisation › Module › current`), and the search trigger at the far right with its ⌘K / Ctrl+K hint.
- **Command palette.** The search trigger opens one Base UI dialog over the whole shell, and so does ⌘K / Ctrl+K from anywhere, including a text field. It is the app's only app-search surface — there is no second dropdown. One input filters grouped rows: **Recent** (the recently opened document, then matters by last update) while the input is empty; **Go to** matters (name, reference), documents (name, matter), Verify runs and redaction runs, from the queries the app already runs; **Create** new matter, upload document, new blank document and start redaction, where upload and new blank document go into the open matter or ask which matter when none is open; **Actions** sidebar, agent panel, focus mode, theme and each Settings section, showing the shortcut the shared helper formats for the platform; and last **Search** — "Search case law and legislation for '…'" — which opens `/search?q=` with the typed query. Arrow keys move, Enter opens, ⌘/Ctrl+Enter opens a link row in a new tab, Escape closes and returns focus to whatever opened the palette. Rows that navigate are links, and matching is a local subsequence scorer, not a new dependency.
- **Matter switcher.** Inside a matter, the matter's crumb is a button rather than a link: a Base UI menu with a filter input at the top, up to eight recent matters with their references, the current matter marked with a brand dot, and All matters. Choosing one opens that matter's page, and Escape returns focus to the crumb.
- **Presence avatars.** The document header shows up to three initials avatars of the other people in the document next to the save state, each tooltip naming the person and whether they are viewing or editing, and `+N` beyond three. Names resolve from the organisation member list; the presence data is the existing collaboration sync. Nothing renders when you are alone. The toggle collapses the full sidebar on Home and hides or shows the contents panel everywhere else; one toggle for the sidebar and none for the right slot, which has its own Agent row instead, and no chevron inside the contents panel. Both choices are remembered per person (`obiter.sidebar.collapsed`, `obiter.contents.hidden`), read and written inside `try`/`catch` so a blocked storage API leaves the shell working. On desktop the row is the window drag region; its controls are no-drag, and on darwin the sidebar's own top-left is padded so the monogram clears the traffic lights.
- **Contents panel**, per section, joined to the page in the same pane with its header row on the 40px tab-strip line: Matters shows the Active/Archived/All filter the page applies plus recent matters; a matter shows its name and reference, its documents, and the Verify and Redact runs the API links to it; Verify and Redact group runs by status with attention first; Search lists the recent searches the search view already stores; Settings carries the section nav the page used to own. At 1023px and under it opens as an overlay from the same toggle, with a scrim, Escape, and focus returned to the toggle.
- **Matter tabs.** Inside a matter the top of the page column is a 40px tab strip (`matter-tab-strip.tsx`), level with the contents panel's header row and on `--obiter-surface`, with the active tab on `--obiter-surface-raised` and joined to the page below it. The route is the source of truth: the tab strip lists the matter overview, the documents open in this matter, the matter's Verify view (`/matters/:matterId/verify`) and its redaction runs (`/matters/:matterId/redact/:runId`), the current tab follows the URL, and a tab set is remembered per person per matter under `obiter.matterTabs.<userId>.<matterId>` (`matter-tabs.ts`), read and written inside `try`/`catch`, capped at 12 with the overview pinned and the oldest unpinned tab closing. A single click in the contents panel opens a preview tab (italic) that the next single click replaces; a double click on the tab, an edit to the document, or opening it from the + menu makes it permanent. Closing the current tab moves to its neighbour, and the last tab falls back to the overview. ⌘/Ctrl+1–9 select, ⌘/Ctrl+W closes and ⌘/Ctrl+Shift+T reopens the last closed tab **on desktop only** — browsers reserve those combinations for their own tabs, so the web build leaves them to the browser — and all three are ignored while the target is typing. At 767px and under the strip collapses to one “N open” switcher. The + menu creates a blank document, uploads documents, starts a Verify run or starts a redaction run through the flows that already exist, with single-letter accelerators shown while it is open. A document tab can be opened to the side, by dragging it to the pane's right edge or from its context menu, which records `?side=<tab>` in the URL; the side renders the paper read-only because the editor runs once per page, the divider can be dragged, and closing either side returns to one.
- **Right slot.** A docked 330px pane with the tabs Agent, Comments, Checks and History and one tab open at a time. A tab is listed only where the shell registry (`packages/app-shell/src/right-slot.tsx`) gives it content for the current section, so a route gains a tab by registering content rather than by adding chrome. Today only Agent has content. Open state and the chosen tab are remembered per person (`obiter.rightSlot.open`, `obiter.rightSlot.tab`). ⌘J / Ctrl+J toggles it, and so does the Agent row in the sidebar or rail, whose tooltip names the shortcut; at 767px and under it opens as a bottom sheet above the bottom bar.
- **Keyboard shortcuts** live in one module (`shell-shortcuts.tsx`) and are shown in tooltips with `KeyboardHint`: ⌘K or Ctrl+K opens the command palette, ⌘\ or Ctrl+\ toggles the sidebar, ⌘J or Ctrl+J the right slot, ⌘. or Ctrl+. focus mode, and `g` then `h`, `m`, `v`, `r` or `s` goes to Home, Matters, Verify, Redact and Search. Bare letters are ignored while the target is typing, and a key the editor or a dialog has already claimed (`defaultPrevented`) is left alone. The 800ms sequence window is the only timing.
- **Key labels and the primary modifier follow the platform** (`keyboard-platform.ts`). A Mac — the macOS desktop build, or a browser that reports `darwin` through `userAgentData`, `navigator.platform` or the user agent — shows ⌘, ⇧ and ⌥, and matches `metaKey`; every other platform shows Ctrl, Shift and Alt, and matches `ctrlKey`. The other modifier never triggers a shell shortcut. A Mac glyph sequence is written without separators (`⌘⇧Z`), elsewhere with `+` (`Ctrl+Shift+Z`). The server renders the non-Mac label and the browser corrects it on hydration.
- **Focus mode** hides the rail, the contents panel and the right slot, leaving the title bar and the page. ⌘. or Ctrl+. toggles it, Escape leaves it and returns focus to the title-bar toggle, and it is not remembered across reloads.
- **Account menu** is a Base UI Menu anchored under the avatar in the sidebar or rail foot: name, email and role, Account settings, Sign out. Enter/Space/ArrowDown open it and move focus into the list, arrow keys and Home/End move between items, Escape closes it and returns focus to the avatar, and Tab or a click outside closes it — all from Base UI, not reimplemented in the shell.
- **Settings sections and the matters status filter** live in shell state shared between the contents panel and the page (`shell-contents.tsx`), not in the URL, so every deep link still opens its route and the panel can drive the section the page shows.
- **Shell states**: a session-check loading screen that names what it is doing; an error surface that says what is preserved and offers Retry (the route reset); not-found and permission-denied surfaces, chosen from the typed `ApiError` code (a refusal is not an error to retry); and an offline banner shown only when the browser reports no connection, which claims only that already-open pages stay readable and that saving, uploads and search will fail until it returns.
- **Theme**: light is the default (`:root`), dark is `[data-theme="dark"]`. The stored choice is `light`, `dark` or `system` (`obiter.theme.v2` in `localStorage`), resolved to the rendered theme and applied from each document root before first paint so a dark preference does not flash light. `system` follows `prefers-color-scheme` live. `useAppTheme()` returns the theme being rendered and `useThemeChoice()` the stored choice; the sidebar or rail toggle stores an explicit theme, and Settings → Preferences offers all three. Auth routes follow the theme; they do not force night. There is no floating Agent widget.
- **Auth screens** (`/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`, `/invites/accept`) share one layout: the form in a 360px column on the left under the wordmark and the theme toggle, a sample clause in serif on paper with a summary of _Wood v Capita Insurance Services Ltd_ [2017] UKSC 24 at [10]–[12] on the right, and one footnote line per screen. Below 1025px the right-hand panel is dropped and the form sits in the middle of the column. The sample panel is product illustration, not state: the sheet is hidden from assistive technology. There is no session-expired screen: the product has no such state, so no route or view is invented for it.

`<Toaster/>` is mounted once in the frame. User-facing copy uses **Obiter** throughout (FR6a).

## 7. Invariants the shell must not break

- Organisation rename is owner-only, enforced by the API (`requireOwnerRole` plus an ownership check against the caller's own organisation). The client sends no organisation id in `PATCH /api/organisations`: an id in the request could only be meant to address another tenant.
- Draft state is per workspace. Each workspace builds its own `format` draft state rather than sharing `emptyFormatDrafts`, because `planDocumentSave` fills a copy in place; sharing the singleton would leak one workspace's paragraph styles into every other one.
- Tracked-change decisions and classification markings (Document type, Draft, Privileged, Without prejudice) each commit a new immutable version server-side, so both are refused while unsaved, blocked, stale or failed work would leave the base version behind.
- A refused find-and-replace batch never half-applies: the state is immutable, so a refusal returns its reason and changes nothing.
- Password change is verified server-side; the client-side checks are a courtesy the API repeats.
- A permission refusal is not an error to retry: the shell chooses its surface from the typed `ApiError` code.
- Verification findings and the legal checks are presented as things a person should look at, never as a verdict; honest uncertainty is surfaced, not passed silently.

## 8. Rules no unit test can reach

These rules were in code comments until the no-comments rule (29 Oct 2026). A unit test cannot observe them, so they are stated here; change them only deliberately.

- Restoring the last draft unmounts the save banner, so focus moves back to the document rather than being stranded on a removed node (`save-banners.tsx`).
- Focus returns to the caret's field at the only point a save can begin (`use-document-save.ts`).
- Save containment probes the most recent slots first (`use-document-save.ts`).
- While a save is still landing at the version boundary, Save stays visibly active rather than reading as inert (`use-document-save.ts`).
- The track-changes toggle is sent only while a flip is pending, so a stale tab cannot revert a collaborator's setting (`use-document-save.ts`).
- Find caches the folded text and its maps per text and fold flag, maps hits to spans in one forward walk, and searches only the story open for editing (`document-find.ts`).
- Local paint descriptors for pending redlines never enter model storage or review decisions (`document-pending-redlines.ts`).
- A range edit whose head is revision-only has no run to join into and is refused before paint shows it (`document-range-edits.ts`).
- For downloads, `filename*` is authoritative for a non-ASCII name and `filename` is the fallback (`document-workspace-downloads.ts`).
- A surface with no save leaves the platform's own Ctrl/Cmd+S unclaimed (`document-workspace-keys.ts`).
- Local recovery acknowledges a commit before any refetch can delay it (`document-workspace-mutations.ts`).
- A paired read is fetched only once both sides are picked (`document-workspace-queries.ts`).
