# Anti-slop Pass E - value evidence

**Branch:** `chore/anti-slop-pass-f`
**Base:** `dev` @ `bb5f01a`

## What this pass enables

- `anti-slop/no-known-value-widening` at `error`, scoped to production and
  tooling code by the same `overrides` block Pass D added for test doubles.

## Why

The rule reports a known value flowing into an explicitly broad or anonymous
target type, which discards evidence the compiler already had. The fix keeps
the evidence: `satisfies` instead of an annotated dictionary, a named contract
instead of an anonymous return shape, or an extracted parse helper instead of a
`let parsed: unknown` that is reassigned.

## Measurement on `dev` @ `bb5f01a`

67 prod findings:

- 32 target an anonymous object (inline return or property shapes).
- 29 target an open dictionary (`Record<...>` style maps and similar).
- 6 target `unknown` (`let parsed: unknown` parse slots).

The six `unknown` findings are fixed by extracting a helper that returns
`unknown`, not by weakening the rule.

## Why the contract-type rules are not adopted

See `anti-slop-pass-d.md`: `no-unsafe-dictionary-type` and
`no-unknown-parameters` were re-measured after Pass D and both mainly fire on
`value is Record<string, unknown>` type predicates and
`.catch((error: unknown))` handlers, which are the correct boundary patterns.
