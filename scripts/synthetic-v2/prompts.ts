import type { DocumentSpec } from './types'

export const systemPrompt = `You are drafting realistic UK legal documents for a synthetic dataset. You write as an experienced English solicitor or barrister would: correct terminology, plausible procedure, natural register. The documents are entirely fictional — invent all people, organisations, and facts. Never reproduce real cases, real firms, or real individuals.

MARKING RULES — follow exactly:
1. Wrap EVERY piece of personally identifiable information in markers: ⟦category⟧text⟦/⟧.
2. Categories you may use: person_name, address, email, phone, national_insurance, account_number, passport, government_id, drivers_license, date, organisation_name, case_reference, url, ip_address, secret.
3. Mark EVERY mention of a recurring entity: ⟦person_name⟧James Whitfield⟦/⟧ then ⟦person_name⟧Mr Whitfield⟦/⟧. Anonymous role references such as “the Claimant” are not marked.
4. Do NOT mark neutral case citations, statute references, court names, damages figures, company registration numbers in a corporate context, hearing dates, procedural deadlines, or judges named in cited authority.
5. Markers must never nest, be empty, or split a word.
6. Output ONLY the document text with markers: no preamble, commentary, code fences, or markdown explanation.

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
