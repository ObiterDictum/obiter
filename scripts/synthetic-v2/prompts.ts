import type { DocumentSpec } from './types'

export const systemPrompt = `You are drafting realistic UK legal documents for a synthetic dataset. You write as an experienced English solicitor or barrister would: correct terminology, plausible procedure, natural register. The documents are entirely fictional — invent all people, organisations, and facts. Never reproduce real cases, real firms, or real individuals.

MARKING RULES — follow exactly:
1. Wrap EVERY in-scope personal or identifying span in markers: ⟦category⟧text⟦/⟧.
2. Categories you may use: person_private, person_protected, person_professional, address, email, phone, national_insurance, account_number, passport, government_id, drivers_license, date, organisation_name, case_reference, url, ip_address, secret.
3. Use person_private for clients, parties, witnesses and ordinary private individuals; person_protected for children, anonymity-order subjects and people in family, medical, immigration, employment, criminal or safeguarding contexts; and person_professional for solicitors, in-house counsel, judges, counsel, experts and named professionals acting in that role.
4. Mark every coreferent mention: ⟦person_private⟧James Whitfield⟦/⟧ then ⟦person_private⟧Mr Whitfield⟦/⟧. Anonymous role references such as “the Claimant” are unmarked. Professional names are marked person_professional so the later policy can keep them; their private-looking home address, personal mobile, and non-work email remain marked by their own category.
5. Do NOT mark neutral case citations, statute references, court names, damages figures, company registration numbers in a corporate context, hearing dates, or procedural deadlines. A professional's name in a cited authority is person_professional, not a private-person span.
6. Markers must never nest, be empty, or split a word.
7. Output ONLY the document text with markers: no preamble, commentary, code fences, or markdown explanation.

Write with natural variety: differing sentence rhythms, plausible imperfections, varied name ethnicities and address regions across the UK, and invented but format-plausible identifiers. PII must occur incidentally in a document with a real legal purpose, rather than as a list.`

export function userPrompt(spec: DocumentSpec) {
  const hardNegative = spec.hardNegatives.length
    ? `\nAdditionally weave in, UNMARKED: ${spec.hardNegatives.join('; ')}.`
    : ''
  return `Draft a ${spec.docType.replaceAll('_', ' ')} of roughly ${spec.lengthWords} words in the register of ${spec.register.replaceAll('_', ' ')}.

Scenario seed: ${spec.scenario}
Deterministic diversity seed: ${spec.seed}

This document must naturally contain all of these PII categories, with two recurring people mentioned at least three times using name variations where relevant: ${spec.requiredCategories.join(', ')}.${hardNegative}

Do not structure the document around the PII. Its legal purpose and realistic UK procedural language matter more than the labels.`
}
