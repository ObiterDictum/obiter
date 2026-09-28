# E50 tracked-undo browser evidence

Real-browser Playwright journeys from `apps/web/e2e/document-history-save.spec.ts`,
run on an isolated task-owned stack: worktree `review-pr241-tracked`, web
`http://localhost:3010`, API `http://127.0.0.1:8810`, task database
`obiter_e50_tracked` (all 26 migrations applied, `0027` after `0026`), task
storage, no `OBITER_RESEND_API_KEY` (development logs email instead of
sending). Playwright's global setup proved both servers served the worktree
before the first browser started.

## Before — `a58bc0b` (pre-fix)

A tracked text edit saved, then undone, is refused: the workspace enters the
blocked state (`Saved, but the edit history needs a reload`), Undo is disabled,
and no decision is sent.

- `before-a58bc0b-01-tracked-blocked.png`

## After — the repaired head on `e50-save-history-correctness`

All three journeys pass. The tracked journey types ` TRACKED`, saves it as a
tracked change (V2), undoes it, saves the reversal through
`POST /tracked-changes/decision` (V3), and a fresh browser context reads the
stored version back with the marker gone. The workspace reports
`All changes saved`, not blocked.

- `after-01-tracked-typed.png`
- `after-02-tracked-saved.png`
- `after-03-tracked-undone.png`
- `after-04-tracked-reversal-saved.png`
- `after-05-tracked-reopened.png`
- `after-06-insert-undone.png` (non-tracked insert journey)
- `after-07-text-reopened.png` (non-tracked text journey)

The screenshots are supplementary; the durable proof is the committed journey
at the pinned commit and the assertions it makes against a fresh context.
