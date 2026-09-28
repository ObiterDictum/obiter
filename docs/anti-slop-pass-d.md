# Anti-slop Pass D — assertion discipline

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

| Rule | prod | test | Decision |
| --- | ---: | ---: | --- |
| `require-safety-comment-for-type-assertion` | 190 | 758 | Adopt (this pass) |
| `no-chained-type-assertions` | 7 | 180 | Adopt (this pass) |
| `no-unsafe-dictionary-type` | 56 | 64 | Adopt in Pass E (prod) |
| `no-unknown-parameters` | 197 | 72 | Adopt in Pass E (prod) |
| `no-known-value-widening` | 65 | 6 | Adopt in Pass F |
| `no-runtime-typeof` | 385 | 44 | Skip: bans correct defensive narrowing; needs boundary parsing first |
| `no-conditional-empty-object-spread` | 107 | 9 | Skip: `suggestion` severity, style only |
| `no-shape-in-symbol-names` | 80 | 19 | Skip: `shape` is the CRDT domain term |
| `no-module-mocking` | 0 | 0 | Skip: fires zero times; `TESTING.md` allows mocking external boundaries |

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

## Remaining passes

- **Pass E — contract types:** `no-unsafe-dictionary-type` and
  `no-unknown-parameters`, prod scope.
- **Pass F — value evidence:** `no-known-value-widening`.
- **Pass G — tests:** per-rule decision whether test-file casts get real SAFETY
  comments or stay excluded.
