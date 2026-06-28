# Synthetic Legal Training Data Plan

## Purpose

Generate 200-500 synthetic UK legal documents with PII labelled in OpenAI Privacy Filter's JSONL training format. This data fine-tunes Privacy Filter to recognise PII in legal text, including UK GDPR Article 9 special category data that the base model does not detect.

Not executing yet. This is the plan for when we run it.

## Why DeepSeek

DeepSeek generates high-quality structured text at low cost. For synthetic data generation, we need:
- Realistic UK legal language (formal, specific, structured)
- Controllable PII placement (we define what to include)
- Consistent output format
- Volume (200-500 documents in a single batch)

DeepSeek handles all of this. The generation prompt specifies the document type, the PII categories to include, and the output format. Post-processing in Python validates character offsets and converts to JSONL.

## The Problem With Direct Offset Generation

Asking an LLM to generate text AND character offsets directly is unreliable. The model counts tokens, not characters, so offsets are usually wrong.

**Solution: marker-based generation.** DeepSeek generates text with PII wrapped in markers:
```
Mr [[PERSON: James Cartwright]] of [[ADDRESS: 42 Belgrave Road, Leicester LE4 5AB]] appeared before the court on [[DATE: 15 March 2024]].
```

A Python post-processor:
1. Strips markers from the text
2. Records the character positions where each marker was
3. Outputs the clean text + spans with correct offsets

This is deterministic and reliable. The model doesn't need to count characters.

## Legal Document Types

Seven document types covering the main contexts where PII appears in legal work:

### 1. Skeleton Arguments (40-60 examples)
Dense formal documents filed before hearings. PII appears in:
- Party names with honorifics (Mr, Mrs, Ms, Dr, etc.)
- Addresses (residential, business)
- Dates (hearings, deadlines, events)
- Case references (neutral citations, internal matter refs)
- NI numbers (immigration, family cases)
- Settlement amounts (commercial disputes)
- Article 9: health data (personal injury, medical negligence), racial/ethnic origin (discrimination), religious belief (discrimination), trade union membership (employment)

### 2. Witness Statements (40-60 examples)
First-person testimony. PII appears in:
- Witness names and addresses
- Dates of events
- Phone numbers, email addresses
- Names of third parties (family members, colleagues)
- Vehicle registrations
- Article 9: health data (injury descriptions), sexual orientation (family cases), political opinions (public order cases)

### 3. Case Reports / Judgment Summaries (30-50 examples)
Summaries of decided cases. PII appears in:
- Party names (though many are public, some are anonymised)
- Neutral citations
- Dates of hearings and judgments
- Court references
- Article 9: health data (clinical negligence cases), racial/ethnic origin (discrimination cases)

### 4. Client Letters (30-50 examples)
Solicitor to client correspondence. PII appears in:
- Client name and address
- Matter reference numbers
- Financial details (settlement amounts, costs, account numbers)
- Dates
- Opposing party details
- Article 9: any data relevant to the matter

### 5. Attendance Notes (30-50 examples)
Internal records of meetings/calls. PII appears in:
- Attendee names
- Dates and times
- PII discussed in the meeting (names, addresses, financial details)
- Article 9: health data discussed in family/employment matters

### 6. Court Forms (20-40 examples)
Standardised forms (N1 claim form, C100 child arrangements, etc.). PII appears in:
- Claimant/respondent names and addresses
- Dates of birth
- NI numbers
- Case numbers
- Article 9: health data (certain form types)

### 7. Pleadings / Particulars of Claim (20-40 examples)
Formal statements of the case. PII appears in:
- Party names
- Addresses
- Financial amounts
- Dates
- Article 9: health data (personal injury particulars), racial/ethnic origin (discrimination particulars), trade union (employment)

## PII Categories to Embed

### Layer 1: Standard PII (Privacy Filter's 8 categories + UK supplement)

| Category | Label | Format/Pattern | Example |
|----------|-------|----------------|---------|
| Person name | `private_person` | Honorific + first + last | Mr James Cartwright |
| Address | `private_address` | UK postcode format | 42 Belgrave Road, Leicester LE4 5AB |
| Email | `private_email` | Standard email | j.smith@firm.co.uk |
| Phone | `private_phone` | UK formats: 0116, 07, +44 | 0116 555 0199 |
| Date | `private_date` | Legal formats: "15 March 2024", "the 15th day of March 2024", "15/03/2024" | 15 March 2024 |
| Account number | `account_number` | UK sort code + account, or card number | 12-34-56 12345678 |
| Secret | `secret` | API keys, passwords, tokens | sk-test-abc123 |
| URL with PII | `private_url` | URLs containing tokens/params | https://portal.firm.co.uk/case?id=12345 |
| NI number | `national_insurance` | 2 letters, 6 digits, 1 letter | JX 12 34 56 D |
| Passport | `passport_number` | UK: 9 digits, or alphanumeric | 123456789 |
| Case reference | `case_reference` | Neutral citation, internal ref | [2024] UKSC 3, REF/2024/0123 |

### Layer 2: UK GDPR Article 9 Special Category Data

| Category | Label | How it appears in legal text | Example |
|----------|-------|------------------------------|---------|
| Health data | `health_data` | Medical conditions, treatments, diagnoses mentioned in personal injury, medical negligence, family cases | "diagnosed with Type 2 diabetes", "receiving treatment for depression" |
| Racial/ethnic origin | `racial_ethnic_origin` | In discrimination cases, immigration | "British Asian", "of Afro-Caribbean descent" |
| Religious belief | `religious_belief` | In discrimination cases, employment | "practising Muslim", "Catholic by faith" |
| Political opinion | `political_opinion` | In employment, public law cases | "member of the Conservative Party" |
| Trade union | `trade_union_membership` | In employment cases | "UNITE union representative" |
| Sexual orientation | `sexual_orientation` | In family, discrimination cases | "in a same-sex relationship" |

### Layer 3: Legal-Specific Identifiers

| Category | Label | How it appears | Example |
|----------|-------|----------------|---------|
| Settlement amount | `settlement_amount` | Financial figures in settlement context | "accepted settlement of GBP 125,000" |
| Minor identity | `minor_identity` | Names of under-18s | "the child, Thomas (aged 14)" |
| Witness identity | `witness_identity` | Witness names in protected contexts | "Witness A" (already anonymised, but tag contexts where real names are used) |

## Custom Label Space

```json
{
  "category_version": "ormont_legal_v1",
  "span_class_names": [
    "O",
    "private_person",
    "private_address",
    "private_email",
    "private_phone",
    "private_date",
    "account_number",
    "secret",
    "private_url",
    "national_insurance",
    "passport_number",
    "case_reference",
    "health_data",
    "racial_ethnic_origin",
    "religious_belief",
    "political_opinion",
    "trade_union_membership",
    "sexual_orientation",
    "settlement_amount",
    "minor_identity"
  ]
}
```

21 classes total: 1 background (O) + 20 PII categories.

## Generation Process

### Step 1: Generate Document Templates with DeepSeek

For each document type, craft a DeepSeek prompt that:

1. Specifies the document type and UK legal context
2. Lists the PII categories to include (randomly sampled per document)
3. Instructs the model to use marker format: `[[LABEL: actual text]]`
4. Specifies the length (200-1000 words per document)
5. Tells the model to write realistic UK legal English
6. For Article 9 data, specifies the legal context where it would naturally appear (personal injury case, discrimination claim, employment tribunal, family proceedings)

**Prompt template:**
```
You are generating a synthetic UK legal document for training a PII detection model.

Document type: {DOCUMENT_TYPE}
Legal context: {LEGAL_CONTEXT}
Approximate length: {LENGTH} words

Include the following PII categories, wrapping each instance in markers using the format [[LABEL: actual text]]:

{PII_CATEGORIES_WITH_DESCRIPTIONS}

Rules:
- Write realistic UK legal English. Use formal legal language and document structure.
- Use realistic UK names, addresses, postcodes, phone numbers, and dates.
- Do NOT use real people's data. All data must be synthetic.
- Place PII naturally within the document text, not in a list.
- Some PII may appear multiple times (e.g. a person's name mentioned in several paragraphs).
- For Article 9 data (health, race, religion, political, trade union, sexual orientation), only include it when it fits the legal context naturally.
- Use the exact marker labels provided. Do not invent new labels.
- Do not add any commentary or explanation outside the document text.

Write the document now:
```

### Step 2: Post-Process with Python

A Python script (`scripts/generate_training_data.py`):

1. Read DeepSeek output files (raw text with markers)
2. For each document:
   a. Find all markers using regex: `\[\[(\w+):\s*(.+?)\]\]`
   b. Strip markers from text, record positions
   c. For each marker, compute: start offset (character position in stripped text), end offset (start + len(matched text))
   d. Build the spans dictionary in Privacy Filter's format: `{"label: text": [[start, end]]}`
   e. Handle multiple instances of the same label+text: append to the positions array
3. Validate: for each span, verify `clean_text[start:end] == expected_text`. If any fail, log and skip the document.
4. Output JSONL: one JSON object per line with `text`, `spans`, and `info` fields

### Step 3: Validate and Split

1. **Offset validation:** every span's text must match `clean_text[start:end]`
2. **Label validation:** every label must be in the custom label space
3. **Coverage check:** each document type has at least 20 examples
4. **Category distribution check:** each PII category appears in at least 10 documents
5. **Split:** 80% train, 20% validation, stratified by document type
6. **Output files:**
   - `data/evals/redact/train.jsonl`
   - `data/evals/redact/validation.jsonl`
   - `data/evals/redact/label_space.json`
   - `data/evals/redact/generation_stats.json` (counts per type, per category)

### Step 4: Evaluate Base Model Before Fine-Tuning

Before fine-tuning, run the base Privacy Filter against the validation set:
```bash
opf eval data/evals/redact/validation.jsonl --output-dir data/evals/redact/baseline_eval
```

This gives a baseline F1 score. After fine-tuning, run the same eval and compare.

## DeepSeek API Configuration

- **Model:** deepseek-chat (or deepseek-reasoner for more complex documents)
- **Temperature:** 0.7 (enough variation, not random)
- **Batch size:** Generate 5-10 documents per API call to reduce cost
- **Cost estimate:** ~500 documents at ~500 words each = ~250k tokens output. At DeepSeek's pricing, this is under $5 total.
- **Rate limits:** DeepSeek allows concurrent requests. Use 3-5 parallel workers.

## Document-to-PII Mapping

Not every document type includes every PII category. The mapping:

| Document Type | Layer 1 PII | Layer 2 (Article 9) | Layer 3 |
|---------------|-------------|---------------------|---------|
| Skeleton argument | person, address, date, case_ref, NI, account, phone, email | health, racial, religious, political, trade_union, sexual_orientation | settlement_amount |
| Witness statement | person, address, date, phone, email, NI, passport | health, racial, sexual_orientation | minor_identity |
| Case report | person, date, case_ref | health, racial | - |
| Client letter | person, address, date, case_ref, account, email, phone | (varies by matter) | settlement_amount |
| Attendance note | person, date, phone | health, political, trade_union | - |
| Court form | person, address, date, NI, passport, case_ref | health | - |
| Pleadings | person, address, date, account, case_ref | health, racial, religious, political, trade_union, sexual_orientation | settlement_amount, minor_identity |

## Edge Cases to Cover

Each of these must appear in at least 5 documents:

1. **Name that looks like a citation:** "Smith v Jones" in text. "Smith" and "Jones" are person names, but "Smith v Jones" is a case reference. The model must learn the difference.
2. **Multiple instances of same person:** "Mr Cartwright" in paragraph 1, "James Cartwright" in paragraph 3, "Mr Cartwright" in paragraph 7. All should be detected.
3. **NI number in different formats:** "JX 12 34 56 D", "JX123456D", "JX 12 34 56D". All valid.
4. **Date in legal formats:** "15 March 2024", "the 15th day of March 2024", "15/03/2024", "March 2024" (month only), "2024" (year only in legal context).
5. **Address across multiple lines:** "42 Belgrave Road\nLeicester\nLE4 5AB". Must be one span, not three.
6. **Health data without diagnosis label:** "the claimant experienced significant back pain and was unable to work" (health data implied, not explicitly diagnosed).
7. **Article 9 data in indirect speech:** "The claimant alleges that her employer referred to her as 'that Muslim woman'" (religious belief attributed via reported speech).
8. **Financial amount in legal context:** "damages assessed at GBP 45,000" vs "costs of GBP 350 for the filing fee" (settlement amount vs costs).
9. **Minor mentioned in family proceedings:** "the children, Thomas (aged 12) and Emma (aged 9)" (minor identity).
10. **Empty/zero-PII documents:** at least 10 documents with no PII at all. The model must learn that not everything is PII. These are negative examples.

## Directory Structure

```
data/evals/redact/
  raw/                        - DeepSeek raw output (with markers)
    skeleton_arguments/
    witness_statements/
    case_reports/
    client_letters/
    attendance_notes/
    court_forms/
    pleadings/
  train.jsonl                 - processed training data
  validation.jsonl             - processed validation data
  label_space.json             - custom label space for opf train
  baseline_eval/               - base model evaluation results
  generation_stats.json        - counts per type, per category
  generation_log.md            - what was generated, when, prompts used

scripts/
  generate_training_data.py   - main generation + post-processing script
  validate_offsets.py         - standalone offset validator
  split_dataset.py             - train/validation splitter
```

## Execution Checklist (when we run this)

- [ ] Write DeepSeek prompt templates for each document type
- [ ] Write `scripts/generate_training_data.py` (API calls + marker stripping + offset computation)
- [ ] Write `scripts/validate_offsets.py`
- [ ] Write `scripts/split_dataset.py`
- [ ] Generate 20 test documents, validate offsets pass
- [ ] Generate full 200-500 document batch
- [ ] Validate all offsets
- [ ] Check category coverage (each category in 10+ docs, each type has 20+ docs)
- [ ] Split into train/validation (80/20)
- [ ] Run baseline eval: `opf eval data/evals/redact/validation.jsonl`
- [ ] Record baseline F1 per category
- [ ] Generate `label_space.json`
- [ ] Documents are ready for fine-tuning when GPU is rented

## What This Does NOT Include

- Running the fine-tuning itself (that happens on a rented GPU, documented in the Redact PRD 3)
- Non-legal sectors (healthcare, finance, police). Legal first, then expand the same approach to other verticals using the same pipeline.
- Real client documents. All data is synthetic.
- Automated quality scoring of the generated text (manual spot-check is sufficient for 200-500 docs)

## Expanding to Other Sectors

The same pipeline applies to other verticals. When legal is done:

| Sector | Document types | Additional PII categories |
|--------|----------------|--------------------------|
| Healthcare | Clinic letters, discharge summaries, referral letters, mental health notes | `nhs_number`, `patient_id`, `medication`, `mental_health_reference` |
| Finance | KYC files, transaction reports, loan applications, audit reports | `sort_code`, `credit_score`, `transaction_id`, `income_figure` |
| Police/CPS | MG forms, witness statements (criminal), case file summaries | `officer_id`, `collar_number`, `informant_identity`, `surveillance_reference` |
| HR | Performance reviews, sickness records, disciplinary notes | `employee_id`, `salary`, `performance_rating`, `sickness_reference` |

Each sector gets its own generation run, its own label space extension, and its own training data directory. The fine-tuning checkpoint can be trained on multi-sector data or sector-specific depending on the deployment target.