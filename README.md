# api-ai-readiness

**Grade any API for AI-native design.** Point it at an OpenAPI/Swagger spec and get a scorecard of how
well the API serves an AI agent — plus a generated test-prompt suite you can run against the live system.

Built from the framework in *"Delivering APIs for AI"*: the shift from human-interface (HI) APIs — small,
paginated, browser-shaped — to agent-interface (AI) APIs — bounded, filterable, self-describing, and
stateless with explicit handles. The failure modes an AI agent hits are **observable**, so most of that
framework is a computable rubric, not an opinion.

```
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

## Why

Traditional APIs returned small digestible chunks for humans clicking through pages. Agents don't click —
they need complete, bounded, context-aware access. An API that dumps 15,000 rows or hides a required
parameter behind a spec that says "optional" doesn't *fail loudly*; it silently blows the model's context
window or dead-ends the agent. This tool makes those failures **visible and rankable** before an agent
ever hits them.

The rubric maps 1:1 to the article's design guidelines — see [`SPEC.md`](./SPEC.md) for the exact scoring.

## What it does (three layers, increasingly involved)

| Layer | Needs | What you get |
|---|---|---|
| **1. Scorecard** | just the spec | Deterministic AI-readiness grade — per endpoint + rolled up, with the specific gap and the pattern to adopt. **No LLM, no network to the API itself.** |
| **2. Test-suite generation** | the spec (+ optional LLM) | A per-endpoint suite of realistic natural-language prompts that *should* exercise each endpoint — the behavioral test plan. |
| **3. Live execution** | a **runner adapter** | Run the suite against the real system and grade **PASS / SLOW / FAIL** — catching the gaps a static spec can't show (oversized-in-practice, required-in-practice params). The runner is pluggable: weave-fanout, a raw OpenAI/Anthropic loop, or your own agent. |

Layer 1 is fully portable and dependency-free. Layers 2–3 are opt-in.

## The AI-readiness dimensions

Each maps to a section of *"Delivering APIs for AI"*:

| Dimension | Article principle | Checked from |
|---|---|---|
| **Response discipline** | Context window; intelligent defaults; reference-based patterns | spec (limit param? sane default? summary/reference shape?) + live (oversized in practice?) |
| **Retrieval shape** | Server-side filtering & aggregation | spec (filter/aggregation params) |
| **Field selection** | Context efficiency (selective fields) | spec (`fields`/`select`/`expand`) |
| **Self-description** | Error recovery; self-describing responses | spec (documented 4xx + response metadata) + live (actionable errors?) |
| **Workflow atomicity** | The multi-stage API problem; explicit state handles | spec (chained non-scope ids) + live (hidden required-in-practice params) |
| **Discovery** | Capability discovery (`server/discover`, Server Cards) | spec-level (is there a discovery endpoint?) |

## Quickstart

```bash
npm install
npm run build

# Layer 1 — deterministic scorecard (no LLM)
node dist/cli.js score <spec-url> --format md

# Layer 2 — generate a behavioral test suite
node dist/cli.js gen <spec-url> --out suite.json

# Layer 3 — run it (bring a runner)
node dist/cli.js run suite.json --runner <adapter>
```

Or as a library:

```ts
import { scoreSpec, generateTestSuite, runSuite } from "api-ai-readiness";

const card = await scoreSpec("https://api.example.com/openapi.json");   // Layer 1
const suite = await generateTestSuite("https://api.example.com/openapi.json"); // Layer 2
const results = await runSuite(suite, myRunner);                        // Layer 3
```

## Status

**Scaffold + working Layer-1 core.** This repo starts design-doc-first (`README.md` + `SPEC.md`) with the
deterministic scorecard implemented and the prompt-generator / runner interfaces defined. Roadmap:

- [x] Deterministic scorecard engine + CLI (`score`)
- [x] Rubric spec ([`SPEC.md`](./SPEC.md)) mapped to the article
- [ ] Template-based test-suite generation (`gen`) — LLM enrichment optional
- [ ] Runner adapter interface + reference adapters (weave-fanout, OpenAI, Anthropic)
- [ ] MCP-server wrapper (evaluate-a-spec as MCP tools) — dogfood the thesis
- [ ] Shared-cache / stateless-handle checks for MCP-server specs
- [ ] `server/discover` + Server Card conformance checks

## Provenance

The scorecard engine was first built inside [weave](https://github.com/gaberger/weave)'s `api-analyst`
plugin and extracted here as a standalone, domain-agnostic project. Weave remains one consumer (and one
runner adapter); the evaluator depends on nothing weave-specific.

## License

MIT — see [`LICENSE`](./LICENSE).
