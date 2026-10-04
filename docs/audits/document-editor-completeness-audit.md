# Document Editor Completeness Audit

**Assessed base commit:** `4667e76aca7e4ff09b6f1ba965c367591cc4dc88` (`origin/dev`, "Add a sandboxed DOCX to PDF rendering worker (#265)")
**Audit date:** 2026-10-04
**Audit branch:** `audit/document-editor-completion` (clean worktree at the commit above)
**Scope:** the DOCX document editor and read-only PDF workspace, every rendered ribbon control, and the supporting OOXML, API, database, contract and test surfaces.
**Nature:** read-only audit. No product code was modified. No schema, migration, dependency or test was changed. Nothing was merged.

---

## 1. Executive verdict

The Obiter document editor is a genuine, carefully engineered foundation, not a mock. It parses and preserves DOCX losslessly, edits real OOXML through a narrow typed operation contract, creates immutable versions, auto-merges disjoint collaborative edits, and has strong isolation and round-trip preservation. A meaningful core of the Home and Review ribbons is wired and covered by an unusually deep unit/component suite.

It is **not ready for legal documents or source ingestion**. Two facts dominate:

1. **Most of the visible ribbon is a disabled placeholder.** Of 95 interactive controls audited, 43 render as `soon` and are disabled with an accessible name ending "(not available yet)". These include alignment, line spacing, font family/size/colour, clear formatting, page setup, tables, images, hyperlinks, headers/footers, page numbers, footnotes, table of contents, cross-references, defined terms, spelling, breaks, compare versions and share-safe export. Per the governing product rule, a control that does not perform its stated action is a defect, not a roadmap hint.
2. **The export-to-Word journey has never been verified.** The editor's stated bar is "DOCX export → Microsoft Word reopen → expected content preserved". No automated or recorded manual Microsoft Word check exists anywhere in the repository. Microsoft Word is unavailable in this audit environment, so Word rendering is **NOT CHECKED** and must not be assumed.

The in-app edit → save → immutable version → refresh → reopen journey is proven for the wired controls by browser journeys and 1,798 passing unit/component tests. The gap is not the engine; it is breadth of controls, comment/change fidelity, and the unverified export boundary.

**Bottom line:** the editor is a strong foundation that is roughly one third exposed, and the third that is exposed is only partly verified against Word. It should be treated as pre-release and not as ready for legal-document ingestion until the programme in section 30 is delivered.

---

## 2. Definition of "editor ready"

The editor is ready for legal documents and source ingestion when **all** of the following hold:

1. Every control rendered in the ribbon performs its stated action correctly, or is explicitly removed with the owner's approval.
2. The complete journey succeeds for each control: user interaction → correct editor state → dirty state → undo → redo → save → new immutable version → refresh/reopen → DOCX export → Microsoft Word reopen with content and formatting preserved.
3. No control silently no-ops, loses its result after refresh, corrupts untouched OOXML, or implies functionality that does not exist.
4. Common legal-document structures are editable, not merely preserved: alignment, indentation, spacing, fonts/sizes/colours, numbered and multilevel lists with restart, tables, images, hyperlinks, headers/footers/page numbers, footnotes, cross-references and a table of contents.
5. Comments anchor to a real selected range, imported Word comments are visible and resolvable, and exported comments reopen in Word.
6. Tracked insertions, deletions, replacements and formatting can be recorded, reviewed, accepted and rejected from the ribbon, and survive export to Word.
7. Exported DOCX opens in Microsoft Word without a repair prompt, saves in Word without revealing malformed content, re-uploads into Obiter, and survives a second edit/export cycle.
8. The editor is operable keyboard-only, announces save/conflict/error state, and is usable on a narrow laptop and at browser zoom.
9. No P0 or P1 finding from this audit remains open.

---

## 3. Method and evidence base

- Read `AGENTS.md`, `README.md`, `RULES.md`, `docs/roadmap.md`, `TESTING.md`, `docs/current-product-scope.md`, `docs/specs/documents/*`, `docs/architecture.md` references.
- Fetched `origin`; confirmed `HEAD == origin/dev == 4667e76`.
- Read every ribbon component, the workspace shell, the editing/formatting/undo/find/save modules, the OOXML package, the API document routes, the document migrations and contracts.
- Ran the existing suites (section 26) plus focused Playwright document journeys against an isolated task-owned database (`obiter_editor_audit_test`, migrated `0001…0029`).
- Used only synthetic fixtures. No client or matter material was read, written or committed.

Where a claim below is derived from a read-only sub-survey rather than first-hand reading, the load-bearing parts were spot-checked directly. Line references are to the assessed commit.

---

## 4. Ribbon inventory (master)

`soon` controls are rendered, disabled, `aria-label` ends "(not available yet)", and have no `onClick` (`ribbon-primitives.tsx:64-94`, `:161-186`). They are counted as visible placeholders.

Classification key: **PW** proven working in-app (Word reopen NOT CHECKED); **IV** implemented but insufficiently verified; **PI** partially implemented; **VP** visible placeholder (`soon`); **BR** broken; **UN** unsafe; **MI** missing; **DU** deliberately unsupported.

### Home tab (`ribbon-home.tsx`)

| #   | Group     | Control              | Source line              | State          | Handler → editor op                                                                       | Class | Sev |
| --- | --------- | -------------------- | ------------------------ | -------------- | ----------------------------------------------------------------------------------------- | ----- | --- |
| 1   | Clipboard | Paste                | 99                       | `soon`         | none                                                                                      | VP    | P1  |
| 2   | Clipboard | Cut                  | 104                      | `soon`         | none (native Ctrl+X only)                                                                 | VP    | P1  |
| 3   | Clipboard | Copy                 | 108                      | `soon`         | none (native Ctrl+C only)                                                                 | VP    | P1  |
| 4   | Font      | Font family          | 114                      | `soon`         | none                                                                                      | VP    | P1  |
| 5   | Font      | Font size            | 121                      | `soon`         | none                                                                                      | VP    | P1  |
| 6   | Font      | Bold                 | 130                      | wired          | `onToggleBold` → `set_run_emphasis{bold}`                                                 | PW    | —   |
| 7   | Font      | Italic               | 138                      | wired          | `onToggleItalic` → `set_run_emphasis{italic}`                                             | PW    | —   |
| 8   | Font      | Underline            | 146                      | wired          | `onToggleUnderline` → `set_run_emphasis{underline}`                                       | PW    | —   |
| 9   | Font      | Strikethrough        | 154                      | wired          | `onToggleStrikethrough` → `set_run_emphasis{strikethrough}`                               | PW    | —   |
| 10  | Font      | Font colour          | 162                      | `soon`         | none                                                                                      | VP    | P1  |
| 11  | Font      | Highlight            | 167                      | wired          | `onToggleHighlight` → `set_run_emphasis{highlight}`                                       | PW    | —   |
| 12  | Font      | Superscript          | 175                      | wired          | `onToggleSuperscript` → `set_run_emphasis{vertAlign}`                                     | PW    | —   |
| 13  | Font      | Subscript            | 183                      | wired          | `onToggleSubscript` → `set_run_emphasis{vertAlign}`                                       | PW    | —   |
| 14  | Font      | Clear formatting     | 191                      | `soon`         | none                                                                                      | VP    | P1  |
| 15  | Paragraph | Multilevel numbering | 200                      | wired          | `onToggleList('multilevel')` → `set_paragraph_numbering`                                  | IV    | P1  |
| 16  | Paragraph | Numbering            | 207                      | wired          | `onToggleList('number')` → `set_paragraph_numbering`                                      | IV    | P1  |
| 17  | Paragraph | Bullets              | 214                      | wired          | `onToggleList('bullet')` → `set_paragraph_numbering`                                      | IV    | P1  |
| 18  | Paragraph | Increase list indent | 221                      | wired          | `onIndent` → `set_paragraph_numbering{ilvl+1}`                                            | IV    | P1  |
| 19  | Paragraph | Decrease list indent | 227                      | wired          | `onOutdent` → `set_paragraph_numbering{ilvl-1}`                                           | IV    | P1  |
| 20  | Paragraph | Continue list        | 233                      | wired          | `onContinueList` → `set_paragraph_numbering` (copies previous numPr)                      | IV    | P1  |
| 21  | Paragraph | Align left           | 241                      | `soon`         | none                                                                                      | VP    | P1  |
| 22  | Paragraph | Align centre         | 246                      | `soon`         | none                                                                                      | VP    | P1  |
| 23  | Paragraph | Align right          | 251                      | `soon`         | none                                                                                      | VP    | P1  |
| 24  | Paragraph | Justify              | 256                      | `soon`         | none                                                                                      | VP    | P1  |
| 25  | Paragraph | Line spacing         | 261                      | `soon`         | none                                                                                      | VP    | P1  |
| 26  | Styles    | Style gallery items  | 307-334                  | wired / `soon` | `onParagraphStyle(styleId)` → `set_paragraph_style`; fallback chips `soon` when no styles | IV    | P2  |
| 27  | Styles    | Paragraph style      | 329                      | wired          | `onParagraphStyle` → `set_paragraph_style` / `null`                                       | IV    | P2  |
| 28  | Editing   | Insert paragraph     | 273                      | wired          | `drafts.insertAfter` → `insert_paragraph_after`                                           | PW    | —   |
| 29  | Editing   | Delete paragraph     | 279                      | wired          | `drafts.deleteParagraph` → `delete_paragraph`                                             | PI    | P2  |
| 30  | Editing   | Undo                 | 285                      | wired          | `undoDocument` (history step)                                                             | PW    | —   |
| 31  | Editing   | Redo                 | 291                      | wired          | `redoDocument` (history step)                                                             | PW    | —   |
| 32  | Global    | Save                 | `toolbar.tsx:190-210`    | wired          | `save.save` → edit/merge batch                                                            | PW    | —   |
| 33  | Global    | Save status region   | `save-banners.tsx:22-33` | status         | `data-save-state`, `aria-live="polite"`                                                   | PW    | —   |

### Insert tab (`ribbon-insert-layout.tsx`)

| #   | Group             | Control         | Source line | State  | Handler            | Class | Sev |
| --- | ----------------- | --------------- | ----------- | ------ | ------------------ | ----- | --- |
| 34  | Breaks            | Page break      | 62          | `soon` | none               | VP    | P1  |
| 35  | Breaks            | Section break   | 67          | `soon` | none               | VP    | P1  |
| 36  | Tables            | Insert table    | 75          | `soon` | none               | VP    | P1  |
| 37  | Exhibits          | Picture         | 82          | `soon` | none               | VP    | P1  |
| 38  | Links             | Link            | 89          | `soon` | none               | VP    | P1  |
| 39  | Links             | Cross-reference | 91          | `soon` | none               | VP    | P1  |
| 40  | Header and footer | Header          | 100         | `soon` | none               | VP    | P1  |
| 41  | Header and footer | Footer          | 105         | `soon` | none               | VP    | P1  |
| 42  | Header and footer | Page number     | 110         | `soon` | none               | VP    | P1  |
| 43  | Comments          | Comments toggle | 118         | wired  | `onToggleComments` | PW    | —   |

### Layout tab (`ribbon-insert-layout.tsx`)

| #   | Group      | Control           | Source line | State  | Class | Sev |
| --- | ---------- | ----------------- | ----------- | ------ | ----- | --- |
| 44  | Page setup | Margins           | 138         | `soon` | VP    | P1  |
| 45  | Page setup | Orientation       | 145         | `soon` | VP    | P1  |
| 46  | Page setup | Page size         | 150         | `soon` | VP    | P1  |
| 47  | Document   | Document type     | 160         | `soon` | VP    | P1  |
| 48  | Marking    | Draft             | 169         | `soon` | VP    | P1  |
| 49  | Marking    | Privileged        | 170         | `soon` | VP    | P1  |
| 50  | Marking    | Without prejudice | 171         | `soon` | VP    | P1  |
| 51  | Paragraph  | Indent            | 176         | `soon` | VP    | P1  |

### References tab (`ribbon-review.tsx`)

| #   | Group            | Control                | Source line | State  | Handler → op                                               | Class | Sev |
| --- | ---------------- | ---------------------- | ----------- | ------ | ---------------------------------------------------------- | ----- | --- |
| 52  | Authorities      | Insert authority       | 65          | wired  | `onInsertAuthority` → `insertText` at caret                | IV    | P2  |
| 53  | Authorities      | Verify citations       | 70          | wired  | `verification.revealStart()` (disabled with honest reason) | IV    | P2  |
| 54  | Authorities      | List of authorities    | 80          | wired  | `onToggleAuthorities`                                      | IV    | P2  |
| 55  | Authorities      | Citation style         | 86          | `soon` | none                                                       | VP    | P1  |
| 56  | Defined terms    | Mark defined term      | 100         | `soon` | none                                                       | VP    | P1  |
| 57  | Defined terms    | Check defined terms    | 105         | `soon` | none                                                       | VP    | P1  |
| 58  | Cross-references | Insert cross-reference | 114         | `soon` | none                                                       | VP    | P1  |
| 59  | Cross-references | Check cross-references | 119         | `soon` | none                                                       | VP    | P1  |
| 60  | Notes            | Insert footnote        | 128         | `soon` | none                                                       | VP    | P1  |
| 61  | Notes            | Table of contents      | 133         | `soon` | none                                                       | VP    | P1  |

### Review tab (`ribbon-review.tsx`, `ribbon-find.tsx`)

| #   | Group    | Control              | Source line          | State  | Handler → op                              | Class | Sev |
| --- | -------- | -------------------- | -------------------- | ------ | ----------------------------------------- | ----- | --- |
| 62  | Proofing | Spelling             | 178                  | `soon` | none                                      | VP    | P1  |
| 63  | Find     | Find field           | `ribbon-find.tsx:44` | wired  | `onQuery`                                 | PW    | —   |
| 64  | Find     | Previous match       | `ribbon-find.tsx:54` | wired  | `onPrevious`                              | PW    | —   |
| 65  | Find     | Next match           | `ribbon-find.tsx:59` | wired  | `onNext`                                  | PW    | —   |
| 66  | Find     | Result count         | `ribbon-find.tsx:50` | status | `matchLabel`                              | PW    | —   |
| 67  | Find     | Replace field        | `ribbon-find.tsx:63` | wired  | `onReplace`                               | PW    | —   |
| 68  | Find     | Replace              | `ribbon-find.tsx:70` | wired  | `onReplaceOne` → `replace_run_text`       | PW    | —   |
| 69  | Find     | Replace all          | `ribbon-find.tsx:76` | wired  | `onReplaceAll` → `replace_run_text` batch | PW    | —   |
| 70  | Comments | Comments toggle      | 190                  | wired  | `onToggleComments`                        | PW    | —   |
| 71  | Tracking | Track changes        | 199                  | wired  | `onToggleTrackChanges`                    | PW    | —   |
| 72  | Tracking | Changes toggle       | 206                  | wired  | `onToggleChanges`                         | PW    | —   |
| 73  | Tracking | Accept change        | 212                  | `soon` | none (panel only)                         | VP    | P1  |
| 74  | Tracking | Reject change        | 217                  | `soon` | none (panel only)                         | VP    | P1  |
| 75  | Versions | Compare versions     | 225                  | `soon` | none                                      | VP    | P1  |
| 76  | Redact   | Redact this document | 232                  | wired  | `revealDocumentRedactionRuns`             | IV    | P1  |
| 77  | Export   | Export               | 240                  | wired  | `exportDocx` → `fetchDocumentExport`      | PW    | —   |
| 78  | Export   | Share-safe export    | 245                  | `soon` | none                                      | VP    | P1  |
| 79  | Export   | Print                | 250                  | wired  | `printDocument`                           | PW    | —   |

### View tab (`ribbon-review.tsx`)

| #   | Group | Control         | Source line | State               | Handler                     | Class | Sev |
| --- | ----- | --------------- | ----------- | ------------------- | --------------------------- | ----- | --- |
| 80  | Views | Print layout    | 275         | pressed, no handler | none — silent no-op         | BR    | P3  |
| 81  | Show  | Ruler           | 283         | `soon`              | none                        | VP    | P3  |
| 82  | Show  | Navigation pane | 288         | `soon`              | none                        | VP    | P3  |
| 83  | Zoom  | Zoom out        | 297         | wired               | `onZoom(max(75, zoom-10))`  | PW    | —   |
| 84  | Zoom  | Zoom in         | 305         | wired               | `onZoom(min(140, zoom+10))` | PW    | —   |

### Ribbon tabs (`toolbar.tsx:124-215`)

| #   | Control    | Source | State | Class |
| --- | ---------- | ------ | ----- | ----- |
| 85  | Home       | 130    | wired | PW    |
| 86  | Insert     | 131    | wired | PW    |
| 87  | Layout     | 132    | wired | PW    |
| 88  | References | 133    | wired | PW    |
| 89  | Review     | 134    | wired | PW    |
| 90  | View       | 135    | wired | PW    |

### Read-only PDF workspace (`toolbar.tsx:86-122`, `ribbon-find.tsx:8-30`, `pdf-view.tsx`)

| #   | Control               | Source               | State  | Handler                             | Class | Sev |
| --- | --------------------- | -------------------- | ------ | ----------------------------------- | ----- | --- |
| 91  | Zoom out              | `ribbon-find.tsx:23` | wired  | `onZoom`                            | PW    | —   |
| 92  | Zoom in               | `ribbon-find.tsx:31` | wired  | `onZoom`                            | PW    | —   |
| 93  | Export extracted text | `toolbar.tsx:105`    | wired  | `downloadPlainText(filename, text)` | PW    | —   |
| 94  | Download original     | `toolbar.tsx:110`    | wired  | `fetchDocumentDownload`             | PW    | —   |
| 95  | Previous page         | `pdf-view.tsx:31`    | wired  | `onPageIndexChange`                 | PW    | —   |
| 96  | Next page             | `pdf-view.tsx:44`    | wired  | `onPageIndexChange`                 | PW    | —   |
| 97  | Read-only status      | `toolbar.tsx:116`    | status | "View only, not editable"           | PW    | —   |

**Total:** 95 interactive controls + 2 status regions = 97 audited items.

---

## 5. Per-control feature matrix

The 29 requested attributes are reported across two tables. Table B covers attributes 8–21 and 25–26 for every wired control; Table C states the shared profile for the 43 placeholders (attributes 8–21 are all "n/a — no handler"); Table D covers accessibility (attribute 25) and tests (22–24).

Legend: `Y` yes/covered; `N` no; `~` partial or refused; `?` not checked; `n/a` not applicable; `—` none.

### Table B — journey and OOXML matrix (wired controls)

| Control                            | Caret | Range | Cross-run | Cross-para | Mixed | Track | Undo | Redo | Dirty | Save | Refresh | Version | Export | Word | Unit | API | E2E |
| ---------------------------------- | ----- | ----- | --------- | ---------- | ----- | ----- | ---- | ---- | ----- | ---- | ------- | ------- | ------ | ---- | ---- | --- | --- |
| Bold                               | Y     | Y     | Y         | Y          | Y     | ~     | Y    | Y    | Y     | Y    | Y       | Y       | Y      | ?    | Y    | Y   | Y   |
| Italic                             | Y     | Y     | Y         | Y          | Y     | ~     | Y    | Y    | Y     | Y    | Y       | Y       | Y      | ?    | Y    | Y   | Y   |
| Underline                          | Y     | Y     | Y         | Y          | Y     | ~     | Y    | Y    | Y     | Y    | Y       | Y       | Y      | ?    | Y    | Y   | Y   |
| Strikethrough                      | Y     | Y     | Y         | Y          | Y     | ~     | Y    | Y    | Y     | Y    | Y       | Y       | Y      | ?    | Y    | Y   | Y   |
| Highlight                          | Y     | Y     | Y         | Y          | Y     | ~     | Y    | Y    | Y     | Y    | Y       | Y       | Y      | ?    | Y    | Y   | Y   |
| Superscript                        | Y     | Y     | Y         | Y          | Y     | ~     | Y    | Y    | Y     | Y    | Y       | Y       | Y      | ?    | Y    | Y   | Y   |
| Subscript                          | Y     | Y     | Y         | Y          | Y     | ~     | Y    | Y    | Y     | Y    | Y       | Y       | Y      | ?    | Y    | Y   | Y   |
| Multilevel numbering               | Y     | Y     | n/a       | Y          | n/a   | N     | Y    | Y    | Y     | Y    | Y       | Y       | Y      | ?    | Y    | Y   | N   |
| Numbering                          | Y     | Y     | n/a       | Y          | n/a   | N     | Y    | Y    | Y     | Y    | Y       | Y       | Y      | ?    | Y    | Y   | N   |
| Bullets                            | Y     | Y     | n/a       | Y          | n/a   | N     | Y    | Y    | Y     | Y    | Y       | Y       | Y      | ?    | Y    | Y   | N   |
| Increase list indent               | Y     | Y     | n/a       | Y          | n/a   | N     | Y    | Y    | Y     | Y    | Y       | Y       | Y      | ?    | Y    | Y   | N   |
| Decrease list indent               | Y     | Y     | n/a       | Y          | n/a   | N     | Y    | Y    | Y     | Y    | Y       | Y       | Y      | ?    | Y    | Y   | N   |
| Continue list                      | Y     | Y     | n/a       | Y          | n/a   | N     | Y    | Y    | Y     | Y    | Y       | Y       | Y      | ?    | Y    | Y   | N   |
| Style gallery item                 | Y     | Y     | n/a       | Y          | ~     | N     | Y    | Y    | Y     | Y    | Y       | Y       | Y      | ?    | Y    | Y   | N   |
| Paragraph style                    | Y     | Y     | n/a       | Y          | ~     | N     | Y    | Y    | Y     | Y    | Y       | Y       | Y      | ?    | Y    | Y   | N   |
| Insert paragraph                   | Y     | n/a   | n/a       | n/a        | n/a   | N     | Y    | Y    | Y     | Y    | Y       | Y       | Y      | ?    | Y    | Y   | Y   |
| Delete paragraph                   | Y     | n/a   | n/a       | n/a        | n/a   | N     | Y    | Y    | Y     | ~    | ~       | Y       | Y      | ?    | Y    | Y   | Y   |
| Undo                               | Y     | Y     | Y         | Y          | Y     | Y     | n/a  | n/a  | Y     | Y    | Y       | Y       | Y      | ?    | Y    | Y   | Y   |
| Redo                               | Y     | Y     | Y         | Y          | Y     | Y     | n/a  | n/a  | Y     | Y    | Y       | Y       | Y      | ?    | Y    | Y   | Y   |
| Save                               | n/a   | n/a   | n/a       | n/a        | n/a   | n/a   | n/a  | n/a  | Y     | Y    | Y       | Y       | Y      | ?    | Y    | Y   | Y   |
| Find / Prev / Next / count         | Y     | n/a   | Y         | N          | n/a   | n/a   | n/a  | n/a  | N     | n/a  | n/a     | n/a     | n/a    | n/a  | Y    | N   | N   |
| Replace / Replace all              | Y     | Y     | Y         | N          | n/a   | ~     | Y    | Y    | Y     | Y    | Y       | Y       | Y      | ?    | Y    | Y   | N   |
| Track changes toggle               | n/a   | n/a   | n/a       | n/a        | n/a   | Y     | n/a  | n/a  | Y     | Y    | Y       | Y       | Y      | ?    | Y    | Y   | Y   |
| Comments toggle                    | n/a   | n/a   | n/a       | n/a        | n/a   | n/a   | n/a  | n/a  | N     | n/a  | n/a     | n/a     | n/a    | n/a  | Y    | N   | N   |
| Changes toggle                     | n/a   | n/a   | n/a       | n/a        | n/a   | n/a   | n/a  | n/a  | N     | n/a  | n/a     | n/a     | n/a    | n/a  | Y    | N   | N   |
| Accept/Reject (panel)              | n/a   | n/a   | n/a       | n/a        | n/a   | Y     | n/a  | n/a  | Y     | Y    | Y       | Y       | Y      | ?    | Y    | Y   | N   |
| Insert authority                   | Y     | n/a   | n/a       | n/a        | n/a   | N     | Y    | Y    | Y     | Y    | Y       | Y       | Y      | ?    | Y    | N   | N   |
| Verify citations                   | n/a   | n/a   | n/a       | n/a        | n/a   | n/a   | n/a  | n/a  | N     | n/a  | n/a     | n/a     | n/a    | n/a  | Y    | Y   | N   |
| List of authorities                | n/a   | n/a   | n/a       | n/a        | n/a   | n/a   | n/a  | n/a  | N     | n/a  | n/a     | n/a     | n/a    | n/a  | Y    | N   | N   |
| Redact this document               | n/a   | n/a   | n/a       | n/a        | n/a   | n/a   | n/a  | n/a  | N     | n/a  | n/a     | n/a     | n/a    | n/a  | Y    | N   | N   |
| Export DOCX                        | n/a   | n/a   | n/a       | n/a        | n/a   | n/a   | n/a  | n/a  | n/a   | n/a  | n/a     | Y       | Y      | ?    | Y    | Y   | N   |
| Print                              | n/a   | n/a   | n/a       | n/a        | n/a   | n/a   | n/a  | n/a  | N     | N    | n/a     | n/a     | n/a    | ?    | Y    | N   | Y   |
| Zoom out / in                      | n/a   | n/a   | n/a       | n/a        | n/a   | n/a   | n/a  | n/a  | N     | n/a  | N       | n/a     | n/a    | n/a  | Y    | N   | Y   |
| PDF export text / download / pages | n/a   | n/a   | n/a       | n/a        | n/a   | n/a   | n/a  | n/a  | N     | n/a  | N       | n/a     | n/a    | n/a  | Y    | N   | N   |
| Ribbon tabs                        | n/a   | n/a   | n/a       | n/a        | n/a   | n/a   | n/a  | n/a  | n/a   | n/a  | n/a     | n/a     | n/a    | n/a  | Y    | N   | Y   |

Notes:

- **Track `~`** on character formatting: a whole-run toggle under tracking works; a partial-range toggle is refused with the honest message "Partial formatting is not yet recorded as a tracked change" (`document-format-toolbar.ts:160-175`). Mid-run bold with tracking on is therefore impossible.
- **Cross-para** on formatting is supported for emphasis (one range per paragraph, `docx-workspace.tsx:207-210`), but not for `replace` or list toggles.
- **Find** matches within a single paragraph only and is case-insensitive (`document-find.ts`); it does not cross paragraphs or support match-case/whole-word.
- **Delete paragraph `~`**: works for ordinary paragraphs; deleting the last remaining body paragraph is plannable client-side but refused by the server on save (`model-edit-validation.ts:37-40`), producing a failed save rather than a guarded control.
- **Word column is `?` for every export path**: Microsoft Word was unavailable (section 27).
- **PDF refresh `N`**: PDF/TXT viewers always resolve the server's current version; there is no version pin in the URL (`workspace.tsx:129-147`).

### Table C — placeholder profile

All 43 `soon` controls share one audited profile: visible; disabled; accessible name `"<label> (not available yet)"`; no handler; no editor or OOXML operation; caret/range/cross-run/cross-para/mixed/track/undo/redo/dirty/save/refresh/version/export all not applicable; no unit, API or browser test asserts their intended behaviour; failure behaviour is "cannot be activated". They are enumerated individually in section 4 and section 10.

### Table D — accessibility and test coverage (wired controls)

| Control family           | Accessible name  | Pressed state      | Tooltip | Keyboard reach      | Shortcut                                 | Unit | API | E2E      | Failure path                                |
| ------------------------ | ---------------- | ------------------ | ------- | ------------------- | ---------------------------------------- | ---- | --- | -------- | ------------------------------------------- |
| Character formatting     | Y (`aria-label`) | Y (`aria-pressed`) | Y       | Y (tab)             | N (no Ctrl+B/I/U)                        | Y    | Y   | Y        | refusal message under tracking              |
| List toggles             | Y                | Y                  | Y       | Y                   | N                                        | Y    | Y   | N        | no-op when no matching numbering definition |
| Styles                   | Y                | Y (chips)          | Y       | Y                   | N                                        | Y    | Y   | N        | falls back to `soon` chips when no styles   |
| Insert/Delete paragraph  | Y                | n/a                | Y       | Y                   | N                                        | Y    | Y   | Y        | last-paragraph save refusal                 |
| Undo/Redo                | Y                | n/a                | Y       | Y                   | Y (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y)       | Y    | Y   | Y        | disabled when history empty                 |
| Save                     | Y                | n/a                | N       | Y                   | Y (Ctrl/Cmd+S)                           | Y    | Y   | Y        | failed/stale/blocked banners                |
| Find/Replace             | Y (inputs)       | n/a                | N       | Y                   | Y (Ctrl/Cmd+F)                           | Y    | N   | N        | empty-result label; no match-case           |
| Track changes            | Y (on/off label) | Y                  | Y       | Y                   | N                                        | Y    | Y   | Y        | n/a                                         |
| Comments/Changes toggles | Y                | Y                  | Y       | Y                   | N                                        | Y    | N   | N        | panel error alert                           |
| Authorities              | Y                | Y                  | Y       | Y                   | N                                        | Y    | N   | N        | empty state                                 |
| Redact/Export/Print      | Y                | n/a                | Y       | Y                   | Print: Ctrl/Cmd+P                        | Y    | Y   | Print: Y | error banner / print refusal                |
| Zoom                     | Y                | n/a                | Y       | Y                   | N                                        | Y    | N   | Y        | clamped 75–140                              |
| Ribbon tabs              | Y                | `data-selected`    | n/a     | Y (roving, Base UI) | arrows move focus, Enter/Space activates | Y    | N   | Y        | n/a                                         |
| PDF controls             | Y                | n/a                | Y       | Y                   | N                                        | Y    | N   | N        | query error surface                         |

---

## 6. Proven working capabilities

Proven by automated in-app journeys through save, immutable version, refresh and reopen (Word reopen NOT CHECKED):

- **Character emphasis**: bold, italic, underline, strikethrough, highlight, superscript, subscript, over collapsed caret, within-run range, cross-run range and cross-paragraph selection, with mixed-format agreement (`document-format-controls.ts:71-112`), correct painted state, undo/redo and save/reload. Browser journeys: `document-character-formatting.spec.ts` (3/3 on rerun), plus `docx-workspace-history-save.test.tsx`, `toolbar-character-formatting.test.tsx`.
- **Paragraph insert/delete** (ordinary paragraphs), **undo/redo** across text, split, join, formatting, style, numbering, find-and-replace and tracked-insertion reversals. Browser journeys: `document-history-save.spec.ts` (4/5 first run, failing test passed in isolation), `document-redo.spec.ts` (browser suite exists but is credential-gated), `e47-split-enter.spec.ts` (1/1).
- **Immutable versions and optimistic concurrency**: every save creates a new `document_versions` row; stale base versions are refused with 409; no silent overwrite (`document-version-commit.ts`, `document-versions.ts:236-260`).
- **Collaborative merge**: disjoint edits auto-merge; same-range conflicts return 409; duplicate sync ids are idempotent (`document-collaboration-versions.ts`).
- **Find and replace** within a paragraph, with result count and replace-all as one undoable step.
- **Save state machine and recovery**: dirty/saving/saved/failed/stale/blocked, restored drafts, held rejected changes, retry and discard dialogs (`save-banners.tsx`, `use-document-save.ts`).
- **Print** (browser print of the painted document) and **DOCX download** (API-verified export bytes).
- **PDF read-only workspace**: zoom, page navigation, extracted-text export, original download, honest read-only label, text-layer rendering.
- **Presence**: 8-second heartbeat and "Editors present" chips (in-memory, per process).
- **Tenant isolation and authz** on every document route (section 21).

## 7. Implemented but insufficiently verified

- **Lists** (numbering, bullets, multilevel, indent, outdent, continue): unit/component-tested, no browser journey, no export/Word check, no restart/start-value.
- **Paragraph styles**: applying a style is tested at unit level; mixed-selection pressed state is undefined; gallery degrades to `soon` chips when a document has no paragraph styles.
- **Authorities**: extraction (neutral-citation regex), list and caret insertion are unit-tested; no lookup, no verification, no table of authorities, no browser journey.
- **Verify citations**: wired to the verification dock with honest availability, but no document-editor browser journey.
- **Redact this document**: scrolls/focuses the redaction region; no browser journey and no return path.
- **Tracked-change recording and decisions**: extensively unit-tested in OOXML and API, and `document-character-formatting.spec.ts` covers tracked refusals; but most recording paths (paragraph insertion/deletion, replacement, property changes) have no browser journey.
- **Export DOCX**: API unit tests assert byte/comment behaviour; no browser journey and no Word reopen.

## 8. Partially implemented

- **Comments**: product comments are created, listed and resolved, but only against a whole paragraph (`startOffset` hard-coded `0`, `endOffset` = paragraph length, `docx-workspace.tsx:470-490`); imported Word comments are preserved and exported but never displayed; there is no comment navigation, reply, or insertion-point comment; resolution is allowed to any editor (`routes/comments.ts:89`).
- **Tracked changes**: recording and decisions exist, but ribbon Accept/Reject are placeholders, there is no change navigation or bulk accept/reject, and partial-range formatting under tracking is refused.
- **Redaction handoff**: a document can start a linked run, but there is no endpoint or UI that writes a redacted result back as a document version (`document-redaction` survey; no return path found).
- **Delete paragraph**: ordinary deletes work; deleting the last body paragraph is not guarded client-side and fails at save.
- **Paste**: plain-text paste over a live selection replaces the range, but a multi-paragraph paste with no selection falls through to the single textarea and collapses into one paragraph with hard line breaks; no formatted paste.

## 9. Visible placeholders

The 43 `soon` controls in section 4: Paste, Cut, Copy, Font family, Font size, Font colour, Clear formatting, Align left/centre/right/justify, Line spacing, Page break, Section break, Insert table, Picture, Link, Cross-reference, Header, Footer, Page number, Margins, Orientation, Page size, Document type, Draft, Privileged, Without prejudice, Indent, Citation style, Mark defined term, Check defined terms, Insert cross-reference, Check cross-references, Insert footnote, Table of contents, Spelling, Accept change, Reject change, Compare versions, Share-safe export, Ruler, Navigation pane, plus the style-gallery fallback chips.

## 10. Broken controls

- **Print layout** (`ribbon-review.tsx:275`): rendered as a pressed button with no handler; clicking does nothing silently. Only one layout exists, so the control implies a mode switch that does not exist. Severity P3.
- **Delete paragraph** (`ribbon-home.tsx:279`): not fully broken, but the last-paragraph case is a visible control whose result cannot be saved. Classified PI/P2.

## 11. Missing controls or workflows

No ribbon control is entirely absent (placeholders stand in), but these workflows are missing:

- Version selection, difference presentation and compare-versions view.
- Comment navigation, reply, and display/resolution of imported Word comments.
- Change navigation and bulk accept/reject.
- Spelling/proofing.
- Table of authorities generation and citation-style formatting.
- Defined-term marking/checking and cross-reference checking.
- Share-safe export.
- Paragraph alignment/indentation/spacing editing.
- Font family/size/colour editing and clear formatting.
- Tables, images, hyperlinks, headers/footers/page numbers, footnotes, TOC, page/section setup, breaks.
- Document classification/marking.
- Redaction return path.
- PDF find and large-document handling.

## 12. Unsafe behaviours

No confirmed data-loss, corruption, cross-tenant or silent-overwrite defect was found. The preservation contract (untouched parts byte-identical; dirty parts semantically equivalent to source plus the intentional edit) is well tested (`round-trip.test.ts`, `model-edits.test.ts:610`). The following are "unsafe-adjacent" and are tracked as P1/P2:

- Whole-paragraph comment anchoring can attach a comment to text the author did not intend to mark (P1).
- Multi-paragraph paste collapsing into one paragraph can silently restructure a legal document (P2).
- Non-ASCII export filenames degrade to underscores (`document-export.ts:103`), which can mislead a user about the exported file (P2).
- Deleting the last paragraph leaves an empty editor and a failed save (P2).

## 13. DOCX rendering findings

The parser (`packages/ooxml/src/parse.ts`, `parts/stories.ts`) builds a typed logical model for paragraphs and runs and preserves everything else as opaque, source-preserving fragments.

**Parsed and painted:** paragraphs; runs; whitespace and `xml:space`; tabs; `w:br` line breaks; headings and paragraph styles; character styles; fonts and sizes; bold, italic, underline, strikethrough, colour, highlight, superscript, subscript; alignment; left/right/first-line/hanging indentation; line spacing and space before/after; keep-with-next, keep-lines-together and widow/orphan control (pagination); bullets, numbering and multilevel lists; list continuation/restart data; page dimensions, margins, orientation and columns; headers, footers and page numbers; footnotes and endnotes; letterheads; tables, merged cells and nested tables; inline and floating drawings and text boxes; images.

**Preserved opaquely, not editable:** tables, drawings/images, section properties, hyperlinks, bookmarks, fields, content controls, comments extensions, signatures, custom XML and unknown parts. Multiple sections and differing headers/footers are read as stories; section geometry is not writable.

**Unsupported content handling:** preserved opaquely (never silently deleted) and re-emitted byte-identically when untouched. There is no "rendered approximately with a warning" path for unsupported features, because unsupported features are not rendered at all; they are preserved. This is a safe default but means a user cannot see or edit content that exists in their document.

## 14. Editing findings

Typing at the start, middle and end of a run; empty paragraphs; typing across differently formatted runs; replacing selections within a run, across runs and across paragraphs; Enter (split), Shift+Enter (line break), Backspace, Delete, arrow keys, Home/End, Shift-selection, paragraph split/join, insert-before-first (via undo restoration), delete first/last (except the last-paragraph guard), IME composition, Unicode and astral characters, caret restoration after rerender/undo/redo — all implemented and unit/component-tested, with browser journeys for split, cross-paragraph selection and undo/redo.

Gaps: multi-paragraph paste collapses; Ctrl/Command+Arrow is deliberately left native (no model word-jump); no `Ctrl+B/I/U`; no client guard against deleting the last paragraph; no selection stability test across page boundaries in a browser.

## 15. Formatting findings

Character emphasis is solid for the seven wired toggles. Paragraph alignment, indentation (non-list), line spacing, space before/after and keep-with-next are **read/painted only** — the contract supports them (`document-edit.ts:128-179`, `set_paragraph_format`) and the OOXML writer supports them (`model-property-edits.ts:94`), but no client code emits `set_paragraph_format` and every control is `soon`. Font family, size, colour and small caps are similarly supported by the contract (`set_run_emphasis` fields) and OOXML writer but unwritable because the controls are `soon` and `document-format-types.ts:1-40` explicitly excludes them.

## 16. Comments and tracked-change findings

**Comments.** Product comments only; anchor is always the whole paragraph; imported Word comments are preserved/exported but invisible; no navigation or reply; resolve is any-editor; the panel copy says "write a plain-text comment anchored to it" but does not disclose whole-paragraph anchoring. Export appends product comments and skips anchors that no longer resolve, reporting the count (`document-export.ts`; `docx-workspace.tsx` `skippedCommentsMessage`).

**Tracked changes.** OOXML records `w:ins`/`w:del` (with `delText`), `rPrChange`/`pPrChange`, moves are paired and preserved; decisions accept/reject individual changes and related pairs, including paragraph-mark absorption and move-pair auto-inclusion, and commit as a new immutable version. The Changes panel shows author, date, kind, element and text with Accept/Reject. Ribbon Accept/Reject are placeholders; no navigation or bulk action; partial-range formatting under tracking is refused; imported tracked changes are preserved and exported but there is no dedicated review view beyond the change list.

## 17. Collaboration and conflict findings

Presence heartbeat (8s), participants list, stale cleanup, 50-participant/1000-document caps, duplicate-sync-id idempotency and org-scoped presence buckets are implemented and API-tested. Merge reconciles disjoint edits, remaps addresses and returns 409 with operation indexes for true conflicts. Gaps: presence is per-process in memory (multi-instance split brain); no browser journey for merge/conflict UI; version-level ACL does not exist, so any `view` grantee can read any ready version via `?versionId=`.

## 18. Persistence and immutable-version findings

Every save writes a new version and advances `current_version_id` only under an optimistic check; stale bases return 409 before work is done and again at commit; lineage is stored atomically with the version. Originals remain available; the versions list renders all versions (metadata), though only the current version is viewable in the editor (`document-detail.tsx:245-286`). Drafts persist locally per document/base version and are recovered after refresh with explicit restore/discard. No silent overwrite was found.

## 19. OOXML and Word round-trip findings

OOXML-level round-trip is strongly proven: 229 ooxml tests pass, including byte identity for clean parts, semantic equivalence for dirty parts, foreign tracked-change and comment preservation, and package-part-set stability. **Application-level** round-trip through the editor and the API export has no browser journey and **no Microsoft Word verification at all**. Therefore: export can be opened in Word — NOT CHECKED; Word repair prompt — NOT CHECKED; re-upload of the exported file — NOT CHECKED; second edit/export cycle — NOT CHECKED.

## 20. Security and tenant-isolation findings

AuthN on every route via `ensureOrgUser` (`authz.ts:42`); authZ via org scoping, matter creator/share predicate and storage-key equality; denials are concealed as 404. Writes lock the matter and re-check the share at commit time, including revocation races (`document-write-share-revocation.db.test.ts`, all passing). Object keys contain only ids (no names/filenames). ZIP limits, relationship traversal and external relationships are handled safely. Residual: non-current version reads by `view` grantees; export filename downgrade; presence per-process; comment resolve any-editor; a comment-anchor TOCTOU between validation and insert (fail-safe: unresolved anchors are skipped at export). No cross-organisation exposure was found.

## 21. Accessibility findings

- All buttons have accessible names; toggles expose `aria-pressed`; the save status is an `aria-live="polite"` region with `data-save-state`; errors use `role="alert"`; the PDF toolbar names its controls and states "View only, not editable".
- Ribbon tabs use Base UI Tabs with roving focus, arrow-key navigation and focus-visible outlines; `activateOnFocus` is not set, so arrows move focus and Enter/Space activates (manual activation).
- Keyboard shortcuts exist for save (Ctrl/Cmd+S), print (Ctrl/Cmd+P), undo (Ctrl/Cmd+Z), redo (Ctrl/Cmd+Shift+Z or Ctrl+Y) and find (Ctrl/Cmd+F) (`document-workspace-keys.ts`).
- Gaps: no Ctrl/Cmd+B/I/U; disabled placeholders are reachable in the tab order (they are disabled, so skipped) and named honestly; no focus management after accepting/rejecting a change, navigating to a comment or authority, or closing a dialog beyond default browser behaviour; no announcement when a comment/change decision writes a new version beyond the save status; no dark-mode/contrast automated test for the editor; touch targets for ribbon buttons are 28×28 px (`h-7 w-7`), below the 44 px recommendation.

## 22. Responsive and narrow-screen findings

The ribbon wraps (`flex-wrap`) and the tab strip scrolls horizontally (`overflow-x-auto`); the side panels are `lg:w-80` and stack below `lg`. Existing e2e covers the shell and a 390 px verification flow, but **no document-editor e2e** exercises the ribbon, side panels or dialogs at 390 px, narrow laptop widths, browser zoom or text scaling. The Home tab has many controls and will wrap to several rows on a narrow screen.

## 23. Performance findings for large documents

Pagination and rendering are memoised by inputs (`document-page-engine`, `use-workspace-derivations`). The model is loaded whole; images are fetched per part; PDF text is held whole in memory with no pagination cap or virtualisation. No large-document fixture or benchmark exists for the editor, so large-document behaviour is **not measured**.

## 24. Automated-test gaps

- No browser/e2e journey for: lists, styles, comments create/resolve/anchor, tracked-change accept/reject panel, authorities, redaction handoff, save banners, draft recovery, presence, collaborative merge/conflict UI, export/download, PDF viewer.
- No test asserts the full 20-step journey per control (interaction → … → Word reopen).
- `document-redo.spec.ts` and `document-selection.spec.ts` are credential-gated and skip without `E6_*`/`E52_*` env vars.
- The two most recent e2e runs each produced one flake (sign-in timeout; Review-tab click timeout), which suggests the browser suite is not yet reliable as a gate.

## 25. Manual-verification gaps

- Microsoft Word open/save/repair — NOT CHECKED (no Word available).
- Exported DOCX re-upload into Obiter — NOT CHECKED.
- Second edit/export cycle — NOT CHECKED.
- Visual fidelity of headers/footers/letterheads/tables/images in Word — NOT CHECKED.
- Screen-reader walkthrough and high-contrast/reduced-motion — NOT CHECKED.
- Large real-world DOCX performance — NOT CHECKED (no fixture).

## 26. Findings ordered by severity

### P0 (blocking)

- **P0-1 — Verification gap, not a confirmed defect: Microsoft Word round-trip is unverified.** No automated or recorded manual Word check exists; Word is unavailable here. The editor cannot be declared safe for legal export. Evidence: no Word-related test or artifact in the repo; `TESTING.md` does not include a Word gate. This must not be downgraded.

### P1 (major)

- **P1-1 — 43 of 95 visible controls are disabled placeholders.** Section 4. Includes alignment, line spacing, font family/size/colour, clear formatting, page setup, breaks, tables, images, links, headers/footers/page numbers, footnotes, TOC, cross-references, defined terms, spelling, compare versions, share-safe export. `ribbon-*.tsx` `soon` props.
- **P1-2 — Comment anchoring is whole-paragraph only; imported comments invisible.** `docx-workspace.tsx:470-490` hard-codes `startOffset: 0` and `endOffset` = paragraph length; `comments-panel.tsx:45-80`; `listDocumentComments` reads only `document_comments`.
- **P1-3 — Ribbon Accept/Reject change are placeholders; no change navigation or bulk action.** `ribbon-review.tsx:212-217`.
- **P1-4 — Paragraph alignment, indentation, spacing and keep-with-next cannot be edited.** Paint-only (`document-page-style.ts`); all controls `soon`; no `set_paragraph_format` emitter.
- **P1-5 — Font family, size and colour cannot be edited.** `document-format-types.ts:1-40` excludes them; controls `soon`.
- **P1-6 — Structural content is not editable.** Tables, images, hyperlinks, headers/footers, page numbers, footnotes, TOC, cross-references, sections, breaks — preserved but no writer or control.
- **P1-7 — No accessibility shortcut for bold/italic/underline and no editor e2e at narrow widths/zoom.** `document-workspace-keys.ts` handles only S/P/Z/Y/F.
- **P1-8 — Multi-paragraph paste collapses into one paragraph.** `paragraph-editor.tsx:399-417` only intercepts paste with a live selection; otherwise `onChange` inserts the whole string into one run.
- **P1-9 — Tracked partial-range formatting is refused.** `document-format-toolbar.ts:160-175`; mid-run bold with tracking on is impossible.

### P2 (moderate)

- **P2-1 — Delete paragraph can empty the body; save then fails.** No client guard; server refuses (`model-edit-validation.ts:37-40`).
- **P2-2 — Find is single-paragraph and case-insensitive only.** `document-find.ts`.
- **P2-3 — No undo grouping.** One history entry per keystroke (`use-workspace-drafts.ts`, `document-editor-history.ts`).
- **P2-4 — Style gallery degrades to `soon` chips when no paragraph styles exist; mixed-style pressed state undefined.** `ribbon-home.tsx:307-334`, `document-format-controls.ts:150-162`.
- **P2-5 — No list restart/start-value.** No op or control; `document-list-toggle.ts`.
- **P2-6 — Comment resolve allowed to any editor; no un-resolve.** `routes/comments.ts:89`.
- **P2-7 — Export filename non-ASCII downgrade.** `document-export.ts:103`.
- **P2-8 — Presence is per-process in memory.** `app.ts` presence registry.
- **P2-9 — Non-current versions readable by any `view` grantee.** `routes/document-export.ts`, `routes/tracked-changes.ts`.
- **P2-10 — PDF viewer has no large-document handling or find.** `pdf-view.tsx`, `workspace.tsx:285-363`.

### P3 (minor)

- **P3-1 — Print layout is a silent pressed no-op.** `ribbon-review.tsx:275`.
- **P3-2 — Ruler and Navigation pane are placeholders.** `ribbon-review.tsx:283-288`.
- **P3-3 — Ribbon touch targets are 28×28 px.** `ribbon-primitives.tsx` `h-7 w-7`.
- **P3-4 — Browser e2e suite produced one flake per recent run.**

## 27. Test results

Commands run from the assessed worktree after `bun install --frozen-lockfile` (no version changes).

| Check                                       | Command                                                                                      | Result                                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| OOXML tests                                 | `bun run --filter @obiter/ooxml test`                                                        | **229 pass / 0 fail** (26 files, 920 assertions)                                          |
| App-shell tests                             | `bun run --filter @obiter/app-shell test`                                                    | **1094 pass / 0 fail** (116 files, 95,494 assertions)                                     |
| Contracts tests                             | `bun run --filter @obiter/contracts test`                                                    | **130 pass / 0 fail** (7 files)                                                           |
| API document-focused tests                  | `TEST_DATABASE_URL=…obiter_test bun test` on `document-*`/`comments-*` route & domain suites | **345 pass / 0 fail** (27 files, 1,721 assertions)                                        |
| Typecheck                                   | `bun run typecheck`                                                                          | **clean** (every workspace 0)                                                             |
| Format                                      | `prettier --check .`                                                                         | **clean**                                                                                 |
| Lint                                        | `bun run lint` (`oxlint && eslint .`)                                                        | **clean** (only a Node `MODULE_TYPELESS_PACKAGE_JSON` warning)                            |
| E2E `e47-split-enter.spec.ts`               | isolated stack, task-owned DB                                                                | **1 pass / 0 fail**                                                                       |
| E2E `document-character-formatting.spec.ts` | isolated stack                                                                               | **3 pass / 0 fail on rerun**; first run 1 sign-in timeout flake                           |
| E2E `document-history-save.spec.ts`         | isolated stack                                                                               | **4 pass / 1 fail**; the failing test passed in isolation → flaky, not a confirmed defect |

Not run: the full `services/api` suite (focused document suites only); `document-redo.spec.ts` and `document-selection.spec.ts` (credential-gated, skipped); `redact-finalize`, `responsive-shell`, `mode-rail`, `meeting-demo-*` e2e; benchmarks.

Not tested / not checked: Microsoft Word; exported-file re-upload; second export cycle; screen readers; high contrast; large real documents.

## 28. Recommended temporary safety treatment for misleading controls

Per the non-negotiable requirement, no control should be hidden or removed without the owner's approval. Recommended interim treatment:

1. Keep the 43 `soon` controls visible but disabled and honestly named (already the case). Add a visible reason (a shared tooltip or a "not available yet" caption) so the disabled state is explained without hover.
2. Fix the two silent no-ops: give **Print layout** a real handler or mark it disabled with an honest label; guard **Delete paragraph** against removing the last body paragraph, with a reason.
3. Correct the Comments panel copy to state that a comment anchors to the whole paragraph, until range anchoring ships.
4. Add a visible "export not verified in Word" notice on the Export action until the Word conformance harness exists.

## 29. Synthetic conformance corpus

Existing synthetic coverage (no client material):

- **OOXML fixture builder** (`packages/ooxml/fixtures/builder.ts`, `fixture-parts.ts`, `manifest.ts`): numbering/list restarts; nested multilevel lists; style inheritance and linked styles; section breaks with two headers and two footers; footnotes; endnotes; cross-references and `STYLEREF`/`SEQ`/`TOC`/`REF` fields; merged and nested tables; content controls; embedded images; comments; all six tracked-change elements with author/date; identity with and without `w14` ids; opaque parts (settings, theme, font table, web settings, custom XML, signatures).
- **Upload/extraction fixtures** (`services/api/test-fixtures/upload-corpus/`): plain letter, table letter, image letter, footnotes/numbering letter, tracked-changes letter.
- **Product fixtures** (`data/evals/redact/`): `demo-fixture.docx` (synthetic judgment/witness-style with headings and numbered paragraphs), `docx-edge-cases-fixture.docx`.
- **E2E fixture** (`apps/web/e2e/fixtures/e47-split.docx`).

Mapping to the requested 20 categories: categories 1 (letter), 4 (nested numbering), 5 (tables/merged cells), 6 (inline/floating images), 8 (headers/footers/page numbers), 9 (comments), 10 (tracked insert/delete), 11 (tracked formatting), 12 (footnotes), 13 (hyperlinks/bookmarks/cross-references/fields), 15 (list restarts/nesting), 16 (mixed run properties, partial), 19 (malformed DOCX — via package-limit and extraction tests rather than a committed fixture), 20 (unsupported advanced features) are covered. Missing or thin: 2 (a realistic skeleton argument with citations), 3 (witness statement with statement of truth), 7 (letterhead), 14 (multi-section with differing orientations/margins), 17 (Unicode/legal symbols/non-ASCII names), 18 (large multi-page). New fixtures must remain synthetic and narrowly scoped, and must not be committed if they contain real material.

## 30. Dependency-ordered implementation programme

Every ribbon control is accounted for. "Operational in" names the PR that makes the control perform its stated action.

### PR-E1 — Editor foundations: selection, clipboard, keyboard, history

- Implement Paste/Cut/Copy (clipboard API + selection integration; multi-paragraph paste splitting).
- Add Ctrl/Cmd+B/I/U and a shortcut layer; add undo grouping (time/word coalescing).
- Guard the last body paragraph; define zero-paragraph behaviour.
- **Operational in E1:** Paste, Cut, Copy.
- Depends on: nothing.

### PR-E2 — Character formatting completion

- Wire Font family, Font size, Font colour and Clear formatting to the existing `set_run_emphasis` fields and paint.
- **Operational in E2:** Font family, Font size, Font colour, Clear formatting.

### PR-E3 — Paragraph formatting

- Emit `set_paragraph_format`; wire Align left/centre/right/justify, Line spacing, Layout Indent (none/first-line/hanging), space before/after, keep-with-next.
- **Operational in E3:** Align left/centre/right/justify, Line spacing, Indent.

### PR-E4 — Lists and styles

- List restart/start-value, deeper multilevel, robust gallery, mixed-style state, style application on pending inserts.
- **Operational in E4:** Multilevel numbering, Numbering, Bullets, Increase/Decrease list indent, Continue list (hardening); style gallery and Paragraph style (hardening).

### PR-E5 — Page and section layout

- Section properties writer; Margins, Orientation, Page size, Page break, Section break.
- **Operational in E5:** Margins, Orientation, Page size, Page break, Section break.

### PR-E6 — Structural insertions

- Tables (insert, merged cells, nested), images (inline/floating), hyperlinks, cross-references.
- **Operational in E6:** Insert table, Picture, Link, Cross-reference.

### PR-E7 — Headers, footers, generated structures

- Header/Footer editor, Page number field, Insert footnote, Table of contents.
- **Operational in E7:** Header, Footer, Page number, Insert footnote, Table of contents.

### PR-E8 — Comments

- Range anchoring, insertion-point comments, comment navigation, imported Word comment display, reply, resolve authorization, export fidelity.
- **Operational in E8:** comment creation/anchoring/navigation (panel and both Comments toggles).

### PR-E9 — Tracked changes

- Ribbon Accept/Reject, bulk and navigation, partial-range tracked formatting, imported-change review.
- **Operational in E9:** Accept change, Reject change (ribbon), Track changes hardening.

### PR-E10 — Versions, comparison, collaboration

- Compare versions, version selection and difference presentation, version-level ACL, presence hardening.
- **Operational in E10:** Compare versions.

### PR-E11 — Legal-document tools

- Citation style, table of authorities, defined-term mark/check, cross-reference check, Verify-citations integration.
- **Operational in E11:** Citation style, Mark defined term, Check defined terms, Check cross-references, Verify citations hardening.

### PR-E12 — Redaction handoff, share-safe export, print, classification

- Redaction return path; Share-safe export; Print hardening; Document type, Draft, Privileged, Without prejudice markings.
- **Operational in E12:** Share-safe export, Document type, Draft, Privileged, Without prejudice, Redact this document (return path).

### PR-E13 — Accessibility, responsive, Word conformance

- Spelling/proofing; Ruler; Navigation pane; Print layout alternatives; narrow-width/zoom/reduced-motion/high-contrast; Microsoft Word round-trip harness and fixture.
- **Operational in E13:** Spelling, Ruler, Navigation pane, Print layout.

## 31. Proposed PR sequence

| PR  | Theme                           | Makes operational                                               |
| --- | ------------------------------- | --------------------------------------------------------------- |
| E1  | Editor foundations              | Paste, Cut, Copy                                                |
| E2  | Character formatting            | Font family, Font size, Font colour, Clear formatting           |
| E3  | Paragraph formatting            | Align ×4, Line spacing, Indent                                  |
| E4  | Lists and styles                | List hardening, style gallery/selector                          |
| E5  | Page/section layout             | Margins, Orientation, Page size, Page break, Section break      |
| E6  | Structural insertions           | Insert table, Picture, Link, Cross-reference                    |
| E7  | Headers/footers/generated       | Header, Footer, Page number, Insert footnote, Table of contents |
| E8  | Comments                        | Comment create/anchor/navigate/resolve, imported comments       |
| E9  | Tracked changes                 | Accept change, Reject change                                    |
| E10 | Versions/collaboration          | Compare versions                                                |
| E11 | Legal tools                     | Citation style, defined terms, cross-reference checks           |
| E12 | Redaction/export/classification | Share-safe export, markings, redaction return path              |
| E13 | A11y/responsive/Word            | Spelling, Ruler, Navigation pane, Print layout                  |

All 95 controls are mapped: 40 proven working (hardened where noted), 12 insufficiently verified (hardened in E4/E9/E11), 1 partially implemented (E1/E9), 1 broken (E13/E1), 43 placeholders (E1–E13 as above).

## 32. Acceptance criteria per PR

- **E1:** clipboard journeys pass in a browser (copy/cut/paste within and across paragraphs, multi-paragraph paste splits); Ctrl/Cmd+B/I/U work; undo groups a typing run into one step; deleting the last paragraph is refused or replaced by an empty-paragraph guard; all with unit + browser tests.
- **E2:** each control changes painted state, survives save/reload and export, and reopens in Word with the expected run property; mixed selections make a uniform value on click.
- **E3:** alignment, line spacing and indentation survive save/reload/export and reopen in Word; mixed selections apply uniformly.
- **E4:** list restart/start values survive round-trip; gallery applies styles across mixed and pending selections; no fallback placeholder when the document has styles.
- **E5:** margins/orientation/page size/section breaks survive save/reload/export and reopen in Word with the same geometry.
- **E6:** inserted tables (incl. merged/nested), images, hyperlinks and cross-references survive save/reload/export and reopen in Word; untouched OOXML remains byte-identical.
- **E7:** header/footer/page-number/footnote/TOC edits survive save/reload/export and reopen in Word.
- **E8:** comments anchor to a real selected range; imported Word comments display; navigation and reply work; exported comments reopen in Word; resolve is authorised.
- **E9:** ribbon accept/reject and bulk decisions create immutable versions; partial-range formatting is tracked; exported tracked changes reopen in Word.
- **E10:** compare versions renders a real difference; version selection is safe; presence is correct across instances.
- **E11:** authorities, defined terms and cross-references are checked against stored sources with honest uncertainty.
- **E12:** share-safe export and document markings survive export; redaction produces a linked document version and a return path.
- **E13:** keyboard-only operation; visible focus; announced status; narrow/zoom/reduced-motion/high-contrast; a Word conformance harness that opens and re-uploads exported files.

Every PR must include the full journey test for each control it makes operational, and must not weaken existing tests.

## 33. Remaining risks after the proposed programme

- Word compatibility is an external, evolving target; the harness will reduce but not eliminate risk.
- The opaque-preservation model means unsupported features remain invisible/uneditable; ingestion of source material may surface features the model cannot edit.
- Collaborative merge of same-range edits remains conflict-based; legal users may expect finer merging.
- Presence and caches are per-process; scale-out needs shared state.
- Large-document performance is unmeasured.
- Accessibility and responsive behaviour need ongoing verification as the ribbon grows.

---

## Appendix A — exact file references

- Ribbon: `packages/app-shell/src/components/document-workspace/ribbon-home.tsx`, `ribbon-insert-layout.tsx`, `ribbon-review.tsx`, `ribbon-find.tsx`, `ribbon-primitives.tsx`, `ribbon-types.ts`, `toolbar.tsx`.
- Workspace: `packages/app-shell/src/components/document-workspace/docx-workspace.tsx`, `workspace.tsx`, `pdf-view.tsx`, `workspace-chrome.tsx`, `comments-panel.tsx`, `changes-panel.tsx`, `authorities-panel.tsx`, `save-banners.tsx`, `use-document-save.ts`, `use-workspace-drafts.ts`, `use-workspace-caret.ts`, `use-workspace-find.ts`, `use-presence-heartbeat.ts`, `use-save-baseline.ts`, `document-page-style.ts`.
- Editing: `packages/app-shell/src/document-edits.ts`, `document-range-edits.ts`, `document-word-edits.ts`, `document-run-range.ts`, `document-format-types.ts`, `document-format-edits.ts`, `document-format-toolbar.ts`, `document-format-controls.ts`, `document-list-toggle.ts`, `document-editor-history.ts`, `document-history-baseline.ts`, `document-find.ts`, `document-save-plan.ts`, `document-workspace-keys.ts`.
- OOXML: `packages/ooxml/src/parse.ts`, `serialise.ts`, `model-edits.ts`, `model-edit-validation.ts`, `model-paragraph-edits.ts`, `model-property-edits.ts`, `model-run-emphasis.ts`, `model-run-range-edits.ts`, `model-style-edits.ts`, `comment-anchors.ts`, `comments-package.ts`, `tracked-changes.ts`, `tracked-edits.ts`, `tracked-change-decisions.ts`, `collaboration-merge.ts`, `document-lineage.ts`, `equivalence.ts`; fixtures `packages/ooxml/fixtures/*`.
- Contracts: `packages/contracts/src/document-edit.ts`, `document-model.ts`, `document-comments.ts`, `document-collaboration.ts`, `document-tracked-changes.ts`, `document-lineage.ts`.
- API: `services/api/src/routes/documents.ts`, `document-edit.ts`, `document-model.ts`, `document-content.ts`, `document-export.ts`, `document-collaboration.ts`, `document-pdf-view.ts`, `document-media.ts`, `comments.ts`, `tracked-changes.ts`; domain `services/api/src/document-versions.ts`, `document-version-commit.ts`, `comments-db.ts`, `document-presence.ts`, `document-artifact-store.ts`, `document-media-response.ts`; migrations `packages/database/migrations/0014_document_comments.sql`, `0026_document_version_lineage.sql`.
- Web/e2e: `apps/web/src/routes/matters/$matterId/documents/$documentId.tsx`, `apps/web/playwright.config.ts`, `apps/web/e2e/*.spec.ts`.
- Docs: `docs/specs/documents/ooxml-fidelity.md`, `semantic-xml-equivalence.md`, `docs/current-product-scope.md`, `TESTING.md`.

## Appendix B — audit hygiene

- Base commit stated: `4667e76aca7e4ff09b6f1ba965c367591cc4dc88`.
- Only `docs/audits/document-editor-completeness-audit.md` was added. No product code, schema, migration, dependency, test or configuration changed.
- The isolated e2e database `obiter_editor_audit_test` was created and migrated for verification only; it is not part of the repository.
- Synthetic fixtures only; no real client or matter material was used.
- Nothing was merged.
