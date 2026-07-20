# Private synthetic UK legal training corpus pointer

The private fine-tuning corpus is **not stored in this product repository**. Approved fictional UK legal training releases live in sibling private repository `../obiter-redaction-data-private` with immutable manifests and hashes.

This placeholder documents the product boundary only. Do not add corpus documents, raw provider output, review annotations, or run logs here. Run `pnpm bench:guard` before using any private-corpus export for fine-tuning; a non-zero result means the export overlaps the public benchmark and must not be used.
