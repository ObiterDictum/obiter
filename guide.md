1. The core problem Ormont is solving
The big problem

Legal research is too important to be trapped behind closed, expensive, opaque systems.

Westlaw, Lexis, Practical Law, vLex, and the new AI-native tools all solve parts of the problem, but they are mostly closed systems. They do not give the public, students, small firms, legal aid, researchers, and open-justice organisations enough access to the underlying infrastructure of law.

At the same time, general AI is dangerous in law because it can hallucinate authorities, mishandle confidential information, misquote sources, and produce persuasive but unsupported legal analysis. The SRA has warned that firms remain accountable for AI outputs, must protect confidentiality and legal privilege, must test and supervise AI systems, and should not trust AI systems to judge their own accuracy.

The judiciary’s updated AI guidance for England and Wales also warns about hallucinations, bias, and confidentiality, and says judicial AI use must preserve the integrity of justice and the rule of law.

So Ormont is solving this:

How do we make law searchable, understandable, verifiable, privacy-preserving, benchmarked, and open enough to support justice?

2. What we are building
Product vision

Ormont is an open legal intelligence platform for research, redaction, verification, benchmarking, and AI-safe legal work.

It should become:

Westlaw-level legal research, rebuilt for open justice and trustworthy AI.

Not just a chatbot. Not just document search. Not just a citation checker. The product should become a full legal operating system with the following modules:

Product	Purpose	First user-facing value
Ormont Atlas	Open legal data engine and knowledge graph	Search cases, legislation, citations, paragraphs, references
Ormont Redact	Legal redaction and pseudonymisation	Safely process client/matter documents before AI use
Ormont Verify	Citation, quote, and proposition verification	Catch fake cases, bad quotes, unsupported claims
Ormont Research	AI-assisted legal research	Ask questions and receive source-bound legal analysis
Ormont Vault	Secure local/cloud matter workspace	Store, search, redact, and analyse legal documents
Ormont Bench	Legal AI evaluation framework	Benchmark models, retrieval, verification, and redaction
Ormont API	Developer/legaltech infrastructure	Expose search, citation parsing, redaction, verification

The Phase 1 build should focus on:

Atlas + Redact + Verify + a thin Research interface.

That gives you a real application quickly while building the foundation for the bigger platform.

3. External constraints that shape the build
OpenAI Privacy Filter changes the redaction plan

OpenAI released OpenAI Privacy Filter on 22 April 2026. It is an open-weight model for detecting and redacting personally identifiable information in text, designed for high-throughput privacy workflows, able to run locally, and able to process long inputs in a single pass.

The model supports up to 128,000 tokens, has 1.5B total parameters and 50M active parameters, and predicts eight span categories: private_person, private_address, private_email, private_phone, private_url, private_date, account_number, and secret. The official GitHub repo says it is Apache 2.0 licensed, fine-tunable, long-context, locally runnable, and suitable for experimentation, customisation, and commercial deployment.

But it is not enough on its own. OpenAI explicitly warns that Privacy Filter is a redaction and data minimisation aid, not an anonymisation, compliance, or safety guarantee; OpenAI also recommends in-domain evaluation, task-specific fine-tuning where policy differs, and human review paths for high-sensitivity workflows such as legal work.

That means:

Ormont Redact should use Privacy Filter as the base PII layer, then add legal policy, human review, PDF-safe redaction, audit logs, pseudonymisation, and legal-specific fine-tuning.

UK case law data has licensing constraints

The National Archives’ Find Case Law service permits broad reuse under the Open Justice Licence, including legal research, court submissions, education, commercial use, and incorporating judgments into legal technology products.

However, the Open Justice Licence does not permit computational analysis. Programmatic searching in bulk across Find Case Law records to identify, extract, or enrich content requires a separate computational-analysis licence.

The National Archives says there is no cost to apply for such a licence, and applications are assessed against the Five Safes Framework and Ministry of Justice principles including privacy, discoverability, algorithmic transparency, and accurate data representation.

So the data plan must be:

Apply for the computational-analysis licence immediately, and until it is granted, avoid bulk NLP/enrichment over the full Find Case Law corpus.

Find Case Law also has a public API and recommends using the internal machine-readable Document URI as the stable internal identifier, rather than assuming the URI is equivalent to a neutral citation.

UK legislation data is accessible through official APIs

The Legislation API is published by The National Archives and gives access to the UK statute book at various levels and for various times, with reusable HTML fragments, XML, and RDF; it is RESTful and uses content negotiation.

So Atlas should ingest legislation differently from case law: legislation needs versioning, commencement, amendment history, provision-level structure, and “as at date” logic.

4. The main legal problems and what Ormont builds to solve each one
Problem	Why it matters	What Ormont builds
Law is expensive and closed	Access to justice suffers when legal information is locked behind proprietary systems	Ormont Atlas, an open legal data/search layer
AI hallucinates cases and statutes	Fake authorities can mislead courts and clients	Ormont Verify, citation and authority checking
AI misquotes real sources	A real case can still be used falsely	Quote fidelity and paragraph-level verification
AI makes unsupported legal claims	Lawyers need to know whether a proposition is actually supported	Proposition extraction and support classification
Confidential data blocks safe AI use	Lawyers cannot casually upload client files to AI tools	Ormont Redact, local-first redaction and pseudonymisation
Redaction is slow and risky	Bad redaction can expose private data or remove legally important context	Human-review redaction UI with audit logs
Legal search is fragmented	Cases, legislation, CPR, guidance, and uploaded documents are separate	Unified legal/matter search
Legal AI is hard to evaluate	Vendors claim accuracy but lawyers need proof	Ormont Bench, E&W legal AI benchmarks
Small firms lack AI governance	The SRA expects supervision, testing, confidentiality, and accountability	Matter-level AI audit logs and governance reports
Public legal data is not enough by itself	Raw law is hard to navigate	Knowledge graph, issue maps, citation graph, search ranking
5. Phase 1 product definition
Phase 1 objective

Build a working application that allows a user to:

Create a matter.
Upload a document.
Redact or pseudonymise sensitive information.
Search open legal sources.
Ask a legal research question.
Receive an answer with paragraph-level sources.
Paste or upload a draft.
Verify every case, statutory reference, quote, and legal proposition.
Export a research, redaction, or verification report.

The first killer demo should be:

Upload a draft skeleton argument containing one fake case, one misquoted case, one real case used for the wrong proposition, one outdated statutory reference, and unredacted personal data. Ormont redacts the personal data, flags the fake authority, detects the bad quote, marks the unsupported proposition, and exports a verification report.

That demo proves the whole thesis.

6. Product architecture

The architecture should be modular from day one.

                         vault.legal Web App
                                 |
                         Ormont Desktop App
                                 |
                          Matter Workspace
                                 |
        -----------------------------------------------------
        |                    |                    |          |
   Ormont Atlas        Ormont Redact       Ormont Verify   Vault
        |                    |                    |          |
   Legal Corpus        Privacy Layer        Trust Layer     Docs
        |                    |                    |          |
        -----------------------------------------------------
                                 |
                         Ormont Research
                                 |
                          Ormont Bench
                                 |
                           Ormont API
Module responsibilities
Ormont Atlas

Atlas is the legal source engine.

It stores and indexes:

cases
judgments
neutral citations
Find Case Law identifiers
court metadata
judgment paragraphs
legislation
provisions
statutory references
case-to-case citations
case-to-legislation citations
CPR and practice materials later
user-uploaded matter documents separately

Atlas should answer:

Does this authority exist?
Where is the official source?
What paragraphs mention this issue?
What statutes are cited?
What cases cite this case?
Which provisions are relevant?
What is the document structure?
What is the source licence?
What source ID should be used internally?
Ormont Redact

Redact is the privacy and confidentiality layer.

It should:

detect PII
detect secrets
detect legal-specific sensitive spans
pseudonymise matter-specific entities
support reversible pseudonymisation for internal use
support irreversible redaction for publication/export
safely redact PDFs, not just visually cover text
produce redaction audit logs
allow human approval before final export
Ormont Verify

Verify is the trust layer.

It should:

extract citations
resolve authorities
detect fake citations
check quote fidelity
check paragraph references
extract legal propositions
compare propositions to cited sources
flag unsupported or contradicted claims
check jurisdiction mismatch
check date sensitivity
generate a verification report
Ormont Research

Research is the AI interface.

It should:

ask for jurisdiction, date, practice area, and context
search Atlas
retrieve relevant sources
generate a source-bound answer
decompose the answer into claims
run Verify automatically
show contrary authorities
show “what was searched”
export a memo
Ormont Vault

Vault is the matter workspace.

It should:

store uploaded documents
store redaction maps
store research history
store verification reports
maintain local-first encrypted storage in desktop mode
optionally sync to cloud
separate public legal sources from private matter documents
Ormont Bench

Bench is the evaluation system.

It should:

evaluate retrieval
evaluate citation resolution
evaluate quote checking
evaluate proposition verification
evaluate redaction
evaluate full research answers
version model, prompt, retriever, and data changes
create public and private benchmark reports
7. Recommended technical stack

Your existing infrastructure guide is still useful. I would adapt it rather than replace it.

Monorepo

Use a single monorepo:

ormont/
  apps/
    web/                 # vault.legal web app
    desktop/             # Tauri desktop app
    docs/                # ormont.tech docs
    marketing/           # ormont.tech / vault.legal landing
  services/
    api/                 # main Hono/Fastify API
    worker/              # BullMQ jobs
    redact-worker/       # Python Privacy Filter / PDF redaction
    atlas-ingestor/      # legal data ingestion
    verify-worker/       # quote/proposition verification
    bench-runner/        # evaluation jobs
  packages/
    ui/                  # shared React components
    database/            # Prisma/Drizzle schema
    legal-schema/        # canonical legal document types
    citation-parser/     # neutral citation/statute parser
    redaction-policy/    # policy rules and label schema
    verification-core/   # reusable verification logic
    search-client/       # typed search client
    config/              # shared env/config
  infra/
    docker/
    terraform-or-scripts/
    nginx-or-traefik/
    monitoring/
  data/
    seed/
    evals/
    fixtures/
Frontend

Use:

React
Next.js for web
Tauri for desktop
TypeScript
Tailwind
shadcn/ui or equivalent
TanStack Query
Zustand or Jotai for local UI state
Zod for validation

Tauri is a strong fit because it lets you use a web frontend while putting system-level logic in Rust and shipping cross-platform desktop apps from one codebase. Electron is also viable and mature because it embeds Chromium and Node.js for cross-platform desktop apps, but it will usually be heavier.

Recommendation:

Use Tauri for Ormont Desktop unless you hit a hard integration problem.

Backend

Use:

Hono or Fastify for the API
BetterAuth for auth, as in your current infrastructure plan
PostgreSQL 16
pgvector for embeddings
Redis
BullMQ
Meilisearch for fast keyword/legal search
S3-compatible object storage
Python worker for OpenAI Privacy Filter and PDF redaction
Optional Rust sidecar for desktop-local processing later
Search

Start with:

Meilisearch for keyword and faceted search
PostgreSQL for metadata and relational structure
pgvector for semantic search
hybrid ranking layer in the API

Do not begin with a massive vector database. Legal research needs exact citation search, structured metadata, keyword matching, filters, and paragraph-level retrieval. Semantic search is useful, but it should not be the only retrieval method.

Infrastructure

Use the architecture from your infrastructure guide, renamed for Ormont:

Cloudflare Pages:
  - ormont.tech
  - docs.ormont.tech

Hetzner app server:
  - API
  - web app container if needed
  - worker
  - Redis
  - Traefik/Dokploy

Hetzner database/search server:
  - PostgreSQL
  - PgBouncer
  - Meilisearch
  - backups

Object storage:
  - source documents
  - uploaded files
  - generated reports
  - benchmark outputs

Add one extra future component:

GPU / ML worker:
  - Privacy Filter at scale
  - embedding jobs
  - reranker inference
  - future fine-tuned verifier/redaction models

For Phase 1, Redact can run locally in the desktop app and through a hosted worker for web users.

8. Core data model

The data model is the most important foundation. Do not treat legal documents as plain text blobs.

Public legal source tables
legal_sources
  id
  source_type              # case_law, legislation, guidance, cpr, user_document
  provider                 # TNA, legislation.gov.uk, gov.uk, user_upload
  licence_type
  licence_notes
  computational_analysis_allowed
  source_url
  fetched_at
  version_hash

legal_documents
  id
  source_id
  canonical_title
  document_type            # judgment, act, si, rule, practice_direction
  jurisdiction
  court_or_body
  date_published
  date_decided
  preferred_identifier
  source_document_uri
  neutral_citation
  status
  raw_text_object_key
  html_object_key
  xml_object_key
  created_at
  updated_at

judgment_paragraphs
  id
  document_id
  paragraph_number
  paragraph_label
  text
  normalized_text
  page_number
  char_start
  char_end
  embedding_id
  created_at

legislation_documents
  id
  document_id
  legislation_type
  year
  number
  title
  current_version_date
  original_enactment_date

legislation_provisions
  id
  legislation_document_id
  provision_type           # section, subsection, schedule, paragraph
  provision_number
  parent_id
  heading
  text
  version_start_date
  version_end_date
  in_force_status
Citation graph tables
legal_references
  id
  source_document_id
  source_paragraph_id
  reference_type           # case, legislation, rule, article, regulation
  raw_reference_text
  normalized_reference
  target_document_id
  target_provision_id
  confidence
  resolver_status          # resolved, ambiguous, unresolved
  created_at

case_treatments
  id
  citing_document_id
  cited_document_id
  citing_paragraph_id
  treatment_type           # cited, applied, distinguished, overruled, considered, unknown
  treatment_confidence
  evidence_text
  human_review_status

Important: do not overclaim treatment detection in Phase 1. It is safer to call this “citation context” or “possible treatment” until there is robust validation.

User/matter tables
organisations
  id
  name
  plan
  data_region
  created_at

users
  id
  email
  name
  role
  created_at

matters
  id
  organisation_id
  name
  client_reference
  jurisdiction
  default_redaction_policy
  storage_mode             # local, cloud, hybrid
  created_by
  created_at

matter_documents
  id
  matter_id
  uploaded_by
  filename
  file_type
  object_key
  text_object_key
  sha256
  page_count
  document_status
  contains_unredacted_data
  created_at
Redaction tables
redaction_runs
  id
  matter_id
  document_id
  policy_id
  model_name
  model_version
  mode                     # ai_minimisation, publication, training_data, internal_review
  status
  created_by
  created_at
  completed_at

redaction_spans
  id
  run_id
  document_id
  page_number
  char_start
  char_end
  original_text_hash
  displayed_original_text  # only if allowed in secure review context
  label                    # private_person, witness_name, child_name, secret, etc.
  confidence
  source                   # privacy_filter, rule, human, llm, manual
  action                   # redact, pseudonymise, keep, review
  replacement_text
  reviewer_id
  reviewed_at

pseudonym_maps
  id
  matter_id
  entity_hash
  label
  pseudonym                # CLIENT_1, WITNESS_2
  encrypted_original_value
  created_at
Verification tables
verification_runs
  id
  matter_id
  input_document_id
  status
  model_versions
  retrieval_version
  created_by
  created_at
  completed_at

verification_items
  id
  run_id
  item_type                # citation, quote, proposition, statute, jurisdiction, date
  raw_text
  normalized_text
  cited_source_id
  cited_paragraph_id
  status                   # verified, unsupported, contradicted, fake, ambiguous, needs_review
  severity                 # info, warning, serious, critical
  explanation
  evidence
  reviewer_status
  created_at

legal_propositions
  id
  run_id
  proposition_text
  source_span_start
  source_span_end
  cited_authorities
  verification_status
  support_score
  contradiction_score
Research tables
research_sessions
  id
  matter_id
  user_id
  query
  jurisdiction
  relevant_date
  practice_area
  status
  created_at

research_claims
  id
  session_id
  claim_text
  claim_type
  support_status
  supporting_sources
  contrary_sources
  confidence_label
  human_review_required

research_sources
  id
  session_id
  document_id
  paragraph_id
  relevance_score
  retrieval_method
  used_in_answer
Benchmark tables
bench_tasks
  id
  benchmark_name
  task_type                # citation_resolution, quote_check, redaction, rag, proposition_support
  input
  expected_output
  rubric
  jurisdiction
  source_ids
  created_at

bench_runs
  id
  benchmark_name
  system_version
  model_version
  retriever_version
  score_summary
  created_at

bench_results
  id
  run_id
  task_id
  output
  score
  error_type
  notes
9. Ormont Atlas build plan
Problem

Legal data is fragmented and hard to reason over. Current search tools mostly return documents. Ormont needs a structured legal knowledge engine that can power research, verification, redaction policy, and benchmarks.

What we build

Ormont Atlas v0:

official case lookup
legislation lookup
paragraph-level indexing
citation parsing
statute reference parsing
source metadata
licence metadata
hybrid search
legal document graph foundation
Atlas MVP scope
Must include
ingest individual Find Case Law documents in a licence-safe manner
store stable TNA document URI
store preferred identifier and neutral citation
parse judgment paragraphs
parse case citations
parse legislation references
index paragraphs in Meilisearch
embed paragraphs for semantic retrieval
expose source reader UI
expose API endpoints for search and lookup
Should include
court/date filters
jurisdiction filters
citation resolver
statute provision resolver
“source coverage” panel
source attribution and licence metadata
Do not include yet
full KeyCite/Shepard’s equivalent
automated “overruled” claims
predictive litigation analytics
full legal advice automation
full corpus computational analysis before licence approval
Atlas ingestion pipeline
Source registry
  ↓
Fetch document
  ↓
Store raw source
  ↓
Parse metadata
  ↓
Parse structure
  ↓
Extract paragraphs/provisions
  ↓
Extract citations/references
  ↓
Resolve references
  ↓
Index keyword search
  ↓
Generate embeddings
  ↓
Quality checks
Atlas API endpoints
GET  /api/atlas/search?q=&jurisdiction=&court=&date_from=&date_to=
GET  /api/atlas/documents/:id
GET  /api/atlas/documents/:id/paragraphs
GET  /api/atlas/citations/resolve?citation=
GET  /api/atlas/legislation/resolve?reference=
GET  /api/atlas/documents/:id/references/out
GET  /api/atlas/documents/:id/references/in
POST /api/atlas/ingest/fcl
POST /api/atlas/ingest/legislation
Atlas acceptance criteria

Atlas v0 is done when:

a user can search legal sources by keyword
a user can open a source and jump to a paragraph
a neutral citation can resolve to a source where available
a statutory reference can resolve to a provision where available
every source has licence/source metadata
every search result shows why it was returned
the system can support Verify and Research without using raw unstructured blobs
10. Ormont Redact build plan
Problem

Lawyers cannot safely use AI on real client documents unless they can remove or pseudonymise confidential and personal data first.

Generic PII redaction is not enough because legal documents contain role-sensitive information. A judge’s name, a company name, a party name, a child’s name, a witness address, and a solicitor’s email all need different treatment depending on context.

What we build

Ormont Redact v0:

local-first PII detection
legal-sensitive span detection
pseudonymisation
PDF/text redaction
human review
audit logs
redaction before AI
redaction before publication
redaction before training/evaluation
Redact modes
1. AI minimisation mode

Purpose:

Make a private document safer before sending it to an external LLM or cloud research pipeline.

Default behaviour:

high recall
redact or pseudonymise client/witness/person data
redact addresses, emails, phone numbers
redact account numbers and secrets
preserve legal issue context
preserve public legal citations
produce a reversible matter-scoped pseudonym map

Example replacements:

CLIENT_1
WITNESS_1
ADDRESS_1
PRIVATE_DATE_1
ACCOUNT_NUMBER_1
SECRET_1
2. Publication mode

Purpose:

Prepare a document for public sharing, open justice, research publication, or external review.

Default behaviour:

require human approval
irreversible redaction
stricter handling for children, vulnerable persons, addresses, DOBs, medical data, immigration details
preserve judge names, court names, citations, statutory references, and public legal content by default
3. Training-data mode

Purpose:

Sanitise documents for model training, benchmarks, internal research, or eval datasets.

Default behaviour:

high recall
pseudonymise consistently
remove secrets
remove account numbers
remove privileged/client-identifying detail
store dataset licence and consent metadata
require human review for sensitive sources
4. Internal review mode

Purpose:

Help a lawyer review sensitive content without permanently deleting it.

Default behaviour:

show detected spans
allow keep/redact/pseudonymise decisions
maintain audit history
do not export until reviewed
Redact label taxonomy

Start with OpenAI Privacy Filter labels:

private_person
private_address
private_email
private_phone
private_url
private_date
account_number
secret

Add Ormont legal labels:

client_name
party_name
witness_name
child_name
protected_party_name
judge_name
solicitor_name
barrister_name
expert_name
company_name
court_name
case_number
claim_number
address_for_service
dob
medical_detail
immigration_detail
financial_detail
settlement_detail
privileged_communication
confidential_business_info
safeguarding_detail
family_case_detail
criminal_case_sensitive_detail

The important product feature is not just detection. It is policy-aware treatment.

Example:

Label	AI minimisation	Publication	Training data
judge_name	keep	keep	keep
child_name	pseudonymise	redact	pseudonymise
witness_address	redact	redact	redact
neutral_citation	keep	keep	keep
account_number	redact	redact	redact
privileged_communication	review	review	exclude
company_name	review	review	pseudonymise if private
solicitor_email	redact	redact	redact
Redact technical pipeline
Input file
  ↓
File validation and hash
  ↓
Text extraction
  ↓
Layout extraction
  ↓
OpenAI Privacy Filter
  ↓
Legal rules layer
  ↓
Optional LLM-assisted legal sensitivity classifier
  ↓
Span merge and conflict resolution
  ↓
Human review UI
  ↓
Apply redaction / pseudonymisation
  ↓
Export
  ↓
Audit report
Implementation details

For the web version:

uploaded file goes to object storage
extraction worker processes it
Privacy Filter runs in a Python worker
redaction spans are saved to Postgres
user reviews spans in the browser
final export is generated server-side

For desktop:

file remains local by default
Tauri invokes a local sidecar
the sidecar runs Privacy Filter locally
local SQLite stores redaction spans and pseudonym maps
cloud sync is opt-in
unredacted documents are never sent to the cloud unless the user explicitly chooses to upload
PDF redaction warning

Do not draw black rectangles on top of PDF text and call that redaction.

The redaction engine must remove or overwrite the underlying text/content stream so that the redacted text cannot be copied, searched, extracted, or recovered.

Redact UI

The Redact screen should have:

left panel: document viewer
right panel: detected spans
top bar: policy mode
filters by label/confidence/source
actions: keep, redact, pseudonymise, replace, mark as wrong
batch actions
preview export
audit report button

Each span card should show:

Label: witness_name
Detected text: Sarah Morgan
Action: pseudonymise
Replacement: WITNESS_1
Confidence: 0.91
Source: Privacy Filter + legal policy rule
Reviewer: pending
Redact export outputs
redacted PDF
pseudonymised text
redacted DOCX where possible
redaction report
pseudonym map, encrypted and matter-scoped
safe-for-AI version
safe-for-publication version
Redact acceptance criteria

Redact v0 is done when:

text documents can be redacted
PDFs can be redacted safely
OpenAI Privacy Filter runs locally in desktop mode
users can review and override spans
pseudonymisation is consistent within a matter
a redaction audit report is generated
the system supports “redact before AI”
the system clearly says redaction still needs human review for legal/publication use
11. Ormont Verify build plan
Problem

AI can invent legal authorities, misstate real authorities, misquote paragraphs, and attach citations to propositions that the source does not actually support. Lawyers need a fast way to verify a draft before it goes to a client, opponent, court, or supervisor.

What we build

Ormont Verify v0:

citation extraction
citation resolution
fake authority detection
quote checking
paragraph checking
statutory reference checking
proposition extraction
proposition support scoring
verification report
Verify pipeline
Input draft
  ↓
Extract citations
  ↓
Extract quotes
  ↓
Extract statutory references
  ↓
Extract legal propositions
  ↓
Resolve authorities in Atlas
  ↓
Check quotes against source text
  ↓
Retrieve cited paragraphs
  ↓
Check whether proposition is supported
  ↓
Check jurisdiction/date mismatch
  ↓
Generate report
Verification item statuses

Use these statuses from day one:

verified
probably_supported
weakly_supported
unsupported
contradicted
fake_or_unresolved
ambiguous
wrong_jurisdiction
date_sensitive
needs_human_review

Do not use a single “confidence score” for a whole answer.

Every legal proposition should have its own status.

Citation extraction

The citation parser should handle:

[2024] UKSC 1
[2023] EWCA Civ 123
[2022] EWHC 456 (KB)
[2021] UKUT 100 (TCC)
R v Smith
Smith v Jones
Housing Act 1988, s 21
Companies Act 2006, section 172
CPR 3.9
Article 6 ECHR

Start with rule-based parsing plus normalisation. Add model-assisted extraction later.

Quote checking

For each quoted passage:

Identify the cited authority.
Search the cited paragraph or document.
Perform exact match.
If exact match fails, perform fuzzy match.
If fuzzy match is close, show diff.
If no match, mark as unsupported or misquoted.

Quote results:

exact_quote_match
minor_variation
material_variation
quote_not_found
wrong_source
wrong_paragraph
Proposition checking

Example draft sentence:

In Smith v Jones, the Court of Appeal held that directors are personally liable for all company misrepresentations.

Verify should extract:

Proposition:
Directors are personally liable for all company misrepresentations.

Cited source:
Smith v Jones

Question:
Does the cited source support this proposition?

Then it should:

retrieve relevant paragraphs
compare proposition to source text
identify overstatement
mark support status
show evidence
suggest narrower wording if possible
Verify report

The report should include:

Verification Report
Matter:
Document:
Date:
System version:
Sources checked:

Summary:
- 12 citations found
- 10 resolved
- 1 ambiguous
- 1 unresolved/fake
- 3 quotes checked
- 1 material quote mismatch
- 8 propositions extracted
- 5 supported
- 2 weakly supported
- 1 unsupported

Critical issues:
1. Possible fake case: [2021] EWCA Civ 9999
2. Quote not found in cited paragraph
3. Proposition overstates authority

Detailed findings:
...
Verify acceptance criteria

Verify v0 is done when:

fake neutral citations are flagged
real citations resolve to source documents
quoted text can be checked against source text
paragraph references are checked
statutory references are parsed
legal propositions are extracted
each proposition has a support status
report export works
every generated finding links to evidence
12. Ormont Research build plan
Problem

Legal research is not just “find documents.” A lawyer needs to move from question to authorities to propositions to contrary sources to a defensible answer.

Normal AI chat is unsafe because it hides retrieval, reasoning, uncertainty, and source coverage.

What we build

Ormont Research v0:

structured legal question intake
hybrid search over Atlas
answer generation with paragraph-level sources
claim decomposition
automatic Verify pass
contrary authority panel
research trail
exportable memo
Research workflow
User asks question
  ↓
System asks/infers:
  - jurisdiction
  - relevant date
  - practice area
  - document context
  - user role
  ↓
Query planner creates search plan
  ↓
Atlas retrieves sources
  ↓
Reranker ranks paragraphs/provisions
  ↓
Answer generator drafts source-bound answer
  ↓
Claim extractor splits answer into propositions
  ↓
Verify checks each proposition
  ↓
UI shows answer + evidence + warnings
Research answer format

Every answer should contain:

1. Summary answer
2. Key legal propositions
3. Authorities supporting each proposition
4. Contrary or limiting authorities
5. Relevant statutory provisions
6. Date/jurisdiction assumptions
7. What was searched
8. What was not searched
9. Human review checklist
Example claim card
Claim:
A director may be personally liable where they personally made or authorised a fraudulent misrepresentation.

Status:
Verified

Support:
Case A, paragraph 42
Case B, paragraph 17

Limit:
Not every company misrepresentation creates personal liability.

Review:
Check whether the facts show personal involvement.
Research guardrails

The system should refuse or downgrade answers when:

no relevant source is found
the issue is outside the selected jurisdiction
the source date is unclear
the law is likely unsettled
the answer depends on facts not provided
user asks for public-facing legal advice without professional context
sensitive client data has not been redacted
Research acceptance criteria

Research v0 is done when:

user can ask a legal question
results are grounded in Atlas sources
every answer has claim-level citations
every claim is passed through Verify
unsupported claims are marked
contrary sources are shown where available
research trail can be exported
13. Ormont Vault build plan
Problem

Lawyers need a secure workspace for matter documents. Cloud-only legal AI creates confidentiality and privilege concerns. A local-first desktop workspace gives Ormont a major trust advantage.

What we build

Ormont Vault v0:

matter creation
file upload
local document storage
local redaction
local search
optional cloud sync
research and verification history
encrypted pseudonym maps
audit logs
Desktop-first design

The desktop app should support:

local matter folder
encrypted metadata database
local text extraction
local redaction
local pseudonym maps
local search index
explicit “send redacted version to cloud/LLM” button
explicit “sync matter” button
offline use for previously cached legal sources
Vault UI

Matter screen:

Matter: ABC v XYZ
Jurisdiction: England & Wales
Documents:
  - witness_statement.pdf
  - draft_skeleton.docx
  - advice_note.txt
Research:
  - Director liability research
  - Limitation issue
Verification:
  - skeleton verification report
Redaction:
  - witness statement redaction report
Vault acceptance criteria

Vault v0 is done when:

users can create matters
users can upload/store documents
desktop users can keep files local
documents can be searched
documents can be redacted before AI use
verification/research reports attach to a matter
matter-level audit history exists
14. Ormont Bench build plan
Problem

Legal AI systems need rigorous evaluation. Without benchmarks, Ormont cannot know whether Atlas, Redact, Verify, or Research is improving.

What we build

Ormont Bench v0:

citation resolution benchmark
quote checking benchmark
redaction benchmark
retrieval benchmark
proposition support benchmark
full research answer benchmark
Benchmark families
1. CiteBench

Tests whether the system can:

parse citations
normalise citations
resolve real cases
flag fake citations
handle ambiguous references
distinguish similar case names

Metrics:

citation_parse_accuracy
resolution_accuracy
fake_citation_recall
fake_citation_precision
ambiguous_case_detection
2. QuoteBench

Tests whether the system can:

find exact quotes
detect misquotes
detect wrong paragraph references
detect quotes from the wrong case

Metrics:

exact_quote_accuracy
material_misquote_recall
wrong_paragraph_detection
quote_diff_quality
3. PropBench

Tests whether the system can:

extract legal propositions
decide whether a source supports a proposition
detect overstatement
detect contradiction
mark uncertainty

Metrics:

proposition_extraction_f1
support_classification_accuracy
unsupported_claim_recall
contradiction_detection
human_review_agreement
4. RedactBench

Tests whether the system can:

find personal data
preserve public legal content
pseudonymise consistently
avoid over-redaction
avoid under-redaction
redact PDF content safely

Metrics:

pii_recall
pii_precision
legal_sensitive_recall
over_redaction_rate
under_redaction_rate
pseudonym_consistency
pdf_redaction_safety
5. ResearchBench

Tests whether the system can:

answer legal questions
retrieve correct authorities
cite paragraphs accurately
identify contrary sources
abstain when sources are insufficient

Metrics:

answer_grounding
source_recall
source_precision
claim_verification_rate
contrary_authority_recall
abstention_quality
Bench acceptance criteria

Bench v0 is done when:

every release can run a regression test
every model/prompt/retriever version is logged
failures are stored as examples
benchmark reports are exportable
product feedback can become benchmark tasks
15. Open-source and commercial strategy

The mission is open justice, but the company still needs a business model.

Open-source layer

Open-source:

citation parser
legislation reference parser
legal document schema
redaction label schema
redaction policy DSL
benchmark harness
eval datasets where legally safe
CLI tools
source transparency tooling
local redaction proof-of-concept
Open data / licensed data layer

Use official sources, but obey licensing.

For Find Case Law:

track source licence
track whether computational analysis is allowed
apply for computational-analysis licence
avoid bulk enrichment before permission
preserve attribution
preserve stable source IDs
Commercial layer

Charge for:

hosted Atlas search
hosted Research
hosted Redact
hosted Verify
firm workspaces
desktop Pro
team governance
private deployment
API usage
benchmark reports
custom evaluation
fine-tuning support

This gives you the right balance:

Open infrastructure, commercial reliability.

16. Security, privacy, and governance requirements
Non-negotiable principles
No unredacted client data to external LLMs by default.
No training on user documents by default.
Matter-level encryption and access control.
Every AI answer gets a source trail.
Every redaction gets an audit trail.
Every verification finding links to evidence.
Every model/retriever/prompt version is logged.
Every user can export or delete matter data.
Every sensitive workflow has human review.
Every legal answer is labelled as requiring professional review.

The ICO’s AI data protection guidance is structured around accountability, transparency, lawfulness, accuracy, fairness, security, data minimisation, and individual rights, so Ormont should bake those concepts into product design rather than bolt them on later.

Audit log events

Log:

document_uploaded
document_redacted
redaction_span_reviewed
redacted_export_created
research_query_submitted
external_llm_called
source_retrieved
answer_generated
claim_verified
verification_report_exported
matter_synced
data_deleted

Each audit event should store:

event_id
organisation_id
matter_id
user_id
event_type
timestamp
model_version
policy_version
source_ids
input_hash
output_hash
redaction_status
external_provider_used

Do not store raw unredacted text in logs.

17. Detailed 12-week build roadmap
Week 0: Project decisions and setup
Problem being solved

The product needs a clear foundation before code starts, otherwise the system will become a chatbot with scattered features.

Build
rename Aequis references to Ormont
reserve product names
decide repo structure
create monorepo
define legal document schema
define redaction taxonomy
define verification status taxonomy
define environment strategy
create initial docs
Deliverables
ormont monorepo created
apps/web created
apps/desktop created
services/api created
services/worker created
services/redact-worker created
packages/legal-schema created
packages/citation-parser created
packages/redaction-policy created
Acceptance criteria
app boots locally
API boots locally
desktop shell boots locally
database migrations run
CI runs typecheck/test/build
basic docs exist
Week 1: Auth, matters, storage, and app shell
Problem being solved

Users need a secure legal workspace before research, redaction, or verification can mean anything.

Build
auth
organisation model
user model
matter model
document upload
object storage
local desktop document storage
basic dashboard
matter dashboard
Web screens
/login
/dashboard
/matters
/matters/:id
/matters/:id/documents
Desktop screens
Local Vault Home
Create Matter
Matter Documents
Settings: local/cloud/sync
Acceptance criteria
user can create account
user can create matter
user can upload document
file hash is stored
document metadata is stored
desktop can create local matter
local/cloud distinction is visible
Week 2: Redact text MVP
Problem being solved

Users need immediate privacy protection before sending documents to AI.

Build
Python redact worker
OpenAI Privacy Filter install
text input redaction
span output
redaction policy engine v0
redaction review UI
pseudonym map
redacted text export
Redact API
POST /api/redact/analyze
GET  /api/redact/runs/:id
PATCH /api/redact/spans/:id
POST /api/redact/runs/:id/export
Acceptance criteria
user can paste text
Privacy Filter detects spans
spans appear in UI
user can keep/redact/pseudonymise
export produces redacted text
audit report is generated
Week 3: Redact PDF MVP
Problem being solved

Most legal documents are PDFs. Text redaction alone is not enough.

Build
PDF text extraction
page/layout mapping
PDF span highlighting
PDF review UI
safe PDF redaction
redacted PDF export
redaction audit report
Acceptance criteria
user uploads PDF
system extracts text
spans are mapped to page locations
user reviews spans visually
exported PDF cannot reveal redacted text through copy/search
audit report lists redactions by page and label
Week 4: Atlas source model and search MVP
Problem being solved

Research and verification need an authoritative source layer.

Build
legal source tables
legal document tables
judgment paragraph tables
source reader UI
basic ingestion for selected seed sources
Meilisearch indexing
search endpoint
source metadata display
Atlas screens
/sources
/sources/search
/sources/:id
/sources/:id/paragraph/:number
Acceptance criteria
source documents can be stored
paragraphs are indexed
keyword search works
filters work
source reader works
source metadata and licence status are displayed
Week 5: Citation parser and resolver
Problem being solved

Verify cannot work unless legal references can be extracted and resolved.

Build
neutral citation parser
case name parser v0
statutory reference parser v0
citation normaliser
Atlas resolver
unresolved/ambiguous status
citation extraction UI
Acceptance criteria
draft text can be scanned for citations
neutral citations are normalised
known citations resolve to Atlas documents
fake citations are flagged as unresolved
ambiguous citations are marked for review
Week 6: Verify citations and quotes
Problem being solved

Lawyers need to know whether the cited authority exists and whether quotes are accurate.

Build
Verify run model
citation verification
quote extraction
quote matching
paragraph reference checking
report UI
report export
Verify screen
/matters/:id/verify
/matters/:id/verify/:runId
Acceptance criteria
user pastes draft
system extracts citations
system checks citations
system extracts quotes
system checks quotes
wrong quote is flagged
fake citation is flagged
report can be exported
Week 7: Proposition extraction
Problem being solved

A real citation can still be attached to a false legal claim.

Build
proposition extractor
cited source linking
source paragraph retrieval
support classifier v0
support status UI
reviewer override
Acceptance criteria
draft is split into legal propositions
cited authorities are linked to propositions
system retrieves candidate support paragraphs
proposition is labelled supported/weak/unsupported/needs review
user can override status
Week 8: Research MVP
Problem being solved

Users need to ask legal questions and receive source-bound answers, not chatbot guesses.

Build
research query intake
jurisdiction/date/practice context
hybrid retrieval
answer generator
claim decomposition
automatic Verify pass
answer UI
export memo
Acceptance criteria
user asks legal question
system retrieves sources
answer includes paragraph-level citations
every claim has verification status
unsupported claims are marked
memo export works
Week 9: Vault desktop local workflow
Problem being solved

Sensitive legal work needs local-first workflows.

Build
desktop local document storage
local redaction
local pseudonym maps
local search
optional send-redacted-to-cloud action
desktop settings
Acceptance criteria
desktop app works without cloud upload
local document can be redacted
local pseudonym map persists
user can choose to send only redacted text to cloud
app clearly shows whether data is local or cloud
Week 10: Bench v0
Problem being solved

The product needs measurable quality and regression testing.

Build
CiteBench seed tasks
QuoteBench seed tasks
RedactBench seed tasks
ResearchBench seed tasks
benchmark runner
score dashboard
version tracking
Acceptance criteria
benchmark suite runs locally
CI can run core evals
results are stored
failures are inspectable
model/retriever/prompt version is logged
Week 11: Governance and reporting
Problem being solved

Firms need to evidence safe AI use.

Build
AI use audit log
matter activity log
redaction report export
verification report export
research trail export
organisation settings
data retention settings
Acceptance criteria
matter has audit trail
external LLM calls are logged
reports are exportable
admin can configure data settings
user can delete matter data
Week 12: Private alpha
Problem being solved

The app needs real users testing real workflows.

Build
onboarding flow
feedback capture
bug triage
pilot user accounts
demo matters
safety disclaimers
usage analytics
support process
Alpha users

Target:

5 barristers
5 solicitors
2 legal academics
2 legal aid/pro bono users
1 law firm innovation contact
Acceptance criteria
alpha users can complete Redact workflow
alpha users can complete Verify workflow
alpha users can run a Research query
feedback is captured inside app
top failure modes become benchmark tasks
18. First 10 days of actual work
Day 1
create repo
create project board
create product spec document
define module names
define legal-schema
define redaction-policy
define verification-status
create architecture diagram
start TNA computational-analysis licence prep
Day 2
scaffold web app
scaffold desktop app
scaffold API
scaffold database package
set up Docker Compose
set up Postgres/Redis/Meilisearch locally
create auth placeholder
Day 3
implement auth
create organisations/users/matters tables
create document upload model
create dashboard
create matter page
Day 4
create Python redact worker
install/run OpenAI Privacy Filter locally
create simple text redaction CLI
create API wrapper around CLI
store redaction run and spans
Day 5
build Redact UI
show detected spans
allow keep/redact/pseudonymise
export redacted text
create pseudonym map
Day 6
implement PDF upload
extract PDF text
store page text
display PDF/text side by side
map spans roughly to page text
Day 7
implement safe PDF redaction prototype
export redacted PDF
test copy/search/extract safety
generate redaction report
Day 8
create Atlas tables
ingest small lawful/manual seed set
parse paragraphs
index in Meilisearch
create source reader
Day 9
create citation parser v0
extract neutral citations
resolve against seed Atlas
flag unresolved citations
Day 10
create Verify page
paste draft
show citation findings
export basic verification report

At the end of 10 days, you should have a crude but real product demo.

19. API design
Auth and matter APIs
POST   /api/auth/*
GET    /api/me
GET    /api/orgs/current
GET    /api/matters
POST   /api/matters
GET    /api/matters/:matterId
PATCH  /api/matters/:matterId
DELETE /api/matters/:matterId
Document APIs
POST   /api/matters/:matterId/documents
GET    /api/matters/:matterId/documents
GET    /api/documents/:documentId
DELETE /api/documents/:documentId
POST   /api/documents/:documentId/extract
Redact APIs
POST   /api/redact/runs
GET    /api/redact/runs/:runId
GET    /api/redact/runs/:runId/spans
PATCH  /api/redact/spans/:spanId
POST   /api/redact/runs/:runId/apply
GET    /api/redact/runs/:runId/export/pdf
GET    /api/redact/runs/:runId/export/report
Atlas APIs
GET    /api/atlas/search
GET    /api/atlas/documents/:documentId
GET    /api/atlas/documents/:documentId/paragraphs
GET    /api/atlas/resolve/citation
GET    /api/atlas/resolve/legislation
POST   /api/atlas/ingest/source
Verify APIs
POST   /api/verify/runs
GET    /api/verify/runs/:runId
GET    /api/verify/runs/:runId/items
PATCH  /api/verify/items/:itemId
GET    /api/verify/runs/:runId/export/report
Research APIs
POST   /api/research/sessions
GET    /api/research/sessions/:sessionId
GET    /api/research/sessions/:sessionId/claims
GET    /api/research/sessions/:sessionId/sources
GET    /api/research/sessions/:sessionId/export/memo
Bench APIs
GET    /api/bench/suites
POST   /api/bench/runs
GET    /api/bench/runs/:runId
GET    /api/bench/runs/:runId/results
20. UI screens to build
Dashboard

Shows:

recent matters
recent research
recent redactions
recent verification reports
source status
benchmark status
Matter page

Shows:

documents
research sessions
verification reports
redaction reports
audit history
Atlas search

Shows:

search bar
filters
results
source type
court
date
citation
paragraph snippets
licence/source metadata
Source reader

Shows:

judgment/legislation text
paragraph numbers
citations
related sources
copy citation
open official source
add to matter
ask about this source
Redact

Shows:

document viewer
detected spans
policy selector
review actions
pseudonym map
export buttons
audit report
Verify

Shows:

draft input
citation list
quote list
proposition list
severity filters
source evidence
report export
Research

Shows:

structured query input
jurisdiction/date/practice context
answer
claim cards
source cards
contrary sources
research trail
export memo
Bench

Shows:

benchmark suites
latest run
model/retriever versions
scores
failures
regression warnings
21. Model strategy
Do not train a full legal LLM first

The first proprietary model should not be a general legal chatbot.

The better order is:

redaction fine-tune
citation resolver
quote checker
legal proposition extractor
legal support classifier
paragraph reranker
issue classifier
full legal reasoning model later
Month 1 model work
use OpenAI Privacy Filter out of the box
evaluate on legal documents
collect user corrections
build RedactBench
Month 2 model work
build quote/proposition datasets
evaluate LLM-based support checking
build retrieval reranker experiments
Month 3 model work
fine-tune or calibrate Privacy Filter for legal redaction
train small classifier for citation/proposition support if enough labels exist
publish first Ormont Bench report
Long-term model moat

The moat is not “we trained a legal LLM.”

The moat is:

We own the legal verification, redaction, citation, source-grounding, and benchmark data generated by real workflows.

22. Legal-data licensing action plan
Immediate tasks

Prepare the Find Case Law computational-analysis licence application.

You will likely need to describe:

who Ormont is
what data you want to process
what processing you will perform
why processing supports open justice
what outputs you will create
whether you will produce legal advice
whether you will predict case outcomes
how you will handle personal data
how you will avoid harm
how you will ensure transparency
how you will preserve accurate data representation
how you will handle discoverability
how you will audit use
whether outputs are public or commercial
Recommended positioning for licence application

Use this framing:

Ormont is building open legal research, verification, redaction, and evaluation infrastructure for England and Wales. The system is not designed to provide fully automated legal advice, predict case outcomes, or decide whether a person should pursue legal action. It is designed to improve access to legal information, verify legal citations and propositions, support responsible legal AI use, and preserve open justice through transparent, auditable source handling.

Until licence approval

Allowed direction:

use individual documents for development
use user-uploaded documents
use legislation API
build parsers
build UI
build redaction
build verification against a limited lawful seed
build benchmark harness

Avoid:

bulk NLP over all Find Case Law records
bulk extraction of case relationships from the full corpus
training models on the full corpus
enriching the full corpus with automated labels
23. Risk register
Risk 1: Overbuilding before shipping

Mitigation:

Build Redact and Verify first, with a small Atlas seed. Do not wait for a perfect full legal database.

Risk 2: Data licensing breach

Mitigation:

Apply for TNA computational-analysis licence immediately. Track source permissions in the database. Do not bulk enrich before approval.

Risk 3: Unsafe redaction

Mitigation:

Treat Privacy Filter as a base layer, not a guarantee. Add human review, in-domain evals, PDF-safe redaction, audit logs, and legal policies.

Risk 4: Fake confidence

Mitigation:

Never show one global confidence score. Show claim-level support status.

Risk 5: Overclaiming citator functionality

Mitigation:

In Phase 1, call it citation context, not full legal treatment. Do not claim “overruled” unless verified.

Risk 6: External LLM confidentiality

Mitigation:

Redact before AI by default. Make external provider calls visible and logged. Do not send unredacted matter documents by default.

Risk 7: Bad OCR or PDF layout

Mitigation:

Flag low-confidence extraction. Require human review. Store page mappings. Test against real legal PDFs.

Risk 8: Direct-to-consumer legal advice liability

Mitigation:

Phase 1 should be professional/research-facing. Avoid unsupervised public legal advice workflows.

Risk 9: Benchmark gaming

Mitigation:

Keep held-out tests. Publish methodology. Store failure cases. Separate internal regression tests from marketing reports.

Risk 10: Model/provider lock-in

Mitigation:

Build model adapters. Keep retrieval, verification, redaction, and benchmarks provider-agnostic.

24. Product metrics
Redact metrics
PII recall
PII precision
legal-sensitive recall
over-redaction rate
under-redaction rate
human correction rate
PDF redaction safety failures
average review time
Verify metrics
citation extraction accuracy
citation resolution accuracy
fake citation recall
quote match accuracy
unsupported proposition recall
false unsupported rate
average verification time
human override rate
Research metrics
source precision
source recall
claim verification rate
unsupported claim rate
user correction rate
answer export rate
time to useful answer
Atlas metrics
documents indexed
paragraphs indexed
citation resolution coverage
legislation reference coverage
search latency
search click-through
zero-result rate
Business metrics
activated users
matters created
documents redacted
verification reports exported
research memos exported
weekly active users
pilot conversion rate
paid seats
API usage
25. Alpha release scope
Include
web app
desktop app shell
matter workspace
text redaction
PDF redaction
citation extraction
citation resolution against seed Atlas
quote checking
proposition extraction
basic research
report exports
audit logs
benchmark runner
Exclude
full public legal corpus
full citator treatment
automated legal advice
case outcome prediction
unsupervised public-facing advice
training on user documents
perfect legislation amendment tracking
firm-wide DMS integrations
Microsoft Word plugin
browser extension
26. Six-month roadmap after alpha
Month 4
expand Atlas corpus subject to licence approval
improve statutory provision resolver
add CPR and practice directions
improve PDF layout mapping
launch private pilots
publish first technical blog on Ormont Redact
Month 5
build Ormont Bench public dashboard
fine-tune redaction model on legal eval data
build better proposition support classifier
add local semantic search in desktop
improve source reader and citation graph
Month 6
paid beta
API beta
chambers/small firm pilot
university/legal clinic pilot
first public E&W legal AI evaluation report
launch ormont.tech docs and open-source packages
27. Build priority ranking

Start in this order:

Matter workspace
Redact text
Redact PDF
Atlas source model
Citation parser
Verify citations
Verify quotes
Verify propositions
Research answer generation
Bench regression testing
Desktop local-first workflow
Governance reports
Public API

This order creates useful product value early while building toward the larger platform.

28. The practical MVP statement

The first public version should be described as:

Ormont is an open legal intelligence workspace for England and Wales. It helps lawyers and researchers redact sensitive documents, search open legal sources, verify authorities, and produce source-grounded legal research with auditable AI.

The sharper landing-page version:

Legal research you can verify.
Search open law, redact sensitive documents, check citations, and audit AI-assisted legal work.

The developer/open-source version:

Open infrastructure for trustworthy legal AI.
Citation parsing, legal redaction, source-grounded retrieval, verification, and benchmarks for England and Wales law.

29. The “start building now” checklist

Create these first:

[ ] Monorepo
[ ] Web app
[ ] Desktop app
[ ] API service
[ ] Worker service
[ ] Redact worker
[ ] Database schema
[ ] Matter model
[ ] Document upload
[ ] OpenAI Privacy Filter local test
[ ] Text redaction UI
[ ] PDF redaction prototype
[ ] Atlas source schema
[ ] Seed source ingestion
[ ] Citation parser
[ ] Verify report
[ ] Research query screen
[ ] Benchmark harness
[ ] TNA computational-analysis licence application
[ ] ormont.tech docs skeleton
[ ] vault.legal app skeleton

The most important first milestone is not “AI research answer.”

It is:

A user can upload a legal draft, redact it, verify its citations and quotes, and export a report.