import {
  AllowlistError,
  buildCommandSpec,
  ensureTaskIsDiscovered,
  parseTaskNamesFromListTasks,
  validateTaskNameFormat,
} from "../allowlist";

describe("allowlist", () => {
  it("builds allowlisted command specs", () => {
    expect(buildCommandSpec("diagnose").argv).toEqual(["nlx", "diagnose"]);
    expect(buildCommandSpec("listTasks").argv).toEqual(["nlx", "list-tasks"]);
    expect(buildCommandSpec("dryRunAll").argv).toEqual(["nlx", "--dry-run", "--no-reports"]);
  });

  it("rejects disallowed command ids", () => {
    expect(() => buildCommandSpec("autofix")).toThrow(AllowlistError);
  });

  it("validates task name format", () => {
    expect(validateTaskNameFormat("DNS Stack Sanity Check")).toBe("DNS Stack Sanity Check");
    expect(() => validateTaskNameFormat("-bad")).toThrow(AllowlistError);
    expect(() => validateTaskNameFormat("Task; rm -rf /")).toThrow(AllowlistError);
  });

  it("parses and enforces discovered task names", () => {
    const output = [
      "Task                   | Status   | Last Update         ",
      "--------------------------------------------------------",
      "DNS Stack Sanity Check | PASS     | 2026-02-21T00:00:00",
      "Cloudflared DoH        | FAIL     | 2026-02-21T00:00:00",
    ].join("\n");

    const names = parseTaskNamesFromListTasks(output);
    expect(names).toEqual(["DNS Stack Sanity Check", "Cloudflared DoH"]);
    expect(() => ensureTaskIsDiscovered("DNS Stack Sanity Check", names)).not.toThrow();
    expect(() => ensureTaskIsDiscovered("Mise Globals", names)).toThrow(AllowlistError);
  });
});
