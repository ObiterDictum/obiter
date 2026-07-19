import type { DocumentSpec } from './types'

export const draftSystemPrompt = `You draft fictional English, Welsh, Scottish, and Northern Irish legal documents for a UK legal-redaction dataset. Write as an experienced solicitor, barrister, tribunal representative, or legal professional, matching the requested document's legal purpose and register.

Invent every person, organisation, address, matter, factual event, firm, and correspondence. Never reproduce real cases, judgments, authorities, firms, people, addresses, or legal text. Use fictional street names, .test email domains, and plausibly formatted fictional identifiers.

The document must have a genuine legal issue, a factual or procedural chronology, and an appropriate requested outcome, position, advice, or order. Personal details must appear incidentally rather than as a list. Use natural headings, paragraphing, quotations, signatures, schedules, post-scripts, forwarded-email material, or OCR-like defects only when the requested document type supports them.

Output only the document text. Do not output labels, markup, a plan, a checklist, an explanation, or a markdown fence.`

export const labelSystemPrompt = `You are an exacting UK legal-data annotator. You receive a wholly fictional legal document and must label only the requested categories using XML tags of exactly this form: <pii category="category">text</pii>.

Categories: person_private, person_protected, person_professional, address, email, phone, national_insurance, account_number, passport, government_id, drivers_license, date, organisation_name, case_reference, url, ip_address, secret.

Use person_private for clients, parties, witnesses, and ordinary private people; person_protected for children, anonymity-order subjects, and people in family, medical, immigration, employment, criminal, or safeguarding contexts; and person_professional for solicitors, in-house counsel, judges, counsel, experts, and named professionals acting in-role. Label every coreferent name variation. A professional's private-looking home address, personal mobile, or non-work email still receives its own category.

Do not label neutral citations, statutes, court names, hearing dates, procedural deadlines, damages figures, company registration numbers, or generic role references. Do not alter, paraphrase, add, remove, reorder, or correct document text. Output only the original document with complete, non-nested XML tags. Before responding, silently verify that every required category appears at least once and every <pii> tag closes.`

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

function requiredContent(spec: DocumentSpec) {
  return spec.requiredCategories
    .map((category) => `- ${category}: ${categoryInstruction(category)}`)
    .join('\n')
}

export function draftUserPrompt(spec: DocumentSpec) {
  const hardNegative = spec.hardNegatives.length
    ? `\nHard negatives: weave these in naturally: ${spec.hardNegatives.join('; ')}.`
    : ''
  return `Draft a ${spec.docType.replaceAll('_', ' ')} of approximately ${spec.lengthWords} words in the register of ${spec.register.replaceAll('_', ' ')}.

Scenario seed: ${spec.scenario}
Diversity seed: ${spec.seed}

The document must naturally contain these facts for later annotation:
${requiredContent(spec)}${hardNegative}

The legal purpose comes first. Spread identifiers through a plausible chronology, correspondence trail, evidence, signature block, or schedule. Include a professional/public-role distinction where natural to the scenario. Finish the document cleanly.`
}

export function labelUserPrompt(spec: DocumentSpec, text: string) {
  return `Required categories to label:\n${requiredContent(spec)}\n\nDocument to annotate verbatim:\n${text}`
}
