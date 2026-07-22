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

Before the tournament, run `pnpm synthetic-v2:smoke` with the same explicit network, terms, credential, judge-provider, judge-model, pricing, private-root, and spend-cap environment used for generation. Set each of `SYNTHETIC_V2_PRIMARY_JUDGE_PROVIDER` and `SYNTHETIC_V2_ADJUDICATOR_PROVIDER` explicitly to `openrouter`, `zai`, or `opencode-go`, alongside its corresponding `*_MODEL`. Z.ai uses `ZAI_API_KEY` against the general API endpoint and requires `OBITER_ZAI_GENERAL_API_CONFIRMED=1`; a GLM Coding Plan key is not eligible because that subscription is restricted to supported coding tools. OpenCode Go uses `OPENCODE_GO_API_KEY`, requires `OBITER_OPENCODE_GO_TERMS_CONFIRMED=1`, and permits only reviewed model/endpoint mappings.

The default `connectivity` smoke profile submits one fixed, 300-word standard diagnostic specification. It proves provider plumbing only and does **not** qualify tournament execution. Before every tournament provider/model configuration, remove `SYNTHETIC_V2_SMOKE_CANDIDATE` and run `pnpm synthetic-v2:canary` across all reviewed candidates. This profile preserves the complete first tournament specification, including its original length, categories, matrix cells, and hard negatives. A successful full-candidate run writes a hash-bound receipt under `tournament-canaries/`; the tournament refuses paid calls unless the private root contains a matching receipt for the current specification and judge configuration.

Both profiles permit no source regeneration and write immutable artifacts under the external private-corpus root. Tournament-canary qualification additionally requires every writer, annotator, and judge response to satisfy its structural contract on the first attempt: validation retries or pipeline repair may preserve diagnostic evidence but cannot create a receipt. After a partial connectivity failure, `SYNTHETIC_V2_SMOKE_CANDIDATE` may select one reviewed candidate so successful paid paths are not replayed, but selected-candidate evidence cannot create a tournament receipt. Smoke artifacts are diagnostic only: they are not corpus partitions and never enter tournament, training, development, or benchmark registries. The command defaults to a GBP 1 worst-case reservation cap. The more conservative tournament-canary estimate may exceed that default; set `SYNTHETIC_V2_SMOKE_MAX_GBP` only to a separately reviewed and approved estimate.

The reviewed tournament candidates use OpenRouter `anthropic/claude-sonnet-4.6` for independent annotation after Gemini 3.6 Flash failed repeated exact-spec structural conformance checks. Tournament qualification and execution require the reviewed OpenCode Go pairing `SYNTHETIC_V2_PRIMARY_JUDGE_PROVIDER=opencode-go`, `SYNTHETIC_V2_PRIMARY_JUDGE_MODEL=qwen3.7-max`, `SYNTHETIC_V2_ADJUDICATOR_PROVIDER=opencode-go`, and `SYNTHETIC_V2_ADJUDICATOR_MODEL=grok-4.5`. Qwen uses the reviewed Anthropic-compatible forced-tool route rather than best-effort JSON mode. Other allowlisted judge routes remain available for connectivity diagnostics but cannot authorize or assemble a tournament. Provider-qualified pricing entries are preferred so subscription quota is recorded at its published notional rate.

## Model tournament

Evaluate a small shortlist on identical 24-document specifications. Record model/version/provider, terms review reference, latency, and cost telemetry. Selection is based on:

- accepted-document rate without draft regeneration;
- required-category and offset validity;
- entity precision/recall by category;
- protected/private/professional confusion;
- hard-negative false positives;
- factual consistency and legal-prose blind review;
- latency and cost per accepted document.

Each reviewed candidate is a separate paid execution and candidate processes must run sequentially, never concurrently against the shared spend ledger. Set `SYNTHETIC_V2_TOURNAMENT_CANDIDATE` to one reviewed candidate and set `SYNTHETIC_V2_TOURNAMENT_CANDIDATE_MAX_GBP` to that candidate's separately reviewed conservative cap before running `pnpm synthetic-v2:tournament`. Tournament candidates permit no source regeneration: exhausted document validation is recorded as candidate-quality rejection and stops that candidate, while malformed provider output, accounting failure, or pipeline invariant failure remains operational evidence and creates no candidate run. A successful candidate writes an immutable artifact under `tournament-candidate-runs/<candidate>/`; it does not create the canonical tournament.

After all three candidate runs are complete, create a private `synthetic-v2-tournament-candidate-run-registry:v1` registry naming each candidate's relative artifact path and hash, then run `pnpm synthetic-v2:tournament:assemble -- --candidate-run-registry=<private-root-relative-or-absolute-path>`. Assembly makes no provider calls, requires exactly one valid run for every reviewed candidate with identical specification and judge configuration, and only then writes the canonical tournament dataset. Tournament specifications are a fixed, stratified 24-document subset covering every document type, register, difficulty, and label-category group; the 280-document benchmark plan covers every quota-matrix cell. A terminal provider or validation failure stops immediately, writes immutable spend/usage/request diagnostics under `failed-tournaments/`, prints a sanitized failure summary, and exits non-zero.

Tournament entity metrics are scored against reference spans independently produced by the primary and adjudicating judges and accepted only when those references agree (or a recorded human adjudication resolves the disagreement). Candidate annotations are never scored against themselves. Hard-negative false positives are counted by overlap with each immutable hard-negative assertion, not by a document-level judge boolean.

## Annotation contract

Ground truth is immutable source text plus structured `{ start, end, category }` spans. The pipeline validates offsets and serializes XML only as an export format. Model-produced XML is not authoritative.

## Evaluation

Report micro and macro entity precision, recall, and F1, per-category metrics, role confusion, hard-negative false-positive rate, document exact-match rate, latency, and cost. Keep the benchmark frozen after adjudication. Do not train candidate models on benchmark or development documents.

## Human review

Human review is reserved for benchmark disputes and a deterministic stratified 15–20% audit, with increased sampling for protected-person and hard-negative documents. A judge-reference disagreement is a `human_adjudication_required` state, never an automatic acceptance or regeneration. Promotion requires a hashed human disposition for every failed or disagreeing judge verdict. Training-seed documents are automatically validated and may be sampled for drift checks. Each document records generation, label repair, regeneration, judge, and retry request telemetry; every request records its provider and every successful response must return the requested model identity. `SYNTHETIC_V2_PRIMARY_JUDGE_MODEL` and `SYNTHETIC_V2_ADJUDICATOR_MODEL` are required and must each differ from the writer, annotator, and one another. `pnpm bench:guard` deliberately requires explicit `--input` and `--benchmark-manifest` paths from those external repositories; it has no repository-local default.

A non-tournament pending checkpoint binds the complete frozen specification set and run provenance; resume it with `--resume-pending` and the exact human dispositions. Tournament disputes must instead use `--resume-tournament-candidate` with the canonical tournament manifest (the private tournament artifact writes `TOURNAMENT.json`). That path emits a new immutable candidate continuation containing the resolved candidate, metrics, and blind package; it never overwrites `root/tournament`.
