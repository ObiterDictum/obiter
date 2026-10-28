# Obiter UI redesign: mock-up brief

> The first-draft variants named below were superseded by `final/` and are not kept. The approved screens are in `final/`; the build is planned in `BUILD-PLAN.md`.

Obiter is legal software for UK lawyers (solicitors and barristers). It has five modules:

- **Search**: UK case law and legislation.
- **Matters**: a client matter holds documents, edited in a Word-like editor with tracked changes and comments.
- **Verify**: checks the citations, authorities and quotations in a document.
- **Redact**: produces redacted documents.
- **Research**: coming later. Matter **Artefacts**, the sources attached to a matter, are also coming.

The users are lawyers, not engineers. They value calm, dense, trustworthy screens. They do not want dashboards full of vanity numbers.

## What exists today

Screenshots of the current app at 1440x900 are in `/tmp/ui-audit/shots/`. Look at them first:

- `01-home.png` is the dashboard.
- `03-matters.png` is the matters list.
- `04-matter.png` is the matter page.
- `06-document.png` and `06b-document2.png` are the document page.
- `07`/`08` are Search, `09` is a judgment and `10` is legislation.
- `11` is Redact start, `12` is Redact review and `13` is Redact finalised.
- `14` is Verify and `15` is Settings.
- `19`/`20` are mobile and `23` is the account menu.

The current visual language:

- Dark by default, with a light theme.
- Near-black background (#0a0a0a) and Inter-style sans text.
- Slate-blue primary buttons.
- Salmon for flagged and warning states, green for done.

Real tokens and styles are in `apps/web/src/styles.css`. Read them and stay recognisably Obiter. Refine the palette; do not reinvent the brand.

## Audit findings the mock-ups must fix

1. **Navigation.** There are two systems at once:
   - a topbar (Home, Search, Matters, Verify, Redact);
   - an unlabelled 48px icon rail whose icons change on every page (matters and documents on one page, history and bookmarks on another, empty on the dashboard).

   Decided direction: **one labelled left sidebar**, collapsible to icons, especially in the document editor. Keep a thin top bar for breadcrumbs, global search (Ctrl+K) and the account menu. The sidebar should hold:
   - the module links;
   - pinned or recent matters;
   - room for Research later.

2. **Dashboard.**
   - Verify findings are missing entirely: a flagged citation is never mentioned.
   - "Needs you" and the Redaction panel duplicate each other.
   - The counts at the top right duplicate the "Workspace" stats row.
   - The stats are vanity numbers ("Spans detected 42").
   - Runs show only a filename, with no matter.
   - There are two search boxes.

   Wanted:
   - one ranked "Needs your attention" list: flagged Verify findings, redactions waiting for review, failed runs, and comments or tracked changes for me;
   - recent documents, with their matter and last edit;
   - matters with activity and open-item counts;
   - quick actions: new matter, upload, start redaction.

3. **Matters list.**
   - The green "active" badge sits on every row.
   - There is no document count, last activity, search, sort or filter.
   - Rows are full width.
4. **Matter page.**
   - Documents are listed twice (left column and main panel).
   - Metadata fills the top of the page.
   - Delete is the only header action.
   - "Upload" looks like plain text.

   It must make room for an **Artefacts** section (judgments, legislation, links, notes attached to the matter) under Documents. The Redaction runs panel appears only in a matter marked as a "redaction matter" (for example an FOI request). Show that matter type with a visible label.

5. **Document page.**
   - Raw IDs are shown (`mtr_53e40eba-…`, `ver_…`). Never show IDs.
   - Four stacked bands (title, details, Verify bar, ribbon) push the document about 480px down.
   - The ribbon truncates its controls ("De", "Automat").
   - Save and "All changes saved" show together.
   - Delete sits beside an "Immutable versions" badge.

   Wanted: a compact header, a Verify status that doesn't eat a full band, a ribbon that fits, and a Word-like page.

6. **Search and judgment and legislation pages.**
   - Search results show lowercase courts ("uksc") and ISO dates.
   - Results have no snippet and carry engine jargon ("Body text match · stored index").
   - The judgment title is duplicated, and the judgment sits in a nested scroll box.
   - Legislation contents show "s. 1, s. 2" with no headings.
7. **Redact.**
   - The primary entry is a paste-text box; upload is an unstyled native file input. Upload must come first.
   - In review, rejected spans look identical to accepted ones in the document.
   - Progress is said four times.
   - The decision buttons are cramped under the queue.
   - It says "Finalize" (use UK English: "Finalise").
8. **Verify page.** It's a bare list of runs with raw version IDs.
9. **Cross-cutting.**
   - Use one date format (e.g. "25 Oct 2026").
   - Use one button hierarchy (primary, secondary, ghost, destructive), with destructive actions never as the lone header action.
   - Make badge colours consistent.
   - Give every page a title.
   - Hide the "Agent: coming soon" chat bubble.

## Demo data to use in every mock-up

- **Firm:** Harrington Vale LLP. **User:** Alex Morgan (Owner).
- **Matters:**
  - Northgate Foods v Brightwater Packaging (NGF-0418, Commercial contracts). It holds 3 documents:
    - supply-agreement-northgate.docx (v2);
    - advice-note-northgate.docx (Verify: 1 flagged, 2 need review; the flagged item is "[2018] UKSC 24");
    - witness-statement-shah.docx.
  - Okafor v Lumen Logistics (OKA-0233, Employment).
  - Lindqvist Estate (LIN-0107, Private client).
  - An example redaction matter: "FOI request: Cheshire Council 2026/114".
- **Redaction runs:** witness-statement-shah.docx, one in review and one finalised.
- **Cases:** Wood v Capita Insurance Services Ltd [2017] UKSC 24; Rock Advertising v MWB [2018] UKSC 24; Secretary of State for Business and Trade v Mercer [2024] UKSC 12.

## Rules for the mock-ups

- Each file is one **self-contained HTML file**: inline CSS, no external fonts or CDNs, no build step.
- Only light JS where it shows behaviour (sidebar collapse, theme toggle).
- Use realistic legal content, not lorem ipsum.
- Design at 1440x900 first. Each file should also hold up at 1024 wide.
- Each variant must be a genuinely different idea, not a recolour. Put a short note at the top of each file, which the page can hide, saying what the variant optimises for and its trade-off.
- Write only inside `docs/design/ui-redesign/`. Don't modify any other file in the repository, don't commit and don't push.

## Added: the top of the document editor, and redlines

Extra screenshots:

- `24-document-details-open.png` shows the Details panel opened.
- `25-document-review-ribbon.png` shows the Review ribbon.
- `26-document-redline-scrolled.png` shows the page with a tracked change.

### Top of the editor: move information behind a "?" (info) button

Everything above the ribbon today is reference information a lawyer rarely needs while drafting:

- "DOCUMENT" eyebrow;
- matter ID, version ID, size and file type;
- "Immutable versions" badge;
- Details panel (SHA-256, "sync state", created/updated in US format, the version list, compare versions);
- the full-width Verify sentence repeating the version ID.

The editor's top should hold only:

- breadcrumb (Matter › Document);
- document name;
- one saving status;
- a Verify chip;
- Share/Export;
- an overflow menu (Delete lives there);
- a **"?" / info button** that opens a popover or side panel. The panel holds file details, version history with Compare, and an explanation of what "immutable versions" means.

Show the info panel open in at least one variant. Never show SHA or "sync state" by default.

### Redlines (tracked changes) and comments UX

Today:

- Tracked changes paint live as you type: deletions are red strikethrough, insertions green underline, and the painting matches exactly what Save writes.
- Imported Word revisions can be accepted or rejected singly or in bulk. Moves are listed but can't be decided.
- The Review ribbon's Tracking group is **icon-only and unlabelled**: track on/off, list, previous, next, accept, reject, accept all, reject all.
- There is no visible "Track changes is ON" state.
- There is no markup view switch (Word's All markup / Simple markup / No markup / Original).
- There is no list of changes showing author and time, no margin change bars, and no comment balloons in the margin.
- The Redact group sits in the Review ribbon even in ordinary matters. It should only appear in a redaction matter.

Design for a lawyer reviewing the other side's markup and drafting their own:

- an unmistakable Track changes on/off state;
- a markup view switch;
- a changes/comments side panel listing each revision and comment with author, time and accept/reject, synced to the page;
- margin change bars and comment anchors;
- author colours when there is more than one author;
- clear handling of an undecidable move;
- labelled controls (icon plus word) where space allows.

Use the supply agreement example: clause 4.2, where "60,000" was changed to "45,000" by "Brightwater (Legal)", plus a comment from Alex Morgan on 12.2.

## Decisions

- **Reviewing tracked changes (decided 26 Oct 2026): A as the base, plus parts of B.** Combined mock-up: `document-review-final.html`.
  - Keep from A:
    - the review happens in the normal editor's Review tab, not a separate mode;
    - the document stays wide and central;
    - the right-hand changes and comments panel stays synced to the page;
    - the labelled Tracking group, the markup view switch and the authors legend;
    - the undecidable move is pinned at the top of the panel.
  - Change from A: don't show each item twice. Drop the margin balloon cards and keep only small numbered markers beside the text, linked to the panel.
  - Take from B:
    - the fixed decision bar (Accept / Reject, keyboard hints, Previous / Next undecided);
    - checkboxes for bulk selection with "Accept selected" / "Reject selected".

## Polish pass: refine everything (decided 26 Oct 2026)

**Goal:** every screen, dialog and state in Obiter should look refined and high-end, at the level of Linear, Stripe's dashboard or Harvey. Calm, precise, expensive-feeling, and built for a lawyer's long working day.

**Chosen layouts.** These are the layouts to polish. Polish means refining them, not redesigning them:

- shell-a
- dashboard-a
- matters-a
- matter-a
- document-a, with document-review-final for review
- search-b, judgment, legislation
- redact-start-a and redact-review-a
- verify

### What is wrong with the first drafts (fix this everywhere)

- **Type:** too many sizes and weights, and lots of 10–11px text. Uppercase tracked eyebrow labels are everywhere ("MATTERS · REVIEW", "WORKSPACE", "PINNED MATTERS"). The system font fallback looks generic.
- **Borders:** everything is outlined: cards, rows, buttons, pills and panels. The noise comes from borders rather than content.
- **Badges:** filled pills on almost every row, in four competing colours (salmon, amber, blue, green).
- **Buttons:** heavy bold labels and uneven heights.
- **Hierarchy:** headers stack small metadata lines, so too many things compete at the same level.

### Polish standard

- **Font:** use the real app fonts, which are self-hosted in `final/fonts/`:
  - Inter variable for the interface;
  - IBM Plex Mono only for citations or code-like references, used sparingly.

  Load them with `@font-face` from `fonts/…` relative to `final/`.

- **Type scale:** 12 / 13 / 14 (body) / 16 / 20 / 28. Nothing below 12px. Weights 400, 500 and 600 only. Use tabular figures for numbers and dates. Sentence case everywhere. At most one small uppercase label per page.
- **Spacing:** a 4px grid with generous, consistent whitespace. Align everything to a clear column grid.
- **Separation:** separate with space and quiet surface steps, not borders. Use one hairline colour, used sparingly.
- **Colour:**
  - Neutrals with one accent, a refined Obiter slate-blue.
  - Semantic colours (flagged, needs review, done, failed) appear only for status and are desaturated.
  - The dark theme is layered charcoal surfaces, not pure black. The light theme is warm off-white and equally finished.
  - Both themes reach WCAG AA contrast.
- **Status:** shown as a small dot or icon plus a text label. Filled pills only where a status truly needs to shout (one flagged finding).
- **Buttons:**
  - Sizes: 32px by default, 28px compact.
  - One primary button per view; secondary and ghost for the rest.
  - Destructive actions are red only inside a confirmation step.
- **Icons:** one consistent 16px icon set with a 1.5px stroke, as an inline SVG sprite, used the same way everywhere.
- **Detail:**
  - Radius: 6px for controls, 10px for panels.
  - Elevation is subtle: one shadow level for popovers and dialogs.
  - Motion is 120–180ms ease-out and respects reduced motion.
  - Every focus ring is visible.
  - Hover states are quiet.
- **Documents:** pages look like real paper. Use a soft page shadow, true margins and the document's own serif or sans. The app's chrome must never compete with the page.
- **Copy:** plain UK English for lawyers, with no engineering jargon, no raw IDs and one date format ("26 Oct 2026", "26 Oct 2026, 14:32").
- **Final files:** drop the "Optimises for" note bar. These are final designs, not options.
- **Shared style:** all final files share one stylesheet, `final/obiter.css`, and one icon sprite, so they look like a single product. Never restyle a component locally.

### Full inventory: every screen and state to polish (stage 2)

Every item becomes a file in `final/`. Where a state is small, put it as a toggle or second frame inside the parent file. Use the shared `final/obiter.css` and `final/icons.svg` only.

**Designer 1: account, shell surfaces, matters, settings, Verify**

- **Auth:**
  - sign in (password and magic link), plus magic link sent;
  - sign up;
  - forgot password, plus the email-sent state;
  - reset password;
  - accept invite;
  - signed-out or session-expired message.
- **Shell surfaces:** 404 / not found, generic error with retry, offline banner, permission denied (no access to a matter), global loading skeletons.
- **Matters:**
  - matters list (the polished matters-a) and its empty state;
  - create matter dialog, including the "This is a redaction matter (e.g. FOI)" option and validation errors;
  - matter page (the polished matter-a), in three states: ordinary, redaction matter, and new/empty;
  - edit matter details;
  - share matter dialog (people in the organisation, roles);
  - delete matter confirmation;
  - Add artefact dialog (search the corpus, paste a URL, write a note, pick a matter document);
  - a withdrawn-source artefact state.
- **Settings:**
  - Account (name, email, role);
  - Security (change password, signed-in sessions if shown);
  - Organisation (name, members table, invite member dialog, pending invites, roles, remove member confirmation);
  - Preferences (theme, date display) if useful.
- **Verify:**
  - findings list (the polished verify);
  - a single finding expanded, showing the authority, the problem, the suggested correction, and what was checked against which source;
  - a run in progress;
  - a run failed.

**Designer 2: documents, search and sources, Redact**

- **Documents:**
  - upload (drag and drop onto the matter, a progress list for several files, an unsupported or too-large error);
  - new blank document;
  - the editor (the polished document-a), with each ribbon tab shown: Home, Insert, Layout, References, Review, View;
  - the "?" information panel (details, versions);
  - the version history and Compare versions view (side by side or inline diff);
  - Export and Share menu;
  - Delete document confirmation;
  - the Insert link, Insert table, Insert authority and Insert cross-reference dialogs;
  - find and replace;
  - a comment thread with replies and resolve;
  - presence (another person viewing or editing);
  - read-only state for an older version;
  - the review screen (the polished document-review-final);
  - the Verify findings panel inside the editor, plus the "All findings" dialog;
  - unsaved changes and saving failed states.
- **Search and sources:**
  - search landing (recent searches, court shortcuts);
  - results (the polished search-b);
  - no results;
  - filters open;
  - judgment page;
  - legislation Act page and a single provision page;
  - the "Add to matter" popover choosing a matter.
- **Redact:**
  - start (the polished redact-start-a), including the matter picker restricted to redaction matters;
  - detecting in progress;
  - review (the polished redact-review-a, set in the FOI redaction matter, not Northgate);
  - edit span;
  - Finalise confirmation (choose a secure PDF or a pseudonymised Word document);
  - finalised with preview, download and share;
  - failed with a reason;
  - "Return to document" confirmation, which creates a new version in the redaction matter.

**When both designers finish:** `final/index.html` will list every final file grouped by area.

### Stage 2 rules (after stage 1 review)

- **Foundation:** `final/obiter.css`, `final/icons.svg`, `final/system.html` and `final/shell.html` are the foundation. Read the class conventions at the top of `obiter.css` and in `system.html`, and copy the frame markup from `final/dashboard.html`.
- **Do not edit `obiter.css`.** Two designers work at the same time. If you need a genuinely new component, put it in your own file, `final/obiter-d1.css` or `final/obiter-d2.css`, using the `.ob-` conventions. Link it after `obiter.css`. These are merged into `obiter.css` afterwards. Page-level layout may use a small `<style>` block; components may not.
- **Citations:** use body text with italic case names (_Wood v Capita Insurance Services Ltd_ [2017] UKSC 24), via `.ob-cite`. Monospace is only for client references such as NGF-0418, and only sparingly.
- **Demo data:**
  - witness-statement-shah.docx belongs to the FOI redaction matter ("FOI request: Cheshire Council 2026/114").
  - Northgate holds supply-agreement-northgate.docx and advice-note-northgate.docx, plus a third document, board-minutes-northgate.docx.
  - All Redact screens are set in the FOI matter.
- **Sprite:** each page may carry the hidden inline sprite copy, as stage 1 did, so it works over `file://`.

## Refinement pass: alignment, spacing, hierarchy and type (decided 27 Oct 2026)

The product owner likes the final set. Now it must feel **spacious**, and **everything must be aligned and consistent**. It should feel like a calm, expensive product where nothing is a pixel off.

### Rules: measurable, so they can be checked

**Layout grid and alignment**

- **One left content edge per page.** The page title, section titles, the first column of tables, card contents and list rows all start on the same x. A nested container (a card) has one inner edge, and its contents align to that.
- **Right edges line up too.** Header actions, the end of tables and the edge of the right rail share one right edge.
- **Top alignment.** The top of the right rail lines up with the first section title in the main column. Header actions are vertically centred on the page title.
- **Tables.** Numbers and dates are right-aligned with tabular figures. Columns align across every row. Row dividers run the full row width, including the action and chevron column.
- **Icons.** Icons are centred on the first line of their text. Every icon in a list sits in a column of the same width.
- **Breadcrumbs.** The breadcrumb in the top bar starts on the same x as the page content.

**Spacing (4px base; only these values may appear)**

- **4 and 8:** inside a component (icon to label, label to its meta line).
- **12 and 16:** between related items (rows in a list, fields in a form).
- **24:** card and panel padding, and the gap between cards.
- **40:** between sections on a page.
- **56:** page top padding.
- **Page side gutter:** 48px at 1440, 32px at 1024.
- **Content width:** content max 1120px. Reading text (judgment, legislation, long descriptions) max 68ch.
- **Rows and controls:**
  - list and table rows at least 52px tall, with 16px vertical padding;
  - sidebar items 36px;
  - controls 32px (28 compact) and 40px for large inputs.
- **Spacious beats dense.** Where a screen feels crowded, reduce what is shown (move secondary metadata into the "?" panel, a tooltip or a disclosure) rather than shrinking the spacing.

**Hierarchy: exactly these text levels and no others**

| Role             | Size and weight  | Line height | Tracking    |
| ---------------- | ---------------- | ----------- | ----------- |
| Page title       | 28 / 600         | 1.2         | −0.02em     |
| Section title    | 18 / 600         | 1.3         | −0.01em     |
| Item title       | 14 / 500         | 1.4         | —           |
| Body             | 14 / 400         | 1.55        | —           |
| Secondary (meta) | 13 / 400, muted  | 1.45        | —           |
| Caption          | 12 / 400, subtle | 1.4         | used rarely |

- One page title per page.
- No other sizes or weights except inside the document paper and the display numbers in the style guide.
- **Text colours:** only ink, muted and subtle, plus the status colours for status words.
- **Letter-spacing:** none on body text, and **never** on filenames, references or citations. The matter page currently shows letter-spaced filenames; fix that.
- **Spacing around headings:** headings get more space above than below. Section title to its content is 16px; the previous block to the section title is 40px.

### How to check (must be done, with numbers in the report)

Write a Playwright audit script in /tmp (not in the repo). For each page and state, at 1440 and 1024, in both themes, it reports:

- **(a)** the distinct `(font-size, font-weight)` pairs used outside `.ob-paper`. These must be a subset of the table above.
- **(b)** the distinct margin, padding and gap values used. These must be a subset of the spacing scale.
- **(c)** the left x of the page title, every section title, and the first content element of each section in the main column. These must be equal, to within 1px.
- **(d)** any element with non-zero letter-spacing other than the page title and section titles.
- **(e)** row heights in lists and tables below 52px.
- **(f)** overflow and text below 12px, as before.

Report before and after numbers.

### Stage B additions (found by eye after stage A; the audit missed them)

- **Filenames looked letter-spaced.** Inter's tabular figures also widen hyphens. Fixed in `obiter.css`: tabular figures apply only to numeric cells (`.is-num`, `.is-date`), `.ob-num` and `.ob-count`. Never put `tabular-nums` on text.
- **Table dividers drifted under the action column.** `display: flex` on a `<td>` takes the cell out of its row. Fixed in `obiter.css` for `.ob-doc-actions`. Never make a `td` or `th` flex or grid; put a wrapper inside it instead.
- **Truncation in narrow rails.** The dashboard's right rail cuts dates to "26 …". Spacious means secondary lines must fit: drop the less important part of the line rather than truncate. Only a long title may truncate, and only with a full-text tooltip.
- **Citations.** The matter page's artefact titles show case names in roman. Case names are italic and citations roman, everywhere (`.ob-cite`).
- **New audit checks.** Designer 1 adds these to `/tmp/obiter-audit/audit.mjs` before anyone fixes pages:
  - **(g)** visible text clipped with an ellipsis, excluding elements marked as long titles;
  - **(h)** any `td` or `th` whose computed display is not `table-cell`;
  - **(i)** `tabular-nums` on an element whose text contains letters, apart from date cells.
