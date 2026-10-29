# Editor frame and document review (PR #365) — evidence

Captured from the branch head in this worktree, running against a copy of the
demo data (`obiter_fix_b`), at 1440×900 and 1024×768, light and dark.

The document is `supply-agreement-northgate.docx`: the copy of the demo storage
in this worktree carries bytes for the supply agreement and the witness
statement only, and the supply agreement is the one with two stored versions
and tracked changes. It has no comment threads, so the Comments filter is not
offered and the Moves filter is absent; the review list's All/Changes views and
the two change rows are the honest state for this document.

- `editor-*` — the document with the one toolbar row, the header switch and the
  single Comments control.
- `menu-file|edit|insert|format|review|view-*` — every menu, with command names
  clean and disabled reasons as descriptions.
- `formatting-panel-*` — the value controls, with the paragraph spacing and
  indent defaults named rather than a placeholder.
- `selection-toolbar-*` — bold/italic/comment/cite on a text selection.
- `palette-*` — Ctrl+K over the same command list.
- `docked-panel-*`, `floating-panel-*` — the review panel docked, and floated
  below the toolbar row so it cannot cover the header's Check citations/Save.
- `review-list-all|changes-*` — counts, filters, rows with initials, one
  decision bar.
- `compare-*` — the whole document redlined with the Differences list beside it
  ("Wording changed", wrapping rows).
- `info-panel-*` — document information and versions.
- `authorities-*` — the Authorities panel on a document with no stored
  citations (the honest empty/not-checked state).

A "before" set (origin/dev chrome) could not be captured from this worktree: a
second checkout needs its own node_modules (~1 GB) against ~6 GB free disk, and
the ribbon-era chrome for these screens is already visible in the review
screenshots on the PR.
