import { defineConfig } from 'oxlint'

export default defineConfig({
  plugins: ['typescript', 'unicorn', 'oxc'],
  categories: {
    correctness: 'error',
  },
  rules: {
    // Stage 1: exactly one anti-slop rule to prove wiring, chosen for fewest
    // violations (0 in this codebase). See tools/oxlint/anti-slop/ for the
    // vendored source. The remaining 14 generic rules are disabled until stage 2.
    // Effect-specific rules are intentionally omitted (we do not use Effect).
    'anti-slop/no-reflect-apply': 'error',
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
