# Pi Agent Framework Spec

Priority: `P2 university verification`

Pi is the agent framework layer planned for Obiter workflows that need multi-step planning, tool use, retrieval, verification, and handoff. This document records the minimum documentation needed before the framework is used as evidence in an academic or external-review context.

## Purpose

The Pi layer should make agent behavior inspectable. It should not be treated as a black-box assistant.

It should show:

- what goal the agent was given
- what tools it was allowed to use
- what steps it took
- what evidence it retrieved
- what it generated
- why it stopped
- what still requires human review

## Agent Run Lifecycle

An agent run should move through explicit states:

1. receive user goal
2. classify task and policy constraints
3. build an initial plan
4. execute bounded tool calls
5. retrieve source evidence where needed
6. synthesize or update output
7. run verification checks where legal claims are generated
8. stop with a final output, handoff, or failure reason

Unknown or unsafe states must fail visibly.

## Run Record

Each run should record:

- `agent_run_id`
- `agent_name`
- `agent_version`
- `goal_summary`
- `matter_id` where applicable
- `policy_version`
- `tool_registry_version`
- `model_name`
- `prompt_version`
- `status`
- `stop_reason`
- `created_at`
- `completed_at`

The goal summary must be bounded and must not leak raw private matter text into logs.

## Step Record

Each agent step should record:

- `step_id`
- `agent_run_id`
- `step_index`
- `step_type`
- `operation`
- `input_summary`
- `output_summary`
- `evidence_ids`
- `tool_call_ids`
- `status`
- `error_category`
- `started_at`
- `completed_at`

Step types:

- `plan`
- `search`
- `retrieve_evidence`
- `verify`
- `draft`
- `redact`
- `review`
- `handoff`

## Tool Boundary

Tools must declare:

- name
- version
- input schema
- output schema
- permissions needed
- whether private matter data may be sent
- whether external model calls are allowed
- audit category

The agent must not receive raw database access, private indexes, object storage credentials, provider credentials, or Meilisearch admin keys. It should call product APIs or explicitly scoped tools.

## Evidence Handling

Agent outputs that contain legal claims should link to the verification evidence package.

The agent may use:

- source ids
- evidence ids
- bounded public excerpts
- verification finding ids
- benchmark artifact refs

The agent must not store raw private matter text, embeddings, secrets, or sensitive stack traces in its trace.

## Human Handoff

The agent should hand off rather than continue when:

- evidence is weak or contradictory
- the requested action is outside allowed tools
- private data would cross an unapproved boundary
- a citation is unresolved or ambiguous
- verification returns unsupported or contradicted claims
- the task requires lawyer judgment

Handoff output should explain the blocking condition and list the evidence or missing input needed for review.

## Benchmarking

Pi agent runs should be benchmarked separately from plain Search or Verify tasks because tool choice and stopping behavior are part of the quality claim.

Bench should measure:

- whether the agent chose the right tool
- whether it retrieved source evidence before making legal claims
- whether it stopped when support was weak
- whether final output included inspectable evidence
- whether unsafe or unsupported actions were avoided

## Ratio

Ratio is the agent's animated badger mascot: barrister's wig, gown and bands, holding a brief tied with pink tape. It sits beside each agent turn, in the empty agent window and in the matter-side agent panel header. The app renders it from `@obiter/ui`; static avatars for Slack, Teams and Buzz are written to `apps/web/public/ratio/` by `scripts/ratio-avatars.ts`.

| State            | Reads as                      | Motion                                    |
| ---------------- | ----------------------------- | ----------------------------------------- |
| `idle`           | waiting for you               | sway, blink, brief wave                   |
| `thinking`       | planning before it acts       | head up, eyes up, thought dots, paw tap   |
| `working`        | reading or drafting           | open brief, scanning eyes, lines lighting |
| `needs_approval` | holding out the brief         | raised brows, amber pulse ring            |
| `done`           | finished the task             | closed eyes, nod, tick, sparkles          |
| `stuck`          | failed or needs more from you | puzzled tilt, glancing eyes, sweat drop   |

### Derivation

`agentPresence(run, latestEvent?)` in `@obiter/contracts` derives the state from what the API already reports. The harness never declares presence: it has no UI and no presence channel.

| API run status         | Latest trace event                      | Presence         |
| ---------------------- | --------------------------------------- | ---------------- |
| no run, or `cancelled` | —                                       | `idle`           |
| `queued` or `running`  | a tool `step_started` with no later end | `working`        |
| `queued` or `running`  | anything else                           | `thinking`       |
| `waiting_for_approval` | —                                       | `needs_approval` |
| `completed`            | —                                       | `done`           |
| `failed` or `refused`  | —                                       | `stuck`          |

### Ownership

- harness: no UI, never sets presence
- API: sets run status
- `@obiter/contracts`: the derivation and its schema
- `@obiter/ui`: the art, keyframes and still pose

Live instances animate: the current or latest turn in the agent window, the matter panel header and the empty agent window. A state change eases the new pose in, so it is not a hard swap. `done` celebrates twice, then settles into a calm loop with the tick still showing; `stuck` keeps the sweat drop and puzzled loop. Earlier turns show the still pose so history does not keep moving. Below 40px the mascot drops the gown and brief but keeps motion: blink, sway, thought dots, the amber approval ring and the done tick. `prefers-reduced-motion: reduce` is the only other still state.

## Acceptance Criteria

- every agent run has a durable run record
- every material step is inspectable
- every tool call is tied to a versioned schema and policy boundary
- legal claims generated by the agent link to evidence or verification findings
- handoff states are explicit and cannot be mistaken for successful completion

## Conversation model and thinking choices

`GET /api/agent/models` returns the authenticated organisation's available
Anthropic models, their labels, descriptions, supported `thinkingLevels` and
`defaultThinking`, plus the organisation `default` model and thinking level.
Without a configured key it returns no models and `reason: not_configured`;
the composer directs users to Settings → Agent. The isolated e2e stack offers
its synthetic stand-in instead.

Session creation and turns accept optional `model` and `thinking` fields.
Thinking is `off`, `low`, `medium` or `high`; unsupported combinations return
400 `validation_failed`. Sessions remember the last choice. Each run preserves
its model identity, label and thinking level: the answer footer reads
`Sonnet 5.5 · High thinking`, or `No thinking` for `off`.

The composer and the matter panel share one pill that names the model and the
level (`Sonnet 5.5 · Medium`) and opens a single menu: the models with their
descriptions, then a Thinking row holding a segmented control over exactly the
levels the selected model supports, in the order Off, Low, Medium, High. The
row is hidden when the model offers one level, and picking a level leaves the
menu open. A model change keeps the level when the new model supports it and
uses its `defaultThinking` otherwise. The pill is disabled during a live turn,
and the setup note appears only when the catalogue has no models. Settings
sets the organisation default with the same segmented control and retains
free-text Anthropic model IDs for organisations using their own key.

Opus 5.5 and Fable 5.2 require thinking and offer Low, Medium and High.
Sonnet 5.5 uses `between_tools` for Off; Haiku 5.5 uses `disabled`.
Adaptive models map the other levels to Anthropic effort. Older supported
Claude 4 models use budgets of 1,024 / 4,096 / 8,192 thinking tokens, with
2,048 answer tokens in addition. Unknown custom models offer Off only.
Thinking counts as output in usage and reservations include the whole output
limit. See [Anthropic thinking](https://platform.claude.com/docs/en/build-with-claude/thinking).

This covers Anthropic with the organisation's own key and the stand-in.
Managed EU models and other providers arrive with the harness gateway.
