# Live draft redlines

With Track changes enabled, the document workspace must paint unsaved text
revisions immediately. Save must write the same removed and inserted text,
with the same unchanged boundaries. The loaded model and draft operations remain
the source of truth; painted revisions never become saved review decisions.

## Shared revision contract

The OOXML parser records whether each text run is safely splittable: one optional
leading run-properties element and anchored plain text elements only, with no
text-wrapping breaks or unmodelled children. This fact must be derived while
source ranges and ordering exist, not reconstructed from preserved fragments.
Old cached models without this required metadata must regenerate.

A pure text-revision planner in `@obiter/contracts` consumes the original text,
the replacement and that eligibility. It returns unchanged head/tail and removed
and inserted text. Both the OOXML writer and workspace projection use it.
Substitutions expand to Word whitespace-delimited tokens; insertions/deletions
stay character-minimal. UTF-16 surrogate pairs remain intact. Ineligible runs
use the writer's whole-run replacement. Equal text produces no revision.

The client derives pending descriptors from `planDocumentSave`'s covered
operations, after partitioning blocked and unaddressable drafts. It must not
invent revisions from raw drafts. Server validation remains authoritative: a
preview is not a claim that a request has committed or will pass authorisation.

## Editable mapping

Pending insertion characters participate in editable text and all display to
editable mappings. Pending deletions occupy display space only. Saved revisions
remain opaque, including saved insertions. The same mapping drives textarea
edits, caret restoration, arrows, Backspace/Delete, selection, clipboard, DOM
range text and pagination slices.

A pending replacement retains the original run's editable identity. Virtual
paint runs must never enter a save payload or draft storage. Editing or undoing
inside a pending insertion recomputes the projection from the original baseline;
it must not create nested saved revisions. Pending marks are labelled unsaved
and excluded from the Changes panel's review navigation and decisions.

## Paragraph structure

Joins use the covered replacement operations, including the appended tail folded
into the head's last run. The removed paragraph remains visibly marked as a
pending deletion while tracking is enabled, matching the paragraph deletion Save
writes. Its text is display-only and cannot receive edits.

New paragraphs and replacements of runless paragraphs paint their covered text
as pending insertions. Their existing draft ids remain editable until Save
returns persisted lineage. Paragraph deletions include the paragraph-mark state;
empty paragraphs need an accessible visible marker even when no text can strike.
Blocked paragraph operations must not paint as revisions that Save will write.

## Equality and lifecycle

For a covered save plan, concatenating each pending removed/inserted piece must
match the revisions obtained by saving and reparsing that plan against the same
baseline with tracking enabled. Existing tracked text retains source order.
Turning tracking off restores the ordinary draft view; saved revisions remain.
Save, undo, redo, rejection recovery and model refresh all derive from their
current baseline and covered plan. A pending descriptor has no persisted OOXML id.

Text replacements precede range formatting in the current writer. Any future
operation order that can change granular eligibility must update both planner
inputs and projection in the same change. No client dependency on the OOXML XML
parser/writer is permitted. Memoisation must depend on stable model and draft
fields, not the entire workspace hook result or caret/presence updates.

## PR split and verification

1. This docs-only contract, based on `dev` at `b6bc584d`.
2. Parser metadata and shared planner, with writer parity tests, stacked here.
3. Workspace projection and editable mappings, stacked on the planner change.
   If paragraph structure needs a separate independently green change, split it
   before the final workspace integration.

The final implementation must pass the supplied `live-draft-redlines.test.tsx`,
cover whole-run fallback and paragraph structure, and demonstrate replacement
while typing and equal persisted revisions in the running app using synthetic
data. Capture before/after media and checkout/API provenance. Run the relevant
package suites, root typecheck/lint/format, build and bundle budget without
raising the budget. No PR in the stack is merged by this task.
