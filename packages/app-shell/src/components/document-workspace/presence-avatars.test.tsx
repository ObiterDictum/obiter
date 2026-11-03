import '@obiter/test-dom'
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { PresenceAvatars } from './presence-avatars'

const names = new Map([
  ['usr_2', 'Priya Raman'],
  ['usr_3', 'Tom Okafor'],
  ['usr_4', 'Sam Whitfield'],
  ['usr_5', 'Noah Berg'],
  ['usr_6', 'Leah Mensah'],
])

const viewers = ['usr_2', 'usr_3', 'usr_4', 'usr_5', 'usr_6'].map((userId) => ({
  userId,
  clientId: `${userId}-client`,
  cursor: null,
}))

afterEach(() => {
  cleanup()
})

describe('presence avatars', () => {
  it('renders nothing when you are alone in the document', () => {
    const { container } = render(
      <PresenceAvatars presence={[]} currentUserId="usr_1" names={names} />,
    )
    expect(container.textContent).toBe('')
  })

  it('shows the initials of the other people with their name and activity', () => {
    render(
      <PresenceAvatars
        presence={viewers.slice(0, 2)}
        currentUserId="usr_1"
        names={names}
      />,
    )
    expect(
      screen.getByRole('img', { name: 'Priya Raman, viewing' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('img', { name: 'Tom Okafor, viewing' }),
    ).toBeTruthy()
  })

  it('caps the avatars at three and counts the rest', () => {
    const { container } = render(
      <PresenceAvatars
        presence={viewers}
        currentUserId="usr_1"
        names={names}
      />,
    )
    expect(screen.getAllByRole('img')).toHaveLength(3)
    expect(container.textContent).toContain('+2')
  })
})
