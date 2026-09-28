-- Cluster-visible admission state for legal-source hydration (P0.12 follow-up).
--
-- The per-process gate cannot bound provider work across API replicas: N
-- processes give N per-subject windows, N anonymous buckets, N in-flight
-- queues and N upstream rate allowances on one shared egress IP. This pair of
-- tables is the shared authority every replica reads and writes.
--
-- Ownership: the application database (DATABASE_URL), which every API process
-- migrates at boot and may write. It is deliberately not the legal corpus:
-- a lane is configured with `CORPUS_DATABASE_URL` alone and therefore has no
-- corpus writer, and the corpus holds externally-licensed material that
-- operational admission rows must not pollute.
--
-- Privacy: no query text, canonical key or matter data is stored. `subject`
-- is a server-verified session id or the `anonymous:shared` sentinel, and a
-- lease is named by an opaque id. A query's canonical key never reaches a row.

create table if not exists legal_hydration_leases (
  id uuid primary key,
  subject text not null,
  admitted_at timestamptz not null default now(),
  -- A live lease holds one in-flight slot. `expires_at` bounds a crashed
  -- holder: a replica that dies without completing stops counting once the
  -- lease passes, so it cannot hold capacity forever. Counts filter on
  -- `expires_at > now()`, so the bound holds even before a sweep runs.
  expires_at timestamptz not null,
  constraint legal_hydration_leases_subject_not_blank_check check (
    length(btrim(subject)) > 0
  )
);

create index if not exists legal_hydration_leases_expires_idx
  on legal_hydration_leases (expires_at);

-- One row per charged miss. The rolling window is a count over this table,
-- not a lock: an advisory lock alone serialises writers without persisting
-- the window, which would lose it on restart and could not be shared.
create table if not exists legal_hydration_misses (
  id bigserial primary key,
  subject text not null,
  admitted_at timestamptz not null default now(),
  constraint legal_hydration_misses_subject_not_blank_check check (
    length(btrim(subject)) > 0
  )
);

create index if not exists legal_hydration_misses_subject_admitted_idx
  on legal_hydration_misses (subject, admitted_at);
