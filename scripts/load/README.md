# Upload and extraction load measurement

A bounded harness that measures the envelope for authenticated document
uploads, and what extraction concurrency does to unrelated requests on the same
API. It measures the implementation as it is: extraction runs inline in the
upload request (`services/api/src/routes/documents.ts`), so one upload is
transfer + storage write + extraction + JSON in a single request.

This is a manual instrument for a lane, not a gate. It produces an observed
envelope with its conditions and limitations. It does not assert a production
capacity, and one server run is never enough to justify a CI threshold.

Read this before quoting a number: the way to get a wrong load figure here is
to measure another lane's server, measure while another lane is building, or
treat a small-sample p95 as a distribution.

## Running it

From the lane worktree, with that lane's API already running:

```bash
obiter-lane start security          # the lane's own unit, port 8791
node scripts/load/upload-extraction-load.mjs \
  --sizes small,medium,large \
  --ramp 1,2,4 \
  --requests 12 --duration-ms 20000 \
  --out /tmp/q3-upload-extraction.json
```

`pnpm load:upload-extraction` is the same entry point. `--out` is required and
must be outside the checkout: the JSON is a run dump, not source.

Before measuring, check the machine is quiet:

```bash
systemctl --user list-units 'obiter*' --state running   # expect only your lane
uptime
```

Another lane's API on the same four vCPUs invalidates a capacity number. The
report records what else was running and how much CPU each unit used during the
window, so a contended run is visible rather than plausible. For measurements
worth publishing, serialize against other lanes' builds:

```bash
/home/karl/bin/obiter-heavy node scripts/load/upload-extraction-load.mjs ...
```

Run `--check-only` first. It resolves and proves the target, provisions and
soft-deletes the fixtures, runs the tenancy isolation checks and exits without
sending load.

## What it refuses

The harness fails closed before it sends anything (exit 2):

- the API origin is not loopback, or resolves to the shared ports 3000/8787;
- the resolved database is not this lane's (`lane-security` owns
  `obiter_lane_security`), unless the exact name is passed to
  `--allow-database`;
- `/api/health` reports a different checkout root, a different commit, or a
  different `.env`;
- the provisioned session does not authenticate against that API — which is
  also how the harness proves the database `psql` writes and the database the
  API reads are the same one.

During a run it stops on the first breached bound (exit 1): host memory below
`--min-available-mb`, API anonymous memory growth over `--max-rss-growth-mb`,
disk below `--min-free-disk-mb`, p95 over `--max-p95-ms`, `--max-consecutive-errors`,
error rate over `--max-error-rate`, or the `--max-cell-duration-ms` ceiling.
Each cell is also refused _before_ it starts when the headroom is already gone,
so escalation to the next concurrency is gated on observation.

Another lane on the same four vCPUs makes a capacity number unusable, so
contention is a bound with a value rather than a footnote. Before the load the
harness measures the other Obiter units' CPU over `--max-neighbour-cpu-ms`
(default 1000 ms of a 2500 ms window) and refuses if any of them is working. A
build that starts partway through a run cannot be caught up front, so the
whole-window figure is recorded and a run whose window another unit contested
over `--max-window-neighbour-cpu-ms` (default 5000 ms) exits non-zero rather
than publish numbers that describe the machine. A unit that restarts mid-window
has its cgroup counter reset, which is reported as an unknown window rather than
as a quiet zero.

There is no ramp-until-failure mode. Concurrency is capped at 4, requests at 64,
cells at 8, and a fixture at 8 MiB by default (the API's multipart cap is 25
MiB). A near-cap payload burst and an OOM experiment are out of scope.

Exit codes: `0` clean, `1` a failure or a breached bound, `2` refused before the
run, `3` harness error. A refused run cleans up too: fixtures are soft-deleted
through the product's own routes on the failure path as well, and anything left
behind is named on stderr and recorded in the report.

## Fixtures

Synthetic DOCX, generated per run by `make-upload-fixtures.py` (python-docx, the
same real-toolchain approach as `scripts/generate-upload-corpus.py`) into a
temporary directory, and removed afterwards. Nothing is committed and nothing
comes from a matter.

| size   | paragraphs | words   | measured bytes |
| ------ | ---------- | ------- | -------------- |
| small  | 40         | 3,600   | ~47 KB         |
| medium | 1,600      | 176,000 | ~0.5 MB        |
| large  | 6,000      | 900,000 | ~2.4 MB        |

The text is generated from a seeded PRNG over a wide vocabulary plus
case-reference tokens. That is not decoration: a fixture built from a short
repeating block deflates to almost nothing, so a "large" file arrives small and
the run measures the wrong thing. The generator prints bytes and sha256, and the
harness re-checks both against the bytes on disk before the run.

## What it records

Per cell (one fixture size at one concurrency):

- upload latency p50/p95 with the sample count, over all attempts and over
  successful ones separately, plus the first attempt;
- throughput in accepted uploads per second;
- successes and failures by category (`extraction_failed`, `not_ready`,
  `server_error`, `network_error`, `timeout`, and the HTTP classes);
- API cgroup anonymous memory and CPU, host available memory, disk free;
- probe latency for `GET /api/matters` during the cell.

Around the cells: an idle probe before the load, a recovery probe after it, the
driver's own event-loop delay, the neighbour units' CPU and memory over the
window, host CPU utilisation and load average, and API memory sampled across
the recovery window so "recovery" answers whether memory came back, not only
whether latency did. After the run, verification reads Postgres and the storage
root directly: document and version counts, `document_status`, whether every
`object_key` and `text_object_key` exists, duplicate document ids and version
numbers, documents with no version row, and audit rows by action.

Per-cell memory and CPU deltas are measured from that cell's own first sample,
not from the start of the run, so the third cell cannot report the whole run's
growth as its own. The sampler cadence is 500 ms, so a cell shorter than about a
second has coarse CPU attribution; the run-level total is the reliable figure.

`GET /api/matters` is the probe rather than `/api/health` because it is a real
authenticated product query that touches Postgres; a health endpoint that walks
no data would show almost nothing.

## Correctness rules the harness enforces

- A `201` whose version is not `ready` is a failure, not throughput. Extraction
  is expected inline, so a `201` that is not ready means the boundary moved.
- Two uploads of the same fixture share a content hash; duplicates are judged
  per document (two version rows for one document), which is what would indicate
  a partial or duplicated write.
- Fixtures are provisioned and soft-deleted through the product's own routes.
  Audit rows are never modified or deleted, storage objects are retained, and
  the report names what remains.

## Isolation checks

With the measured session, against fixtures in a second synthetic tenant:
another tenant's matter and its document list must answer `404`, an absent
matter must answer `404`, and the upload and matter-list routes must answer
`401` without a session. A denial that echoes the other tenant's matter name
fails the run. No other tenant's content is read, and nothing belonging to an
existing user or matter is touched.

## Retained storage

Cleanup soft-deletes the task's matters and documents and leaves everything
else alone: no audit row is modified and no stored object is deleted out of
band. That is deliberate, and it has a measurable cost. Storage is written
uncompressed, so extracted text is several times the size of the DOCX it came
from — one 36-upload run of the 2.4 MB fixture retained 82 MB of `source` and
335 MB of `text`. Check `du -sh services/api/.obiter-storage` before a long
campaign on a small disk, and report the retained figure with any envelope you
publish. A run-scoped purge of the run's own object keys is the obvious next
step if the footprint starts to matter; it is not implemented here.

## Limitations

Stated in every report and repeated here, because a capacity number without
them is a claim the harness cannot support:

- one API process, one Postgres, one machine — nothing here predicts a
  multi-instance or production topology;
- the client shares the host with the server, so client CPU competes with
  extraction CPU as concurrency rises;
- response latency is upload + storage + extraction + JSON in one request; no
  boundary inside that span is observable from outside the process;
- the API server's own event-loop lag is not observable externally; only the
  driver's is recorded, and probe latency stands in for server-side stalls;
- a p95 over a small request count is a direction, not a distribution;
- redaction-model inference, document save and edit, export, comments and
  search ingest are outside this slice and were not loaded.
