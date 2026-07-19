# Datasheet: UK Legal PII benchmark

**Publication status:** not yet generated or published. This template becomes a release datasheet only after the mandatory DeepSeek terms review and maintainer blind review have passed.

## Motivation and scope

The benchmark evaluates UK-legal PII span detection in fictional English-language legal documents. It is not legal advice, a source of authority, or representative of all UK jurisdictions, languages, legal aid practice, or legal-document styles.

## Construction

The planned corpus contains 280 documents: witness statements, particulars of claim, skeleton arguments, attendance notes, letters before action, tenancy/employment dispute correspondence, contract clauses, and court orders. Each document is specified through a quota matrix spanning document type, all v2 label categories, formal pleading/solicitor correspondence/internal-note registers, and standard/hard-negative difficulty. A document can cover several PII-category cells; the committed `stats.json` will contain every per-cell count.

Benchmark prose is generated only with Claude Opus 4.8 (`claude-opus-4-8`) using Anthropic's Messages Batch API. The shared marking instruction is prompt-cached. Generated marker spans are mechanically parsed, category-checked against `v2_span_class_names` in `data/evals/redact/custom_label_space.json`, offset-round-tripped, deduplicated by shingle similarity, and rejected/regenerated on failure. Batch results are joined by `custom_id`, never response order.

## Labels and validation

The v2 label space contains person names, contact details, addresses, personal dates (including natural DOB wording and age references), government and financial identifiers, passports and driving licences, URLs/IP addresses, national-insurance numbers, case references, organisation names, and secrets. Neutral citations, statutes, courts, procedural dates, damages figures, and corporate registration numbers are deliberate hard negatives.

A Haiku 4.5 sample review will cover at least 10% of each corpus and report label agreement and obvious missed PII by matrix cell. `supplementSpans` is run over every document as an additional mechanical miss signal. Cells over the documented disagreement threshold are regenerated. The final committed QA report will state sample sizes, agreement, flagged cells, and regeneration counts.

## Privacy, licensing, and limitations

All content and purported PII are fictional. No real personal data, client matter data, real individuals, real firms, or copied legal text may be included. The intended benchmark licence is CC-BY-4.0, recorded in `LICENSE` when publication is approved.

Synthetic data can encode generator biases and is not a substitute for human-labelled real documents. The first release is English/UK-only and single-generator; generator mixing is flagged for future work. The private training corpus is deliberately not a published artifact and is checked against this benchmark by content hash before fine-tuning.
