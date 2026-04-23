# Atlas Implementation

## Scope

- ingest approved case law and legislation sources
- normalize identifiers
- index search records
- support citation resolution
- support paragraph and provision retrieval

## Build Steps

1. define canonical legal document schema
2. implement citation parser and normalizer
3. build ingestion worker
4. persist canonical documents and paragraphs
5. index keyword search in Meilisearch
6. expose resolution and retrieval endpoints

## Stack

- Node.js
- TypeScript
- PostgreSQL
- Meilisearch
- pgvector
- BullMQ

## Performance Notes

- exact match resolution before broad search
- summary search payloads before full document loads
- resumable ingestion jobs
