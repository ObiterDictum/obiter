# E50 save/history repair — durable evidence

Commit-pinned evidence for the repair of PR #241 (`e50-save-history-correctness`).

- Product commit served by both e2e targets: `8fe0745ed4856e2172ce9e9f02cc9ab166e8d837`
  (`Make tracked-insert undo and merge saves keep history usable`), parent merge
  `8ba54c9` (merge of `origin/dev` `cd92cd6`).
- e2e spec and this evidence directory are committed in the following commit;
  they contain no product code, so the served product behaviour is `8fe0745`.
- Assessed head before the repair: `d2f5bb2cffab3b7e48b4496950176b7f84d3d659`.
- Base branch `dev`: `cd92cd679197f8887333a426090e83f7704ca254`; merge-base
  `64a08f386699174afc37d8dc79daf41960e4c5d4`.

## Journey sources

Screenshots in this directory were produced by
`apps/web/e2e/document-history-save.spec.ts` against an isolated stack:

| Item       | Value                                                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| Web        | `http://localhost:3010`                                                                                                     |
| API        | `http://127.0.0.1:8810` (`OBITER_API_ORIGIN` pinned to IPv4)                                                                |
| Database   | `obiter_e50_repair` (task-owned; created and migrated, never shared)                                                        |
| Migrations | `0001 … 0026, 0027` applied in lexical order — both coexist                                                                 |
| Provenance | `/api/health` reported `checkoutRoot=/home/karl/Source/Obiter/lane-editor`, `commitSha=8fe0745…`                            |
| Accounts   | synthetic, created through the product sign-up endpoint; email verified directly in the task-owned database (no email sent) |
| Fixture    | `data/evals/redact/demo-fixture.docx`                                                                                       |

Command (servers on isolated ports, task-owned DB):

```bash
OBITER_WEB_PORT=3010 PORT=8810 \
OBITER_API_ORIGIN="http://127.0.0.1:8810" \
OBITER_E2E_DATABASE_URL="postgresql://obiter:obiter@127.0.0.1:5432/obiter_e50_repair" \
E50_E2E_SHOTS=apps/web/docs/evidence/e50-repair \
  bun run --filter @obiter/web test:e2e document-history-save.spec.ts
```

Result: **5 passed (1.1m)**:

1. `undo after a save persists the reverted text once`
2. `undo of a saved insert does not persist a duplicate paragraph`
3. `undo of a saved tracked edit rejects the change and persists the reversal`
4. `undo of a saved tracked insertion removes the paragraph atomically` (new)
5. `undo after a reconciled merge save keeps the history usable` (new)

Each journey ends in a fresh browser context that reopens the document and
asserts the persisted content, not only the controls.

### New journey evidence

| Files                            | What it proves                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `12-tracked-insert-saved.png`    | the tracked insertion saved; Save is disabled, Undo enabled, no blocked banner                               |
| `13-tracked-insert-undone.png`   | Undo produced a pending decision; Redo restored the saved state; Undo again returned to the pending decision |
| `14-tracked-insert-reopened.png` | a fresh context has the original paragraph count; the shell is gone                                          |
| `15-merge-saved.png`             | a save reconciled onto a colleague's newer version, with the "new version" notice                            |
| `16-merge-undone.png`            | Undo, Redo and Undo again worked across the merge save                                                       |
| `17-merge-reopened.png`          | a fresh context has the colleague's text and not the reverted local text                                     |

## Suites and gates (run through `obiter-heavy`, one heavy job at a time)

| Check                                                                                                       | Result            |
| ----------------------------------------------------------------------------------------------------------- | ----------------- |
| `@obiter/contracts` `bun test`                                                                              | 130 pass / 0 fail |
| `@obiter/ooxml` `bun test`                                                                                  | 228 pass / 0 fail |
| `@obiter/app-shell` `bun test`                                                                              | 989 pass / 0 fail |
| API focused route suites (`document-edit*`, `tracked-changes`, `document-collaboration*`, `document-model`) | 72 pass / 0 fail  |
| `tsc --noEmit` (contracts, ooxml, app-shell, api)                                                           | clean             |
| `oxlint`                                                                                                    | clean             |
| `eslint .`                                                                                                  | clean             |
| `prettier --check`                                                                                          | clean             |
| e2e `document-history-save.spec.ts`                                                                         | 5 pass / 0 fail   |

The migration runner applied `0026_document_version_lineage.sql` then
`0027_matter_share_grantee_organisation.sql` on `obiter_e50_repair`, giving a
combined integration signal for the two migrations.

## Fail-first coverage added

- `packages/ooxml/src/document-lineage-reversals.test.ts`: a tracked paragraph
  insertion's reversal (`trackedInsertChangeIds` + shell removal) restores the
  pre-insertion document in one decision; the server refuses to remove a
  paragraph the rejected change does not live in; the 100-id change and shell
  removal boundaries fail closed.
- `packages/app-shell/src/components/document-workspace/docx-workspace-history-save.test.tsx`:
  the saved tracked insertion leaves Save enabled after Undo, and one decision
  persists the removal.
- `packages/app-shell/src/document-history-baseline.test.ts`: a tracked
  insertion translates to one rejection plus shell removal.
- `packages/ooxml/src/collaboration-merge.test.ts`: a reconciled-merge lineage
  is retargeted onto the client base, and base-addressed operations are
  rewritten to current addresses before they are applied.
- `services/api/src/routes/document-collaboration-merge.test.ts`: a true
  reconciled merge returns a lineage whose `baseVersionId` is the client's base
  and that names the edited base run.

## Honest gaps

- **Tracked range formatting is unsupported.** A range `set_run_emphasis` under
  tracking is refused with `model-node-not-editable`; the client holds and
  surfaces the slot. This is recorded in `docs/architecture.md` and the map.
- **Tracked run-keyed reversals block.** A tracked text replacement's result
  run exists only inside `w:del`/`w:ins`, so its reversal is a change
  rejection, not a run address. A tracked version omits run addresses and the
  boundary blocks honestly rather than retargeting. Tracked paragraph
  insertions are now undoable; tracked run replacements remain rejection-based.
- **Failure/retry and Redo are covered by the mounted suites**
  (`docx-workspace-history-save`, `docx-workspace-redo`,
  `docx-workspace-save-recovery`), not by a dedicated browser journey. The new
  browser journeys exercise Redo for the tracked-insert and merge saves.
- A merge that cannot be reconciled (a genuine conflict) still returns 409 and a
  reload affordance; that is outside this repair and unchanged.
