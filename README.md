# api-ai-readiness

> Grade any API for AI-native design — a scorecard, a generated behavioral test suite, and an MCP server,
> built from the **"Delivering APIs for AI"** framework.

[![npm](https://img.shields.io/npm/v/api-ai-readiness.svg)](https://www.npmjs.com/package/api-ai-readiness)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](#)

Point it at an OpenAPI/Swagger spec and get a computed answer to a question every API team now faces:
**how well does this API serve an AI agent?**

```text
$ apieval score https://docs.fwd.app/latest/api/spec/complete.json

  Forward Networks: Complete API — AI-readiness: 31%  (189 endpoints)
  list endpoints: 25%   ·   capability discovery: none

  Most common gaps:
    158×  no documented 4xx error response         (self-describing errors)
     41×  list endpoint has no limit/page-size      (context window)
     39×  no field-selection param                  (context efficiency)
     31×  no server-side filter params              (retrieval shape)
      3×  chains 2+ resource ids                     (multi-stage workflow)
```

---

## Why this exists

Traditional APIs returned small, digestible chunks for humans clicking through pages. Agents don't click —
they need complete, **bounded**, filterable, self-describing access. An API that dumps 15,000 rows or hides
a required parameter behind a spec that says "optional" doesn't fail loudly; it silently **blows the
model's context window** or **dead-ends the agent**.

The insight that makes this a *tool* and not an *opinion*: **the failure modes an AI agent hits are
observable.** "Oversized response" is a query that stalls. "Hidden multi-stage" is a runtime `400`.
"No error recovery" is a dead-end the agent can't retry. So most of the AI-native design framework is a
**computable rubric** — which is exactly what this project computes.

Every dimension maps 1:1 to a section of *"Delivering APIs for AI"* — see [`SPEC.md`](./SPEC.md).

---

## What it does — three layers

| Layer | Needs | What you get |
|---|---|---|
| **1 · Scorecard** | just the spec | Deterministic AI-readiness grade, per endpoint + rolled up, with the specific gap and the pattern to adopt. **No LLM. No call to the API itself.** |
| **2 · Test-suite generation** | the spec (+ optional LLM) | Realistic per-endpoint natural-language prompts — the behavioral test plan. |
| **3 · Live execution** | a **runner** (or an MCP host) | Run the suite against the real system and grade **PASS / SLOW / FAIL**, catching what a static spec can't (oversized-in-practice, required-in-practice params). |

Layer 1 is fully portable and dependency-free. Layers 2–3 are opt-in. Live execution is decoupled behind a
4-method `Runner` interface, so the project depends on **no** particular agent runtime.

---

## The rubric

| Dimension | Article principle | Signal |
|---|---|---|
| **Response discipline** | Context window · intelligent defaults · reference-based patterns | limit param? sane default? summary/reference shape? *(+ live: oversized in practice?)* |
| **Retrieval shape** | Server-side filtering & aggregation | filter params present |
| **Field selection** | Context efficiency (selective fields) | `fields`/`select`/`expand` param |
| **Self-description** | Error recovery · self-describing responses | documented `4xx` *(+ live: actionable error?)* |
| **Workflow atomicity** | The multi-stage API problem · explicit state handles | chained non-scope ids *(+ live: required-in-practice param)* |
| **Discovery** | Capability discovery (`server/discover`, Server Cards) | is there a discovery endpoint? |

≈70% of the framework is statically gradable; ~15% comes free from live probing; ~15% (token-cost metadata,
streaming conformance, prompt-cache infra) is design-time and out of scope for a black-box evaluator.

---

## Install

```bash
npm install -g api-ai-readiness      # CLI + MCP server
# or, as a library:
npm install api-ai-readiness
```

## Use — CLI

```bash
# Layer 1 — deterministic scorecard (no LLM)
apieval score <spec-url|file|-> [--query k] [--tag t] [--format md] [--out report.md]

# Layer 2 — generate a behavioral test suite
apieval gen <spec-url> [--query k] [--per 2] --out suite.json

# Layer 3 — run it (mock runner ships in-core; real runners are library adapters)
apieval run suite.json --out report.md
```

## Use — library

```ts
import { scoreSpec, generateTestSuite, runSuite } from "api-ai-readiness";

const card    = await scoreSpec("https://api.example.com/openapi.json");         // Layer 1
const suite   = await generateTestSuite("https://api.example.com/openapi.json"); // Layer 2
const results = await runSuite(suite, myRunner);                                 // Layer 3 — your runner
```

A `Runner` is four lines to implement — bind it to OpenAI/Anthropic tool-calling, a weave task, or your own agent:

```ts
interface Runner {
  run(prompt: string, opts?: { timeoutMs?: number }): Promise<{
    status: "completed" | "timeout" | "error"; text: string; ms: number;
  }>;
}
```

## Use — MCP server

`api-ai-readiness` ships as an MCP server, so **any MCP host** (Claude Desktop, Cursor, an agent framework)
can evaluate an API as a native capability. It exposes:

- **Tools** — `score_api`, `search_spec`, `generate_test_suite`, `run_test_suite`
- **Resource** — `readiness://<id>`: the full per-endpoint scorecard, fetched *on demand* (a large report
  never lands in your context unless you ask for it)
- **Prompt** — `audit-api-for-ai-readiness`

Layer-3 execution uses **MCP sampling** — the server borrows the *host's* model to run the generated
prompts, so it needs no LLM of its own.

```jsonc
// claude_desktop_config.json
{
  "mcpServers": {
    "api-ai-readiness": { "command": "npx", "args": ["-y", "api-ai-readiness", "apieval-mcp"] }
  }
}
```

Then ask your host: *"Score the Stripe API for AI-readiness and tell me the top three gaps."*

---

## It practices what it grades

The MCP server is built the way it tells other APIs to build:

- **Reference-based / explicit handles** — `score_api` returns a summary + a `readiness://` handle, not a
  189-endpoint dump. The exact pattern the stateless MCP core now assumes.
- **Stateless** — every request carries its own `specUrl`; the only state is a content-addressed report cache.
- **Bounded responses + server-side filtering** — summaries by default, `query`/`tag`/`limit` on every tool.
- **Capability discovery** — MCP `tools/list` *is* discovery; rich descriptions + schemas per tool.
- **Sampling** — the server reasons via the host's model instead of being a passive endpoint.

Known debt (the recurring lesson): the report cache is **in-process**, so a `readiness://` handle won't
resolve across horizontally load-balanced instances — the handle is right, the store is local. Fine for a
stdio server; a hosted deployment wants a shared store (Redis/S3). This is precisely the *"design for
statelessness from the start"* point — and everyone gets the handle right and the store wrong first.

---

## Provenance

The scorecard engine was first built inside [weave](https://github.com/gaberger/weave)'s `api-analyst`
plugin — extracted here as a standalone, domain-agnostic project. Weave remains one consumer (and one
runner adapter); this evaluator depends on nothing weave-specific.

## Roadmap

- [x] Deterministic scorecard + CLI (`score`)
- [x] Test-suite generation (`gen`)
- [x] Runner contract + mock; live grading (`run`)
- [x] MCP server (tools + `readiness://` resource + prompt + sampling)
- [ ] Runner adapters: `openai`, `anthropic`, `weave-fanout`
- [ ] Shared-store resource cache (stateless across instances)
- [ ] MCP Tasks extension for large async suites
- [ ] `server/discover` + Server Card conformance checks for MCP-server targets
- [ ] Aggregation-endpoint signal; cost-metadata check

## License

MIT — see [`LICENSE`](./LICENSE).
