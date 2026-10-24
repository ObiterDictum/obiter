# Redaction Matters and the Redact–Matters Boundary

Status: specified, not built.

## Rule

Redact never crosses into Matters. The one exception is a **redaction matter**: a
matter explicitly marked as existing to produce redacted documents, for example a
Freedom of Information request or a subject access request.

In a redaction matter, a matter document can be redacted, and the finished redaction
comes back as a **new immutable version** of that document holding the redacted text.
That is the only way Redact writes into a matter. It never edits a version in place and
never touches any other matter data.

Everywhere else, Redact and Matters are separate:

- Standalone Redact (a file uploaded straight into Redact) has no matter and stays
  outside Matters.
- An ordinary matter shows no Redact controls and holds no redaction runs.

## Redaction matter flag

- `matters.redaction_matter boolean not null default false`.
- Set when the matter is created ("This matter is for producing redacted documents,
  for example an FOI request"), or turned on later by a member with edit rights.
- It cannot be turned off while the matter holds live redaction runs. Turning it off
  would leave runs in a matter that is not allowed to have them.
- Changing it is audited (`matter.redaction_matter_set`, `matter.redaction_matter_unset`).
- Migration: an existing matter that already holds linked redaction runs is marked as a
  redaction matter, so no run is orphaned. Every other existing matter stays ordinary.

## Enforcement

On the server, because hiding UI is not authorisation:

- `POST /api/documents/:documentId/redaction-runs` is refused with
  `matter_not_redaction_matter` unless the document's matter is a redaction matter.
- `POST /api/redaction-runs/:runId/return-to-document` is refused with the same code
  unless the run's matter is still a redaction matter.

In the app shell:

- The document Review ribbon's Redact group, the document page's redaction-runs region
  and the matter overview's Redaction runs panel render only in a redaction matter.
- A redaction matter is visibly labelled as one on the Matters list and the matter page.

## Redact owns its output code

Redact's Word output (the pseudonymised DOCX, which is also what "Return to document"
writes back) is built by Redact's own code, not by the document editor's edit
operations (`applyRunTextReplacementRange` and the shared range-edit machinery). The
Matters editor can therefore change without changing what a redaction produces.

Redact may share read-only parsing (`parseDocx`, zip loading and serialising) with the
editor. It must not share code that decides what the redacted bytes contain.

Within an accepted redaction range, Redact's output removes everything that could carry
the redacted content, visible or not:

- the text, replaced by the marker or token;
- field instruction text (`w:instrText`), for example a hyperlink target behind a
  redacted name. The field's begin, separator and end markers stay, so the field remains
  valid;
- nothing outside the range: tabs, breaks, field markers and footnote references at the
  range's edges belong to the text around it and are kept.

The existing gate stays as the last step: if any accepted span's text survives anywhere
in the package, the output is refused.

Hard redaction is unaffected by the field rule because its output is an image-only PDF,
but it uses the same Redact-owned burn step before rendering.

## Done when

- An ordinary matter shows no Redact controls, and the API refuses a matter-linked
  redaction run or a return for it.
- A redaction matter can redact a document and return it as a new version, and the
  version history shows where it came from.
- `services/api` Redact output code imports no editor edit operation.
- A pseudonymised DOCX of a redacted hyperlink contains neither the display text nor the
  hyperlink target.
