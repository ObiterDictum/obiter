# API ingress configuration

`entrypoints.yml` is the version-controlled owner of the Traefik `entryPoints`
settings the API relies on and Dokploy does not set by default: request and
response deadlines, the keep-alive idle window, and the request-header limit.

Dokploy generates `/etc/dokploy/traefik/traefik.yml` once at install and never
rewrites it. That file is the deployed configuration and is not in this
repository, so **merging a change here does not change Traefik**: an operator
applies the fragment through Dokploy's Traefik file editor (or edits the file and
restarts `dokploy-traefik`). The operator runbook is
[`docs/specs/deployment.md`](../../docs/specs/deployment.md), under "API runtime
and image".

Why the proxy carries these: Bun exposes no request-header deadline, no
whole-request deadline and no configurable header-size limit. Node did, so
without the fragment a move to Bun silently loses those protections.
`http.maxHeaderBytes` is absent from Dokploy's own configuration schema, so a
value cannot be discovered from Dokploy's UI; it exists in Traefik v3.6 and is
pinned here.

The values are validated by [`scripts/api-ingress`](../../scripts/api-ingress),
which runs this file verbatim in a disposable Traefik:

- Traefik **v3.6.25**, the image Dokploy pulls for a fresh install
  (`TRAEFIK_VERSION` default), digest
  `sha256:31267173a15b4944e797a76ffd9c419707c8d8b32fe5b610f80cd0cfa05f372d`.
- A control run with `readTimeout`/`writeTimeout` at 5 s proves each knob bites
  at the configured value, so a value cannot pass by being ignored.

Re-run the harness after changing this file or moving to a different Traefik
version. The addresses in the file are Dokploy's default ports; if the server
listens elsewhere, keep its addresses and merge only the `transport` and
`http.maxHeaderBytes` keys.
