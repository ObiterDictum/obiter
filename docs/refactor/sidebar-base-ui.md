# Sidebar Base UI Refactor Plan

## Goal

Refactor the finished sidebar without changing how it looks or behaves.

The refactor should:

- keep the current visual result pixel-stable
- move repeated sidebar primitives into Ormont-owned components
- use Base UI for accessible headless behavior where it fits
- keep Heroicons as the icon system
- reduce render/layout work during hover, collapse, resize, and menu interactions

## Non-Goals

- Do not redesign the sidebar.
- Do not rename navigation concepts.
- Do not change spacing, typography, colors, hover states, or animation timing unless a bug requires it.
- Do not introduce a generic external visual theme.
- Do not replace Heroicons.

## Base UI Scope

Use `@base-ui/react` for behavior primitives, not styling.

Recommended mappings:

- User profile menu: Base UI `Menu` or `Popover`
- Collapsible navigation groups: Base UI `Collapsible`
- Last active matter card details: Base UI `Collapsible`
- Current matter and recent research sections: Base UI `Collapsible`
- Search field shell: Ormont-owned wrapper around native input, optionally Base UI `Field`
- Future tooltips or floating affordances: Base UI `Tooltip`

Avoid using Base UI where a plain anchor, button, or static list is clearer.

## Component Boundaries

Keep sidebar product components in `packages/app-shell/src/sidebar`.

Introduce local primitives under:

`packages/app-shell/src/sidebar/components`

Suggested components:

- `SidebarIcon`
- `SidebarIconButton`
- `SidebarRow`
- `SidebarSection`
- `SidebarDisclosure`
- `SidebarStatusDot`
- `SidebarBadge`
- `SidebarMenu`
- `SidebarSearchField`

These are Ormont components. Base UI should stay behind these wrappers where possible so the product code does not become coupled to third-party markup details.

## Styling Strategy

Keep the current class names during the first pass so the visual output stays stable.

Then split `packages/app-shell/src/styles.css` into sidebar-focused sections only after behavior parity is confirmed.

Target split:

- app shell layout
- sidebar layout
- sidebar rows and icons
- sidebar cards and search
- sidebar user menu
- route/page styles

Do not combine visual refactor with behavior refactor in the same commit.

## Performance Targets

- Keep hover effects to color, opacity, and background changes.
- Avoid layout-affecting hover changes.
- Avoid animating width/height except where sidebar collapse explicitly requires it.
- Keep static navigation definitions outside render functions.
- Memoize repeated row components only where props are stable and it reduces rerender noise.
- Prefer CSS state selectors and Base UI data attributes over extra React state where practical.

## Visual Regression Checklist

Before editing, capture the current sidebar in these states:

- desktop default at `/workspace`
- narrow window default
- content sidebar collapsed
- user menu open
- each collapsible section opened and closed
- hover state on a primary navigation row
- hover state on current matter
- hover state on recent research

The refactor is acceptable only if these states look the same after the change.

## Suggested PR Split

1. Add Base UI dependency and Ormont sidebar primitive wrappers.
2. Convert user menu and collapsible sections to Base UI behind the wrappers.
3. Extract repeated row/icon/badge primitives without visual changes.
4. Split sidebar CSS after parity is confirmed.
5. Apply targeted performance cleanup and add focused tests.

Each PR should pass:

- `pnpm --filter @ormont/app-shell typecheck`
- `pnpm --filter @ormont/app-shell test`
- `pnpm --filter @ormont/desktop typecheck`
- `pnpm --filter @ormont/web build`
