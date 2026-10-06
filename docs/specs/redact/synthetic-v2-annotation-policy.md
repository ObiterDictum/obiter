# Synthetic v2 annotation policy

## Purpose

Synthetic v2 trains and evaluates **detection first**. A detected span is not automatically a redaction instruction: later policy may retain a public/professional entity while redacting private or protected people. Documents are wholly fictional and must not contain real personal data, firms, or copied legal text.

## Person labels

| Label                 | Mark                                                                                                                            | Default downstream treatment               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `person_private`      | Clients, parties, witnesses, and ordinary private people; every coreferent name variant.                                        | Redact/review.                             |
| `person_protected`    | Children, anonymity-order subjects, and people in family, medical, immigration, employment, criminal, or safeguarding contexts. | Redact/review; highest-risk audit stratum. |
| `person_professional` | Solicitors, in-house counsel, judges, counsel, experts, and named professionals acting in-role.                                 | Detect, normally keep.                     |

A role reference without a name (for example, “the Claimant”) is unmarked. A professional name remains `person_professional` in a judgment, correspondence, or report. This does not make their private-looking home address, personal mobile, or non-work email public: those values receive their own PII labels.

## Other labels

Use the v2 label space in `data/evals/redact/custom_label_space.json` for contact details, personal dates/DOBs, government and financial identifiers, passports/driving licences, URLs/IP addresses, NI numbers, organisation names, case references, and secrets. Date-of-birth wording and age references are in scope. Procedural dates are not.

## Hard negatives

Do not mark neutral citations, statutes, court names, procedural dates, damages figures, or corporate registration numbers. A cited authority's named judge or counsel is `person_professional` if represented as a name span, never `person_private`. Each hard-negative document must include explicit counterexamples for the requested category.

## Automated acceptance

Every document must pass marker/offset validation, required-category coverage, quota accounting, near-duplicate rejection, and `supplementSpans` miss detection. An independent judge reviews the plain text and proposed spans; a second judge handles disagreement, uncertainty, protected-person examples, and hard-negative conflicts. Cells exceeding the configured disagreement threshold are regenerated. The public benchmark additionally requires independent-judge agreement for every document and human review of disputes plus a stratified 15–20% audit.
