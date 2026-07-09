import type { EndpointGrade, Scorecard, Spec } from "./types.js";
import { deref, loadSpec, ops, paramsOf, pathsOf, successSchema } from "./spec.js";

// Dimension recognizers — see SPEC.md.
const LIMIT_RE = /^(limit|per[_-]?page|page[_-]?size|max[_-]?results|max[_-]?rows|top|count|size|first)$/i;
const PAGE_RE = /^(offset|page|cursor|skip|start|after|next[_-]?token|page[_-]?token|continuation)$/i;
const FIELD_RE = /^(fields|select|expand|include|columns|projection|view|properties|with)$/i;
const SCOPE_ID_RE = /network|snapshot|org/i;

/** Grade one operation on the spec-derivable AI-readiness dimensions (SPEC.md §Dimensions). */
export function gradeOp(spec: Spec, path: string, method: string, op: Record<string, unknown>): EndpointGrade {
  const params = paramsOf(spec, op);
  const qNames = params.filter((p) => p["in"] === "query").map((p) => String(p["name"] ?? ""));
  const schema = successSchema(spec, op) ?? {};
  const props = (schema["properties"] as Record<string, unknown>) ?? {};
  const topArray = schema["type"] === "array";
  const objWithArray = schema["type"] === "object" && Object.values(props).some((v) => deref(spec, v)?.["type"] === "array");
  const isList = method === "GET" && (topArray || objWithArray);
  const gaps: string[] = [];
  let score = 0;
  let max = 0;

  // 1. Response discipline (context window) — list GETs only.
  if (isList) {
    max += 3;
    const limitP = params.find((p) => LIMIT_RE.test(String(p["name"] ?? "")));
    if (limitP) {
      score += 1;
      const sch = deref(spec, limitP["schema"]) ?? {};
      if (sch["default"] != null || limitP["default"] != null) score += 1;
      else gaps.push("has a limit param but NO default — set a sane default (e.g. 100) so an unqualified call is bounded");
    } else {
      gaps.push("list endpoint has NO limit/page-size param — unbounded response blows the context window");
    }
    const paged = params.some((p) => PAGE_RE.test(String(p["name"] ?? "")));
    const hasMeta = Object.keys(props).some((k) => /count|total|meta|links|pagination|summary|next/i.test(k));
    if (paged || hasMeta) score += 1;
    else if (topArray) gaps.push("returns a bare top-level array — no count/summary/reference; adopt the summary + reference-handle pattern (preview + result_id)");
  }

  // 2. Field selection (context efficiency).
  max += 1;
  if (qNames.some((n) => FIELD_RE.test(n))) score += 1;
  else if (isList) gaps.push("no field-selection param (fields/select) — the agent must pull every column");

  // 3. Retrieval shape (server-side filtering).
  max += 1;
  const filterable = qNames.filter((n) => !LIMIT_RE.test(n) && !PAGE_RE.test(n) && !FIELD_RE.test(n));
  if (filterable.length > 0) score += 1;
  else if (isList) gaps.push("no server-side filter params — the agent must over-fetch, then filter in-context");

  // 4. Self-description (error recovery).
  max += 1;
  if (Object.keys((op["responses"] as Record<string, unknown>) ?? {}).some((k) => /^4\d\d$/.test(k))) score += 1;
  else gaps.push("no documented 4xx error response — the agent can't recover from a bad call (self-describing errors)");

  // 5. Workflow atomicity (multi-stage). Scope ids are resolvable; only 2+ non-scope ids is a real chain.
  max += 1;
  const ids = (path.match(/\{([^}]+)\}/g) ?? []).map((s) => s.slice(1, -1));
  const nonScope = ids.filter((id) => !SCOPE_ID_RE.test(id));
  if (nonScope.length <= 1) score += 1;
  else gaps.push(`chains ${nonScope.length} resource ids (${nonScope.join(", ")}) — multi-stage: each must come from a prior call; consider a query-by-attribute or consolidated variant`);

  return { method, path, isList, score, max, pct: Math.round((100 * score) / Math.max(1, max)), gaps };
}

export interface ScoreFilter {
  query?: string;
  tag?: string;
  path?: string;
  limit?: number;
}

/** Grade an already-loaded spec. */
export function scoreLoaded(spec: Spec, filter: ScoreFilter = {}): Scorecard {
  const paths = pathsOf(spec);
  const terms = String(filter.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const tag = filter.tag?.toLowerCase() ?? "";
  const limit = filter.limit && filter.limit > 0 ? filter.limit : 200;

  const graded: EndpointGrade[] = [];
  for (const [p, item] of Object.entries(paths)) {
    if (filter.path && p !== filter.path) continue;
    for (const [m, op] of ops(item)) {
      if (tag && !(((op["tags"] as string[]) ?? []).some((t) => t.toLowerCase() === tag))) continue;
      if (terms.length && !terms.every((t) => [p, op["summary"], op["description"], ...(((op["tags"] as string[]) ?? []))].join(" ").toLowerCase().includes(t))) continue;
      graded.push(gradeOp(spec, p, m, op));
    }
  }
  graded.sort((a, b) => a.pct - b.pct);

  const lists = graded.filter((g) => g.isList);
  const discovery = Object.keys(paths).some((p) => /openapi|swagger|\/schema|catalog|capabilit|discovery|\/spec\b/i.test(p));
  const gapCounts: Record<string, number> = {};
  for (const g of graded) for (const gap of g.gaps) { const key = gap.split(" — ")[0] ?? gap.slice(0, 40); gapCounts[key] = (gapCounts[key] ?? 0) + 1; }
  const commonGaps = Object.entries(gapCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([g, n]) => `${n}× ${g}`);

  return {
    title: String((spec["info"] as Record<string, unknown>)?.["title"] ?? "(untitled API)"),
    endpointsGraded: graded.length,
    discoveryEndpoint: discovery,
    summary: {
      listEndpoints: lists.length,
      avgScore: graded.length ? Math.round(graded.reduce((s, g) => s + g.pct, 0) / graded.length) : null,
      avgListScore: lists.length ? Math.round(lists.reduce((s, g) => s + g.pct, 0) / lists.length) : null,
      commonGaps,
    },
    worst: graded.slice(0, 12),
    endpoints: graded.slice(0, limit),
  };
}

/** Load + grade a spec from a URL / file path / inline JSON. */
export async function scoreSpec(source: string, filter: ScoreFilter & { refresh?: boolean } = {}): Promise<Scorecard> {
  const spec = await loadSpec(source, !!filter.refresh);
  return scoreLoaded(spec, filter);
}
