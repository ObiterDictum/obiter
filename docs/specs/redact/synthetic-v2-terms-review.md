# Synthetic v2 provider terms gate

**Status: maintainer-approved on 2026-07-19.** The maintainer confirmed DeepSeek is approved for this fictional synthetic-data workflow. `OBITER_DEEPSEEK_TERMS_CONFIRMED=1` may be set for an explicitly opted-in run. Do not use real client data or secrets as generation input.

The public DeepSeek [Terms of Use](https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html) and [Privacy Policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html) do not, by themselves, confirm rights to commercially redistribute a generated dataset or an API-specific no-training/retention/deletion commitment. The privacy policy describes service-wide processing and retention as necessary for stated purposes, rather than a zero-retention API commitment.

Before the dry run, obtain written confirmation for the specific API account covering commercial output use and redistribution, API prompt/output retention and model-training treatment, data location/deletion, and the applicable DPA/security terms. Inputs here are fictional, but this gate also protects against the future accidental use of sensitive data.

Anthropic Batch API implementation references: [batch processing](https://docs.anthropic.com/en/docs/build-with-claude/batch-processing), [batch result retrieval](https://docs.anthropic.com/en/api/retrieving-message-batch-results), and [prompt caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching). Batch results are correlated by `custom_id`, never output position; the shared system block uses ephemeral `cache_control`.
