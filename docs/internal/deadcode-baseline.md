# Dead code detection baseline

The first report excerpt below contains 12 candidates after removing the findings
for the relocated corpus programme. It lists one unused development dependency,
eight unused exports and three unused exported types.

Run `bun run deadcode` from the repository root. CI fails when Knip
reports a finding outside the configured exemptions.

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

## Findings awaiting a human decision

Knip's `ignoreIssues` matches a file and issue type. Review new exports in
these files when they match the exempted issue type, and remove the exemption
once the retained exports have been resolved. The reasons come from the
[layer 2 review](https://github.com/ObiterDictum/obiter/pull/564). The
[layer 3 dependency review](https://github.com/ObiterDictum/obiter/pull/565)
left no dependency findings in the layer 4 report.

| Finding                   | File                                           | Reason                          | Status        |
| ------------------------- | ---------------------------------------------- | ------------------------------- | ------------- |
| `hasDarwinWindowControls` | `packages/app-shell/src/lib/desktop-bridge.ts` | Mac desktop support is planned. | Kept: planned |

## First report excerpt

```text
Unused devDependencies (1)
simple-icons  package.json:42:6
Unused exports (8)
useCreateAgentRun                 function  packages/app-shell/src/agent-runs.ts:87:17
clearStoredDocumentDraftsForUser            packages/app-shell/src/document-draft-store.ts:29:3
suspendDocumentDraftWrites                  packages/app-shell/src/document-draft-store.ts:36:3
pictureSizeInCentimetres          function  packages/app-shell/src/document-picture-resize.ts:36:17
pictureChanged                    function  packages/app-shell/src/document-picture-resize.ts:155:17
hasDarwinWindowControls           function  packages/app-shell/src/lib/desktop-bridge.ts:33:17
DOCUMENT_EDIT_TEXT_MAX_LENGTH               packages/contracts/src/document-edit-format.ts:146:41
isPopulatedObjectExpression       function  tools/oxlint/anti-slop/shared/dictionary-types.ts:467:17
Unused exported types (1)
FeatureKey                      type  packages/app-shell/src/views/staff-chart-data.ts:28:13
```
