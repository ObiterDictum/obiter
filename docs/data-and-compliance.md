# Data and Compliance

## External Constraints

Obiter is not being built in a neutral environment. The legal data and privacy constraints shape the product directly.

## Compliance Direction

The platform should be designed from the start to align with:

- UK GDPR / GDPR
- ICO-style accountability and auditability
- ISO 27001-friendly operational controls

This does not mean formal certification from day one. It means the architecture should not block those requirements later.

## Hosting And Residency

Current operating assumptions:

- hosted services run on Hetzner infrastructure
- hosted data remains in the EU
- real client documents may be used during early development and private beta

That means security and audit controls are a build requirement, not a later cleanup task.

## Redaction Baseline

OpenAI Privacy Filter provides a strong base layer for PII detection and redaction workflows, especially because it can run locally and process long inputs. It should be used as a component, not treated as a complete legal redaction solution.

Obiter Redact still needs:

- legal-specific policy rules
- human review and approval paths
- PDF-safe redaction
- pseudonymisation support
- audit logging
- domain evaluation and tuning

For product policy, desktop-local redaction is the preferred sensitive path. Hosted redaction may exist for web flows, but it should be policy-controlled and clearly distinguishable from the local path.

## UK Case Law Licensing

The National Archives Find Case Law service permits broad reuse under the Open Justice Licence, but computational analysis over the corpus requires a separate licence.

That means the immediate operating rule is:

- apply for the computational-analysis licence early
- avoid bulk enrichment or NLP over the full corpus until that licence is granted
- use the machine-readable document URI as the stable internal identifier where appropriate

## Legislation Handling

Legislation needs a different ingestion and modeling approach from case law. Atlas should track:

- provision-level structure
- amendment history
- commencement state
- versioning
- "as at" date logic

## Core Data Model Principles

The system should not treat legal materials as plain text blobs. The minimum useful model is structured around:

- legal sources and providers
- legal documents and identifiers
- judgment paragraphs
- legislation documents and provisions
- legal references and citation graph data
- matter documents and workspaces
- redaction runs and audit records

## Public Legal Source Entities

The data model needs first-class support for:

- source type
- provider
- licence status
- computational analysis permissions
- canonical titles
- court or issuing body
- dates decided and published
- preferred identifiers
- neutral citations
- source document URIs

## Matter and Trust Entities

The private workspace layer needs first-class support for:

- organisations
- users
- matters
- matter documents
- document versions
- redaction runs
- verification outputs
- artifact exports
- audit logs

## Jurisdiction And Domain Model

The system should distinguish between jurisdiction and legal domain.

The current starting model should be:

- `primary_jurisdiction`: required
- `secondary_jurisdictions`: optional
- controlled jurisdiction values
- legal domains tracked separately from jurisdiction

Initial focus areas:

- England and Wales
- International Humanitarian Law as a legal domain, not a jurisdiction bucket

## Learning And Model Behavior

Phase 1 should rely on:

- curated legal corpus ingestion
- retrieval and ranking over that corpus
- per-matter history and product state

It should not silently "learn" from client matter data. Retrieval over trusted legal sources is the correct early mechanism. Weight-changing fine-tuning belongs to a later, explicitly governed phase if it is used at all.

## Risk Posture

Obiter should make conservative claims. For example, citation treatment detection should be framed as citation context or possible treatment until the system has enough validation to make stronger assertions safely.
