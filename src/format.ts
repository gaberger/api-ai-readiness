import type { GradedPrompt, Scorecard } from "./types.js";

/** Render a scorecard as Markdown (for a saved report or a PR comment). */
export function scorecardMarkdown(c: Scorecard): string {
  const s = c.summary;
  const L: string[] = [];
  L.push(`# AI-Readiness — ${c.title}`);
  L.push("");
  L.push(`**Overall: ${s.avgScore ?? "—"}%** · list endpoints: ${s.avgListScore ?? "—"}% (${s.listEndpoints}) · ${c.endpointsGraded} endpoints · capability discovery: ${c.discoveryEndpoint ? "yes" : "none"}`);
  L.push("");
  L.push("## Most common gaps");
  for (const g of s.commonGaps) L.push(`- ${g}`);
  L.push("");
  L.push("## Worst-scoring endpoints");
  L.push("");
  L.push("| Score | Endpoint | Gaps |");
  L.push("|------:|----------|------|");
  for (const e of c.worst) L.push(`| ${e.pct}% | \`${e.method} ${e.path}\` | ${e.gaps.map((g) => g.split(" — ")[0]).join("; ") || "—"} |`);
  return L.join("\n");
}

/** Compact terminal summary. */
export function scorecardText(c: Scorecard): string {
  const s = c.summary;
  const L: string[] = [];
  L.push(`${c.title} — AI-readiness: ${s.avgScore ?? "—"}%  (${c.endpointsGraded} endpoints)`);
  L.push(`list endpoints: ${s.avgListScore ?? "—"}%   ·   capability discovery: ${c.discoveryEndpoint ? "yes" : "none"}`);
  L.push("");
  L.push("Most common gaps:");
  for (const g of s.commonGaps.slice(0, 6)) L.push(`  ${g}`);
  return L.join("\n");
}

/** Roll a run's live verdicts into a one-line pass rate + a table. */
export function runSummaryMarkdown(graded: GradedPrompt[]): string {
  const n = graded.length;
  const pass = graded.filter((g) => g.verdict === "PASS").length;
  const slow = graded.filter((g) => g.verdict === "SLOW").length;
  const fail = graded.filter((g) => g.verdict === "FAIL").length;
  const L: string[] = [];
  L.push(`## Live behavior — ${pass}/${n} PASS · ${slow} SLOW · ${fail} FAIL`);
  L.push("");
  L.push("| Verdict | Endpoint | Prompt | Probes |");
  L.push("|---------|----------|--------|--------|");
  for (const g of graded) L.push(`| ${g.verdict} | \`${g.endpoint}\` | ${g.prompt} | ${g.probes} |`);
  return L.join("\n");
}
