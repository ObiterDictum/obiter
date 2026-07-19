# Private synthetic UK legal training corpus

This directory is reserved for the private fine-tuning corpus. It is not a published artifact and must not be copied into releases, public repositories, demos, or benchmark packages.

When the maintainer approves the dry run, it will contain fictional UK legal documents generated with commercial LLMs, with no real personal data. Run `pnpm bench:guard` before using any export for fine-tuning; a non-zero result means the export overlaps the public benchmark and must not be used.
