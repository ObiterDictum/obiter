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

V1 (#199), V2 (#202), V3 (#204) and V4 are delivered as domain and store
machinery. V4 is `compareQuoteText`/`decideQuoteFidelity` in
`packages/verification-core` plus the store-scoped retrieval in
`services/api/src/quote-fidelity.ts`. None of the three is wired to a route,
worker or UI; V5 owns the run, persistence and the findings surface. The quote
normalisation and mismatch policy is recorded in `domain-model.md` and
`packages/verification-core/README.md`.

## Stack

- Node.js
- TypeScript
- BullMQ
- PostgreSQL
- shared `packages/verification-core`

## Safety Rules

- classify uncertain checks as review required
- do not overclaim legal correctness
