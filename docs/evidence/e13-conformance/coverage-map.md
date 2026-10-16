# E13 editor conformance — coverage map

Which proof layer covers each E13 requirement. "Unit" is a pure-function test
under `packages/ooxml`/`packages/app-shell`; "component" is a jsdom +
testing-library render of the real workspace; "e2e" is the Playwright journey
on an isolated lane — the E13 specs are split by family under
`apps/web/e2e/document-e13{,-accessibility,-drafts,-save-state}.spec.ts`
sharing `e13-support.ts`, so "e13 spec" below names the relevant family
file; "external" is a step no automation in this environment can perform,
recorded rather than claimed.

## Layout and printing

| Requirement                                                           | Layer                  | Where                                                                                                                                                      |
| --------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web layout paints one continuous chromeless flow                      | unit + component + e2e | `document-page-engine.ts` web flow tests; `e13-review-controls.test.tsx`; `document-e13.spec.ts` view test                                                 |
| Print layout paginates into paper sheets                              | unit + component + e2e | page-engine print tests; `docx-workspace-print.test.tsx`; `document-print.spec.ts`                                                                         |
| `@page` is the stored section page box, never the web flow frame      | component + e2e        | `docx-workspace-print.test.tsx` (asserts the exact rule while web view is painted); `document-print.spec.ts` (PDF page dimensions read back through unpdf) |
| Printing repaginates from any entry point and restores the view       | component              | `docx-workspace-print.test.tsx` (ribbon path, `beforeprint`/`afterprint` path, abort path)                                                                 |
| Print output is the painted state, drafts included, and saves nothing | component + e2e        | `docx-workspace-print.test.tsx`; `document-print.spec.ts` (PDF text)                                                                                       |

## View controls

| Requirement                                          | Layer           | Where                                                                                   |
| ---------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------- |
| Ruler bound to the page measure                      | component + e2e | `e13-review-controls.test.tsx`; `document-e13.spec.ts`                                  |
| Navigation pane lists headings and moves the caret   | component + e2e | `e13-review-controls.test.tsx`; `document-e13.spec.ts`                                  |
| Spelling toggles the browser's local dictionary only | component + e2e | `e13-review-controls.test.tsx`; `document-e13.spec.ts` (the notice states the boundary) |
| Zoom paints a real transform and resets              | e2e             | `document-e13.spec.ts` view test                                                        |

## PDF viewer

| Requirement                                                | Layer           | Where                                                 |
| ---------------------------------------------------------- | --------------- | ----------------------------------------------------- |
| Only the current page's spans mount                        | component + e2e | `pdf-view.test.tsx` sentinels; `document-e13.spec.ts` |
| Prev/next bounds, page jump, refused jump resets the field | component + e2e | `pdf-view.test.tsx`; `document-e13.spec.ts`           |
| Zoom rescales the painted page; download names the file    | e2e             | `document-e13.spec.ts`                                |

## Accessibility

| Requirement                                              | Layer     | Where                                                                                                                           |
| -------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Keyboard focus stays visibly outlined                    | e2e       | `document-e13-accessibility.spec.ts` reduced-motion/forced-colours test (computed outline width)                                |
| Reduced motion and forced colours keep the ribbon usable | e2e       | `document-e13-accessibility.spec.ts` (emulated media)                                                                           |
| Tablet width has no horizontal overflow                  | e2e       | `document-e13-accessibility.spec.ts` tablet test                                                                                |
| Coarse-pointer targets compute to at least 44px          | e2e       | `document-e13-accessibility.spec.ts` `coarse pointer` describe (`isMobile`/`hasTouch` report `pointer: coarse`; boxes measured) |
| 200% zoom keeps controls reachable and sized             | e2e       | same test at a ~410px viewport — a zoom-scale proxy; Playwright cannot drive real browser zoom                                  |
| Outline entries keep heading semantics                   | component | `e13-review-controls.test.tsx` (indent is presentational; no `aria-level` on a plain `li`)                                      |

## Draft safety

| Requirement                                                                           | Layer      | Where                                                             |
| ------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------- |
| Multiple abandoned drafts surface a recoverable banner with restore and discard exits | e2e        | `document-e13-drafts.spec.ts` recoverable-draft test              |
| Unresolvable lineage blocks saves until reload                                        | e2e + unit | `document-e13-save-state.spec.ts` lineage test; draft-store tests |
| Held and blocked changes surface their own dialogs                                    | e2e        | `document-e13-drafts.spec.ts` held/blocked tests                  |
| A sibling tab's save surfaces the conflict reload                                     | e2e        | `document-e13-save-state.spec.ts` conflict test                   |

## Gates and external acceptance

| Requirement                                                   | Layer           | Where                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bundle budgets are truthful release gates                     | build           | `scripts/perf/bundle-budget.mjs`, `scripts/perf/desktop-budget.mjs` — ceilings are never raised to fit a feature                                                                                                                                                        |
| Word round-trip harness writes only to an isolated lane       | unit + runtime  | `scripts/word-roundtrip/word-roundtrip.test.ts`; `lane.ts` reuses `verifyServedCheckout`                                                                                                                                                                                |
| A Word-saved DOCX carries producer evidence                   | unit + external | `inspectWordOutput` rejects non-Word producers, byte-identical copies and unrelated documents; a Word-named `docProps/app.xml` earns `manual-reported` (`externally-unverified`), and `wordAcceptance` stays `not-checked` until recorded external Word evidence exists |
| Word actually opens, displays and saves the file correctly    | external        | `scripts/word-roundtrip` operator step — Word and LibreOffice are unavailable in this environment                                                                                                                                                                       |
| Print output matches every browser/driver/printer combination | external        | not automatable: Chromium `page.pdf()` is the standing proxy and its boundary is recorded in `docs/architecture.md`                                                                                                                                                     |
