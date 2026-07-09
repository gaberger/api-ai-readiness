import type { GradedPrompt, RunOutcome, Runner, TestPrompt } from "./types.js";

/** Default per-prompt wall clock — heavy API scans legitimately take 90–180s (SPEC.md). */
export const DEFAULT_TIMEOUT_MS = 300_000;

/** Map a runner's RunOutcome → the three-state live verdict (SPEC.md §Verdict model). A timeout is SLOW
 *  (heavy/unbounded), NOT a failure; only an explicit error is FAIL. */
export function verdictOf(o: RunOutcome): "PASS" | "SLOW" | "FAIL" {
  if (o.status === "timeout") return "SLOW";
  if (o.status === "error") return "FAIL";
  // completed → PASS unless the "answer" is actually a refusal / clarifying question / empty.
  const t = o.text.trim().toLowerCase();
  if (!t) return "FAIL";
  if (/^(i (can't|cannot|need|don't)|which |please (specify|provide|clarify)|could you (specify|provide))/.test(t)) return "FAIL";
  return "PASS";
}

/** Layer 3 — run a generated suite through a runner and fold each result into a live verdict. Runs
 *  sequentially by default; pass `concurrency` to fan out (a runner may already parallelize internally). */
export async function runSuite(
  suite: readonly TestPrompt[],
  runner: Runner,
  opts: { timeoutMs?: number; concurrency?: number } = {},
): Promise<GradedPrompt[]> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const concurrency = Math.max(1, opts.concurrency ?? 1);
  const results: GradedPrompt[] = new Array(suite.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= suite.length) return;
      const tp = suite[i]!;
      const outcome = await runner.run(tp.prompt, { timeoutMs }).catch(
        (e): RunOutcome => ({ status: "error", text: e instanceof Error ? e.message : String(e), ms: 0 }),
      );
      results[i] = { ...tp, verdict: verdictOf(outcome), outcome };
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, suite.length) }, () => worker()));
  return results;
}

/**
 * A deterministic mock runner for tests + demos — no LLM, no network. Marks list-"all" prompts SLOW (the
 * unbounded-response failure mode) and everything else PASS, so the pipeline can be exercised end-to-end.
 */
export function mockRunner(): Runner {
  return {
    run: async (prompt) => {
      const p = prompt.toLowerCase();
      if (/\blist all\b/.test(p)) return { status: "timeout", text: "", ms: 300_000 };
      if (/leave out a required detail/.test(p)) return { status: "error", text: "400: missing required parameter", ms: 120 };
      return { status: "completed", text: "ok: grounded answer", ms: 800 };
    },
  };
}
