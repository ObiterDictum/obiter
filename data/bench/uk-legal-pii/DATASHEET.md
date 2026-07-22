# Datasheet: UK Legal PII benchmark

**Publication status:** not yet generated or published. This template becomes a release datasheet only after the mandatory DeepSeek terms review and maintainer blind review have passed.

## Motivation and scope

The benchmark evaluates UK-legal PII span detection in fictional English-language legal documents. It is not legal advice, a source of authority, or representative of all UK jurisdictions, languages, legal aid practice, or legal-document styles.

## Construction

The planned corpus contains 280 documents: witness statements, particulars of claim, skeleton arguments, attendance notes, letters before action, tenancy/employment dispute correspondence, contract clauses, and court orders. Each document is specified through a quota matrix spanning document type, all v2 label categories, formal pleading/solicitor correspondence/internal-note registers, and standard/hard-negative difficulty. A document can cover several PII-category cells; the committed `stats.json` will contain every per-cell count.

Benchmark prose is generated only with a maintainer-selected Claude Opus model routed through OpenRouter's OpenAI-compatible API. The exact OpenRouter model slug and returned model ID are committed in the final manifest and datasheet. Direct Anthropic Batch API discounts and prompt caching are not used. Generated marker spans are mechanically parsed, category-checked against `v2_span_class_names` in `data/evals/redact/custom_label_space.json`, offset-round-tripped, deduplicated by shingle similarity, and rejected/regenerated on failure.

## Labels and validation

The v2 label space separates `person_private`, `person_protected`, and `person_professional`. Solicitors, in-house counsel, judges, counsel, experts, and named professionals are detected as professional spans but normally retained by later policy. Clients, parties, witnesses, children, anonymity-order subjects, and people in sensitive family, medical, immigration, employment, criminal, or safeguarding contexts receive private/protected labels. Private-looking contact details remain in scope regardless of a person's professional role. Neutral citations, statutes, courts, procedural dates, damages figures, and corporate registration numbers are deliberate hard negatives.

An independent Claude Haiku model routed through OpenRouter will review every benchmark document against the plain text and proposed spans, producing its own span reference and one verdict per immutable hard-negative assertion. A second judge with a different model identity adjudicates the reference; candidate metrics are computed only from agreeing independent references or recorded human adjudication, never by comparing annotations to themselves. A reference disagreement enters human adjudication rather than automatic acceptance. `supplementSpans` is run over every document as an additional mechanical miss signal. Each document records label-repair/regeneration state plus retry and judge telemetry, and every successful response must return its requested model ID. Human review is limited to every disputed item and a stratified 15–20% benchmark audit. The final committed QA report will state sample sizes, agreement, flagged cells, repair/regeneration counts, and audit outcomes.

## Privacy, licensing, and limitations

All content and purported PII are fictional. No real personal data, client matter data, real individuals, real firms, or copied legal text may be included. The intended benchmark licence is CC-BY-4.0, recorded in `LICENSE` when publication is approved.

Synthetic data can encode generator biases and is not a substitute for human-labelled real documents. The first release is English/UK-only and single-generator; generator mixing is flagged for future work. The private training corpus is deliberately not a published artifact and is checked against this benchmark by content hash before fine-tuning.
