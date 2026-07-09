import type { Spec, TestPrompt } from "./types.js";
import { loadSpec, ops, paramsOf, pathsOf, successSchema } from "./spec.js";
import { gradeOp } from "./scorecard.js";

/**
 * Layer 2 — generate a behavioral test suite: realistic natural-language prompts per endpoint.
 *
 * Template-based by default (no LLM): derives phrasing from the operation's summary + params, and varies
 * shape to probe the AI-readiness dimensions the scorecard flagged (an unbounded list endpoint gets a
 * "list all …" prompt precisely to see if it stalls in practice). An optional `enrich` hook lets a caller
 * rewrite/expand the prompts with an LLM for more natural phrasing — the core stays dependency-free.
 */
export interface GenerateOptions {
  /** Max prompts per endpoint (default 2). */
  readonly perEndpoint?: number;
  /** Only endpoints matching this keyword/tag (same filter shape as the scorecard). */
  readonly query?: string;
  readonly tag?: string;
  /** Optional LLM rewrite: given the templated prompts + endpoint context, return improved phrasings. */
  readonly enrich?: (draft: TestPrompt[], context: { method: string; path: string; summary: string }) => Promise<string[]>;
}

function nounFromPath(path: string): string {
  const seg = path.split("/").filter((s) => s && !s.startsWith("{")).pop() ?? "resource";
  return seg.replace(/[-_]/g, " ");
}

/** Draft 1–3 prompts for one operation, biased to probe its weakest dimension. */
function draftPrompts(spec: Spec, method: string, path: string, op: Record<string, unknown>, perEndpoint: number): TestPrompt[] {
  const ep = `${method} ${path}`;
  const noun = nounFromPath(path);
  const summary = String(op["summary"] ?? "").trim();
  const grade = gradeOp(spec, path, method, op);
  const params = paramsOf(spec, op);
  const filterable = params.filter((p) => p["in"] === "query" && p["name"]).map((p) => String(p["name"]));
  const out: TestPrompt[] = [];

  const push = (prompt: string, probes: string) => { if (out.length < perEndpoint) out.push({ endpoint: ep, prompt, probes }); };

  if (grade.isList) {
    // Unbounded probe — deliberately ask for "all" to see if it stalls / overflows in practice.
    push(`list all the ${noun}`, "response discipline / context window (does an unqualified list stall or overflow?)");
    // Scoped probe — a filter, to check server-side filtering actually works.
    if (filterable.length) push(`show the ${noun} filtered by ${filterable[0]}`, "retrieval shape (server-side filtering)");
    else push(`how many ${noun} are there`, "retrieval shape (can it aggregate, or must the agent count?)");
  } else if (method === "GET") {
    push(summary ? `${summary.toLowerCase()}` : `get the ${noun}`, "self-description (grounded single-resource answer)");
  } else {
    // Write op — probe preview/confirmation + error clarity, not mutation.
    push(`what would ${method.toLowerCase()} on ${noun} do — describe it, don't run it`, "self-description / safety (does it explain before acting?)");
  }
  // A malformed / underspecified probe — surfaces error-recovery quality (self-describing errors).
  push(`${summary || `use ${ep}`} — but I'm going to leave out a required detail`, "self-description (is the error actionable, or a dead-end?)");
  return out.slice(0, perEndpoint);
}

export async function generateFromSpec(spec: Spec, opts: GenerateOptions = {}): Promise<TestPrompt[]> {
  const perEndpoint = opts.perEndpoint && opts.perEndpoint > 0 ? opts.perEndpoint : 2;
  const terms = String(opts.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const tag = opts.tag?.toLowerCase() ?? "";
  const suite: TestPrompt[] = [];
  for (const [path, item] of Object.entries(pathsOf(spec))) {
    for (const [method, op] of ops(item)) {
      if (tag && !(((op["tags"] as string[]) ?? []).some((t) => t.toLowerCase() === tag))) continue;
      if (terms.length && !terms.every((t) => [path, op["summary"], op["description"]].join(" ").toLowerCase().includes(t))) continue;
      let drafts = draftPrompts(spec, method, path, op, perEndpoint);
      if (opts.enrich) {
        try {
          const improved = await opts.enrich(drafts, { method, path, summary: String(op["summary"] ?? "") });
          if (improved.length) drafts = improved.slice(0, perEndpoint).map((prompt, i) => ({ ...drafts[i]!, prompt }));
        } catch { /* enrichment is best-effort; fall back to templates */ }
      }
      suite.push(...drafts);
    }
  }
  return suite;
}

/** Load a spec and generate a test suite. */
export async function generateTestSuite(source: string, opts: GenerateOptions & { refresh?: boolean } = {}): Promise<TestPrompt[]> {
  const spec = await loadSpec(source, !!opts.refresh);
  return generateFromSpec(spec, opts);
}
