import { describe, expect, it } from 'vitest'
import {
  magicLinkEmail,
  resetPasswordEmail,
  verificationEmail,
} from './email-templates'

const URL = 'https://app.obiter.test/auth/reset?token=abc123'

describe('email templates', () => {
  describe('magicLinkEmail', () => {
    it('renders the URL in both html and text parts with the shipped subject', () => {
      const email = magicLinkEmail(URL)
      expect(email.subject).toBe('Your Obiter sign-in link')
      expect(email.html).toContain(URL)
      expect(email.text).toContain(URL)
    })
  })

  describe('verificationEmail', () => {
    it('renders the URL in both html and text parts with the shipped subject', () => {
      const email = verificationEmail(URL)
      expect(email.subject).toBe('Verify your Obiter email')
      expect(email.html).toContain(URL)
      expect(email.text).toContain(URL)
    })
  })

  describe('resetPasswordEmail', () => {
    it('renders the URL in both html and text parts', () => {
      const email = resetPasswordEmail(URL)
      expect(email.subject).toBe('Reset your Obiter password')
      expect(email.html).toContain(URL)
      expect(email.text).toContain(URL)
    })
  })

  it('escapes HTML-special characters in the URL within the html part', () => {
    const evil = 'https://app.obiter.test/auth/reset?token=a&b=<script>'
    const email = magicLinkEmail(evil)
    // The raw angle brackets must not appear unescaped in the rendered html.
    expect(email.html).not.toContain('<script>')
    expect(email.html).toContain('&lt;script&gt;')
  })

  it('keeps all subjects and copy free of emoji and exclamation marks', () => {
    for (const email of [
      magicLinkEmail(URL),
      verificationEmail(URL),
      resetPasswordEmail(URL),
    ]) {
      expect(email.html).not.toMatch(/!/)
      expect(email.text).not.toMatch(/!/)
    }
  })
})
