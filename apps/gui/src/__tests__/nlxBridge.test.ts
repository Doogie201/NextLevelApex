import { runCommand } from "../engine/nlxBridge";
import type { CommandRunner } from "../engine/nlxBridge";

describe("runCommand", () => {
  it("returns command failure for disallowed task args", async () => {
    const runner: CommandRunner = {
      async run() {
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    };

    const result = await runCommand("dryRunTask", { taskName: "Task; rm -rf /" }, runner);
    expect(result.exitCode).toBe(124);
    expect(result.stderr).toMatch(/unsupported characters/i);
  });
});
