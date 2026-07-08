# Pi Agent Framework PRD

## Summary

Pi is Obiter's bounded agent framework for multi-step legal workflows. It coordinates planning, tool use, evidence retrieval, verification, drafting, redaction, and human handoff while preserving inspectable traces and strict tool boundaries.

The first release is not broad autonomy. It is an inspectable framework that can show what an agent was asked to do, what it was allowed to do, what it actually did, what evidence it used, what it generated, and why it stopped.

See the detailed implementation spec at [docs/specs/pi-agent-framework.md](../specs/pi-agent-framework.md).

## Problem

Legal agents are risky when their reasoning path and tool use are hidden. A lawyer cannot rely on a generated output without evidence. A university reviewer cannot evaluate an agent from final prose alone. A builder cannot improve the system without knowing whether the failure came from planning, retrieval, tool use, verification, or policy handling.

Pi exists to make agent behavior bounded, auditable, and benchmarkable.

## Product Principles

- Agents operate through product APIs and scoped tools.
- Every material step is inspectable.
- Legal claims require evidence links.
- Verify checks generated legal analysis before it is presented as reliable.
- Handoff is a successful safety behavior when the task is outside scope or evidence is weak.
- Tool boundaries are explicit and versioned.
- Unknown legal-critical states fail visibly.

## Goals

- Define a durable agent run lifecycle.
- Record run, step, and tool-call traces.
- Enforce allowed tools and policy boundaries.
- Link generated claims to Verification Evidence packages.
- Support explicit handoff states.
- Make agent behavior measurable through Bench.
- Avoid unsafe trace storage.

## Non-Goals

- Unbounded autonomous legal advice.
- Silent drafting across entire matters.
- Direct database, object storage, provider, private index, or admin search access.
- Replacing Verify.
- Treating fluent output as task success.
- Training on client matter data.

## Users

### Lawyer User

Needs bounded assistance that can show its evidence and stop when lawyer judgment is required.

### Internal Builder

Needs to inspect traces and diagnose planning, retrieval, tool, or policy failures.

### Academic Reviewer

Needs to evaluate agent behavior, not just final output quality.

### Product Operator

Needs governance over tool access, external model calls, and audit state.

## Core Use Cases

1. Run a bounded research trace that retrieves sources, drafts an answer, verifies claims, and shows warnings.
2. Triage verification findings into a reviewer handoff.
3. Prepare a redaction review checklist without approving final redactions.
4. Stop when evidence is weak, contradictory, or outside tool scope.
5. Export agent traces for Bench and university review.

## Scope

### First Release Scope

- agent registry
- tool registry
- run records
- step records
- tool-call records
- policy boundary fields
- handoff states
- trace export

### Later Scope

- Research Trace Agent
- Verification Triage Agent
- Redaction Review Agent
- trace inspector UI
- Bench agent benchmark family
- multi-agent delegation

Multi-agent delegation is intentionally out of scope until single-agent trace quality is proven.

## Agent Registry

Required fields:

- `agent_id`
- `agent_name`
- `agent_version`
- `purpose`
- `allowed_task_types`
- `allowed_tool_ids`
- `model_name`
- `prompt_version`
- `policy_version`
- `stopping_rules_version`
- `benchmark_ids`
- `status`

Statuses:

- `draft`
- `active`
- `disabled`
- `deprecated`

## Tool Registry

Required fields:

- `tool_id`
- `tool_name`
- `tool_version`
- `input_schema_ref`
- `output_schema_ref`
- `required_permissions`
- `private_data_allowed`
- `external_model_allowed`
- `audit_category`
- `rate_limit_class`
- `owner`
- `status`

Tool rules:

- tools must validate inputs at the boundary
- tools must return typed outputs
- tools must declare whether private matter data may cross the boundary
- tools must never expose internal credentials to the agent
- tools must fail visibly on permission mismatch

## Run Lifecycle

1. User or system creates a bounded goal.
2. Pi records the run and applies policy classification.
3. Pi selects an allowed agent.
4. Agent creates a plan.
5. Agent executes scoped tool calls.
6. Agent records evidence refs and intermediate outputs.
7. Agent runs Verify when legal claims are generated.
8. Agent returns final output, handoff, or failure.
9. Pi exposes trace data to Bench and product UI.

## Run Record

Required fields:

- `agent_run_id`
- `agent_id`
- `agent_version`
- `goal_summary`
- `matter_id`
- `user_id`
- `organisation_id`
- `policy_version`
- `tool_registry_version`
- `model_name`
- `prompt_version`
- `status`
- `stop_reason`
- `created_at`
- `completed_at`

Statuses:

- `queued`
- `running`
- `waiting_for_tool`
- `waiting_for_review`
- `completed`
- `handed_off`
- `failed`
- `cancelled`

Stop reasons:

- `task_completed`
- `manual_review_required`
- `weak_evidence`
- `contradictory_evidence`
- `unsupported_claim`
- `tool_unavailable`
- `permission_denied`
- `policy_blocked`
- `user_cancelled`
- `system_error`

## Step Record

Required fields:

- `step_id`
- `agent_run_id`
- `step_index`
- `step_type`
- `operation`
- `input_summary`
- `output_summary`
- `evidence_ids`
- `tool_call_ids`
- `verification_finding_ids`
- `status`
- `error_category`
- `started_at`
- `completed_at`

Step types:

- `classify`
- `plan`
- `search`
- `retrieve_evidence`
- `verify`
- `draft`
- `redact`
- `review`
- `handoff`

## Tool Call Record

Required fields:

- `tool_call_id`
- `agent_run_id`
- `step_id`
- `tool_id`
- `tool_version`
- `input_summary`
- `output_summary`
- `status`
- `latency_ms`
- `error_category`
- `evidence_ids`
- `audit_log_id`

The input and output summaries must be bounded. Raw private matter text is not stored by default.

## Handoff Requirements

The agent must hand off when:

- evidence is weak or contradictory
- a citation is unresolved or ambiguous
- Verify marks a generated claim unsupported or contradicted
- requested action is outside allowed tools
- private data would cross an unapproved boundary
- tool output is incomplete or uncertain
- legal judgment is required

Handoff output must include:

- blocking condition
- affected claims or findings
- evidence inspected
- missing input or decision
- recommended reviewer action

## First Agents

### Research Trace Agent

Purpose:

- answer a bounded legal research question with evidence and verification warnings

Flow:

1. normalize question
2. create Search plan
3. retrieve evidence package
4. draft source-bound answer
5. run Verify
6. return answer or handoff

### Verification Triage Agent

Purpose:

- group Verify findings and prepare a reviewer handoff

Flow:

1. load Verify findings
2. group by severity and finding type
3. identify unresolved or unsupported items
4. prepare review checklist
5. stop for lawyer review

### Redaction Review Agent

Purpose:

- help review redaction findings without approving final output

Flow:

1. load redaction findings
2. group by entity and risk
3. identify uncertain or policy-sensitive items
4. prepare review checklist
5. stop before approval

## UI Requirements

### Agent Run View

Shows:

- goal summary
- status
- current step
- final output or handoff
- evidence links
- verification warnings

### Trace Inspector

Shows:

- step timeline
- tool calls
- bounded input and output summaries
- evidence refs
- policy blocks
- errors and stop reasons

Trace Inspector may be internal-only in the first release.

### Handoff View

Shows:

- reason for handoff
- affected claims, findings, or sources
- evidence reviewed
- question for the reviewer
- next allowed actions

## Functional Requirements

- Pi must create durable run records.
- Pi must create durable step records for material steps.
- Pi must create tool-call records for every tool invocation.
- Pi must enforce agent and tool permissions before execution.
- Pi must link legal claims to evidence packages.
- Pi must call Verify before generated legal analysis is marked reliable.
- Pi must support explicit handoff states.
- Pi must export traces for Bench.
- Pi must expose enough trace data for product UI inspection.

## Non-Functional Requirements

- Long-running runs should execute through workers when infrastructure exists.
- Idempotent steps should be safe to retry.
- Unknown statuses must fail visibly.
- Trace records should be compact.
- Trace views must handle long runs without overwhelming the user.
- Contracts should be typed and shared through `packages/contracts` when implemented.

## Security And Compliance

- Do not log raw private matter text by default.
- Do not store raw prompts containing private matter facts.
- Do not store secrets, embeddings, private screenshots, or sensitive stack traces.
- Do not expose database, object storage, provider, or admin search credentials to agents.
- External model calls involving matter data must be visible in product state and audit logs.
- Access control must be enforced server-side.
- Handoff must occur before unapproved private-data boundary crossing.

## Dependencies

- [Search](search-quality.md) evidence package.
- [Verify](verify.md) API and findings.
- [Verification Evidence](verification-evidence.md) claim map.
- [Bench](bench.md) support for agent trace scoring.
- Audit logging.
- Worker/job infrastructure for long-running runs.
- Shared contracts for agent, step, and tool schemas (`packages/contracts`).

## Rollout

### Gate 1: Framework Trace Core

Deliver:

- agent registry
- tool registry
- run, step, and tool-call records
- handoff states
- trace export

Exit criteria:

- every agent run is inspectable
- tool permission failures are visible
- traces avoid private raw text

### Gate 2: First Bounded Agent

Deliver:

- Research Trace Agent
- Search and Verify integration
- evidence package links
- final output and handoff rendering

Exit criteria:

- agent retrieves evidence before claims
- unsupported claims trigger warnings or handoff

### Gate 3: Evaluation

Deliver:

- Bench agent benchmark family
- trace completeness checks
- university review sample traces

Exit criteria:

- reviewer can score tool choice, evidence use, and stopping behavior

## Metrics

- run completion rate
- handoff rate by stop reason
- tool permission failure rate
- unsupported claim rate
- Verify failure rate after generation
- average steps per run
- average run latency
- trace completeness rate
- reviewer override rate
- Bench pass rate by agent

## Risks

- Users may over-trust agent output if handoff and verification states are not prominent.
- Trace storage can leak sensitive data if summaries are not bounded.
- Agents can become hard to debug if tool schemas are loose.
- Autonomy pressure can expand scope before trace quality is proven.
- Verify dependency can bottleneck answer flows if not staged carefully.

## Open Questions

- Which first bounded agent best supports the university conversation?
- Should Pi run records share infrastructure with Research and Verify runs?
- What trace fields are visible to lawyer users versus internal reviewers?
- Should tool policy be encoded with Zod schemas, a policy engine, or both?
- How should user cancellation and partial outputs appear in Bench?
