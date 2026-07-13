# Self-hosted typeface licenses

Obiter vendors its typefaces (woff2) and serves them from the app bundle
instead of the Fontshare CDN. A packaged desktop app must not depend on a CDN:
broken offline, an external runtime dependency, and a future CSP problem.

## Satoshi — ITF Free Font License (FFL)

Copyright Indian Type Foundry (ITF).

Satoshi is governed by the **ITF Free Font License (FFL)** — the "Closed Source"
license on Fontshare. It is 100% free for personal and commercial use and
permits embedding and self-hosting (confirmed in the Fontshare FAQ: fonts may
be "downloaded as an offline kit for self-hosting"). It is **not** open source:
the FFL does not permit reselling or redistributing the font files, or
derivative font files, standalone.

Canonical license text: <https://www.fontshare.com/licenses/itf-ffl>

### Weights vendored

- Satoshi-Regular.woff2 (400)
- Satoshi-Medium.woff2 (500)
- Satoshi-Bold.woff2 (700)

Satoshi has **no 600 (SemiBold) cut** — Fontshare does not publish one (the
`@600` request in the prior CDN `<link>` was a silent no-op). The design
tokens' `--obiter-font-weight-semibold: 600` is therefore synthesized by the
browser (faux-bold from 500/700) exactly as it was under the CDN link. No
visual change; documented here so the missing file is not mistaken for an
oversight.

## JetBrains Mono — SIL Open Font License 1.1

Copyright 2020 The JetBrains Mono Project Authors
(<https://github.com/JetBrains/JetBrainsMono>).

Source: official JetBrains Mono release v2.304. The full license text is in
`jetbrains-mono/LICENSE.txt` (verbatim from the release archive). The SIL OFL
1.1 permits use, study, modification, and redistribution (including
self-hosting and bundling in an app), with the reserved-name condition standard
to the OFL.

### Weights vendored

- JetBrainsMono-Regular.woff2 (400)
- JetBrainsMono-Medium.woff2 (500)
