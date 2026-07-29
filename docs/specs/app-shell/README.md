# App Shell Rebuild Spec

Priority: `P1` — gates the Redact review UI track.

This folder holds the executable planning layer for the [`packages/app-shell`](../../../packages/app-shell) rebuild defined by [App Shell Rebuild PRD](../../prds/archive/app-shell-rebuild.md).

## Files

- [contract.md](contract.md) — **the component contract.** This is the M1 freeze artifact the Redact review UI builds against. Stable export names, token names, route shapes, and the change process.
- [implementation.md](implementation.md) — the M1 build plan (task-level, file-level), the design-token derivation, scope boundaries, and verification.

## Scope of this track (M1 only, this pass)

M1 ends at the **contract freeze**. M2 (live surfaces + fixture deletion) and M3 (search restyle + desktop + polish) are out of scope for this pass and resume after the contract is reviewed.

## Authority order on conflict

1. [App Shell Rebuild PRD](../../prds/archive/app-shell-rebuild.md) — product principles win.
2. This contract — stable surface for dependent tracks.
3. The repo design skills (`.agents/skills/design-taste-frontend`, `high-end-visual-design`) — applied on neutrals, contrast, accessibility, density; **overridden** by the PRD on motion and flash ("calm, dense, professional; no gratuitous motion").
