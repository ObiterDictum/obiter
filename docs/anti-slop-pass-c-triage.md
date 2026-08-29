# Anti-slop Pass C — triage of remaining generic rules

**Branch:** `chore/anti-slop-pass-c-triage` (report-only, enables nothing)
**Base:** `dev` @ 4f872fc (stage 1 wiring, PR #112)
**Pass A:** `chore/anti-slop-pass-a` — `no-object-parameters`, `no-unknown-type-aliases`, `no-widen-then-assert` (0 violations, landed)
**Pass B:** `chore/anti-slop-pass-b` — `no-reflect-get` (2), `no-unknown-returns` (11) fixed at boundary
**This pass:** samples 5 real violations per remaining generic rule, judges _genuine defect_ vs _rule vs deliberate choice_, recommends adoption.

Skipped `require-safety-comment-for-type-assertion` (420/426) — own project per brief.

Counts below measured on Pass B tip (`oxlint` with one extra rule enabled at a time, 465 files). Totals shift ±5 after Pass B formatting, otherwise stable.

---

## 1. `no-chained-type-assertions` — 52 violations

**Samples**

1. `services/api/src/redaction-redetect.test.ts:51` — `{ query: vi.fn() } as unknown as Pool` (test helper casting `Pool` from plain object)
2. `services/api/src/routes/documents-upload.test.ts:104` — `params?.[4] as string | null` followed by `as unknown as Pool` pool cast (same file, `pool()` helper)
3. `services/api/src/document-extraction.ts:334` — `(await import('unpdf/pdfjs')) as unknown as { OPS?: PdfOps }` (pdf.js untyped import)
4. `services/api/src/routes/document-access.test.ts:122` — `documentId as string` chain? (`as unknown as string` on route param)
5. `services/api/src/document-export.test-support.ts:91` — `parameters as string[]` inside `as unknown as` chain for test query capture

**Judgement:** 4/5 are `as unknown as T` — the canonical escape hatch for untyped test doubles and untyped third-party imports (`unpdf`, `pg Pool`). The assertion chain _does_ discard evidence, but it is **deliberate**: the alternative is a faithful typed double or a generated `OPS` type, which we do not have. One sample is a narrow `string[]` destructure that could be typed via tuple inference.

**Recommendation:** **Worth adopting with a narrow allowance.** Genuine defect when chaining `as A as B` to coerce domain types; noise when the chain is `as unknown as T` for test/missing-type boundaries. If adopted, keep `as unknown as T` behind a comment or limit to `*.test.ts`/`unpdf` shims.

---

## 2. `no-conditional-empty-object-spread` — 61 violations

**Samples**

1. `packages/legal-source-provider/src/moj-provider.ts:370` — `...(court ? { court } : {})`
2. `services/api/src/authz.ts:54` — `...(organisationId ? { organisationId } : {})`
3. `services/api/src/authz.ts:72` — `...(matterId ? { matterId } : {})`
4. `packages/app-shell/src/api.ts:52` — `...(signal ? { signal } : {})`
5. `packages/app-shell/src/api.ts:53` — `...(cache ? { cache } : {})`

**Judgement:** All 5 are the idiomatic `...(cond ? {k: v} : {})` for optional request fields. The rule prefers imperative `if` + assignment. This is **style, not defect** — the spread never mis-routes a missing property, and the empty object is a well-understood pattern.

**Recommendation:** **Do not adopt strictly.** 60+ fixes for no bug. If adopted, would churn `moj-provider`, `authz`, `api` for readability only. Consider `no-restricted-syntax` if the spread ever actually hides a required field.

---

## 3. `no-known-value-widening` — 48 violations

**Samples**

1. `packages/ui/src/toast.tsx:41` — `const toneAccent: Record<string, string> = { ... }`
2. `packages/ui/src/badge.tsx:13` — `const toneClasses: Record<string, string> = { ... }`
3. `packages/search-client/src/index.ts:508` — `const searchOptions: Record<string, unknown> = { ... }`
4. `packages/app-shell/src/document-page-margin.ts:122` — `function marginBandHeights(): Record<string, number>`
5. `packages/ui/src/button.tsx:24` — `const variantClasses: Record<string, string> = { ... }`

**Judgement:** All are UI style maps or search option builders widened to `Record<..., string>` before being indexed by a variant key. The precise literal type is known; `satisfies Record<...>` would preserve evidence without widening. **Deliberate shortcut**, not a correctness bug — the widening never loses a required key, it just opts out of exhaustiveness.

**Recommendation:** **Low value.** Adopting would add `satisfies` in 48 places for stricter variant exhaustiveness, but no current bug. Worth a follow-up lint if we want exhaustive style maps, otherwise skip.

---

## 4. `no-module-mocking` — 57 violations

**Samples**

1. `packages/app-shell/src/documents.test.ts:19` — `vi.mock('./matters')`
2. `packages/app-shell/src/home.test.tsx:25,30,38,46` — `vi.mock('./api')`, `vi.mock('./current-user')` etc. (4 consecutive mocks)
3. `packages/…` — 52 further `vi.mock` / `vi.doMock` across `services/api`, `apps/desktop`

**What the rule objects to:** Any `vi.mock`, `vi.doMock`, `vi.mocked` that replaces a module import with a fake. The prescribed fix is dependency injection through a real interface.

**Project context:** This overlaps the live design question about **test-only DI seams** (`DocumentExtractionDependencies`, `DetectorDependencies`). Those seams were introduced precisely to avoid `vi.mock` for the document-extraction and detection layers. The rule therefore **agrees with the direction**: it would push the remaining `vi.mock` sites (mostly `app-shell` route loaders and `search-client`) toward the same seam pattern.

**Judgement:** **Genuine trade-off, not a clear defect.** 57 mocks are **deliberate** — mostly for `app-shell`/`api` boundary tests where a seam would be heavier than a mock. Removing them would require 57 new interfaces/faithful doubles; keeping them keeps tests simple but couples them to module paths.

**Recommendation:** **Worth adopting only if we commit to seams.** Value depends on the DI decision. If we keep seams for `DocumentExtraction`/`Detector`, enabling this rule would ratchet the codebase toward seams elsewhere — worthwhile but high churn. If seams are rejected, the rule is pure churn. **Hold pending that decision; do not enable now.** No code change in this pass per brief.

---

## 5. `no-runtime-typeof` — 293 violations

**Samples**

1. `services/api/src/database.ts:443` — `typeof value === 'string'` in DB row parsing
2. `packages/app-shell/src/document-page-flow.ts:207` — `typeof block.type === 'string'`
3. `packages/app-shell/src/document-page-flow.ts:208` — `typeof block.text === 'string'`
4. `services/api/src/redaction-database.ts:110` — `typeof value !== 'string'` in `json()` guard
5. `services/api/src/redaction-database.ts:124` — `typeof span !== 'object'` in `parseSpans`

**Judgement:** All are **defensive narrowing after I/O** — JSON from DB, pdf.js `str` field, document blocks. The rule wants `schema.parse()` at the boundary instead of `typeof` branching. **Mix:** some are **deliberate and correct** (unknown-error guards, JSON column checks that immediately `throw`), some are **genuine late narrowing** that could be replaced by a Zod schema one level earlier (DB row mappers).

**Recommendation:** **Not worth adopting as an error.** 293 is the largest bucket and mostly not defects — it would ban `typeof error === 'string'` etc. A narrower version scoped to `src/routes` request validation might be worth, but the generic rule is too broad. Consider per-package `no-restricted-syntax` for request handlers only.

---

## 6. `no-unsafe-dictionary-type` — 83 violations

**Samples**

1. `services/api/src/routes/legal-search/__tests__/proxy-routes.test.ts:363` — `Record<string, unknown>` for proxy response
2. same: `:956`, `:1933` — same pattern in other proxy tests
3. `services/api/src/redaction-database.test.ts:648` — `Record<string, unknown>` for `metadata_json` mock
4. `services/api/src/redaction-database.test.ts:671` — `Record<string, unknown>` for audit-log details

**Judgement:** **Deliberate in tests, borderline in prod.** `Record<string, unknown>` is used for **unvalidated external JSON** (Meilisearch hits, `metadata_json`). The rule wants an owner-derived value type. In prod this would be a genuine improvement (parse to `LegalAuthority`); in tests the dictionary is a minimal fixture where a specific type would be ceremony.

**Recommendation:** **Worth adopting for `services/api/src` only.** ~30 prod dictionaries could be tightened to `LegalAuthority`/`AuditDetails`; ~50 test dictionaries are deliberate. Enabling globally would force 83 typed fixtures. A scoped enable (prod only) would be worthwhile.

---

## 7. `no-shape-in-symbol-names` — 67 violations

**Samples**

1. `packages/contracts/src/document-collaboration.ts:40` — `shape` field in `CollaborationShape`
2. `:41` — `shapeId`
3. `:42` — `shapeType`
4. `:67` — `shapeVersion`
5. `:70` — `shapeKind`

**Judgement:** The rule bans the word `shape` as "describes structure, not ownership." In `document-collaboration` **`shape` is the domain term** (Yjs/CRDT shape for collaborative editing). This is **rule vs deliberate domain language**.

**Recommendation:** **Do not adopt.** Would rename domain vocabulary across `contracts` for no correctness gain. If the rule is enabled, this file would need a blanket exemption.

---

## 8. `no-unknown-parameters` — 165 violations

**Samples**

1. `packages/app-shell/src/api.desktop-auth.test.ts:20` — `body: unknown` in test `fetch` stub
2. `packages/redact-ui/src/pdf-review-document.tsx:115` — `catch (error: unknown)`
3. `services/api/src/routes/comments.test-support.ts:297` — `body: unknown` in test harness
4. `services/api/src/routes/comments.test-support.ts:309` — `body: unknown` in same file
5. `packages/app-shell/src/views/matter-detail.tsx:185` — `catch (error: unknown)`

**Judgement:** **Mostly deliberate.** `catch (error: unknown)` is the **recommended** TypeScript pattern (since TS 4.4, `useUnknownInCatchVariables`). `body: unknown` in test stubs is a minimal `fetch` mock where the body is immediately `JSON.parse`ed. Flagging `unknown` params here would push them toward `any` or a specific domain type that the test does not have.

**Recommendation:** **Do not adopt.** Would forbid the idiomatic `catch (error: unknown)` and many test doubles. A scoped rule for `src/routes` handler signatures (where `unknown` body _is_ a defect) could be useful, but the generic rule is inverted — it penalizes the correct pattern.

---

## Summary — what to land next

| Rule                                 | Total | Genuine vs deliberate                                                           | Verdict                                  |
| ------------------------------------ | ----- | ------------------------------------------------------------------------------- | ---------------------------------------- |
| `no-chained-type-assertions`         | 52    | `as unknown as` for tests/missing types — deliberate; raw `as A as B` — genuine | **Adopt with `as unknown as` allowance** |
| `no-conditional-empty-object-spread` | 61    | Idiomatic optional-field spread — deliberate                                    | **Skip**                                 |
| `no-known-value-widening`            | 48    | Style-map widening — deliberate shortcut                                        | **Skip** (or `satisfies` cleanup later)  |
| `no-module-mocking`                  | 57    | Overlaps DI-seam decision — deliberate trade-off                                | **Hold pending DI decision**             |
| `no-runtime-typeof`                  | 293   | Defensive guards — mostly deliberate, some late narrowing                       | **Skip as generic error**                |
| `no-unsafe-dictionary-type`          | 83    | Prod generic JSON — partly genuine; test fixtures — deliberate                  | **Adopt prod-only if ever**              |
| `no-shape-in-symbol-names`           | 67    | Domain term `shape` — deliberate                                                | **Skip**                                 |
| `no-unknown-parameters`              | 165   | `catch unknown` / test stubs — deliberate                                       | **Skip**                                 |

**Overall:** None of the eight justifies a bulk 50-300 fix PR on its own. The only one that looks like a net win with limited churn is `no-chained-type-assertions` (≈10 genuine `as A as B` fixes if `as unknown as` is allowlisted). `no-unsafe-dictionary-type` could be scoped to `services/api/src` for ~30 real improvements. `no-module-mocking` is worth only if the team keeps the DI seams.

_Skipped `require-safety-comment-for-type-assertion` (426) is its own project per brief and not assessed here._
