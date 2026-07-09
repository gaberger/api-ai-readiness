import type { Spec } from "./types.js";
import { deref, loadSpec, ops, paramsOf, pathsOf, successSchema } from "./spec.js";

export interface EndpointSummary {
  readonly method: string;
  readonly path: string;
  readonly summary: string;
  readonly tags: readonly string[];
}

export interface EndpointDetail extends EndpointSummary {
  readonly description: string;
  readonly parameters: ReadonlyArray<{ name: unknown; in: unknown; required: boolean; type: unknown; desc: string }>;
  readonly requestBody: { required: boolean; contentType: string | undefined } | null;
  readonly responses: readonly string[];
  readonly returnsList: boolean;
}

function matches(path: string, op: Record<string, unknown>, terms: string[], tag: string): boolean {
  if (tag && !(((op["tags"] as string[]) ?? []).some((t) => t.toLowerCase() === tag))) return false;
  if (!terms.length) return true;
  const hay = [path, op["summary"], op["description"], ...(((op["tags"] as string[]) ?? []))].join(" ").toLowerCase();
  return terms.every((t) => hay.includes(t));
}

/** Search a loaded spec by keyword/tag → endpoint summaries. */
export function searchLoaded(spec: Spec, opts: { query?: string; tag?: string; limit?: number } = {}): EndpointSummary[] {
  const terms = String(opts.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const tag = opts.tag?.toLowerCase() ?? "";
  const limit = opts.limit && opts.limit > 0 ? opts.limit : 40;
  const out: EndpointSummary[] = [];
  for (const [path, item] of Object.entries(pathsOf(spec))) {
    for (const [method, op] of ops(item)) {
      if (!matches(path, op, terms, tag)) continue;
      out.push({ method, path, summary: String(op["summary"] ?? op["operationId"] ?? ""), tags: (op["tags"] as string[]) ?? [] });
    }
  }
  return out.slice(0, limit);
}

/** Full detail (params + request body) for one exact path. */
export function detailLoaded(spec: Spec, path: string): EndpointDetail[] {
  const item = pathsOf(spec)[path];
  if (!item) return [];
  return [...ops(item)].map(([method, op]) => {
    const params = paramsOf(spec, op).map((p) => ({
      name: p["name"], in: p["in"], required: !!p["required"],
      type: (deref(spec, p["schema"]) ?? {})["type"], desc: String(p["description"] ?? "").slice(0, 140),
    }));
    const rb = deref(spec, op["requestBody"]);
    const schema = successSchema(spec, op) ?? {};
    return {
      method, path, summary: String(op["summary"] ?? ""), description: String(op["description"] ?? "").slice(0, 500),
      tags: (op["tags"] as string[]) ?? [], parameters: params,
      requestBody: rb ? { required: !!rb["required"], contentType: Object.keys((rb["content"] as object) ?? {})[0] } : null,
      responses: Object.keys((op["responses"] as object) ?? {}),
      returnsList: method === "GET" && (schema["type"] === "array" || (schema["type"] === "object" && Object.values((schema["properties"] as object) ?? {}).some((v) => deref(spec, v)?.["type"] === "array"))),
    };
  });
}

export async function searchSpec(source: string, opts: { query?: string; tag?: string; path?: string; limit?: number; refresh?: boolean } = {}): Promise<EndpointSummary[] | EndpointDetail[]> {
  const spec = await loadSpec(source, !!opts.refresh);
  return opts.path ? detailLoaded(spec, opts.path) : searchLoaded(spec, opts);
}
