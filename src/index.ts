// api-ai-readiness — grade any API for AI-native design ("Delivering APIs for AI").
//
// Layer 1 (portable, no LLM): scoreSpec — the deterministic AI-readiness scorecard.
// Layer 2 (spec + optional LLM): generateTestSuite — per-endpoint behavioral prompts.
// Layer 3 (pluggable runner): runSuite — execute the suite live, grade PASS/SLOW/FAIL.

export type {
  Spec,
  EndpointGrade,
  Scorecard,
  TestPrompt,
  RunOutcome,
  Runner,
  GradedPrompt,
} from "./types.js";

export { loadSpec } from "./spec.js";
export { scoreSpec, scoreLoaded, gradeOp, type ScoreFilter } from "./scorecard.js";
export { searchSpec, searchLoaded, detailLoaded, type EndpointSummary, type EndpointDetail } from "./search.js";
export { generateTestSuite, generateFromSpec, type GenerateOptions } from "./prompts.js";
export { runSuite, verdictOf, mockRunner, DEFAULT_TIMEOUT_MS } from "./runner.js";
export { scorecardMarkdown, scorecardText, runSummaryMarkdown } from "./format.js";
