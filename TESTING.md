# Testing Rules

## Purpose

Use this file to decide what verification is required before considering a change complete.

## Expectations

- Every non-trivial change must be verified.
- Verification should be proportionate to risk.
- Legal-critical paths need stronger verification than cosmetic changes.

## Minimum Standard

For most changes, do all applicable items:

- run the relevant automated tests
- run linting or typechecking if the area depends on it
- manually exercise the changed behavior
- verify the failure path if the feature is safety- or trust-related

## Preferred Test Strategy

- add focused tests near the changed behavior
- prefer deterministic tests over broad fragile ones
- test contracts, parsing, state transitions, and critical UI flows
- do not add shallow tests that only exercise implementation trivia

## High-Risk Areas

Use extra care for:

- auth and session handling
- document versioning and sync
- redaction behavior
- verification logic
- storage and deletion behavior
- audit logging

For these areas, verify:

- happy path
- failure path
- permission or boundary behavior where relevant
- no silent data loss

## Reporting Test Results

When summarizing work:

- state exactly what was run
- state any manual flows exercised
- state what could not be tested
- do not imply coverage that does not exist
