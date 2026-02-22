import { buildBundleDiff } from "../bundleDiff";

describe("bundleDiff", () => {
  it("produces deterministic diffs independent of input ordering", () => {
    const leftA = {
      preset: { commandId: "diagnose", taskNames: [] },
      sessions: [{ id: "run-a", badge: "OK" }],
    };
    const rightA = {
      sessions: [{ badge: "DEGRADED", id: "run-a" }],
      preset: { taskNames: [], commandId: "diagnose" },
    };

    const leftB = {
      sessions: [{ id: "run-a", badge: "OK" }],
      preset: { taskNames: [], commandId: "diagnose" },
    };
    const rightB = {
      preset: { commandId: "diagnose", taskNames: [] },
      sessions: [{ id: "run-a", badge: "DEGRADED" }],
    };

    const first = buildBundleDiff(leftA, rightA);
    const second = buildBundleDiff(leftB, rightB);

    expect(first.entries).toEqual(second.entries);
    expect(first.summary).toEqual(second.summary);
  });

  it("truncates diff entry lists deterministically", () => {
    const left = {
      sessions: Array.from({ length: 40 }, (_, index) => ({ id: `run-${index}`, badge: "OK" })),
    };
    const right = {
      sessions: Array.from({ length: 40 }, (_, index) => ({ id: `run-${index}`, badge: "BROKEN" })),
    };

    const diff = buildBundleDiff(left, right, { maxEntries: 10, maxPreviewChars: 500 });

    expect(diff.entries).toHaveLength(10);
    expect(diff.truncated).toBe(true);
  });

  it("never emits unredacted-looking data in previews", () => {
    const left = {
      note: "WEBPASSWORD=unsafe",
      sessions: [{ id: "run-1", reason: "token=abcdefghijklmnopqrstuvwxyzabcdefgh" }],
    };
    const right = {
      note: "WEBPASSWORD=safe",
      sessions: [{ id: "run-1", reason: "token=abcdefghijklmnopqrstuvwxyzabcdefgh" }],
    };

    const diff = buildBundleDiff(left, right);

    expect(diff.leftPreview).not.toContain("WEBPASSWORD=unsafe");
    expect(diff.rightPreview).not.toContain("WEBPASSWORD=safe");
    expect(diff.leftPreview).toContain("WEBPASSWORD=[REDACTED]");
    expect(diff.leftPreview).not.toContain("abcdefghijklmnopqrstuvwxyzabcdefgh");
  });
});
