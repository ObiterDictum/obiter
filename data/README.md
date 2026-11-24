# Product-repository data boundary

`data/` contains only committed, non-sensitive repository assets: small test fixtures, label-space definitions, benchmark schemas, dataset cards, licences, manifests, and release pointers.

It must not contain generated private training/development documents, raw provider output, run logs, human-review annotations, or an unreleased benchmark corpus.

- Private synthetic corpus releases live in a separate private repository.
- The frozen public benchmark will live in its own release repository after approval.
- The generation pipeline, validation code, and evaluation harness remain in this repository.
