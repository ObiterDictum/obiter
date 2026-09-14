# Verify Implementation

## Scope

- citation extraction
- authority resolution via Atlas
- quote fidelity checks
- proposition support checks
- structured findings and report generation

## Build Steps

1. implement citation extraction pipeline
2. connect Atlas resolution and evidence lookup
3. implement quote matching
4. implement proposition extraction and support scoring
5. persist findings and render findings UI

## Status

V1 (#199), V2 (#202), V3 (#204) and V4 (#206) are delivered as domain and store
machinery. V5 wires those checks to an immutable document version: it extracts
citations and quotations from the stored model, runs V3 then V2 then V4,
persists `verification_runs` / `verification_findings`, and renders findings in
the shared app shell. Execution is request-scoped in this slice (no BullMQ
worker). Report export remains V6.

## Stack

- Node.js
- TypeScript
- BullMQ
- PostgreSQL
- shared `packages/verification-core`

## Safety Rules

- classify uncertain checks as review required
- do not overclaim legal correctness
