-- Cluster-wide rolling window for Find Case Law HTTP attempts (P0.12 follow-up).
--
-- The per-process limiter cannot bound the cluster: N API replicas each
-- receive the full allowance on one shared egress IP. This table is the shared
-- authority every replica charges immediately before dispatching an upstream
-- HTTP attempt, so the window counts attempts rather than operations and one
-- operation may spend many charges (Atom pagination, LegalDocML, detail
-- fetches).
--
-- Ownership: the application database (DATABASE_URL), which every API process
-- migrates at boot and may write. It is deliberately not the legal corpus: a
-- lane is configured with CORPUS_DATABASE_URL alone and therefore has no
-- corpus writer, and the corpus holds externally-licensed material that
-- operational request rows must not pollute.
--
-- Privacy: no URL, query text, subject, user identity or matter data is stored.
-- A row is a timestamp and nothing else, so the ledger cannot reconstruct what
-- was fetched or by whom.
--
-- Retention: rows are deleted by the charging transaction once they fall
-- outside the window, so the table holds at most `limit` live rows per window.

create table if not exists legal_moj_request_charges (
  id bigserial primary key,
  -- The database clock is the authority for both the write and the count, so
  -- replica clock skew cannot widen or narrow the window.
  charged_at timestamptz not null default now()
);

create index if not exists legal_moj_request_charges_charged_at_idx
  on legal_moj_request_charges (charged_at);
