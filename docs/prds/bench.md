# Bench PRD

## Summary

Bench is Obiter's evaluation product. It records repeatable tests for [Search](search.md), [Verify](verify.md), [Research](research.md), [Redact](redact.md), and [Pi](pi-agent-framework.md)-backed agent workflows so quality claims can be inspected by Obiter, legal reviewers, and university partners.

The first release is a university verification bundle, not a public leaderboard. It must prove that Obiter can run fixed tasks, preserve the evidence path, classify failures, compare system versions, and expose enough artifacts for independent review without leaking private matter data.

See the detailed implementation spec at [docs/specs/bench/](../specs/bench/).

## Problem

Legal AI evaluation often fails in three ways:

- results are anecdotal rather than repeatable
- aggregate scores hide why the system failed
- reviewers cannot inspect the evidence used by the system

Obiter needs a benchmark layer because Search upgrades, Verify checks, and Pi agent behavior will otherwise be impossible to compare safely. If a ranking change improves broad keyword search but harms exact citation lookup, Bench must expose that. If a prompt change improves answer fluency but increases unsupported claims, Bench must expose that too.

## Product Principles

- Evaluate the system, not just the model.
- Store enough context to replay or inspect a run.
- Prefer exact evidence and failure labels over broad confidence claims.
- Treat legal correctness as reviewable, not absolute.
- Keep benchmark data separate from private matter data.
- Make limitations visible in every report.

## Goals

- Provide repeatable benchmark runs for at least Search and Verify first.
- Produce versioned run records with dataset, system, model, prompt, and config metadata.
- Link every scored item to a Verification Evidence package when evidence exists.
- Support automatic scoring for deterministic tasks and human review for legal judgment tasks.
- Compare runs across commits and configuration versions.
- Export a university review bundle with methodology, dataset cards, scores, artifacts, and limitations.

## Non-Goals

- Public leaderboard.
- Generic LLM benchmark suite.
- Fully automated legal correctness scoring.
- Evaluation over private client matter data by default.
- Autonomous agent benchmarking before Pi emits durable traces.
- Certification or regulatory attestation.

## Users

### Obiter Builder

Compares system changes and needs failure categories that point to concrete work.

### Academic Reviewer

Inspects methodology, datasets, traces, evidence, and score calculation.

### Legal Domain Reviewer

Reviews legal outputs and annotates whether source support is accurate, weak, contradicted, or missing.

### Technical Reviewer

Checks reproducibility, artifact integrity, schema stability, and leakage boundaries.

## Core Use Cases

1. Run the Search citation benchmark before and after a ranking change.
2. Run Verify quote-fidelity fixtures after changing quote matching.
3. Produce a university bundle showing dataset cards, benchmark results, evidence packages, and failure categories.
4. Review failed cases and assign human annotations.
5. Compare two model or prompt versions on the same Research task set.
6. Benchmark Pi agent traces once Pi emits run and step records.

## Scope

### First Release Scope

- benchmark registry
- dataset cards
- Search benchmark family
- Verify benchmark family for authority and quote checks
- local runner
- run record JSON
- artifact directory format
- report JSON
- evidence package links
- manual review annotation format

### Later Scope

- server-side benchmark jobs
- review UI
- Research answer-quality benchmark
- Redact benchmark
- Pi agent benchmark
- run comparison dashboard
- repeated-run variance reporting
- signed export bundles

## Benchmark Families

### Search

Tasks:

- exact neutral citation lookup
- provider document id lookup
- case title and party-name lookup
- stored body-text search
- paragraph retrieval
- no-answer query
- ambiguous query

Core metrics:

- top-1 exact match
- top-3 exact match
- evidence unit recall
- citation parse success
- ambiguity surfaced
- no-answer precision

### Verify

Tasks:

- real authority resolved
- fake authority rejected
- ambiguous citation classified
- exact quote accepted
- materially altered quote flagged
- pinpoint paragraph exists

Core metrics:

- authority resolution accuracy
- false authority detection
- quote mismatch detection
- false positive rate
- manual-review rate

### Research

Tasks:

- answer from fixed public legal-source corpus
- cite exact paragraphs or provisions
- identify contrary or limiting authority
- avoid unsupported claims

Core metrics:

- claim evidence coverage
- unsupported claim rate
- citation accuracy
- post-generation Verify failure rate
- reviewer agreement

### Redact

Tasks:

- PII detection
- secrets detection
- legal-specific redaction policy
- pseudonymisation consistency
- PDF-safe redaction inspection

Core metrics:

- recall
- precision
- false positive class
- false negative class
- unsafe export blocked

### Pi Agent

Tasks:

- bounded research trace
- verification triage
- redaction review checklist
- stop or handoff under weak evidence

Core metrics:

- correct tool choice
- evidence before legal claim
- unsupported action avoided
- handoff correctness
- trace completeness

## Data Model

### Benchmark Definition

Required fields:

- `benchmark_id`
- `name`
- `family`
- `version`
- `description`
- `owner`
- `dataset_ids`
- `evaluator`
- `rubric_version`
- `allowed_external_calls`
- `sensitivity`
- `created_at`

### Dataset Card

Required fields:

- `dataset_id`
- `version`
- `name`
- `source`
- `licence`
- `jurisdiction`
- `legal_domain`
- `task_types`
- `case_count`
- `expected_output_type`
- `sensitivity`
- `known_limitations`
- `external_model_allowed`

### Benchmark Case

Required fields:

- `case_id`
- `dataset_id`
- `input`
- `normalized_expected`
- `rubric_refs`
- `source_refs`
- `negative_case`
- `tags`

### Run Record

Required fields:

- `run_id`
- `benchmark_id`
- `benchmark_version`
- `dataset_id`
- `dataset_version`
- `system_version`
- `git_commit`
- `runner_version`
- `model_name`
- `prompt_version`
- `search_config_hash`
- `agent_config_hash`
- `started_at`
- `completed_at`
- `status`
- `score_summary`
- `artifact_refs`

### Case Result

Required fields:

- `case_result_id`
- `run_id`
- `case_id`
- `status`
- `automatic_score`
- `human_score`
- `failure_categories`
- `evidence_package_id`
- `output_ref`
- `review_state`

## Failure Categories

Stable labels:

- `citation_parse_failure`
- `authority_resolution_failure`
- `ranking_failure`
- `retrieval_failure`
- `source_mismatch`
- `quote_mismatch_missed`
- `quote_mismatch_false_positive`
- `unsupported_claim`
- `contradiction_missed`
- `no_answer_failure`
- `tool_misuse`
- `handoff_failure`
- `policy_boundary_failure`
- `evaluator_disagreement`

Each failed item can have multiple labels.

## Reviewer Workflow

1. Reviewer opens a benchmark run.
2. Reviewer filters to failed or manual-review cases.
3. Reviewer opens the case input, expected behavior, output, and evidence package.
4. Reviewer applies a judgment:
   - correct
   - partially correct
   - incorrect
   - unsupported
   - ambiguous
   - evaluator disagreement
5. Reviewer adds a bounded note.
6. Bench records reviewer id, timestamp, judgment, and rubric version.

Reviewer notes must not introduce private matter data or unapproved raw legal text.

## Reports

Reports must include:

- benchmark and dataset cards
- run metadata
- score summary
- case-level results
- failure categories
- reviewer annotations
- evidence package references
- limitations
- excluded scope
- reproduction instructions

Reports must not state that Obiter is legally correct. They may state what the benchmark measured and what the observed result was.

## University Review Bundle

The first external bundle should include:

- methodology note
- dataset cards
- benchmark definitions
- run records
- report JSON
- selected human-readable report
- evidence packages for sampled cases
- limitations and open questions
- data handling statement

The bundle should be inspectable without access to private matters, secrets, internal credentials, or raw prompts containing private matter facts.

## Functional Requirements

- Bench must run a benchmark from a versioned benchmark definition.
- Bench must validate dataset cards before running.
- Bench must produce run records and case results.
- Bench must store artifacts under safe object keys.
- Bench must link case results to evidence packages when available.
- Bench must support deterministic evaluators.
- Bench must support rubric-based human review.
- Bench must export report JSON.
- Bench must support run comparison by benchmark and dataset version.

## Non-Functional Requirements

- Local runs should work without hosted infrastructure for the first release.
- Server runs should be resumable when worker infrastructure is ready.
- Artifacts should be compact and bounded.
- Reports should be stable enough for external review.
- Large result lists should be paginated or virtualized in future UI.

## Security And Compliance

- Do not use real client matter data unless explicitly approved.
- Do not store secrets, embeddings, private screenshots, or sensitive stack traces.
- Do not log raw prompts containing private matter facts.
- Do not include client names, matter names, original filenames, or raw legal text in object keys.
- Respect public-source licence and computational-analysis permissions.
- Keep hosted data in the EU where hosted storage is used.

## Dependencies

- [Search](search.md) evidence refs for retrieval benchmarks.
- [Verify](verify.md) findings for verification benchmarks.
- [Verification Evidence](verification-evidence.md) package schema.
- [Pi](pi-agent-framework.md) traces before agent benchmarks can be meaningful.
- Shared contracts package (`packages/contracts`) for run-record and case-result schemas.
- Artifact storage once hosted export exists.
- Worker jobs for long-running hosted benchmarks.

## Rollout

### Gate 1: Local Search Benchmark

Deliver:

- benchmark registry files
- dataset card schema
- local runner
- Search citation and title fixtures
- run record JSON
- report JSON

Exit criteria:

- same dataset and config can be rerun
- top-k results and failure labels are recorded
- no private data is present

### Gate 2: Verify Benchmark

Deliver:

- authority and quote fixtures
- deterministic scoring
- evidence package links
- manual review annotation format

Exit criteria:

- fake authority and bad quote cases are scored
- reviewer can inspect evidence for each case

### Gate 3: University Bundle

Deliver:

- methodology note
- dataset cards
- selected run results
- sampled evidence packages
- limitations

Exit criteria:

- external reviewer can understand what was tested, how it was scored, and what data was excluded

## Metrics

- benchmark case count by family
- top-1 and top-3 Search success
- authority resolution accuracy
- quote mismatch detection rate
- unsupported claim rate
- manual-review rate
- reviewer disagreement rate
- run-to-run variance
- benchmark runtime
- artifact export success rate

## Risks

- Bench may create false confidence if reports overstate what was measured.
- Public legal-source excerpt storage may require licence review.
- Manual review can become inconsistent without rubric discipline.
- Model nondeterminism may make comparisons noisy.
- Early benchmark datasets may be too narrow for university scrutiny.

## Open Questions

- Should first university-facing benchmarks prioritize Search or Verify?
- What minimum dataset size is credible for the first external conversation?
- Should benchmark definitions live in `data/evals` or `docs/prds` examples initially?
- Who owns legal reviewer calibration?
- Should exported bundles be signed or checksummed in the first release?
