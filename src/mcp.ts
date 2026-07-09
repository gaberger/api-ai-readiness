#!/usr/bin/env node
// MCP server for api-ai-readiness. Exposes the evaluator as MCP tools + resources + prompts, and uses
// SAMPLING (the host's model) for live Layer-3 execution — so the server needs no LLM of its own.
//
// The server is built the way it grades: STATELESS (each request carries its own specUrl; the only state
// is a content-addressed report cache), and REFERENCE-BASED (a large scorecard is returned as a
// readiness:// handle + a summary, never dumped into the host's context window).
import { createHash } from "node:crypto";

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { scoreSpec } from "./scorecard.js";
import { generateTestSuite } from "./prompts.js";
import { searchSpec } from "./search.js";
import { scorecardMarkdown } from "./format.js";
import { verdictOf } from "./runner.js";
import type { Scorecard } from "./types.js";

/** Reference-based pattern: full scorecards live behind readiness:// handles (content-addressed), not
 *  inlined into context. Bounded LRU so the server holds no unbounded state. */
const REPORTS = new Map<string, { card: Scorecard; md: string }>();
function stash(md: string, card: Scorecard, key: string): string {
  const id = createHash("sha256").update(key).digest("hex").slice(0, 16);
  REPORTS.set(id, { card, md });
  while (REPORTS.size > 64) REPORTS.delete(REPORTS.keys().next().value as string);
  return id;
}

const server = new McpServer({ name: "api-ai-readiness", version: "0.1.0" });

// ── Tool: score_api ─────────────────────────────────────────────────────────────────────────────────
server.registerTool(
  "score_api",
  {
    title: "Score API AI-readiness",
    description:
      "Grade an OpenAPI/Swagger spec for AI-NATIVE design (context-window discipline, filtering, " +
      "self-describing errors, multi-stage workflows, discovery). Returns a SUMMARY + a readiness:// " +
      "resource handle — read that resource for the full per-endpoint detail (reference-based; keeps the " +
      "big scorecard out of your context). specUrl accepts a URL, a local file path, or inline JSON.",
    inputSchema: {
      specUrl: z.string().describe("URL / file path / inline JSON of the OpenAPI spec"),
      query: z.string().optional().describe("only endpoints matching this keyword"),
      tag: z.string().optional().describe("only endpoints with this tag"),
    },
  },
  async ({ specUrl, query, tag }) => {
    const card = await scoreSpec(specUrl, { query, tag });
    const id = stash(scorecardMarkdown(card), card, `${specUrl}|${query ?? ""}|${tag ?? ""}`);
    const s = card.summary;
    const summary = {
      title: card.title, overallScore: s.avgScore, listEndpointScore: s.avgListScore,
      endpoints: card.endpointsGraded, capabilityDiscovery: card.discoveryEndpoint,
      topGaps: s.commonGaps.slice(0, 6), report: `readiness://${id}`,
    };
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }], structuredContent: summary };
  },
);

// ── Tool: search_spec ───────────────────────────────────────────────────────────────────────────────
server.registerTool(
  "search_spec",
  {
    title: "Search an API spec",
    description:
      "Discover real endpoint shapes in an OpenAPI/Swagger spec: search by keyword/tag for matching " +
      "endpoints, or pass an exact `path` for its full detail (parameters + request body). Use before " +
      "assuming an endpoint's shape.",
    inputSchema: {
      specUrl: z.string(),
      query: z.string().optional(),
      tag: z.string().optional(),
      path: z.string().optional().describe("exact path for full detail (params + body)"),
      limit: z.number().optional(),
    },
  },
  async ({ specUrl, query, tag, path, limit }) => {
    const res = await searchSpec(specUrl, { query, tag, path, limit });
    return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }], structuredContent: { endpoints: res } };
  },
);

// ── Tool: generate_test_suite ───────────────────────────────────────────────────────────────────────
server.registerTool(
  "generate_test_suite",
  {
    title: "Generate a behavioral test suite",
    description:
      "Generate realistic natural-language prompts per endpoint — the behavioral test plan that probes " +
      "each endpoint's AI-readiness (e.g. a 'list all …' prompt to see if a list endpoint overflows in " +
      "practice). Run them with `run_test_suite`, or execute them yourself.",
    inputSchema: { specUrl: z.string(), query: z.string().optional(), tag: z.string().optional(), perEndpoint: z.number().optional() },
  },
  async ({ specUrl, query, tag, perEndpoint }) => {
    const suite = await generateTestSuite(specUrl, { query, tag, perEndpoint });
    return { content: [{ type: "text", text: JSON.stringify(suite, null, 2) }], structuredContent: { count: suite.length, suite } };
  },
);

// ── Tool: run_test_suite (Layer 3 — via SAMPLING) ─────────────────────────────────────────────────────
server.registerTool(
  "run_test_suite",
  {
    title: "Run the test suite live (via sampling)",
    description:
      "Generate the suite and attempt each prompt using the HOST's model (MCP sampling), grading " +
      "PASS/SLOW/FAIL. Best when the host also has the TARGET API's tools loaded, so prompts run against " +
      "the real system. If the host doesn't support sampling, returns the suite for you to run yourself.",
    inputSchema: { specUrl: z.string(), query: z.string().optional(), tag: z.string().optional(), max: z.number().optional() },
  },
  async ({ specUrl, query, tag, max }) => {
    const suite = (await generateTestSuite(specUrl, { query, tag })).slice(0, max ?? 8);
    const graded: Array<Record<string, unknown>> = [];
    for (const tp of suite) {
      try {
        const r = await server.server.createMessage({
          messages: [{ role: "user", content: { type: "text", text: tp.prompt } }],
          maxTokens: 512,
        });
        const text = r.content?.type === "text" ? r.content.text : "";
        graded.push({ endpoint: tp.endpoint, prompt: tp.prompt, verdict: verdictOf({ status: "completed", text, ms: 0 }), answer: text.slice(0, 200) });
      } catch {
        // Host lacks sampling → hand back the suite so the host can run it directly.
        return {
          content: [{ type: "text", text: "This host does not support MCP sampling. Run these prompts yourself (ideally with the target API's tools loaded):\n" + JSON.stringify(suite, null, 2) }],
          structuredContent: { sampling: false, suite },
        };
      }
    }
    const pass = graded.filter((g) => g["verdict"] === "PASS").length;
    return { content: [{ type: "text", text: JSON.stringify({ passRate: `${pass}/${graded.length}`, graded }, null, 2) }], structuredContent: { sampling: true, graded } };
  },
);

// ── Resource: the full scorecard behind a readiness:// handle ─────────────────────────────────────────
server.registerResource(
  "readiness-report",
  new ResourceTemplate("readiness://{id}", {
    list: async () => ({
      resources: [...REPORTS.entries()].map(([id, r]) => ({ uri: `readiness://${id}`, name: `${r.card.title} — AI-readiness scorecard`, mimeType: "text/markdown" })),
    }),
  }),
  { title: "AI-readiness report", description: "Full per-endpoint scorecard for a scored spec (dereference the handle from score_api)." },
  async (uri, { id }) => {
    const r = REPORTS.get(String(id));
    return { contents: r ? [{ uri: uri.href, mimeType: "text/markdown", text: r.md }] : [] };
  },
);

// ── Prompt: audit an API ──────────────────────────────────────────────────────────────────────────────
server.registerPrompt(
  "audit-api-for-ai-readiness",
  {
    title: "Audit an API for AI-readiness",
    description: "Score a spec, read its report, and summarize the top gaps + the patterns to fix them.",
    argsSchema: { specUrl: z.string().describe("the OpenAPI spec URL / path") },
  },
  ({ specUrl }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Audit the API at ${specUrl} for AI-native readiness ("Delivering APIs for AI"):\n` +
            `1. Call score_api with specUrl="${specUrl}".\n` +
            `2. Read the returned readiness:// resource for the per-endpoint detail.\n` +
            `3. Summarize the overall + list-endpoint scores, the top 3 gaps, and for each the concrete pattern to adopt (limit+default, reference handle, server-side filter, documented errors, consolidated multi-stage). Lead with the single highest-impact fix.`,
        },
      },
    ],
  }),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("api-ai-readiness MCP server ready (stdio) — tools: score_api, search_spec, generate_test_suite, run_test_suite");
}
main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
