# Synthetic v2 staged corpus programme

## Goal

Build a private fine-tuning corpus and a credible, frozen UK legal PII benchmark without treating a document-count target as evidence of quality.

All documents are wholly fictional. Training, development/challenge, and benchmark partitions are generated from distinct deterministic specifications and must not be mixed.

## Stages

| Stage                 |        Documents | Visibility           | Purpose                                                                       |
| --------------------- | ---------------: | -------------------- | ----------------------------------------------------------------------------- |
| Tournament            | 24 per candidate | Private              | Compare writer/annotator pairs on fixed specifications.                       |
| Training seed         |              600 | Private              | Initial fine-tuning/adaptation corpus. Expand only after measured benefit.    |
| Development challenge |              100 | Private              | Selection, regressions, hard negatives, protected people, and role ambiguity. |
| Benchmark             |              280 | Public when released | Frozen external-model comparison set.                                         |

The corpus programme is defined in `scripts/synthetic-v2/program.ts`. Generation must select a named stage explicitly; no implicit 2,500-document bulk path is permitted. Private training, development, tournament, and benchmark-candidate artifacts belong only in the sibling `../obiter-redaction-data-private` repository. A benchmark candidate is never a release: promotion requires an explicit external benchmark release root with the `SYNTHETIC_V2_ROOT.json` benchmark-release sentinel, evidence, and a new immutable version. Non-tournament generation requires a hash-bound `SYNTHETIC_V2_PARTITION_REGISTRY` containing every prior partition; only the first training-seed run may use an empty registry with an explicit `noPriorPartitions` attestation.

## Model tournament

Evaluate a small shortlist on identical 24-document specifications. Record model/version/provider, terms review reference, latency, and cost telemetry. Selection is based on:

- accepted-document rate without draft regeneration;
- required-category and offset validity;
- entity precision/recall by category;
- protected/private/professional confusion;
- hard-negative false positives;
- factual consistency and legal-prose blind review;
- latency and cost per accepted document.

Cost is recorded for decision-making but is not an automatic generation cap. Tournament specifications are a fixed, stratified 24-document subset covering every document type, register, difficulty, and label-category group; the 280-document benchmark plan covers every quota-matrix cell.

Tournament entity metrics are scored against reference spans independently produced by the primary and adjudicating judges and accepted only when those references agree (or a recorded human adjudication resolves the disagreement). Candidate annotations are never scored against themselves. Hard-negative false positives are counted by overlap with each immutable hard-negative assertion, not by a document-level judge boolean.

## Annotation contract

Ground truth is immutable source text plus structured `{ start, end, category }` spans. The pipeline validates offsets and serializes XML only as an export format. Model-produced XML is not authoritative.

## Evaluation

Report micro and macro entity precision, recall, and F1, per-category metrics, role confusion, hard-negative false-positive rate, document exact-match rate, latency, and cost. Keep the benchmark frozen after adjudication. Do not train candidate models on benchmark or development documents.

## Human review

Human review is reserved for benchmark disputes and a deterministic stratified 15–20% audit, with increased sampling for protected-person and hard-negative documents. A judge-reference disagreement is a `human_adjudication_required` state, never an automatic acceptance or regeneration. Promotion requires a hashed human disposition for every failed or disagreeing judge verdict. Training-seed documents are automatically validated and may be sampled for drift checks. Each document records generation, label repair, regeneration, judge, and retry request telemetry; every successful response must return the requested model identity. `SYNTHETIC_V2_PRIMARY_JUDGE_MODEL` and `SYNTHETIC_V2_ADJUDICATOR_MODEL` are required and must each differ from the annotator and one another. `pnpm bench:guard` deliberately requires explicit `--input` and `--benchmark-manifest` paths from those external repositories; it has no repository-local default.
