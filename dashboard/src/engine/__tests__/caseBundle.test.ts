import {
  buildCaseBundle,
  buildCaseBundleJson,
  CASE_BUNDLE_SCHEMA_VERSION,
  CASE_BUNDLE_SEARCH_FIELD_WHITELIST,
  filterCaseBundleRunListItems,
  MAX_CASE_BUNDLE_IMPORT_BYTES,
  parseCaseBundleJson,
  toCaseBundleRunListItems,
  type CaseBundle,
} from "../caseBundle";
import type { ShareSafeRunExport } from "../runShareSafeExport";

function buildRun(overrides: Partial<ShareSafeRunExport> = {}): ShareSafeRunExport {
  return {
    schemaVersion: "v1",
    runId: "run-a",
    bundleId: "bundle-a",
    bundleKind: "sessions",
    source: "session",
    commandId: "diagnose",
    status: "success",
    reasonCode: "SUCCESS",
    timestamp: "2026-02-22T03:00:00.000Z",
    input: {
      text: "mode=derived",
    },
    output: {
      text: "note: ready",
    },
    error: null,
    redacted: true,
    ...overrides,
  };
}

function buildBundle(overrides: Partial<CaseBundle> = {}): CaseBundle {
  return {
    schemaVersion: CASE_BUNDLE_SCHEMA_VERSION,
    createdAt: "2026-02-22T03:10:00.000Z",
    guiBuildId: "phase24",
    runs: [buildRun()],
    compares: [],
    ...overrides,
  };
}

describe("caseBundle", () => {
  it("exports only share-safe runs and deterministically serializes output", () => {
    const bundle = buildCaseBundle({
      createdAt: "2026-02-22T03:10:00.000Z",
      guiBuildId: "phase24",
      runs: [
        buildRun({
          runId: "run-2",
          timestamp: "2026-02-22T03:02:00.000Z",
          output: { text: "note: second" },
        }),
        buildRun({
          runId: "run-1",
          timestamp: "2026-02-22T03:03:00.000Z",
          output: { text: "note: first" },
        }),
      ],
      comparePairs: [{ baseRunId: "run-1", targetRunId: "run-2" }],
    });

    const first = buildCaseBundleJson(bundle);
    const second = buildCaseBundleJson(bundle);
    expect(first).toBe(second);
    expect(first).toContain("\"runs\"");
    expect(first).toContain("\"compares\"");
    expect(first).toContain("\"redacted\": true");
    expect(first).not.toContain("headers");
    expect(first).not.toContain("\"env\"");
  });

  it("rejects missing schema, unsupported schema, oversized payloads, and malformed runs", () => {
    const missingSchema = parseCaseBundleJson(JSON.stringify({ runs: [] }));
    expect(missingSchema.ok).toBe(false);

    const unsupported = parseCaseBundleJson(
      JSON.stringify({
        schemaVersion: "v999",
        runs: [],
      }),
    );
    expect(unsupported.ok).toBe(false);

    const oversize = parseCaseBundleJson("x".repeat(MAX_CASE_BUNDLE_IMPORT_BYTES + 1));
    expect(oversize.ok).toBe(false);

    const malformedRuns = parseCaseBundleJson(
      JSON.stringify({
        schemaVersion: "v1",
        createdAt: "2026-02-22T03:10:00.000Z",
        runs: [{ runId: "run-a" }],
      }),
    );
    expect(malformedRuns.ok).toBe(false);
  });

  it("rehydrates valid runs/compares and drops invalid compare references", () => {
    const runA = buildRun({
      runId: "run-a",
      bundleId: "bundle-a",
      timestamp: "2026-02-22T03:00:00.000Z",
      output: { text: "note: a" },
    });
    const runB = buildRun({
      runId: "run-b",
      bundleId: "bundle-b",
      timestamp: "2026-02-22T03:01:00.000Z",
      status: "error",
      reasonCode: "EXEC_ERROR",
      output: { text: "note: b" },
      error: { text: "reasonCode=EXEC_ERROR" },
    });

    const raw = JSON.stringify({
      schemaVersion: "v1",
      createdAt: "2026-02-22T03:10:00.000Z",
      guiBuildId: "phase24",
      runs: [runA, runB],
      compares: [
        {
          baseRunId: "run-a",
          targetRunId: "run-b",
          summary: { added: 1, removed: 0, changed: 1, total: 2 },
          entries: [{ path: "$.status", kind: "changed", left: "\"success\"", right: "\"error\"" }],
          truncated: false,
        },
        {
          baseRunId: "run-a",
          targetRunId: "missing-run",
          summary: { added: 0, removed: 0, changed: 0, total: 0 },
          entries: [],
          truncated: false,
        },
      ],
    });

    const parsed = parseCaseBundleJson(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("Expected parsed case bundle");
    }
    expect(parsed.bundle.runs.map((run) => run.runId)).toEqual(["run-b", "run-a"]);
    expect(parsed.bundle.compares).toHaveLength(1);
    expect(parsed.bundle.compares[0]?.baseRunId).toBe("run-a");
    expect(parsed.bundle.compares[0]?.targetRunId).toBe("run-b");
    expect(parsed.warnings.some((warning) => warning.includes("Dropped compare artifact"))).toBe(true);
  });

  it("filters/sorts case run list deterministically using share-safe fields", () => {
    const bundle = buildBundle({
      runs: [
        buildRun({
          runId: "run-a",
          timestamp: "2026-02-22T03:00:00.000Z",
          output: { text: "note: alpha ready" },
        }),
        buildRun({
          runId: "run-b",
          timestamp: "2026-02-22T03:01:00.000Z",
          status: "error",
          reasonCode: "EXEC_ERROR",
          output: { text: "note: beta failed" },
          error: { text: "error: beta" },
        }),
      ],
    });
    const items = toCaseBundleRunListItems(bundle);
    const filtered = filterCaseBundleRunListItems(items, {
      query: "beta",
      status: "error",
      order: "newest",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("run-b");
    expect(CASE_BUNDLE_SEARCH_FIELD_WHITELIST).toContain("run.output.text");
  });
});
