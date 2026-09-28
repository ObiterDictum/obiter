// oxlint is the fast first-pass linter (runs before eslint). It owns the
// `correctness` category only — outright-wrong or useless code. It has no
// formatting rules, so it never fights Prettier. The two load-bearing repo
// policies — the @phosphor-icons single-icon-pack `no-restricted-imports`
// ban and the hex-color-in-inline-styles rule — stay with ESLint
// (eslint.config.mjs) because oxlint has no equivalent for either.
import { defineConfig } from 'oxlint'

export default defineConfig({
  plugins: ['typescript', 'unicorn', 'oxc'],
  categories: {
    correctness: 'error',
  },
  rules: {
    // Stage 1 wiring + Pass A + Pass B rules. Effect-specific rules are
    // intentionally omitted (we do not use Effect).
    'anti-slop/no-reflect-apply': 'error',
    'anti-slop/no-object-parameters': 'error',
    'anti-slop/no-unknown-type-aliases': 'error',
    'anti-slop/no-widen-then-assert': 'error',
    'anti-slop/no-reflect-get': 'error',
    'anti-slop/no-unknown-returns': 'error',
    // Pass D: assertion discipline. `RULES.md` already requires every unsafe
    // cast to carry a documented reason; the SAFETY comment is that reason.
    // Both rules are scoped to production and tooling code by the override
    // below: test doubles cast deliberately to stand in for untyped
    // dependencies. The remaining Pass C rules stay off until their own pass.
    'anti-slop/no-chained-type-assertions': 'error',
    'anti-slop/require-safety-comment-for-type-assertion': 'error',
    // Pass E: keep the evidence a known value already carries instead of
    // widening it to an anonymous or open-dictionary target.
    'anti-slop/no-known-value-widening': 'error',
  },
  env: {
    builtin: true,
  },
  ignorePatterns: [
    'dist/',
    'build/',
    'out/',
    'release/',
    'coverage/',
    '**/*.gen.ts',
    '**/*.gen.tsx',
    'bun.lock',
    'packages/rampart-inference/',
    // Intentionally wider than the 9 patterns in the deleted .oxlintrc.json:
    // the 12 agent-tooling dirs (.agent/** … .windsurf/**) plus the vendored
    // plugin itself currently match no lintable files, so the file-count proof
    // (464 → 465, the +1 is this config file) does not detect the change.
    // They are kept to prevent future noise from installed agent assets; the
    // migration is therefore not claimed as strictly equivalent on
    // ignorePatterns, only on plugins/categories/rules.
    '.agent/**',
    '.agents/**',
    '.claude/**',
    '.codex/**',
    '.continue/**',
    '.cursor/**',
    '.gemini/**',
    '.opencode/**',
    '.pi/**',
    '.roo/**',
    '.windsurf/**',
    'tools/oxlint/anti-slop/**',
  ],
  jsPlugins: [
    { name: 'anti-slop', specifier: './tools/oxlint/anti-slop/index.ts' },
  ],
  overrides: [
    {
      // The load harness is plain `.mjs`, so `bun run typecheck` never sees it and
      // the default rule set does not resolve identifiers. `no-undef` with the
      // Node environment is the static check that catches an unimported name:
      // #215 shipped `execFileSync` and `TargetRefusal` missing from
      // host-observation.mjs and both reached CI green, because the try/catch
      // that referenced them swallowed the ReferenceError into an empty result.
      files: ['scripts/load/*.mjs'],
      env: { node: true, builtin: true, es2024: true },
      rules: { 'no-undef': 'error' },
    },
    {
      // Pass D scope. Test doubles and fixtures cast deliberately (`as unknown
      // as Pool`, typed `window` stubs, untyped framework shims); the assertion
      // rules apply to production and tooling code, not these harnesses.
      files: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.spec.ts',
        '**/*.spec.tsx',
        '**/__tests__/**',
        '**/*.test-support.ts',
        '**/*.test-support.tsx',
        '**/test-support.ts',
        '**/*-test-support.ts',
        '**/*-test-support.tsx',
        'apps/web/e2e/**',
        'scripts/test/**',
      ],
      rules: {
        'anti-slop/no-chained-type-assertions': 'off',
        'anti-slop/require-safety-comment-for-type-assertion': 'off',
        'anti-slop/no-known-value-widening': 'off',
      },
    },
  ],
})
