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

## Provider smoke test

Before the tournament, run `pnpm synthetic-v2:smoke` with the same explicit network, terms, credential, judge-provider, judge-model, pricing, private-root, and spend-cap environment used for generation. Set each of `SYNTHETIC_V2_PRIMARY_JUDGE_PROVIDER` and `SYNTHETIC_V2_ADJUDICATOR_PROVIDER` explicitly to `openrouter`, `zai`, or `opencode-go`, alongside its corresponding `*_MODEL`. Z.ai uses `ZAI_API_KEY` against the general API endpoint and requires `OBITER_ZAI_GENERAL_API_CONFIRMED=1`; a GLM Coding Plan key is not eligible because that subscription is restricted to supported coding tools. OpenCode Go uses `OPENCODE_GO_API_KEY`, requires `OBITER_OPENCODE_GO_TERMS_CONFIRMED=1`, and permits only reviewed model/endpoint mappings. It submits one fixed, 300-word standard diagnostic specification to each reviewed candidate, permits no source regeneration, and writes an immutable `smoke/` artifact under the external private-corpus root. After a partial failure, `SYNTHETIC_V2_SMOKE_CANDIDATE` may select one reviewed candidate so successful paid paths are not replayed. Smoke artifacts are diagnostic only: they are not corpus partitions and never enter the tournament, training, development, or benchmark registries. The command defaults to a GBP 1 worst-case reservation cap; lower it with `SYNTHETIC_V2_SMOKE_MAX_GBP` after reviewing current pricing.

A direct-Z.ai/OpenCode-Go pairing is configured with `SYNTHETIC_V2_PRIMARY_JUDGE_PROVIDER=zai`, `SYNTHETIC_V2_PRIMARY_JUDGE_MODEL=glm-5.2`, `SYNTHETIC_V2_ADJUDICATOR_PROVIDER=opencode-go`, and a reviewed Go model such as `SYNTHETIC_V2_ADJUDICATOR_MODEL=grok-4.5`. Provider-qualified pricing entries are preferred so subscription quota is recorded at its published notional rate.

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

Human review is reserved for benchmark disputes and a deterministic stratified 15–20% audit, with increased sampling for protected-person and hard-negative documents. A judge-reference disagreement is a `human_adjudication_required` state, never an automatic acceptance or regeneration. Promotion requires a hashed human disposition for every failed or disagreeing judge verdict. Training-seed documents are automatically validated and may be sampled for drift checks. Each document records generation, label repair, regeneration, judge, and retry request telemetry; every request records its provider and every successful response must return the requested model identity. `SYNTHETIC_V2_PRIMARY_JUDGE_MODEL` and `SYNTHETIC_V2_ADJUDICATOR_MODEL` are required and must each differ from the writer, annotator, and one another. `pnpm bench:guard` deliberately requires explicit `--input` and `--benchmark-manifest` paths from those external repositories; it has no repository-local default.

A non-tournament pending checkpoint binds the complete frozen specification set and run provenance; resume it with `--resume-pending` and the exact human dispositions. Tournament disputes must instead use `--resume-tournament-candidate` with the canonical tournament manifest (the private tournament artifact writes `TOURNAMENT.json`). That path emits a new immutable candidate continuation containing the resolved candidate, metrics, and blind package; it never overwrites `root/tournament`.
