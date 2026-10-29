import tsParser from '@typescript-eslint/parser'

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
