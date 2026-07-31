# Self-hosted typeface licenses

Obiter loads UI typefaces via fontsource packages so web and desktop bundles
stay offline-capable (no CDN at runtime).

## Inter — SIL Open Font License 1.1

Copyright The Inter Project Authors.

Used as the primary UI sans (`@fontsource-variable/inter`).

Canonical license: <https://github.com/rsms/inter/blob/master/LICENSE.txt>

## IBM Plex Mono — SIL Open Font License 1.1

Copyright IBM Corp. and other contributors.

Used for IDs, hashes, and mono UI (`@fontsource/ibm-plex-mono`).

Canonical license: <https://github.com/IBM/plex/blob/master/LICENSE.txt>

## Legacy vendored files

`fonts/satoshi/` and `fonts/jetbrains-mono/` were removed after the move to
fontsource. They are no longer shipped in the repository; earlier shells had
vendored woff2 files here, but `fonts.css` no longer references them. The ITF
Free Font License for Satoshi does not permit redistributing those font files
standalone.
