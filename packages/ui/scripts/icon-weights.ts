import type { IconWeight } from '../src/icon-base'

const boldIcons = new Set(['ArrowRight', 'Check', 'Minus', 'Plus', 'Question'])
const filledIcons = new Set([
  'CheckCircle',
  'Flag',
  'Folders',
  'House',
  'MagnifyingGlass',
  'MinusCircle',
  'PencilSimple',
  'Question',
  'ShieldCheck',
  'Warning',
])

export function iconWeights(name: string): IconWeight[] {
  const weights: IconWeight[] = ['regular']
  if (boldIcons.has(name)) weights.push('bold')
  if (filledIcons.has(name)) weights.push('fill')
  return weights
}
