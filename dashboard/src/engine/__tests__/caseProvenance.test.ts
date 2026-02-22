import { buildCaseBundle } from "../caseBundle";
import { buildCaseProvenanceModel } from "../caseProvenance";
import type { ShareSafeRunExport } from "../runShareSafeExport";

function buildRun(runId: string): ShareSafeRunExport {
  return {
    schemaVersion: "v1",
    runId,
    bundleId: `bundle-${runId}`,
    bundleKind: "sessions",
    source: "session",
    commandId: "diagnose",
    status: "success",
    reasonCode: "SUCCESS",
    timestamp: "2026-02-22T04:20:00.000Z",
    input: { text: "mode=ad-hoc\ncommandId=diagnose" },
    output: { text: "note: ok" },
    error: null,
    redacted: true,
  };
}

describe("caseProvenance", () => {
  it("builds deterministic provenance copy text and excludes notes", () => {
    const bundle = buildCaseBundle({
      createdAt: "2026-02-22T04:21:00.000Z",
      guiBuildId: "phase26-test",
      runs: [buildRun("run-001"), buildRun("run-002")],
    });

    const first = buildCaseProvenanceModel({
      bundle,
      caseLabel: "Core DNS Incident",
      fingerprint: "fingerprint-fnv1a32-cafebabe",
      source: "library-import",
      importedAt: "2026-02-22T04:22:00.000Z",
      savedAt: "2026-02-22T04:23:00.000Z",
      includeLibraryVersion: true,
    });

    const second = buildCaseProvenanceModel({
      bundle,
      caseLabel: "Core DNS Incident",
      fingerprint: "fingerprint-fnv1a32-cafebabe",
      source: "library-import",
      importedAt: "2026-02-22T04:22:00.000Z",
      savedAt: "2026-02-22T04:23:00.000Z",
      includeLibraryVersion: true,
    });

    expect(first.copyText).toBe(second.copyText);
    expect(first.copyText).toContain("schema=case-provenance.v1");
    expect(first.copyText).toContain("caseLabel=Core DNS Incident");
    expect(first.copyText).toContain("runCount=2");
    expect(first.copyText).not.toContain("Sensitive operator note");
  });

  it("normalizes invalid timestamps safely", () => {
    const bundle = buildCaseBundle({
      createdAt: "invalid",
      runs: [buildRun("run-003")],
    });
    const model = buildCaseProvenanceModel({
      bundle,
      caseLabel: " ",
      fingerprint: "FINGERPRINT-FNV1A32-ABC12345",
      source: "unknown",
      importedAt: "invalid",
      includeLibraryVersion: false,
    });

    expect(model.caseLabel).toBe("Unsaved case");
    expect(model.fingerprint).toBe("fingerprint-fnv1a32-abc12345");
    expect(model.createdAt).toBe("1970-01-01T00:00:00.000Z");
    expect(model.importedAt).toBeNull();
    expect(model.librarySchemaVersion).toBeNull();
  });
});
