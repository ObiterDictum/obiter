# Anti-slop Pass D - assertion discipline

**Branch:** `chore/anti-slop-pass-d`
**Base:** `dev` @ `64a08f3`

This pass starts the burn-down of the anti-slop rules left off after Pass C.

## What this pass enables

- `anti-slop/require-safety-comment-for-type-assertion`
- `anti-slop/no-chained-type-assertions`

Both are `error`. `RULES.md` already requires "no unsafe casts or non-null
assertions without a documented reason next to the code"; the SAFETY comment is
that documented reason, so this pass enforces a rule the repository already
states but did not check.

Both rules are scoped to production and tooling code by an `overrides` block.
Test doubles and fixtures cast deliberately (`as unknown as Pool`, typed
`window` stubs, untyped framework shims) and are excluded.

## Measurement on `dev` @ `64a08f3`

Counts are oxlint findings; "prod" is the scope this pass enforces (test files
excluded by the override).

| Rule                                        | prod | test | Decision                                                   |
| ------------------------------------------- | ---: | ---: | ---------------------------------------------------------- |
| `require-safety-comment-for-type-assertion` |  190 |  758 | Adopt (this pass)                                          |
| `no-chained-type-assertions`                |    7 |  180 | Adopt (this pass)                                          |
| `no-unsafe-dictionary-type`                 |   56 |   64 | Skip (see remeasurement)                                   |
| `no-unknown-parameters`                     |  197 |   72 | Skip (see remeasurement)                                   |
| `no-known-value-widening`                   |   65 |    6 | Adopt (Pass E)                                             |
| `no-runtime-typeof`                         |  385 |   44 | Skip: bans correct defensive narrowing                     |
| `no-conditional-empty-object-spread`        |  107 |    9 | Skip: `suggestion` severity, style only                    |
| `no-shape-in-symbol-names`                  |   80 |   19 | Skip: `shape` is the CRDT domain term                      |
| `no-module-mocking`                         |    0 |    0 | Skip: fires zero times; `TESTING.md` allows boundary mocks |

The counts in `anti-slop-pass-c-triage.md` are stale. They were taken on the
Pass B tip with 465 lintable files; the tree has since grown and most buckets
roughly doubled.

## Method

Each finding is resolved one of two ways, in this order:

1. **Remove the cast.** At an untyped-library or I/O boundary, replace the
   assertion with a checked accessor or type guard, so the value is established
   rather than asserted. Example: `(args?.[0] as number) ?? 0` became a
   `numericArgument(args, 0)` helper that checks `typeof value === 'number'`.
2. **Document the invariant.** Where the cast genuinely encodes a fact the
   compiler cannot express, a `SAFETY:` comment states the fact and where it is
   established. Generic comments ("types match") are not acceptable.

## Post-Pass-D remeasurement

After Pass D landed, which added `isRecord(value: unknown)` guards and SAFETY
comments, the two contract-type rules were re-measured with the same test scope:

- `no-unsafe-dictionary-type`: 48 prod findings, 16 of them
  `value is Record<string, unknown>` type predicates.
- `no-unknown-parameters`: 193 prod findings, about 74 type predicates and 18
  `.catch((error: unknown))` handlers.

Both ban patterns this codebase depends on: narrowing `unknown` at a boundary
and treating dynamic JSON as a dictionary until its fields are checked.
Adopting them would force worse types (`any`) or churn correct code, so they
stay off.

## Test-file scope (final)

The assertion and value-evidence rules stay out of test files. Test doubles cast
deliberately to stand in for untyped dependencies, and test quality is governed
by `TESTING.md` (no tautologies, mock only external boundaries) and the review
roster, not by a `SAFETY:` comment on every fixture cast. Production and tooling
code are fully in scope.

## Programme status

Adopted:

- Pass A/B: `no-reflect-apply`, `no-object-parameters`,
  `no-unknown-type-aliases`, `no-widen-then-assert`, `no-reflect-get`,
  `no-unknown-returns`
- Pass D (`#247`): `no-chained-type-assertions`,
  `require-safety-comment-for-type-assertion`
- Pass E (`#248`): `no-known-value-widening`

Not adopted: `no-runtime-typeof`, `no-conditional-empty-object-spread`,
`no-shape-in-symbol-names`, `no-module-mocking`, `no-unsafe-dictionary-type`,
`no-unknown-parameters`. Reasons are in this file and in
`anti-slop-pass-c-triage.md`.
