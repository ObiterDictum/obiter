The visual foundation is professional enough for a UK legal audience; the legal examples are not yet trustworthy enough for a launch demo.  
The warm light theme, restrained chrome and document-first layouts already feel credible and composed.  
Harvey's advantage is the connection between work, source, matter permissions and an accountable next action.  
Obiter's highest-impact improvements are accurate legal content, explicit provenance and safer review and disclosure decisions.  
Keep the chosen layouts; make light the first-use default and give the identity a more distinctive, restrained finish.

## Top 10 changes, ranked by impact

1. **P1 — Correct the legal examples:** Mercer, the sign-in quotation and the Verify quotation example contain substantive errors. [1]
2. **P1 — Put source and pinpoint beside every legal assertion**, and distinguish an editorial summary from the judgment. [2]
3. **P1 — Make redaction export boundaries explicit:** separate the sensitive schedule from the disclosure copy and substantiate “secure PDF”. [3]
4. **P1 — Show exactly what Verify checked, and what it did not**, before offering a correction or “Clear”. [4]
5. **P1 — Make tracked-change decisions unambiguous at 1024 × 768**, especially bulk selection and the undecidable move. [5]
6. **P1 — Show legislation's effective date and source**, rather than an unqualified “Current version”. [6]
7. **P2 — Make matter access and the decision history inspectable**, with named actors and times. [7]
8. **P2 — Use light by default and soften the dark document surround** for sustained reading. [8]
9. **P2 — Make the product more recognisably Obiter**, without changing the approved Inter-led system. [9]
10. **P2 — Clarify urgency, counts and decisions in the dashboard and review states.** [10]

## Findings by area

### Legal accuracy and sources

**[1] P1 · `search.html` `.ob-result` / `.ob-held`; `auth-sign-in.html` `.ob-auth-quote`; `verify.html` `.ob-finding-why`.** The Mercer result says the appeal was dismissed and implies s 146 provides the protection in question. The Supreme Court allowed the appeal to the extent of making a declaration of incompatibility; the result misleads on the central legal point. The sign-in text in quotation marks is a paraphrase, not the words of _Wood_ at [12]; the Verify example attributes wording from [10] to [12]. A lawyer will notice that the product which promises verification cannot verify its own demo. Replace Mercer with “Appeal allowed in part; s 146 declared incompatible with Article 11 insofar as it fails to protect against detriment for lawful strike action”, linked to the judgment and relevant paragraphs. Use a checked verbatim quotation with the correct pinpoint, or remove quotation marks and label it “Summary”. Correct the Verify example's source and paragraph. See the judgments linked below.

**[2] P1 · `search.html` `.ob-result-meta`, `.ob-held`; `judgment.html` judgment body.** “Held” looks authoritative but has no named author, source or pinpoint; the results' explanatory sentences have the same ambiguity. Harvey's Connector Library promises citations back to source material, and its research workflow grounds output in named authorities. Add “Obiter summary · judgment [121] · Open paragraph” to an editorial summary; use “Judgment extract” only for exact source text. On the judgment page add “Source: The National Archives / court” and “Open original” with retrieval date where known. Do not present reconstructed prose as the judgment: show actual source text or clearly label a mock extract.

**[6] P1 · `legislation-provision.html` `.ob-status`, `.ob-meta`; `legislation.html`.** “In force”, “Amended 6 Apr 2026” and “Current version” imply a definitive, up-to-date legal position without a source, effective date or extent qualification. Replace with “In force in England and Wales · text as at [date]”, a linked source and “Changes not yet incorporated” where applicable; offer “View original / point in time” when supported. Do not display an unverified date. Remove “4 min read”: a lawyer needs commencement and amendment information, not an editorial reading estimate.

### Redact and Verify

**[3] P1 · `redact-finalise.html` `.ob-choicecard`, `.rf-opt`; `redact-review.html` `.ob-spanrow`.** The checked “Include the redaction schedule” sits beside the external-disclosure PDF option without saying whether the schedule is embedded, separate, or contains the original sensitive text. “Secure PDF” asserts removal but gives no indication of what happens to metadata, annotations or other layers. Default the schedule to a separate, access-controlled file, unchecked for external sharing; say “Schedule may contain sensitive original text” if it does. State precisely which layers are removed or retained, only when the exporter actually guarantees it, and offer “Preview disclosure copy” before download. A completed list of detected spans does not prove all sensitive material was found: label progress “21 detected spans decided” and include a manual page-review step.

**[4] P1 · `verify.html` `.ob-finding-source`, `.ob-finding-acts`, “Checked against” card; `document.html` Verify chip.** The source line is a good start, but it is not an actionable source link, and “Clear” can be read as legal approval. A single “Replace” action risks implying that a citation fix validates the proposition. Link the exact source and paragraph; show document version, checked source and retrieval time in each finding; label the result “Citation matches checked source” rather than simply “Clear”. Add “Citation corrected; legal proposition not assessed” after replacement. Change “Not a problem” to “Dismiss finding” and request an optional reason, retaining actor and time. Harvey's source-linked answers and lawyer-approved research plans demonstrate this evidence-first approach.

**P2 · `redact-review.html` `.ob-spanrow-meta`, decision bar.** “High confidence” looks like confidence that disclosure is safe, although it may only describe detection. Say “Detection confidence: high” with a short explanation, or omit it until calibrated; retain the legal decision with the reviewer. Show a selected span's decision, reviewer and time in a disclosure, and give “Export schedule” a sensitivity warning. The visible original text in the review rail is appropriate for an authorised reviewer; make its presence explicit before sharing a screen or exporting a schedule.

### Editor and review

**[5] P1 · `document-review.html` changes panel, bulk controls and fixed decision bar.** At 1024 × 768 the pinned move plus bulk bar occupy much of the rail, while the bottom says “6 undecided” even though the selected move cannot be decided automatically and comments are included in the six open items. This makes scope of “Accept selected” difficult to judge. Preserve the decided in-editor Review tab, synced panel, markers and fixed bar. Separate counts: “3 changes · 2 comments · 1 move requiring manual review”; show “2 changes selected” and exclude comments and moves from bulk decisions. Explain “Move cannot be accepted or rejected here; compare both locations and edit manually.” At narrow widths collapse the pinned explanation to one line after it has been read, keeping “Compare both places” available. Disable destructive bulk actions until the selection is unambiguous and give a reversible confirmation with the affected count.

**P2 · `document.html` header and Review ribbon; `document-versions.html`.** “Saved 16:12” is reassuring but does not say which version is being reviewed or whether subsequent edits invalidate a Verify result. Keep the agreed `?` panel for details, but show “Saved · version 2” and a Verify state tied to that version; after an edit say “Check out of date · Run Verify”. In version history show “Version 2 · Alex Morgan · 26 Oct 2026, 16:12” and make compare direction explicit (“Version 1 → Version 2”). This follows Word's familiar version/revision model and Harvey II's emphasis on matter history.

### Matter, provenance and copy

**[7] P2 · `matter.html` matter details / Recent activity; `redact-review.html` audit-trail note; sharing dialogs.** “Every decision is recorded in the audit trail” is a promise without a visible route to the record; some activity entries name no actor. Add “View activity” showing actor, action, document version and time, e.g. “Alex Morgan · accepted change 4.2 · v2 · 26 Oct 2026, 16:12”. In Share show “Access: 4 named people” with roles and a link to manage access. If residency and processing locations are known, show the actual region in organisation/security settings; otherwise say “Contact your administrator” rather than invent a UK-hosting or confidentiality guarantee. Harvey II describes permissions and ethical walls attached to a matter; Obiter should make its own actual boundaries legible.

**[10] P2 · `dashboard.html` `.ob-attn-why`, `.ob-section-meta`; `matter.html` artefacts.** The ranked queue is useful, but “Ranked by urgency” gives no reason why a citation outranks a disclosure decision, while “Four items need you” can imply assigned responsibility. Keep the ranking decision; add a concise reason per item, such as “Accuracy risk · advice note” or “Awaiting your decision · 3 detected spans”, and only say “you” when assigned. “Artefacts” is unfamiliar outside some legal-tech teams: retain the decided term, add a first-use hint “Authorities, notes and other saved material”, and distinguish “5 artefacts” from “5 sources” if notes or documents are included. Use “26 Oct 2026, 14:32” consistently for absolute event times; reserve relative dates for supplementary context.

### Visual identity, themes and states

**[8] P2 · `obiter.css` theme tokens and `.ob-paper` surroundings; `settings-preferences.html`.** At 1440 and 1024, light makes the page and chrome feel like a familiar document workspace. In dark, the almost-black surround against white paper produces a hard halo, especially on editor and Redact screens. Recommend **light on first use**, then honour a saved choice and offer system theme; this explicitly challenges the current dark default, not the decision to support both themes. In dark, lift the canvas around paper to a layered charcoal (for example `#20242a`) and keep paper near-white; check text and markup contrast in both themes. Do not invert the document itself.

**[9] P2 · `obiter.css` `.ob-logo`; `shell.html`, `auth-sign-in.html`.** The rounded square with a generic “O”, Inter and slate buttons reads as a well-made SaaS shell rather than a distinctive legal product. Keep Inter for working UI and the document's own typography. Commission a simple, distinctive Obiter wordmark or monogram, set it at roughly the existing 24–28px footprint, and use it consistently in sign-in and the expanded sidebar. A restrained editorial serif may be used in the sign-in brand panel only; do not add a decorative serif to tables or editor chrome. The warm neutral and restrained blue are strengths; avoid adding a second bright brand colour. Harvey's material earns its premium feel through restrained presentation and concrete legal workflow context, not merely a serif or a logo.

**P2 · `search.html` at 1024 × 768.** The selected result's preview disappears, so the relationship between selection and evidence becomes unclear. Keep results prominent; add a “Preview” button that opens a dismissible right drawer over the results at this width, with source and pinpoint visible. Avoid forcing a user to open and lose their place in the list.

**P3 · `shell-loading.html`, `shell-offline.html`, `verify-run.html`; `obiter.css` motion rules.** Reduced-motion handling exists; keep it. Make work states informative rather than theatrical: “Checking citations in version 3 · 8 of 12 checked” only when the count is real, and “Offline · changes not yet saved” only when applicable, followed by the next action. No looping shimmer after a failure; preserve the document and offer Retry. Test focus return when a dialog closes and avoid moving the page under a reader during panel transitions.

## Keep

- The ranked “Needs your attention” queue, with a specific reason and next action; the sidebar and matter context remain familiar across modules.
- The wide paper page, labelled Review controls, markup selector, author legend, small linked markers and fixed decision bar. The pinned exceptional move is a good safeguard.
- The Verify finding's wrong/right comparison and named source line; make the evidence actionable rather than replacing the layout.
- Muted semantic status with text, italic case names and roman neutral citations, warm surfaces, restrained borders, and the spacious reading column.
- The `?` information panel decision and reduced-motion support; avoid returning technical version details to the default editor header.

## Sources and review scope

Harvey's most recent product announcement listed on its product blog at the review date is [Connector Library general availability, 21 October 2026](https://www.harvey.ai/blog/harvey-connector-library): reviewed connectors, administrator controls and citations to connected sources are the concrete trust signals. The broader [Harvey II launch, 18 August 2026](https://www.harvey.ai/blog/introducing-harvey-ii) describes matter-bound context, permissions, history and user-controlled memory. [October product releases](https://www.harvey.ai/blog/the-brief-october-2026) describe lawyer approval of a research plan and a fullscreen source preview. These are vendor descriptions, not independent verification of product behaviour; public launch text does not establish every visual detail of the live application.

Legal checks: [Supreme Court: _Mercer_ judgment and case details](https://www.supremecourt.uk/cases/uksc-2022-0080); [_Mercer_ judgment, especially [121]](https://www.bailii.org/uk/cases/UKSC/2024/12.html); [_Wood v Capita_, especially [10]–[12]](https://www.bailii.org/uk/cases/UKSC/2017/24.html).

Visual review used existing 1440 × 900 screenshots in both themes and direct 1024 × 768 renders of dashboard, search, document review, Redact review and Verify in both themes, plus judgment and provision views at 1024. Other findings are based on the relevant mock-up markup and copy; this is a design review, not a functional, accessibility or security audit.
