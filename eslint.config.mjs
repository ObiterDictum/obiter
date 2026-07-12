import tsParser from '@typescript-eslint/parser'

/**
 * Minimal ESLint config. The repo has no broader lint setup yet; this exists
 * to enforce two App Shell Rebuild PRD FR5 decisions:
 *   1. Single icon pack: every icon comes from @phosphor-icons/react.
 *   2. Tokens, not hex: raw hex colors must not appear in inline component
 *      styles — use a --obiter-* design token (consumed via Tailwind) instead.
 *
 * Adding the full recommended rule-sets is a separate, repo-wide concern.
 */

const iconPackRule = {
  'no-restricted-imports': [
    'error',
    {
      paths: [
        {
          name: '@heroicons/react',
          message: 'Use @phosphor-icons/react — it is the single icon pack.',
        },
        {
          name: 'lucide-react',
          message: 'Use @phosphor-icons/react — it is the single icon pack.',
        },
        {
          name: 'react-icons',
          message: 'Use @phosphor-icons/react — it is the single icon pack.',
        },
        {
          name: '@radix-ui/react-icons',
          message: 'Use @phosphor-icons/react — it is the single icon pack.',
        },
      ],
      patterns: [
        '@heroicons/*',
        'lucide-*',
        'react-icons/*',
        '@radix-ui/react-icons*',
      ],
    },
  ],
}

/**
 * Bans raw hex color literals inside JSX `style={{ ... }}` attributes, e.g.
 * `style={{ color: '#fff' }}`. They bypass the --obiter-* token system and
 * silently break theming (a token-driven Tailwind utility flips with the
 * theme; a hardcoded hex does not).
 *
 * Scope note: this catches hex literals in inline styles only. Arbitrary
 * Tailwind values such as `bg-[#fff]` are not caught by this selector — that
 * is a harder problem left to a future rule. Where a raw color is genuinely
 * required before the renderer can read a CSS variable (e.g. an Electron
 * window backgroundColor set in the main process), keep it as a named
 * constant rather than an inline style.
 */
const noHexInStylesRule = {
  'no-restricted-syntax': [
    'error',
    {
      selector:
        "JSXAttribute[name.name='style'] Literal[value=/^#[0-9a-fA-F]{3,8}$/]",
      message:
        'Do not use raw hex colors in inline styles — use an --obiter-* design token (via a Tailwind utility) instead.',
    },
  ],
}

export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/out/**',
      '**/.output/**',
      '**/routeTree.gen.ts',
      // Vendored Rampart — byte-faithful to upstream; see packages/rampart-inference/README.md
      'packages/rampart-inference/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: { parser: tsParser },
    rules: { ...iconPackRule, ...noHexInStylesRule },
  },
  {
    files: ['**/*.{js,jsx,mjs,cjs}'],
    rules: { ...iconPackRule, ...noHexInStylesRule },
  },
]
