/** A parsed OpenAPI/Swagger document (untyped — we read it structurally). */
export type Spec = Record<string, unknown>;

/** One graded operation. */
export interface EndpointGrade {
  readonly method: string;
  readonly path: string;
  readonly isList: boolean;
  readonly score: number; // raw points
  readonly max: number; // applicable max points
  readonly pct: number; // 0..100
  readonly gaps: readonly string[];
}

/** The full deterministic scorecard for a spec. */
export interface Scorecard {
  readonly title: string;
  readonly endpointsGraded: number;
  readonly discoveryEndpoint: boolean;
  readonly summary: {
    readonly listEndpoints: number;
    readonly avgScore: number | null;
    readonly avgListScore: number | null;
    readonly commonGaps: readonly string[];
  };
  readonly worst: readonly EndpointGrade[];
  readonly endpoints: readonly EndpointGrade[];
}

/** A generated behavioral test prompt targeting one endpoint (Layer 2). */
export interface TestPrompt {
  readonly endpoint: string; // "GET /widgets"
  readonly prompt: string; // natural-language user phrasing
  readonly probes: string; // what AI-readiness dimension this prompt is meant to exercise
}

/** What a runner returns for one prompt (Layer 3). */
export interface RunOutcome {
  readonly status: "completed" | "timeout" | "error";
  readonly text: string;
  readonly ms: number;
  readonly meta?: Record<string, unknown>;
}

/** Live execution backend — decouples the evaluator from any one agent runtime. */
export interface Runner {
  run(prompt: string, opts?: { timeoutMs?: number }): Promise<RunOutcome>;
}

/** A generated prompt plus its live grade. */
export interface GradedPrompt extends TestPrompt {
  readonly verdict: "PASS" | "SLOW" | "FAIL";
  readonly outcome: RunOutcome;
}
