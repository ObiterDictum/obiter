# Sidebar Base UI Refactor Plan

## Branch Goal

Use this branch to make the finished sidebar easier to maintain by moving behavior onto Base UI primitives and moving repeated sidebar structure into Ormont-owned components, without intentionally changing the visual design.

This branch is successful when:

- the sidebar still looks and behaves like the current production sidebar
- Base UI owns menu/disclosure behavior where it improves accessibility
- Ormont-owned wrappers keep Base UI details out of product sections where practical
- repeated sidebar row, icon, menu, and disclosure markup is reduced
- the file layout makes ownership obvious to a human reviewer
- the branch passes app-shell, desktop, and web verification
- remaining visual/manual QA gaps are explicit before merge

## Current Refactor Goals

1. **Add Base UI deliberately**
   - Add `@base-ui-components/react` only to `@ormont/app-shell`.
   - Use it for behavior primitives, not styling.
   - Do not introduce another visual system or replace Heroicons.

2. **Preserve visual parity**
   - Keep existing CSS class hooks during the behavior refactor.
   - Do not change spacing, typography, colors, hover states, or animation timing unless a bug requires it.
   - Defer CSS splitting until behavior parity has been manually checked.

3. **Clarify sidebar ownership**
   - Keep `OrmontSidebar.tsx` as composition only.
   - Put reusable sidebar primitives and Base UI wrappers in `components/`.
   - Put product-specific sidebar areas in `sections/`.
   - Put stable nav labels, routes, badges, and icon mappings in `data/`.

4. **Improve accessible behavior**
   - Use Base UI `Collapsible` for workspace details, navigation groups, current matter, and recent research.
   - Use Base UI `Menu` for the user profile menu.
   - Keep plain links/buttons where a Base UI primitive adds no value.

5. **Keep the review surface small**
   - Avoid CSS rewrites in this branch unless required for parity.
   - Avoid generic component abstractions that hide simple product markup.
   - Capture follow-ups rather than expanding the refactor scope.

## Non-Goals

- Do not redesign the sidebar.
- Do not rename navigation concepts.
- Do not change spacing, typography, colors, hover states, or animation timing unless a bug requires it.
- Do not introduce a generic external visual theme.
- Do not replace Heroicons.

## Base UI Scope

Use `@base-ui-components/react` for behavior primitives, not styling.

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

Use this target structure:

```text
packages/app-shell/src/sidebar/
  OrmontSidebar.tsx
  types.ts

  components/
    SidebarBadge.tsx
    SidebarDisclosure.tsx
    SidebarIcon.tsx
    SidebarIconButton.tsx
    SidebarMenu.tsx
    SidebarRow.tsx
    SidebarSearchField.tsx
    SidebarSection.tsx
    SidebarStatusDot.tsx

  sections/
    SidebarNavigation.tsx
    SidebarWorkspaceCard.tsx
    SidebarMatterPanel.tsx
    SidebarRecentResearch.tsx
    SidebarUserCard.tsx

  data/
    navigationItems.ts
```

Ownership rules:

- `OrmontSidebar.tsx` should compose the sidebar, not implement row-level markup.
- `components/` holds reusable sidebar primitives and Base UI wrappers.
- `sections/` holds product-specific sidebar areas.
- `data/` holds stable labels, routes, icon mappings, groups, and status-dot metadata.
- Give a component its own file when it has state, behavior, repeated markup, or wraps Base UI.
- Keep one-off two-line JSX local unless extracting it makes the parent easier to read.
- Avoid one giant barrel file during the refactor; explicit imports are easier to review while files are moving.

## Code Quality Bar

The refactor should make the code feel deliberately written, not generated.

Prefer:

- small components with one clear responsibility
- boring, precise names that match the product language
- explicit props over loosely shaped config objects when the call site is clearer
- typed navigation data that is easy to scan and change
- local helpers only when they remove real repetition
- straightforward JSX over clever render factories
- CSS class names that describe the product surface, not implementation tricks
- comments only where they explain a non-obvious constraint or design decision

Avoid:

- generic component names such as `Item`, `Block`, `Panel`, or `Widget` where product names exist
- abstraction layers that hide simple markup
- large mixed-purpose components that own data, rendering, animation, and state at once
- deeply nested object configs that are harder to read than JSX
- utility functions that exist only to make the code look DRY
- broad `Record<string, unknown>` style types
- visual constants scattered across components instead of CSS/tokens
- comments that narrate the code

Target shape:

- `OrmontSidebar` should read as composition, not implementation detail.
- `SidebarNavigation` should own navigation structure and grouping, but not low-level row markup.
- `SidebarUserCard`, `SidebarWorkspaceCard`, `SidebarMatterPanel`, and `SidebarRecentResearch` should delegate repeated row/menu/disclosure behavior to shared sidebar primitives.
- Any Base UI integration should be isolated enough that replacing it later would not require rewriting product components.

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

## Branch Checklist

Complete these in order:

1. Add Base UI dependency to `@ormont/app-shell`.
2. Convert collapsible sidebar areas to Base UI `Collapsible` while preserving class hooks.
3. Convert the user menu to Base UI `Menu` while preserving the existing menu shell styling.
4. Extract repeated icon/disclosure/navigation data into Ormont-owned sidebar files.
5. Run automated verification.
6. Perform manual visual and keyboard QA.
7. Record any follow-up work instead of widening this branch.

Required automated verification:

- `pnpm --filter @ormont/app-shell typecheck`
- `pnpm --filter @ormont/app-shell test`
- `pnpm --filter @ormont/desktop typecheck`
- `pnpm --filter @ormont/web build`
- `git diff --check`

## Follow-Ups After This Branch

- Split sidebar CSS only after visual parity is confirmed.
- Add focused interaction tests if Base UI behavior exposes stable testing hooks.
- Revisit `@base-ui-components/react` versioning before building more UI primitives on top of the release-candidate package.
