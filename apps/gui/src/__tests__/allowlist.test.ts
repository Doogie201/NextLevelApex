import { buildAllowlistedArgv } from "../engine/allowlist";

describe("buildAllowlistedArgv", () => {
  it("allows diagnose without arguments", () => {
    expect(buildAllowlistedArgv("diagnose", {})).toEqual(["nlx", "diagnose"]);
  });

  it("rejects invalid dry-run task names", () => {
    expect(() => buildAllowlistedArgv("dryRunTask", { taskName: "" })).toThrow(/required/i);
    expect(() => buildAllowlistedArgv("dryRunTask", { taskName: "-bad" })).toThrow(/invalid/i);
    expect(() =>
      buildAllowlistedArgv("dryRunTask", { taskName: "Task; rm -rf /" }),
    ).toThrow(/unsupported/i);
  });

  it("builds dry-run task argv for a valid task", () => {
    expect(buildAllowlistedArgv("dryRunTask", { taskName: "DNS Stack Sanity Check" })).toEqual([
      "nlx",
      "--dry-run",
      "--no-reports",
      "--task",
      "DNS Stack Sanity Check",
    ]);
  });
});
