import { expect, it } from 'bun:test'
import { buzzAgentLines, roleList, shortNpub } from './staff-buzz-data'

const NPUB = 'npub1gutgpl9302edr9ch7mg90z5fxk962mgkdx7xxcyu57fr5a7j0ydqvucky8'

it('shortens an npub to its first nine and last four characters', () => {
  expect(shortNpub(NPUB)).toBe('npub1gutg…cky8')
})

it('leaves a value too short to shorten alone', () => {
  expect(shortNpub('npub1short')).toBe('npub1short')
})

it('names the role that unlocks a role agent and leaves staff agents bare', () => {
  expect(buzzAgentLines(['Clerk', 'Registrar', 'Archivist'])).toEqual([
    { label: 'Clerk', line: 'routes requests' },
    { label: 'Registrar (Operations role)', line: 'ops status' },
    { label: 'Archivist (Corpus role)', line: 'Find Case Law notices' },
  ])
})

it('sends the whole role list in a stable order', () => {
  expect(roleList(['corpus'], 'operations', true)).toEqual([
    'operations',
    'corpus',
  ])
  expect(roleList(['operations', 'corpus'], 'operations', false)).toEqual([
    'corpus',
  ])
  expect(roleList([], 'corpus', false)).toEqual([])
})
