# Bench Spec

Priority: `P2 university verification`

Bench is the repeatable evaluation layer for Search, Verify, Research, Redact, and Pi-backed agent workflows. It exists to make quality claims inspectable by Obiter and by external academic reviewers.

Bench must measure system behavior without storing secrets, private matter data, raw prompts containing matter facts, embeddings, or sensitive stack traces.

## Purpose

Bench should answer:

- what system version produced this result
- what dataset and benchmark version was used
- what configuration, model, prompt version, and retrieval settings were used
- what evidence was retrieved and used
- how the output was scored
- whether another reviewer can replay or inspect the run

## Benchmark Families

### Search

- exact citation resolution
- title and party-name search
- paragraph or provision retrieval
- source ranking quality
- query expansion and filter handling
- no-answer and ambiguous-query behavior

### Verify

- authority existence detection
- citation normalization and ambiguity handling
- quote fidelity
- paragraph reference checks
- proposition support classification once Verify Advanced exists

### Research

- source-bound answer quality
- citation coverage
- unsupported claim rate
- contrary authority surfacing
- post-generation Verify outcomes

### Redact

- PII and secret detection
- legal-specific redaction policy
- false positive and false negative rates
- PDF-safe redaction checks

### Agent

- task completion against a fixed goal
- tool-call correctness
- retrieval trace quality
- unsafe or unsupported action rate
- handoff clarity when the agent cannot complete the task

## Dataset Cards

Every benchmark dataset needs a small dataset card:

- stable dataset id and version
- benchmark family
- source and licence
- jurisdiction and legal domain
- task type
- expected answer or rubric
- known limitations
- whether the dataset contains sensitive data
- whether external model use is allowed

Real client matter data must not be used in benchmark datasets unless explicitly approved under the data rules.

## Run Record

Each run should produce a structured record:

- `run_id`
- `benchmark_id`
- `benchmark_version`
- `dataset_id`
- `dataset_version`
- `system_version`
- `git_commit`
- `started_at`
- `completed_at`
- `runner_version`
- `model_name`
- `prompt_version`
- `search_config_hash`
- `agent_config_hash`
- `score_summary`
- `artifact_refs`

The record should be stable enough to compare across releases.

## Artifact Set

Bench should persist bounded artifacts:

- normalized input
- allowed public-source excerpts
- retrieved evidence ids
- ranking and reranking scores
- generated answer or verification finding
- evaluator judgment
- failure category
- human-review annotation where present

Artifacts must use object keys that do not contain client names, matter names, original filenames, or raw legal text.

## Scoring Rules

Scores should be paired with failure labels. A single aggregate number is not enough for legal verification.

Useful labels:

- retrieval failure
- ranking failure
- source mismatch
- unsupported claim
- quote mismatch
- citation parse failure
- ambiguous authority
- stale-law risk
- tool misuse
- evaluator disagreement

Where model output is nondeterministic, Bench should support repeated runs and report variance rather than treating one run as definitive.

## Reviewer Workflow

Academic or domain reviewers should be able to inspect:

- input case
- expected behavior or rubric
- retrieved evidence
- model or agent output
- automatic score
- human override or note

Reviewer notes must not store private matter facts or raw legal text outside the approved benchmark dataset.

## Acceptance Criteria

- a benchmark can be run with one command or one job request
- each result records system, dataset, prompt, model, and retrieval versions
- each scored item links to bounded evidence artifacts
- failures are categorized, not only counted
- a reviewer can replay or inspect a run without access to private matter data
