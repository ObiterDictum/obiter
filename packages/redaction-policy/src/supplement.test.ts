import { describe, expect, it } from 'vitest'
import { mergeSpans, supplementSpans } from './index'
import type { RedactionSpan } from './types'

const legalText = `Jane Smith of 10 Downing Street emailed jane.smith@example.com about matter CR-2024-00123. Her NI number is QQ 12 34 56 C. Smith & Jones Solicitors LLP act for the claimant.`

// Returns only the matched text grouped by category, in document order. Keeps
// assertions readable for the realistic-mixed-paragraph case where exact span
// counts are brittle.
function byCategory(spans: RedactionSpan[]) {
  const groups: Record<string, string[]> = {}
  for (const span of spans) (groups[span.category] ??= []).push(span.text)
  return groups
}

describe('UK supplement — existing patterns', () => {
  it('detects UK legal supplement spans', () => {
    const spans = supplementSpans(legalText)
    expect(spans.map((span) => span.category)).toEqual(
      expect.arrayContaining(['national_insurance', 'case_reference', 'organisation_name']),
    )
  })

  it('returns empty arrays for empty input', () => {
    expect(supplementSpans('')).toEqual([])
  })

  it('assigns suggested actions from the category map', () => {
    const spans = supplementSpans('reach me at jane.smith@example.com')
    expect(spans[0]?.suggestion).toBe('redact')
    expect(spans[0]?.source).toBe('uk_supplement')
    expect(spans[0]?.confidence).toBe('high')
  })
})

describe('UK supplement — email', () => {
  it('matches standard addresses with dots, plus and hyphens in the local part', () => {
    const spans = supplementSpans('Contact j.smith+tag@law-firm.co.uk or info@chambers.com.')
    expect(spans.map((span) => ({ t: span.text, c: span.category }))).toEqual([
      { t: 'j.smith+tag@law-firm.co.uk', c: 'email' },
      { t: 'info@chambers.com', c: 'email' },
    ])
    expect(spans.every((span) => span.confidence === 'high')).toBe(true)
  })

  it('does not match bare prose, sentences, or citation fragments', () => {
    const spans = supplementSpans('See Smith v Jones [2024] UKSC 12 at paragraph 15.')
    expect(spans.filter((span) => span.category === 'email')).toHaveLength(0)
  })
})

describe('UK supplement — postcode', () => {
  it('matches one- and two-letter outward codes, spaced as in real legal text', () => {
    const spans = supplementSpans('Based at LE4 5AB; court at SW1A 1AA; box at M1 1AE and W1A 0AX.')
    const matched = spans.filter((span) => span.category === 'address').map((span) => span.text)
    expect(matched).toEqual(['LE4 5AB', 'SW1A 1AA', 'M1 1AE', 'W1A 0AX'])
  })

  it('matches a postcode written without the separating space', () => {
    const spans = supplementSpans('Postcode LE45AB.')
    expect(spans.filter((span) => span.category === 'address').map((span) => span.text)).toEqual(['LE45AB'])
  })

  it('does not match neutral citations, case references, or dates', () => {
    const spans = supplementSpans('The case [2024] EWCA Civ 12, ref CR-2024-00123, heard 12/07/2026.')
    expect(spans.filter((span) => span.category === 'address')).toHaveLength(0)
  })
})

describe('UK supplement — IBAN', () => {
  it('matches a GB IBAN with and without inter-group spaces as one span', () => {
    const compact = supplementSpans('IBAN GB29NWBK60161331926819 end.')
    expect(compact.find((span) => span.category === 'account_number')?.text).toBe('GB29NWBK60161331926819')

    const spaced = supplementSpans('IBAN GB29 NWBK 6016 1331 9268 19 end.')
    expect(spaced.find((span) => span.category === 'account_number')?.text).toBe('GB29 NWBK 6016 1331 9268 19')
    expect(spaced.filter((span) => span.category === 'account_number')).toHaveLength(1)
  })

  it('does not match non-GB IBAN-shaped strings or a trailing damages figure', () => {
    const spans = supplementSpans('Account DE89370400440532013000; damages £1,234,567.89.')
    expect(spans.filter((span) => span.category === 'account_number')).toHaveLength(0)
  })
})

describe('UK supplement — phone', () => {
  it('matches +44 international, mobile (07…) and geographic (020 …) forms', () => {
    const spans = supplementSpans('Call +44 20 7946 0958 or 07700 900482 or 01632 960123.')
    const phones = spans.filter((span) => span.category === 'phone').map((span) => span.text)
    expect(phones).toEqual(['+44 20 7946 0958', '07700 900482', '01632 960123'])
    expect(spans.every((span) => span.confidence === 'medium')).toBe(true)
  })

  it('tolerates hyphenation and the (0) trunk form', () => {
    const spans = supplementSpans('Tel +44-(0)20-7946-0958.')
    expect(spans.find((span) => span.category === 'phone')?.text).toBe('+44-(0)20-7946-0958')
  })

  it('does not match neutral citations, dates, an 8-digit damages figure, or a case number', () => {
    const spans = supplementSpans(
      '[2024] UKSC 12, filed 12/07/2026, damages 15000000, claim 2024/ABC/0123.',
    )
    expect(spans.filter((span) => span.category === 'phone')).toHaveLength(0)
  })
})

describe('UK supplement — bank details (context-gated)', () => {
  it('matches sort code only near a "sort code" cue, in dash and space forms', () => {
    const dash = supplementSpans('Sort code: 12-34-56 for payments.')
    expect(dash.find((span) => span.category === 'account_number')?.text).toBe('12-34-56')

    const space = supplementSpans('her sort code is 12 34 56.')
    expect(space.find((span) => span.category === 'account_number')?.text).toBe('12 34 56')
  })

  it('does not match a bare dash-separated digit group that looks like a sort code', () => {
    const spans = supplementSpans('The period ran from 12-34-56 to later.')
    expect(spans.filter((span) => span.category === 'account_number')).toHaveLength(0)
  })

  it('matches account number only near an "account number" / "a/c" cue', () => {
    const cue = supplementSpans('Account number 12345678 for costs.')
    expect(cue.find((span) => span.category === 'account_number')?.text).toBe('12345678')

    const ac = supplementSpans('a/c 87654321 please.')
    expect(ac.find((span) => span.category === 'account_number')?.text).toBe('87654321')
  })

  it('does not match a bare 8-digit figure such as a damages amount or citation', () => {
    const spans = supplementSpans('Damages assessed at 12345678 and claim ref 87654321.')
    expect(spans.filter((span) => span.category === 'account_number')).toHaveLength(0)
  })

  it('treats gated bank details as medium confidence', () => {
    const spans = supplementSpans('Account number 12345678, sort code 12-34-56.')
    expect(spans.filter((span) => span.category === 'account_number').every((span) => span.confidence === 'medium')).toBe(true)
  })
})

describe('UK supplement — negatives (new patterns must never trigger)', () => {
  // The new contact/financial patterns must not fire on legal prose. These
  // strings ARE legitimate matches for the pre-existing case_reference pattern
  // (CR-2024-00123, 2024/ABC/0123), so the assertion is scoped to the new
  // categories — the requirement is that the new detectors stay silent here.
  const newCategories = ['email', 'phone', 'account_number'] as const

  const neutral = [
    '[2024] UKSC 12',
    '[2024] EWCA Civ 123',
    '12/07/2026',
    '15 March 2024',
    'CR-2024-00123',
    '2024/ABC/0123',
    'damages of £12,345,678',
  ]

  for (const text of neutral) {
    it(`does not fire new patterns on neutral legal prose: "${text}"`, () => {
      const fired = supplementSpans(text)
        .filter((span) => (newCategories as readonly string[]).includes(span.category))
      expect(fired).toEqual([])
    })
  }
})

describe('UK supplement — realistic mixed-PII paragraph', () => {
  const paragraph = `The Claimant, Mr James Cartwright of 42 Belgrave Road, Leicester LE4 5AB, can be reached on +44 20 7946 0958 or james.cartwright@personal.co.uk. His National Insurance number is JX 12 34 56 D. For payments, account number 12345678, sort code 12-34-56. IBAN GB29 NWBK 6016 1331 9268 19. Counsel are Smith & Jones Solicitors LLP. The matter reference is CR-2024-00123. The hearing is listed for 15 March 2024 under [2024] EWHC 1234 (QB).`

  it('detects the exact expected span set with no false positives on the date or citation', () => {
    const spans = supplementSpans(paragraph)
    const groups = byCategory(spans)

    expect(groups.email).toEqual(['james.cartwright@personal.co.uk'])
    expect(groups.phone).toEqual(['+44 20 7946 0958'])
    expect(groups.address).toEqual(['LE4 5AB'])
    expect(groups.national_insurance).toEqual(['JX 12 34 56 D'])
    expect(groups.case_reference).toEqual(['CR-2024-00123'])
    expect(groups.organisation_name).toEqual(['Smith & Jones Solicitors LLP'])
    // account_number covers account number + sort code + IBAN (all three),
    // in document order.
    expect(groups.account_number).toEqual(['12345678', '12-34-56', 'GB29 NWBK 6016 1331 9268 19'])

    // No false positives: the legal date and the neutral citation must not
    // appear anywhere in the span set.
    const allText = spans.map((span) => span.text)
    expect(allText).not.toContain('15 March 2024')
    expect(allText).not.toContain('[2024]')
  })

  it('does not flag the postcode/email as overlapping (distinct, non-overlapping spans)', () => {
    const spans = supplementSpans(paragraph)
    // Within the supplement alone, no two spans should overlap.
    for (let i = 0; i < spans.length; i += 1) {
      for (let j = i + 1; j < spans.length; j += 1) {
        const overlaps = spans[i]!.start < spans[j]!.end && spans[j]!.start < spans[i]!.end
        expect(overlaps).toBe(false)
      }
    }
  })

  it('merges supplement spans with Rampart spans, Rampart winning on overlap', () => {
    // Rampart detects the full email region as part of a person/identifier span;
    // the supplement email inside it must be dropped by the existing merge.
    const emailStart = paragraph.indexOf('james.cartwright@personal.co.uk')
    const emailEnd = emailStart + 'james.cartwright@personal.co.uk'.length
    const rampart: RedactionSpan = {
      id: 'span_r',
      start: emailStart - 6, // "reach … <email>" wider region
      end: emailEnd,
      text: paragraph.slice(emailStart - 6, emailEnd),
      category: 'person_name',
      source: 'rampart_model',
      confidence: 'high',
      suggestion: 'redact',
    }
    const supplement = supplementSpans(paragraph)
    const merged = mergeSpans([rampart], supplement)
    // The supplement email that sat inside the Rampart region is gone.
    expect(merged.find((span) => span.text === 'james.cartwright@personal.co.uk' && span.source === 'uk_supplement')).toBeUndefined()
    // Non-overlapping supplement spans survive.
    expect(merged.find((span) => span.category === 'national_insurance')).toBeDefined()
  })
})
