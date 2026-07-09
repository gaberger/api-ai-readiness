import { createHash } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Spec } from "./types.js";

const TTL_MS = 24 * 3600 * 1000;
const CACHE_DIR = join(tmpdir(), "api-ai-readiness-specs");

function cachePath(specUrl: string): string {
  mkdirSync(CACHE_DIR, { recursive: true });
  return join(CACHE_DIR, createHash("sha256").update(specUrl).digest("hex").slice(0, 24) + ".json");
}

/** Fetch + parse an OpenAPI/Swagger JSON spec, cached 24h per URL. Accepts a URL, or a local file path,
 *  or a raw JSON string — so the evaluator works offline and in tests. */
export async function loadSpec(source: string, refresh = false): Promise<Spec> {
  // Local file or inline JSON — no network, no cache.
  if (source.trim().startsWith("{")) return JSON.parse(source) as Spec;
  if (!/^https?:\/\//i.test(source) && existsSync(source)) return JSON.parse(readFileSync(source, "utf8")) as Spec;

  const p = cachePath(source);
  if (!refresh && existsSync(p) && Date.now() - statSync(p).mtimeMs < TTL_MS) {
    return JSON.parse(readFileSync(p, "utf8")) as Spec;
  }
  const res = await fetch(source);
  if (!res.ok) throw new Error(`fetch ${source}: HTTP ${res.status}`);
  const spec = (await res.json()) as Spec;
  try {
    writeFileSync(p, JSON.stringify(spec));
  } catch {
    /* best-effort cache */
  }
  return spec;
}

export const METHODS = ["get", "post", "put", "delete", "patch"] as const;

/** Iterate the (METHOD, operation) pairs of one path item. */
export function* ops(item: Record<string, unknown>): Generator<[string, Record<string, unknown>]> {
  for (const m of METHODS) {
    const op = item[m];
    if (op && typeof op === "object") yield [m.toUpperCase(), op as Record<string, unknown>];
  }
}

/** Shallow $ref resolver (`#/components/...`) — bounded depth, best-effort. */
export function deref(spec: Spec, node: unknown, depth = 0): Record<string, unknown> | undefined {
  if (!node || typeof node !== "object" || depth > 6) return node as Record<string, unknown> | undefined;
  const ref = (node as Record<string, unknown>)["$ref"];
  if (typeof ref === "string" && ref.startsWith("#/")) {
    let cur: unknown = spec;
    for (const seg of ref.slice(2).split("/")) cur = (cur as Record<string, unknown> | undefined)?.[decodeURIComponent(seg)];
    return deref(spec, cur, depth + 1);
  }
  return node as Record<string, unknown>;
}

export function paramsOf(spec: Spec, op: Record<string, unknown>): Record<string, unknown>[] {
  const raw = Array.isArray(op["parameters"]) ? (op["parameters"] as unknown[]) : [];
  return raw.map((p) => deref(spec, p)).filter((p): p is Record<string, unknown> => !!p);
}

/** Best-effort 2xx JSON response schema for an operation. */
export function successSchema(spec: Spec, op: Record<string, unknown>): Record<string, unknown> | undefined {
  const responses = (op["responses"] as Record<string, unknown>) ?? {};
  const key = Object.keys(responses).find((k) => k.startsWith("2")) ?? "default";
  const resp = deref(spec, responses[key]);
  const content = (resp?.["content"] as Record<string, unknown>) ?? {};
  const media = (content["application/json"] ?? content[Object.keys(content)[0] ?? ""]) as Record<string, unknown> | undefined;
  return deref(spec, media?.["schema"]);
}

export function pathsOf(spec: Spec): Record<string, Record<string, unknown>> {
  return (spec["paths"] as Record<string, Record<string, unknown>>) ?? {};
}
