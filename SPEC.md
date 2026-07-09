# SPEC — the AI-readiness rubric

This is the scoring contract. It translates *"Delivering APIs for AI"* into a deterministic, spec-derived
rubric, and marks where a **live probe** is needed to confirm what a static spec cannot show.

Design principle: **an AI agent hitting the API is the measuring instrument.** Most of the article's
guidance describes observable agent failure modes (context overflow, dead-end errors, hidden required
params), so it can be scored — but a spec is a *claim*, and some claims only break at runtime. Every
dimension therefore has a **static** signal (from the spec) and, where meaningful, a **live** signal (from
running a prompt).

## Verdict model

- **Static score** (Layer 1): 0–100% per endpoint + rolled up. Deterministic; same spec → same score.
- **Live grade** (Layer 3), per generated prompt: **PASS** (grounded answer observed) / **SLOW** (pending
  at timeout — heavy/unbounded) / **FAIL** (explicit 4xx/5xx/error). Three states, never two — a timeout
  is *not* a failure, and a slow-but-correct endpoint is not broken.

The two combine: a spec dimension that scores well statically but whose prompt runs **SLOW** or **FAIL**
live is downgraded, because reality beats the spec (a spec that marks a field "optional" while the API
returns `400 required` is the canonical case).

## Dimensions

### 1. Response discipline — *context window*
The single biggest agent constraint. Applies to **list-shaped GET responses** (a top-level array, or an
object with an array field).

| Signal | Points | Gap emitted |
|---|---:|---|
| Has a `limit`/`per_page`/`page_size`/`max_results`/`top`/`size`/`first` param | +1 | "list endpoint has NO limit/page-size param — unbounded response blows the context window" |
| …and that param has a **default** | +1 | "has a limit param but NO default — set a sane default (e.g. 100)" |
| Returns a summary/reference (pagination cursor, `count`/`total`/`links`/`next`, or not a bare array) | +1 | "returns a bare top-level array — no count/summary/reference; adopt the summary + reference-handle pattern (preview + result_id)" |

**Live signal:** a prompt whose response is oversized in practice (SLOW, or a payload beyond a token
budget) is a confirmed context-window gap **even if the spec looked bounded**.

*Article mapping:* Context Window Challenge; Intelligent Defaults (sensible limits, auto-summarization);
Reference-Based Patterns (`data_reference: cache://…`).

### 2. Field selection — *context efficiency*
| Signal | Points | Gap |
|---|---:|---|
| A `fields`/`select`/`expand`/`include`/`columns`/`projection`/`view` query param | +1 | "no field-selection param — the agent must pull every column" (list endpoints) |

*Article mapping:* Optimize for Context Efficiency → Selective Fields (GraphQL-style projection).

### 3. Retrieval shape — *server-side filtering & aggregation*
| Signal | Points | Gap |
|---|---:|---|
| At least one query param that is not a limit/pagination/field param (i.e. a real filter) | +1 | "no server-side filter params — the agent must over-fetch, then filter in-context" (list endpoints) |

*Article mapping:* Server-Side Filtering and Aggregation. (A full **aggregation** signal — group-by/summary
endpoints — is a roadmap refinement; today filterability is the proxy.)

### 4. Self-description — *error recovery*
| Signal | Points | Gap |
|---|---:|---|
| At least one documented `4xx` response | +1 | "no documented 4xx error response — the agent can't recover from a bad call" |

**Live signal:** when a prompt fails, is the error *actionable* (the agent retried and succeeded) or a
dead-end? A live FAIL with an opaque message is a self-description gap regardless of the spec.

*Article mapping:* Design for Autonomy → Self-Describing Responses, Error Recovery.

### 5. Workflow atomicity — *the multi-stage API problem*
Addressing a resource by id (`DELETE /x/{id}`) is **normal REST, not a trap**. A **scope id**
(`networkId`/`snapshotId`/`orgId`) is always resolvable context. Only a **chain of 2+ non-scope resource
ids** is a genuine multi-stage problem (each must come from a prior call).

| Signal | Points | Gap |
|---|---:|---|
| ≤ 1 non-scope resource id in the path | +1 | — |
| ≥ 2 non-scope resource ids | 0 | "chains N resource ids (…) — multi-stage: each must come from a prior call; consider a query-by-attribute or consolidated variant" |

**Live signal:** a runtime `400 "X is required"` for a param the spec marked optional is a **hidden**
multi-stage / required-in-practice trap the static check cannot see. This is the highest-value live finding.

*Article mapping:* The Multi-Stage API Problem; Explicit State Handles (the stateless-core pattern —
mint a handle, pass it back); Protocol-Level Tasks.

### 6. Discovery — *capability discovery* (spec-level, once per API)
| Signal | Result |
|---|---|
| Any path matching `openapi`/`swagger`/`schema`/`catalog`/`capabilit`/`discovery`/`spec` | `discoveryEndpoint: true` |

*Article mapping:* Capability Discovery (`server/discover`, MCP Server Cards at `.well-known`).

## Scoring

Per endpoint: `score = Σ points / Σ applicable max` → percentage. List-shaped GETs are scored on all
list-relevant dimensions (max up to 6); write/single-resource endpoints are scored only on the dimensions
that apply to them (self-description + workflow atomicity), so a clean `DELETE /x/{id}` is **not** dragged
to 0.

Roll-ups: overall average, **list-endpoint average** (what agents hit hardest — usually the headline
number), a ranked worst-endpoints list, and the most common gaps across the API.

## What is deterministic vs. live

| | Static (spec) | Live (runner) |
|---|---|---|
| Response discipline | limit / default / summary shape | **oversized in practice** |
| Field selection | param present | — |
| Retrieval shape | filter params present | — |
| Self-description | documented 4xx | **actionable error?** |
| Workflow atomicity | chained ids | **required-in-practice param (runtime 400)** |
| Discovery | discovery endpoint | — |

≈70% of the article's guidelines are directly static-gradable; ~15% come free from live probing; ~15%
(token-cost metadata, streaming/SSE conformance, prompt-cache infra) are design/instrumentation concerns
out of scope for a black-box evaluator.

## The runner contract (Layer 3)

Live execution is decoupled so the project depends on no particular agent runtime:

```ts
interface Runner {
  /** Run one natural-language prompt against the target system; return what the agent produced. */
  run(prompt: string, opts?: { timeoutMs?: number }): Promise<RunOutcome>;
}
interface RunOutcome {
  status: "completed" | "timeout" | "error";
  text: string;        // the agent's answer / error
  ms: number;
  meta?: Record<string, unknown>;
}
```

Reference adapters (roadmap): `weave-fanout` (declare each prompt as a weave task), `openai` /
`anthropic` (a tool-calling loop bound to the target's tools), and a `mock` for tests. The evaluator maps
`RunOutcome` → PASS/SLOW/FAIL and folds it into the scorecard.

## Non-goals

- Not a linter for OpenAPI correctness (use Spectral for that) — this grades *AI-consumption fitness*.
- Not tied to MCP: it grades any OpenAPI/Swagger API. An MCP-server evaluator that checks stateless
  handles, `server/discover`, and Server Cards is a planned **extension**, not the core.
