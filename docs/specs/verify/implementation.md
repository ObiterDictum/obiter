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

## Stack

- Node.js
- TypeScript
- BullMQ
- PostgreSQL
- shared `packages/verification-core`

## Safety Rules

- classify uncertain checks as review required
- do not overclaim legal correctness
