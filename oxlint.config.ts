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
    // Stage 1 wiring + Pass A (zero-violation) rules. Remaining 11 generic
    // rules are disabled until Pass B / Pass C triage. Effect-specific rules
    // are intentionally omitted (we do not use Effect).
    'anti-slop/no-reflect-apply': 'error',
    'anti-slop/no-object-parameters': 'error',
    'anti-slop/no-unknown-type-aliases': 'error',
    'anti-slop/no-widen-then-assert': 'error',
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
    'pnpm-lock.yaml',
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
})
