# From Framework to Tool: Grading APIs for AI-Readiness

*A companion to "Delivering APIs for AI." The previous piece argued that we're crossing from
human-interface (HI) APIs to agent-interface (AI) APIs, and laid out the design patterns that shift
requires. This one is about what happened when we tried to **measure** it — and shipped the measuring
instrument as an MCP server.*

## The claim that turned a framework into a tool

The design guidelines in "Delivering APIs for AI" read, at first, like taste: return summaries, bound your
responses, describe your errors, avoid hidden multi-stage workflows. Good advice — but advice.

The realization that changed everything: **these aren't aesthetic preferences. They're observable failure
modes under a real agent.**

- "Oversized response" isn't a style critique. It's a query that *stalls* or blows the model's context
  window — you can watch it happen.
- "Hidden multi-stage workflow" isn't theoretical. It's a runtime `400` for a parameter the spec swore was
  optional.
- "No error recovery" isn't hand-waving. It's a dead-end the agent literally cannot retry its way out of.

If the failure modes are observable, the framework is a **computable rubric**, not an opinion. So we built
one: [`api-ai-readiness`](https://github.com/gaberger/api-ai-readiness) — point it at any OpenAPI spec and
get a graded answer to "how well does this API serve an AI agent?"

## Three layers, and why the boundary matters

The tool has three layers, and where they separate is the whole architecture:

1. **Scorecard** — a deterministic AI-readiness grade from the spec alone. No LLM, no call to the API
   itself, just static analysis. This is the ~70% of the framework that's directly computable.
2. **Test-suite generation** — realistic natural-language prompts per endpoint. The behavioral test plan.
3. **Live execution** — run the suite against the real system and grade **PASS / SLOW / FAIL**, catching
   the ~15% a static spec can't show: oversized-*in-practice* responses, required-*in-practice* params.

The clean line falls exactly where the framework's static-vs-live distinction predicted. **Layer 1 has zero
dependencies** — that's what makes it a portable library anyone can `npm install`. The coupling to an agent
runtime only appears at Layer 3, quarantined behind a four-method `Runner` interface. The remaining ~15% of
the framework (token-cost metadata, streaming conformance, prompt-cache infrastructure) is design-time and
honestly out of scope for a black-box evaluator — so the tool doesn't pretend to grade it.

## What it found: the HI→AI thesis, measured

We pointed it at a real, mature enterprise API — Forward Networks' Complete API, 189 endpoints:

```text
Forward Networks: Complete API — AI-readiness: 31%  (189 endpoints)
list endpoints: 25%   ·   capability discovery: none

  158×  no documented 4xx error response      (self-describing errors)
   41×  list endpoint has no limit/page-size   (context window)
   39×  no field-selection param               (context efficiency)
   31×  no server-side filter params           (retrieval shape)
    3×  chains 2+ resource ids                  (multi-stage workflow)
```

Thirty-one percent. Not because it's a *bad* API — it's a well-built REST surface. It's a **human-era**
API: small digestible responses, pagination for humans, error handling documented for developers reading
docs rather than agents recovering at runtime. This is exactly the HI design the framework describes, now
with a number attached.

But the sharpest result was *inside* the same API. Its **NQE endpoints — a query interface** where the
caller expresses `where` / `group by` / `limit` in the request — scored **75%**, three times the raw REST
average of 25%.

That gap *is* the thesis, measured. A query interface is structurally AI-native: because the agent puts the
filter, the aggregation, and the limit *inside* the request, it physically can't over-fetch or blow the
context window. The REST endpoints hand the agent a firehose and hope; the query endpoint hands it a valve.
The tool didn't just grade the API — it explained the two design philosophies to each other, in the same
codebase.

## The instrument is also the exhibit: shipping it as an MCP server

Here's where it gets recursive. We shipped `api-ai-readiness` as an **MCP server**, so any host — Claude
Desktop, an IDE, an agent framework — can evaluate an API as a native capability:

```jsonc
{ "mcpServers": {
    "api-ai-readiness": { "command": "npx", "args": ["-y", "api-ai-readiness", "apieval-mcp"] } } }
```

And we built the server the way it tells other APIs to build — it had to pass its own rubric:

- **Reference-based / explicit handles.** `score_api` returns a *summary* plus a `readiness://<id>` handle,
  never a 189-endpoint dump. You dereference the full report only if you need it. That's the exact pattern
  the stateless MCP core now assumes — and here it's a context-window mechanism *and* a state handle at once.
- **Stateless.** Every request carries its own `specUrl`; the only state is a content-addressed report cache.
- **Bounded + filterable.** Summaries by default; `query`/`tag`/`limit` on every tool.
- **Capability discovery.** MCP `tools/list` *is* `server/discover`; rich descriptions and schemas per tool.
- **Sampling.** Layer-3 execution borrows the *host's* model via MCP sampling — the server reasons instead
  of being a passive endpoint, and needs no LLM of its own.

## The lesson we learned twice

There is one honest gap, and it's worth ending on because we hit it in **two different systems** building
toward this: the agent harness that spawned the tool, and the MCP server itself.

Both mint a perfect explicit handle — a `result_id`, a `readiness://` URI. And both back it with a
**process-local cache.** Which means the moment you run two instances behind a load balancer, instance B
can't resolve the handle instance A minted. The handle is right. The store is local.

This is precisely the *"design for statelessness from the start"* warning — and the takeaway is that it's
not a mistake you make from ignorance. **Everyone gets the handle right and the store wrong first**, because
the handle is the visible, obviously-correct design and the shared store is the invisible plumbing you defer.
The fix is mechanical (back it with Redis / S3 / content-addressed disk); noticing you need it is the part
that takes a framework — or a tool that grades you against one.

## Try it

```bash
npx -y api-ai-readiness apieval score https://your-api/openapi.json
```

The transition to AI-native APIs isn't a one-time migration; it's an ongoing evaluation discipline. The
point of turning the framework into a tool is to make that discipline a command you can run in CI, a score
you can watch move, and an MCP capability your agents already have — so "is this API ready for agents?"
stops being a matter of taste and starts being a number you can argue with.
