# Dead code detection baseline

The first report with the tuned configuration contains 18 candidates: one unused
development dependency, 14 unused exports and three unused exported types.
These are candidates for review before removal.

Run `bun run deadcode` from the repository root. The CI report step allows a
nonzero exit so findings remain visible alongside the required checks.

Knip reads workspace manifests and keeps their public entry points, including
subpath exports. The Electron Vite plugin discovers the main, preload and
renderer entries. The web workspace lists the file-based routes directly so
detection works before the route tree is generated. The PDF worker is an asset
resolved from `pdfjs-dist` through `new URL(..., import.meta.url)`.

The Playwright entry globs cover the suites and the two runners configured by
Playwright without loading the configuration's runtime port checks. The e2e
suite uses `psql` from the environment and imports `unpdf` inside a Bun child
process. Tailwind is imported from CSS. The duplicate export exemption preserves
the two named response schemas exposed through the contracts entry point.

## First report

```text
Unused devDependencies (1)
simple-icons  package.json:42:6
Unused exports (14)
useCreateAgentRun                 function  packages/app-shell/src/agent-runs.ts:87:17
clearStoredDocumentDraftsForUser            packages/app-shell/src/document-draft-store.ts:29:3
suspendDocumentDraftWrites                  packages/app-shell/src/document-draft-store.ts:36:3
pictureSizeInCentimetres          function  packages/app-shell/src/document-picture-resize.ts:36:17
pictureChanged                    function  packages/app-shell/src/document-picture-resize.ts:155:17
hasDarwinWindowControls           function  packages/app-shell/src/lib/desktop-bridge.ts:33:17
DOCUMENT_EDIT_TEXT_MAX_LENGTH               packages/contracts/src/document-edit-format.ts:146:41
mapCategoryToRampart              function  scripts/export-training-data.ts:67:17
cumulativeSpend                   function  scripts/synthetic-v2/budget.ts:98:17
datasetManifest                   function  scripts/synthetic-v2/governance.ts:582:17
openRouterBenchmarkModel          function  scripts/synthetic-v2/models.ts:4:17
openRouterQaModel                 function  scripts/synthetic-v2/models.ts:10:17
normalizeGenerated                function  scripts/synthetic-v2/validation.ts:26:17
isPopulatedObjectExpression       function  tools/oxlint/anti-slop/shared/dictionary-types.ts:467:17
Unused exported types (3)
LegislationProvisionSubsection  type  packages/app-shell/src/views/legislation-document-query.ts:8:15
LegislationActResponse          type  packages/app-shell/src/views/LegislationActView.tsx:14:15
FeatureKey                      type  packages/app-shell/src/views/staff-chart-data.ts:28:13
```
