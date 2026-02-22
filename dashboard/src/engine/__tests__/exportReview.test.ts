import { buildCaseBundle } from "../caseBundle";
import {
  buildExportReviewOutput,
  createCaseBundleExportReviewPlan,
  createDiffExportReviewPlan,
  createRunExportReviewPlan,
} from "../exportReview";
import { buildRunHistoryShareSafeDiffFromExports } from "../runHistoryCompare";
import type { ShareSafeRunExport } from "../runShareSafeExport";

function buildRun(runId: string, status: "success" | "error" = "success"): ShareSafeRunExport {
  return {
    schemaVersion: "v1",
    runId,
    bundleId: `bundle-${runId}`,
    bundleKind: "sessions",
    source: "session",
    commandId: status === "success" ? "diagnose" : "dryRunTask",
    status,
    reasonCode: status === "success" ? "SUCCESS" : "EXEC_ERROR",
    timestamp: status === "success" ? "2026-02-22T04:30:00.000Z" : "2026-02-22T04:31:00.000Z",
    input: { text: "mode=ad-hoc\ncommandId=diagnose" },
    output: { text: status === "success" ? "note: ready" : "note: failed" },
    error: status === "success" ? null : { text: "task failed" },
    redacted: true,
  };
}

describe("exportReview", () => {
  it("derives run review and output from the same payload object", () => {
    const run = buildRun("run-001");
    const plan = createRunExportReviewPlan(run, "run-001.json");
    expect(plan.payload).toBe(run);
    expect(plan.excluded).toContain("private case notes");

    const output = buildExportReviewOutput(plan);
    expect(output).toContain(`"runId": "${run.runId}"`);
    expect(output).toContain(`"commandId": "${run.commandId}"`);
  });

  it("builds deterministic diff review and copy payload", () => {
    const base = buildRun("run-base", "success");
    const target = buildRun("run-target", "error");
    const diff = buildRunHistoryShareSafeDiffFromExports(base, target);
    const plan = createDiffExportReviewPlan(diff);

    expect(plan.counts.find((entry) => entry.label === "Total changes")?.value).toBe(diff.diff.summary.total);
    expect(plan.excluded).toContain("private case notes");

    const first = buildExportReviewOutput(plan);
    const second = buildExportReviewOutput(plan);
    expect(first).toBe(second);
    expect(first).toContain("schema=run-history-share-safe-diff.v1");
  });

  it("builds deterministic case-bundle review and excludes notes by default", () => {
    const bundle = buildCaseBundle({
      createdAt: "2026-02-22T04:40:00.000Z",
      guiBuildId: "phase26-test",
      runs: [buildRun("run-a"), buildRun("run-b", "error")],
      comparePairs: [{ baseRunId: "run-a", targetRunId: "run-b" }],
    });

    const plan = createCaseBundleExportReviewPlan(bundle, "bundle.json");
    expect(plan.excluded).toContain("private case notes");
    expect(plan.counts.find((entry) => entry.label === "Runs")?.value).toBe(2);
    expect(plan.counts.find((entry) => entry.label === "Compare artifacts")?.value).toBe(1);

    const notes = "Sensitive operator note should never leak";
    const output = buildExportReviewOutput(plan);
    expect(output).not.toContain(notes);
    expect(output).toContain(`"schemaVersion": "${bundle.schemaVersion}"`);
  });
});
