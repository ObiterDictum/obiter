import type { DocumentSpec } from './types'

export const systemPrompt = `You draft fictional English, Welsh, Scottish, and Northern Irish legal documents for a UK legal-redaction dataset. Write as an experienced solicitor, barrister, tribunal representative, or legal professional, matching the requested document's actual legal purpose and register.

NON-NEGOTIABLE FICTION RULES
- Invent every person, organisation, address, matter, factual event, firm, and correspondence. Do not reproduce a real case, judgment, authority, firm, person, address, or legal text.
- Use fictional street names, .test email domains, and plausibly formatted but fictional identifiers. PII must arise incidentally from the legal task, never as a list of examples.
- The document must contain a legal issue, a factual/procedural chronology, and the appropriate requested outcome, position, advice, or order. Use natural headings, paragraphing, quotations, signatures, schedules, post-scripts, or forwarded-email material only where the document type supports them.

MARKING RULES
1. Output document text only. Do not output a plan, checklist, explanation, markdown fence, or commentary.
2. Wrap every in-scope span exactly as ⟦category⟧text⟦/⟧. The only categories are: person_private, person_protected, person_professional, address, email, phone, national_insurance, account_number, passport, government_id, drivers_license, date, organisation_name, case_reference, url, ip_address, secret.
3. Use person_private for clients, parties, witnesses, and ordinary private people. Use person_protected for children, anonymity-order subjects, and people in family, medical, immigration, employment, criminal, or safeguarding contexts. Use person_professional for solicitors, in-house counsel, judges, counsel, experts, and named professionals acting in-role.
4. Mark every name variation for a recurring person. For example, both ⟦person_private⟧James Whitfield⟦/⟧ and ⟦person_private⟧Mr Whitfield⟦/⟧ are marked. Anonymous role references such as “the Claimant” are unmarked.
5. Professional names remain person_professional so later policy can normally keep them. A professional's private-looking home address, personal mobile number, or non-work email remains marked by its own category.
6. Do not mark neutral citations, statutes, court names, hearing dates, procedural deadlines, damages figures, company registration numbers, or generic role references. A named professional in a cited authority is person_professional, never person_private.
7. Markers must be complete, non-empty, non-nested, and must not split a word. Do not leave a dangling ⟦ marker anywhere in the output.

QUALITY CHECK BEFORE YOU RESPOND
Silently check that every category requested by the user appears at least once in a complete marker, every recurring name variant is consistently categorised, and the document ends cleanly after the final complete marker. Prefer a shorter finished document over a longer document with an incomplete final marker.`

function categoryInstruction(category: string) {
  const requirements: Record<string, string> = {
    person_private:
      'a private person named at least three times using natural name variants',
    person_protected:
      'a protected person named at least twice in a clearly sensitive context',
    person_professional:
      'a named legal or other professional acting in their professional role',
    address: 'a full fictional UK postal address with postcode',
    email: 'a fictional .test email address',
    phone: 'a fictional UK-form telephone number',
    date: 'a personal date or natural date-of-birth/age reference, not a procedural date',
    national_insurance: 'a fictional National Insurance number',
    account_number: 'a fictional account detail in a credible context',
    passport: 'a fictional passport number',
    government_id: 'a fictional government identifier',
    drivers_license: 'a fictional driving-licence number',
    organisation_name: 'a fictional organisation name',
    case_reference: 'a fictional personal/matter case reference',
    url: 'a fictional .test URL',
    ip_address: 'a fictional IP address where technically credible',
    secret: 'a fictional credential or access token in a credible context',
  }
  return requirements[category] ?? category
}

export function userPrompt(spec: DocumentSpec) {
  const required = spec.requiredCategories
    .map((category) => `- ${category}: ${categoryInstruction(category)}`)
    .join('\n')
  const hardNegative = spec.hardNegatives.length
    ? `\nHard negatives: weave these in naturally and leave them UNMARKED: ${spec.hardNegatives.join('; ')}.`
    : ''
  return `Draft a ${spec.docType.replaceAll('_', ' ')} of approximately ${spec.lengthWords} words in the register of ${spec.register.replaceAll('_', ' ')}.

Scenario seed: ${spec.scenario}
Diversity seed: ${spec.seed}

Required marked content:
${required}${hardNegative}

The document's legal purpose comes first. Do not force all identifiers into one paragraph. Spread them across a plausible chronology, correspondence trail, evidence, signature block, or schedule. Include at least one professional-name distinction when natural to the scenario. Vary sentence rhythm and document conventions, but finish every required marker before ending the document.`
}
