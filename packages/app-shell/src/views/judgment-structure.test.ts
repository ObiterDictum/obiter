import { expect, it } from 'bun:test'
import { anchorOwners, opinionTitle, opinionsOf } from './judgment-structure'

it('names an opinion from the printed heading and keeps its note', () => {
  expect(
    opinionTitle(
      'LORD REED AND LORD HODGE: (with whom Lord Briggs, Lord Sales and Lord Hamblen agree)',
    ),
  ).toEqual({
    name: 'Lord Reed and Lord Hodge',
    note: 'with whom Lord Briggs, Lord Sales and Lord Hamblen agree',
  })
  expect(opinionTitle('LORD HOPE: (dissenting)')).toEqual({
    name: 'Lord Hope',
    note: 'dissenting',
  })
  expect(opinionTitle('Lord Justice Moore-Bick:')).toEqual({
    name: 'Lord Justice Moore-Bick',
    note: undefined,
  })
  expect(opinionTitle('LADY BLACK-SMITH:').name).toBe('Lady Black-Smith')
})

it('keeps the first anchor for a number repeated across old-format opinions', () => {
  const old = [
    { id: 'a', paragraphNumber: 1, text: 'One.' },
    { id: 'b', paragraphNumber: 1, text: 'Again one.' },
  ]
  expect(anchorOwners(old).get(1)).toBe('a')
})

it('ends an opinion range at its last court paragraph, not a trailing quote', () => {
  expect(
    opinionsOf([
      {
        id: 'a',
        paragraphNumber: 7,
        text: 'x',
        label: '7.',
        level: 1,
        headings: [{ kind: 'opinion', text: 'LORD DYSON:' }],
      },
      { id: 'b', paragraphNumber: 7, text: 'y', level: 1, style: 'quote' },
    ]),
  ).toEqual([{ id: 'opinion-1', at: 0, name: 'Lord Dyson', first: 7, last: 7 }])
})
