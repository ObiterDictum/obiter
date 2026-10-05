# Archived PRDs

Delivered or superseded product requirements, kept for the decision record rather than as build inputs.

**Do not build from these.** They describe what was decided at the time, which is not always what shipped. Where a document and the code disagree, the code is the truth and the deviation should be recorded in the active PRD that replaced it.

| Document                                               | Status     | Notes                                                                                                                                                                                                                  |
| ------------------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [redact-1-detection.md](redact-1-detection.md)         | Delivered  | Detection pipeline. Two known deviations: the Effect TS pilot never happened, and F30's environment configuration was not built.                                                                                       |
| [redact-2-review-output.md](redact-2-review-output.md) | Delivered  | Review, decisions and output. Remains the freeze reference for `docs/specs/app-shell/contract.md`.                                                                                                                     |
| [redact-3-production.md](redact-3-production.md)       | Delivered  | Audit export, synthetic data, dataset export.                                                                                                                                                                          |
| [search-quality.md](search-quality.md)                 | Superseded | Replaced by [Search](../search.md). Predates the Find Case Law licence.                                                                                                                                                |
| [app-shell-rebuild.md](app-shell-rebuild.md)           | Delivered  | M1 to M3 closed July 2026. Remains the reference for `docs/specs/app-shell/contract.md`, which is still the live component freeze. One documented verification gap: `docker build` was not run in the dev environment. |
| [platform-deletion.md](platform-deletion.md)           | Delivered  | Soft-delete, cascade, role gating. Its deferred document and run restore endpoints were subsequently delivered in PR #46, so the deferrals recorded in the document are closed.                                        |

Outstanding Redact work carried forward from the three delivered PRDs lives in [Redact 4: Detection Integrity and Hardening](../redact-4-hardening.md).

Verification of the Redact PRDs was performed on 2026-07-27: all three affected packages plus the API pass their tests and typecheck. See the active PRD for what was found outstanding.
