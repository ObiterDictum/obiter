import type { DocumentSpec } from './types'

export const draftSystemPrompt = `You draft fictional English, Welsh, Scottish, and Northern Irish legal documents for a UK legal-redaction dataset. Write as an experienced solicitor, barrister, tribunal representative, or legal professional, matching the requested document's legal purpose and register.

Invent every person, organisation, address, matter, factual event, firm, and correspondence. Never reproduce real cases, judgments, authorities, firms, people, addresses, or legal text. Use fictional street names, .test email domains, and plausibly formatted fictional identifiers.

The document must have a genuine legal issue, a factual or procedural chronology, and an appropriate requested outcome, position, advice, or order. Personal details must appear incidentally rather than as a list. Use natural headings, paragraphing, quotations, signatures, schedules, post-scripts, forwarded-email material, or OCR-like defects only when the requested document type supports them.

Output only the document text. Do not output labels, markup, a plan, a checklist, an explanation, or a markdown fence.`

export const labelSystemPrompt = `You are an exacting UK legal-data annotator. You receive a wholly fictional legal document and must exhaustively identify every in-scope category using exact quotes from the immutable source text. The immutable source text is authoritative: annotate only text that actually appears, and never invent a span to satisfy a requested category. Return JSON only, exactly {"id":"document-id","spans":[{"category":"person_private","quote":"Jane Doe","occurrence":1}]}. Quote is exact source text and occurrence is the one-based occurrence of that exact quote in source, not the mention number of the person or entity; use 1 when the exact quote appears once. The pipeline resolves and validates UTF-16 offsets deterministically; do not return start or end fields. Do not return XML, markdown, copied document text, or explanations.

Categories: person_private, person_protected, person_professional, address, email, phone, national_insurance, account_number, passport, government_id, drivers_license, date, organisation_name, case_reference, url, ip_address, secret.

Use person_private for clients, parties, witnesses, and ordinary private people; person_protected for children, anonymity-order subjects, and people in family, medical, immigration, employment, criminal, or safeguarding contexts; and person_professional for solicitors, in-house counsel, judges, counsel, experts, and named professionals acting in-role. Label every coreferent name variation. A professional's private-looking home address, personal mobile, or non-work email still receives its own category.

Do not label neutral citations, statutes, court names, hearing dates, procedural deadlines, damages figures, company registration numbers, or generic role references. Do not alter, paraphrase, add, remove, reorder, or correct document text. Quote plus occurrence is authoritative and offsets are computed locally. Exhaustively label every in-scope category that actually appears in the whole document. If a generation requirement is absent from the source, omit it rather than inventing it; downstream QA will reject the draft. Never return two spans for the same person mention: choose exactly one of person_protected, person_professional, or person_private, in that precedence when more than one could apply. Use the full natural name mention rather than a nested surname span. Keep organisation names outside address spans, and do not separately label substrings inside emails, URLs, identifiers, or secrets. Before responding, silently verify that every quote is copied verbatim from the source, every span selects the intended source substring, and spans do not overlap.`

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
    government_id:
      'a fictional government-issued identity-document number (for example a BRP or residence-permit number), explicitly separate from any National Insurance, passport, or driving-licence number',
    drivers_license: 'a fictional driving-licence number',
    organisation_name: 'a fictional organisation name',
    case_reference: 'a fictional personal/matter case reference',
    url: 'a fictional .test URL',
    ip_address: 'a fictional IP address where technically credible',
    secret: 'a fictional credential or access token in a credible context',
  }
  return requirements[category] ?? category
}

function requiredContent(spec: DocumentSpec) {
  return spec.requiredCategories
    .map((category) => `- ${category}: ${categoryInstruction(category)}`)
    .join('\n')
}

export function draftUserPrompt(spec: DocumentSpec) {
  const hardNegative = spec.hardNegatives.length
    ? `\nHard-negative literals: include each exact fictional literal exactly once and do not alter it: ${spec.hardNegatives.map((negative) => JSON.stringify(negative.quote)).join('; ')}. These are neutral counterexamples and must not be labelled.`
    : ''
  return `Draft a ${spec.docType.replaceAll('_', ' ')} of approximately ${spec.lengthWords} words in the register of ${spec.register.replaceAll('_', ' ')}.

Scenario seed: ${spec.scenario}
Diversity seed: ${spec.seed}

The document must naturally contain these facts for later annotation:
${requiredContent(spec)}

Keep distinct categories genuinely distinct: a driving licence is not a government ID, a procedural date is not a personal date, and a professional work address is not a private home address.${hardNegative}

The legal purpose comes first. Spread identifiers through a plausible chronology, correspondence trail, evidence, signature block, or schedule. Include a professional/public-role distinction where natural to the scenario. Finish the document cleanly.`
}

export function labelUserPrompt(
  spec: DocumentSpec,
  text: string,
  repairFeedback?: string,
) {
  const repair = repairFeedback
    ? `\n\nREPAIR FEEDBACK — return a complete replacement span list, preserving valid spans and fixing these exact failures:\n${repairFeedback}`
    : ''
  return `Document ID: ${spec.id}${repair}\n\nAnnotate every in-scope category that actually appears. Never invent text to satisfy a generation requirement.\n\nImmutable document source (copy every quote verbatim from this exact text):\n${text}`
}
