import { test } from "node:test";
import assert from "node:assert/strict";

import { scoreLoaded } from "../src/scorecard.js";
import { generateFromSpec } from "../src/prompts.js";
import { runSuite, mockRunner, verdictOf } from "../src/runner.js";

// A tiny spec with one BAD list endpoint (unbounded, no filter, no 4xx) and one GOOD one.
const SPEC = {
  info: { title: "Test API" },
  paths: {
    "/widgets": {
      get: {
        summary: "List widgets",
        // no limit, no filter, no 4xx, bare array → should score low
        responses: { "200": { content: { "application/json": { schema: { type: "array" } } } } },
      },
    },
    "/gadgets": {
      get: {
        summary: "List gadgets",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", default: 100 } },
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "fields", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": { content: { "application/json": { schema: { type: "object", properties: { total: { type: "integer" }, items: { type: "array" } } } } } },
          "400": { description: "bad request" },
        },
      },
    },
    "/gadgets/{gadgetId}": {
      delete: { summary: "Delete a gadget", responses: { "204": {} } },
    },
  },
};

test("scorecard grades a well-designed list endpoint above a bad one", () => {
  const card = scoreLoaded(SPEC);
  const byPath = Object.fromEntries(card.endpoints.map((e) => [`${e.method} ${e.path}`, e]));
  assert.ok(byPath["GET /gadgets"]!.pct > byPath["GET /widgets"]!.pct, "gadgets (bounded+filter+4xx) beats widgets");
  assert.ok(byPath["GET /gadgets"]!.pct >= 80, "a fully AI-native list endpoint scores high");
  assert.ok(byPath["GET /widgets"]!.gaps.some((g) => /NO limit/.test(g)), "flags the unbounded response");
});

test("normal REST resource-addressing is NOT penalized as multi-stage", () => {
  const card = scoreLoaded(SPEC);
  const del = card.endpoints.find((e) => e.method === "DELETE")!;
  assert.ok(!del.gaps.some((g) => /multi-stage/.test(g)), "DELETE /gadgets/{gadgetId} is normal REST");
});

test("verdict model is three-state (timeout=SLOW, error=FAIL)", () => {
  assert.equal(verdictOf({ status: "timeout", text: "", ms: 1 }), "SLOW");
  assert.equal(verdictOf({ status: "error", text: "boom", ms: 1 }), "FAIL");
  assert.equal(verdictOf({ status: "completed", text: "42 widgets", ms: 1 }), "PASS");
  assert.equal(verdictOf({ status: "completed", text: "which network did you mean?", ms: 1 }), "FAIL");
});

test("generate + run pipeline produces graded prompts", async () => {
  const suite = await generateFromSpec(SPEC, { perEndpoint: 2 });
  assert.ok(suite.length > 0, "generated prompts");
  const graded = await runSuite(suite, mockRunner());
  assert.equal(graded.length, suite.length);
  assert.ok(graded.some((g) => g.verdict === "SLOW"), "the unbounded 'list all' probe is graded SLOW by the mock");
});
