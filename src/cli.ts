#!/usr/bin/env node
import { writeFileSync } from "node:fs";

import { scoreSpec } from "./scorecard.js";
import { generateTestSuite } from "./prompts.js";
import { runSuite, mockRunner } from "./runner.js";
import { scorecardMarkdown, scorecardText, runSummaryMarkdown } from "./format.js";
import type { TestPrompt } from "./types.js";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  const out = flag(rest, "out");
  const query = flag(rest, "query");
  const tag = flag(rest, "tag");
  const source = rest.find((a) => !a.startsWith("--") && a !== query && a !== tag && a !== out);

  if (cmd === "score") {
    if (!source) return usage("score <spec-url|file|-> [--query k] [--tag t] [--format md|text] [--out file]");
    const card = await scoreSpec(source, { query, tag });
    const body = flag(rest, "format") === "md" ? scorecardMarkdown(card) : scorecardText(card);
    if (out) { writeFileSync(out, scorecardMarkdown(card)); console.log(`wrote ${out}`); } else console.log(body);
    return 0;
  }

  if (cmd === "gen") {
    if (!source) return usage("gen <spec-url|file|-> [--query k] [--tag t] [--per N] [--out suite.json]");
    const perEndpoint = Number(flag(rest, "per") ?? 2);
    const suite = await generateTestSuite(source, { query, tag, perEndpoint });
    if (out) { writeFileSync(out, JSON.stringify(suite, null, 2)); console.log(`wrote ${suite.length} prompts → ${out}`); }
    else console.log(JSON.stringify(suite, null, 2));
    return 0;
  }

  if (cmd === "run") {
    if (!source) return usage("run <suite.json> [--runner mock] [--out report.md]");
    const suite = JSON.parse((await import("node:fs")).readFileSync(source, "utf8")) as TestPrompt[];
    // Only the `mock` runner ships in-core; real runners (weave-fanout/openai/anthropic) are adapters.
    const runnerName = flag(rest, "runner") ?? "mock";
    if (runnerName !== "mock") { console.error(`runner '${runnerName}' not bundled — pass a Runner via the library API (see SPEC.md §runner contract)`); return 1; }
    const graded = await runSuite(suite, mockRunner());
    const report = runSummaryMarkdown(graded);
    if (out) { writeFileSync(out, report); console.log(`wrote ${out}`); } else console.log(report);
    return 0;
  }

  return usage("<score|gen|run> …");
}

function usage(line: string): number {
  console.error(`api-ai-readiness — grade an API for AI-native design\n\nusage: apieval ${line}`);
  return 2;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
