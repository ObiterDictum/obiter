# Detection: UK Tuning Strategy

Status: design record, **not scheduled.** Separate track from
[Redact PRD 5](../../prds/redact-5-local-first.md); no milestone.
Date: 2026-07-29
Related: `fine-tuning.md` (mechanics), `synthetic-data-plan.md` (corpus generation)

This note records *what* UK tuning should target and what it should not. The
mechanics of running a fine-tune are in `fine-tuning.md` and are not repeated here.

## The division of labour is already correct

Structured identifiers belong to regex with validation, not to a probabilistic token
classifier. NI numbers have a fixed format with invalid prefix rules that can be
checked outright. Neutral citations are rigidly structured. For these, a validated
pattern is strictly better than a model, and cheaper.

This is already implemented. `packages/redaction-policy/src/supplement.ts` covers
national insurance numbers, case references, organisation names, emails, UK phone
numbers, postcodes, GB IBANs and context-gated sort codes and account numbers.

**Fine-tuning should not target these.** They are at ceiling. Effort spent teaching
the model to recognise NI numbers is effort spent duplicating a solved problem with
a worse tool.

## What fine-tuning should target

The contextual entities the model genuinely owns, where UK forms differ from the
US-centric training distribution:

- UK person names
- UK address forms (postcodes are handled by the supplement; building and street
  patterns are not)
- UK phone formats in running prose, where the supplement's patterns are too strict

## On "making Rampart forget American things"

Rejected as framed.

A US Social Security number or driver's licence appearing in a UK commercial dispute
is still personal data that must be redacted. International parties are common.
Dropping those labels costs recall and buys nothing.

Separately, retraining a BIO head to unlearn labels risks catastrophic forgetting
across the whole tag set, degrading entity types we depend on, in exchange for no
product gain.

**The legitimate concern is narrower**: a US-trained pattern misfiring on a UK
identifier, for example a driver's licence recogniser firing on a case reference.
That is a precedence and mapping problem, not a training problem. It is resolved by:

1. Suppressing specific label-to-category mappings where a genuine collision exists
2. Ordering the deterministic recognisers so UK patterns claim their text first

Both are configuration. Both are reversible. Neither requires a GPU.

**Action: enumerate the actual collisions before changing anything.** The premise
that US labels are misfiring on UK text is currently an assumption. It should be
measured against the existing detection benchmark first, and the suppression list
built from observed collisions rather than anticipated ones.

## Open items

- Measure US-label false positives on UK text against the existing benchmark
- Build the suppression list from that measurement
- Scope a UK contextual corpus (names, addresses, phone forms) for the fine-tune,
  following the marker-based generation approach in `synthetic-data-plan.md`
- `synthetic-data-plan.md` still describes the target as "OpenAI Privacy Filter"
  JSONL format, which predates the Rampart decision. Worth reconciling, though that
  is a separate correction and not owned here.
