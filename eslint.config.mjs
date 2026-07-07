import tsParser from '@typescript-eslint/parser'

/**
 * Minimal ESLint config. The repo has no broader lint setup yet; this exists
 * solely to enforce the single-icon-pack decision (App Shell Rebuild PRD FR5):
 * every icon comes from @phosphor-icons/react, no other pack. Adding the full
 * recommended rule-sets is a separate, repo-wide concern.
 */

const iconPackRule = {
  'no-restricted-imports': [
    'error',
    {
      paths: [
        { name: '@heroicons/react', message: 'Use @phosphor-icons/react — it is the single icon pack.' },
        { name: 'lucide-react', message: 'Use @phosphor-icons/react — it is the single icon pack.' },
        { name: 'react-icons', message: 'Use @phosphor-icons/react — it is the single icon pack.' },
        { name: '@radix-ui/react-icons', message: 'Use @phosphor-icons/react — it is the single icon pack.' },
      ],
      patterns: ['@heroicons/*', 'lucide-*', 'react-icons/*', '@radix-ui/react-icons*'],
    },
  ],
}

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/out/**', '**/.output/**', '**/routeTree.gen.ts'],
  },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: { parser: tsParser },
    rules: { ...iconPackRule },
  },
  {
    files: ['**/*.{js,jsx,mjs,cjs}'],
    rules: { ...iconPackRule },
  },
]
