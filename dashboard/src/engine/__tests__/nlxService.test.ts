import { runAllowlistedNlxCommand } from "../nlxService";
import { runCommandArgv } from "../runner";

vi.mock("../runner", () => ({
  runCommandArgv: vi.fn(),
}));

vi.mock("../nlxErrorSanitizer", () => ({
  sanitizeNlxError: vi.fn((_errorType: string, stderr: string) => ({
    message: stderr,
    fixCommand: "bash scripts/dev-setup.sh --repair-env",
    context: {
      cwd: "/tmp",
      gitTopLevel: null,
      isWorktree: false,
      interpreterPath: null,
      nlxAvailable: false,
    },
    originalSuppressed: false,
  })),
}));

describe("nlxService diagnose handling", () => {
  const mockedRunner = vi.mocked(runCommandArgv);

  beforeEach(() => {
    mockedRunner.mockReset();
  });

  it("coerces diagnose nonzero health output into a structured response", async () => {
    mockedRunner
      .mockResolvedValueOnce({
        argv: ["nlx", "diagnose"],
        stdout: "",
        stderr: "missing",
        exitCode: 127,
        timedOut: false,
        aborted: false,
        errorType: "missing_nlx",
      })
      .mockResolvedValueOnce({
        argv: ["poetry", "run", "nlx", "diagnose"],
        stdout:
          'DNS_MODE=local-private RESOLVER=192.168.64.2 PIHOLE=running PIHOLE_UPSTREAM=host.docker.internal#5053 CLOUDFLARED=down PLAINTEXT_DNS=no NOTES="cloudflared-down"',
        stderr: "",
        exitCode: 1,
        timedOut: false,
        aborted: false,
        errorType: "nonzero_exit",
      });

    const result = await runAllowlistedNlxCommand("diagnose");

    expect(result.ok).toBe(true);
    expect(result.errorType).toBe("none");
    expect(result.diagnose?.badge).toBe("DEGRADED");
    expect(mockedRunner).toHaveBeenCalledTimes(2);
  });

  it("keeps diagnose as failure when output cannot be parsed", async () => {
    mockedRunner
      .mockResolvedValueOnce({
        argv: ["nlx", "diagnose"],
        stdout: "not a diagnose line",
        stderr: "",
        exitCode: 1,
        timedOut: false,
        aborted: false,
        errorType: "nonzero_exit",
      })
      .mockResolvedValueOnce({
        argv: ["poetry", "run", "nlx", "diagnose"],
        stdout: "still not valid",
        stderr: "",
        exitCode: 1,
        timedOut: false,
        aborted: false,
        errorType: "nonzero_exit",
      });

    const result = await runAllowlistedNlxCommand("diagnose");

    expect(result.ok).toBe(false);
    expect(result.diagnose).toBeUndefined();
  });
});
