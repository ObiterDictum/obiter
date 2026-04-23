# Phase 1 Plan

## Purpose

Phase 1 is not "build the whole platform." It is "build the first trustworthy legal workflow that proves the platform thesis."

That workflow is:

1. create a matter
2. upload a document or draft
3. redact or pseudonymise sensitive data
4. search public legal sources
5. ask a legal research question
6. generate a source-bound answer
7. verify the citations and quotes in a draft or generated output, with proposition support added in the advanced Verify stage
8. export a report a lawyer can review

## Phase 1 Deliverable

By the end of Phase 1, Ormont should support one coherent user journey:

- a lawyer opens a matter
- uploads a draft document
- runs redaction review on private content
- searches case law and legislation
- asks a research question against the open corpus
- receives an answer tied to specific paragraphs and provisions
- runs verification over the draft or answer
- exports a verification or redaction report

This is narrower than the full platform vision and that is intentional.

## What Is In Scope

Phase 1 includes:

- Atlas
- Redact
- Verify
- a thin Research interface
- integration into the Phase 0 application shell

Phase 1 does not include:

- full team collaboration
- full cloud sync
- deep Bench productisation
- broad jurisdiction coverage
- complete treatment analysis
- autonomous legal memo drafting without verification

## Foundational Product Concepts

### Matter

A matter is a single client workstream, case, dispute, transaction, or instruction. In Ormont, the matter is the private workspace that groups:

- uploaded documents
- redaction runs
- research history
- verification reports
- exported outputs

### Public Sources Versus Private Matter Data

The product must separate:

- public legal materials such as case law and legislation
- private matter materials such as client drafts, evidence bundles, and internal notes

This boundary is one of the main product requirements, not a nice-to-have.

## Phase 1 Modules

## Phase 0 Prerequisite

Phase 1 assumes Phase 0 already exists. That means:

- the user can authenticate
- the user can create and open a matter
- documents can be uploaded and tracked
- reports can be stored and retrieved
- the web and Electron shells already work

Phase 1 should not rebuild those foundations.

## 1. Atlas

Atlas is the public legal source layer for Phase 1.

### Goal

Allow the system to search and resolve a core England and Wales legal corpus well enough to support trustworthy legal research and verification.

### Must Build

- ingest selected case law sources
- ingest selected legislation sources
- normalise identifiers
- store paragraph-level judgment text
- store provision-level legislation structure
- index text and metadata for search
- support authority lookup by citation
- support keyword search with filters
- support paragraph-level retrieval

### Phase 1 Corpus Strategy

Do not aim for "all law" immediately. Start with a sharply defined corpus:

- UK Supreme Court judgments
- Court of Appeal judgments
- selected legislation needed for the first demo and early workflows
- enough metadata to support citation resolution and linking

Use official-access pathways and APIs wherever possible.

### Search Behaviors Required

- search by party name
- search by neutral citation
- search by statute title
- search by provision number
- search by keywords
- filter by court, date, and source type
- open the exact paragraph or provision used as evidence

### Required Outputs

- authority exists / does not exist
- canonical source record
- linked source URL
- relevant paragraphs
- relevant provisions

### Out of Scope

- broad editorial enrichment
- advanced treatment classification
- headnote generation at publisher quality
- multi-jurisdiction support

## 2. Redact

Redact is the privacy layer for Phase 1.

### Goal

Make it safe to process legal documents by detecting and reviewing sensitive content before the user sends material into downstream AI or exports it.

### Must Build

- detect common PII
- detect secrets and account-like strings
- apply legal redaction policy labels
- allow the user to review suggested redactions
- support pseudonymisation for internal use
- support irreversible redaction for export
- generate an audit log of what was changed

### Document Behaviors Required

- upload a document
- extract text
- run redaction detection
- show suggested spans
- accept or reject suggested spans
- export the redacted result

### Policy Modes

Phase 1 should support at least:

- internal AI minimisation
- external sharing or publication redaction

Desktop-local redaction is the preferred sensitive path. Hosted redaction may exist for web workflows, but it should be policy-controlled and explicitly presented as a hosted run.

### Required Outputs

- redacted text output
- pseudonymised text output
- redaction decision log
- summary of detected sensitive content categories

### Out of Scope

- perfect anonymisation claims
- all document formats
- full records management workflow
- unsupervised final redaction for high-risk documents

## 3. Verify

Verify is the trust layer for Phase 1.

### Goal

Detect the most dangerous legal AI and drafting failures in a lawyer-reviewable way.

Verify should be delivered in stages:

- Verify Core: authority existence, citation resolution, quote fidelity, and paragraph reference checks where feasible
- Verify Advanced: proposition extraction and proposition-to-authority support analysis

### Must Build

- extract citations from a draft
- resolve citations against Atlas
- flag unresolved or fake authorities
- identify quoted passages
- compare quotes to source text
- generate a structured verification report

### Advanced Verify Expansion

The later Verify milestone should add:

- identify cited propositions or claims
- assess whether the cited source supports the claim
- classify support as supported, weak, contradicted, or manual review required

### Verification Checks Required

- authority existence check
- citation resolution status
- quote fidelity check
- paragraph reference check where feasible
- outdated or date-sensitive authority warning where feasible

### Report Structure

The verification report should separate findings by type:

- fake or unresolved authority
- inaccurate quote
- citation without matching source support
- outdated or questionable legal basis
- manual review required

### User Outcome

The user should be able to see exactly what failed, why it failed, and which paragraph or provision was used to assess it.

### Out of Scope

- full legal correctness
- automatic court-ready signoff
- deep doctrinal reasoning across every claim type

## 4. Research

Research is the thin Phase 1 interface over Atlas and Verify.

### Goal

Provide a controlled research experience that produces source-bound answers instead of free-floating legal prose.

### Must Build

- ask a research question
- collect query context such as jurisdiction and date
- search Atlas
- retrieve supporting paragraphs and provisions
- generate an answer grounded in retrieved sources
- display supporting sources inline
- run post-generation verification on the answer

### Required Controls

- jurisdiction selection
- date or "as at" context where relevant
- visible source list
- visible paragraph references
- warning state when support is weak or mixed

### Required Outputs

- research answer
- cited sources
- paragraph-level evidence
- contrary or limiting authority section where available
- verification summary for the answer

### Out of Scope

- broad conversational assistant behavior
- agentic document drafting across the whole matter
- unsourced answers

## 5. Reports And Exports

Phase 1 needs exports because legal users need reviewable artifacts.

### Must Build

- export redaction report
- export verification report
- export research memo or summary

### Minimum Report Contents

- matter name
- input document name
- run date
- findings summary
- source references
- reviewer-facing notes

### Acceptable Early Formats

- HTML
- PDF
- Markdown

## Killer Demo Specification

The first real demo should use one draft skeleton argument containing:

- one fake case
- one misquoted case
- one outdated statutory reference
- unredacted personal data

The system should:

1. detect the private data
2. let the user review the proposed redactions
3. identify the fake authority
4. identify the misquote
5. surface the date-sensitive or outdated statutory problem
6. export a verification report with source references

Once Verify Advanced is added, the same demo should also identify a real case used for the wrong proposition.

If this workflow works end-to-end, Phase 1 is credible.

## Engineering Workstreams

Phase 1 can be planned as five parallel workstreams:

1. source ingestion and search
2. redaction pipeline
3. verification pipeline
4. research UI and orchestration
5. reporting and export

## Acceptance Criteria

Phase 1 is complete when all of the following are true:

- Phase 0 matter and document workflows already exist
- Ormont can search its public legal corpus by citation and keyword
- Ormont can retrieve source paragraphs and provisions
- Ormont can detect and review sensitive spans in the uploaded draft
- Ormont can verify authorities and quotes in the draft
- Ormont can produce a source-bound research answer
- Ormont can export a report a lawyer can inspect

## Non-Goals

To avoid scope failure, Phase 1 is explicitly not:

- a full Westlaw replacement
- a complete document management system
- an autonomous legal agent
- a full benchmarking product
- a polished enterprise collaboration suite

## What To Define Next

After this document, the next level of planning should be:

- exact user stories per module
- API surface for each service
- schema definitions
- ingestion source list
- evaluation fixtures for redaction and verification
- milestone sequencing by week or sprint
