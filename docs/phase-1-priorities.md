# Phase 1 Priorities

## Purpose

Phase 1 is split into four product modules plus report and export polish:

1. Atlas
2. Redact
3. Verify
4. Research
5. Reports and exports

These should not be built in parallel without order. The dependencies are uneven, and Research in particular depends on the others being real rather than mocked.

## Priority Order

### Priority 1: Atlas

Atlas comes first because the rest of the product depends on a canonical legal source layer.

Without Atlas:

- Verify cannot resolve authorities
- Research cannot retrieve sources
- the product cannot prove source-bound output

Primary outcome:

- citation resolution
- legal search
- paragraph and provision retrieval

### Phase 0 Prerequisite

Matter Workspace, auth, storage, and the mirrored web and Electron shell now belong to Phase 0.

Phase 1 depends on those foundations already existing.

### Priority 2: Redact

Redact comes before Verify because privacy protection is a first-order trust requirement for the target user, and because local-sensitive document handling is a clearer early differentiator for solo practitioners and small firms.

Without it:

- sensitive desktop workflows remain incomplete
- users cannot safely prepare documents for AI-assisted work
- the privacy thesis remains theoretical

Primary outcome:

- sensitive span detection
- review workflow
- pseudonymised and redacted outputs

### Priority 3: Verify

Verify comes before Research because Obiter's core trust claim depends on verification, not just answer generation.

Without it:

- Research becomes another legal chatbot
- the killer demo loses its strongest differentiator

Primary outcome:

- fake authority detection
- quote checking
- structured evidence-backed findings

### Priority 4: Research

Research comes last because it is the composition layer.

It should be built after:

- Atlas can retrieve evidence
- Verify can critique outputs
- Phase 0 can hold runs and reports

Primary outcome:

- source-bound answer generation
- inline evidence inspection
- post-generation verification summary

## Build Waves

### Wave 1

- Atlas

### Wave 2

- Redact
- Verify

### Wave 3

- Research
- cross-module report polish

## Dependency Graph

```text
Phase 0 --------------------> Atlas ---------------------> Redact ---------------------> Verify ---------------------> Research
      \                         \                               ^                              ^                              ^
       \                         \                              |                              |                              |
        \_________________________\_____________________________|______________________________|______________________________/
```

## Why This Order

This order optimises for:

- proving Obiter's thesis early
- reducing rework in downstream modules
- keeping the first milestone evidence-driven rather than UI-driven
- avoiding a chat-first product that lacks legal rigor

## First Milestone

The first milestone should deliver:

- authority ingestion
- citation resolution

Phase 0 provides the usable substrate. This milestone provides the legal source substrate.

## Second Milestone

The second milestone should deliver:

- redaction pipeline
- redaction review UI
- verification pipeline
- verification findings UI

That produces the first real trust and privacy workflow.

## Third Milestone

The third milestone should deliver:

- research question flow
- source-bound answer generation
- post-generation verification
- report export polish

That completes the killer demo.
