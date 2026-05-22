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

## Deployment Notes

- Keep Meilisearch on private deployment networking where possible.
- When Ormont API, Atlas ingestor, and Meilisearch run on the same Dokploy server/network, use the internal service hostname for `MEILISEARCH_HOST`, such as `http://<meilisearch-service-name>:7700`.
- `search.ormont.tech` is the intended public Meilisearch domain for environments that deliberately expose search outside the private deployment network.
- Do not make deployed Ormont API or ingestor containers depend on `search.ormont.tech` when an internal Dokploy/Docker service hostname is available.
- The Ormont app search experience should call Ormont API endpoints such as `GET /api/search`; the API can then query Meilisearch with a server-side search key and return a stable product response shape.
- Direct browser-to-Meilisearch access through `search.ormont.tech` is allowed only for deliberately public search surfaces and must use a search-only key scoped to public Atlas indexes.
- Use Tailscale hostnames or Tailscale IPs only for callers outside the Dokploy/Docker network, such as local development machines.
- Keep `MEILI_MASTER_KEY` only on the Meilisearch service.
- Configure the API with `MEILISEARCH_SEARCH_API_KEY`, scoped to search the `atlas_authorities` index.
- Configure Atlas ingestor jobs with `MEILISEARCH_ADMIN_API_KEY`, scoped to index and maintain `atlas_authorities`.
- Do not expose master or admin keys to browser/frontend runtimes.
