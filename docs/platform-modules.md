# Platform Modules

## Platform Overview

Obiter is being designed as a modular platform. Each module solves a distinct legal workflow problem, but the modules reinforce one another when used together.

## Core Modules

### Atlas

Atlas is the legal source engine. It ingests, stores, normalises, and indexes public legal materials such as case law, legislation, citations, and paragraph-level references.

Atlas should answer questions like:

- does this authority exist
- where is the official source
- which paragraphs discuss this issue
- which statutes or cases are cited
- what is the canonical internal source identifier

### Redact

Redact is the confidentiality and privacy layer. It detects PII and secrets, applies legal-specific redaction policy, supports pseudonymisation, handles PDF-safe redaction, and produces audit logs with human review points.

### Verify

Verify is the trust layer. It extracts citations, resolves authorities, detects fake citations, checks quote fidelity, verifies paragraph references, and evaluates whether cited material actually supports the legal proposition being made.

### Research

Research is the AI interface over Atlas and Verify. It searches sources, retrieves relevant material, produces source-bound analysis, runs verification against generated claims, and shows contrary authorities and search trace data.

### Vault

Vault is the matter workspace. It stores uploaded documents, redaction maps, research history, and verification reports while keeping public legal sources separate from private matter documents.

### Bench

Bench is the evaluation system. It measures retrieval quality, citation resolution, quote checking, proposition verification, redaction quality, and end-to-end research answer quality across models and system versions.

### Pi

Pi is the agent framework layer. It coordinates bounded multi-step workflows over Search, Verify, Redact, Research, and product APIs while preserving tool boundaries, execution traces, evidence links, and explicit human handoff states.

### API

The API exposes the platform as legal infrastructure for internal applications and third-party developer use.

## How The Modules Fit Together

The platform flow is:

1. Atlas provides legal source retrieval and structured authority data.
2. Redact makes matter documents safe to process.
3. Verify checks that legal statements are real, accurate, and supported.
4. Research uses Atlas and Verify to generate source-bound analysis.
5. Vault stores the private matter context and outputs.
6. Pi coordinates bounded agentic workflows when a task needs planning or tool use.
7. Bench measures system quality over time.

## Product Direction

The product should not remain a standalone research assistant. The direction is a legal operating system where open legal sources, private matter documents, verification, privacy controls, and evaluation live inside one coherent platform.
