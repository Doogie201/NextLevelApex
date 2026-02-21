import { POST as runPost } from "../run/route";
import { runAllowlistedNlxCommand } from "@/engine/nlxService";

vi.mock("@/engine/nlxService", () => {
  class AllowlistError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "AllowlistError";
    }
  }

  return {
    AllowlistError,
    runAllowlistedNlxCommand: vi.fn(),
  };
});

describe("nlx run API route envelope", () => {
  const mockedRun = vi.mocked(runAllowlistedNlxCommand);
  const originalTimeoutEnv = process.env.NLX_GUI_ROUTE_TIMEOUT_MS;

  beforeEach(() => {
    mockedRun.mockReset();
    if (originalTimeoutEnv === undefined) {
      delete process.env.NLX_GUI_ROUTE_TIMEOUT_MS;
    } else {
      process.env.NLX_GUI_ROUTE_TIMEOUT_MS = originalTimeoutEnv;
    }
  });

  it("returns deterministic envelope for diagnose success", async () => {
    mockedRun.mockResolvedValue({
      ok: true,
      commandId: "diagnose",
      exitCode: 0,
      timedOut: false,
      errorType: "none",
      stdout:
        'DNS_MODE=local-private RESOLVER=192.168.64.2 PIHOLE=running PIHOLE_UPSTREAM=host.docker.internal#5053 CLOUDFLARED=ok PLAINTEXT_DNS=no NOTES="ok"',
      stderr: "",
      diagnose: {
        summary: {
          dnsMode: "local-private",
          resolver: "192.168.64.2",
          pihole: "running",
          piholeUpstream: "host.docker.internal#5053",
          cloudflared: "ok",
          plaintextDns: "no",
          notes: "ok",
        },
        badge: "OK",
      },
    });

    const request = new Request("http://localhost/api/nlx/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commandId: "diagnose" }),
    });

    const response = await runPost(request);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.badge).toBe("OK");
    expect(body.reasonCode).toBe("SUCCESS");
    expect(body.commandId).toBe("diagnose");
    expect(typeof body.startedAt).toBe("string");
    expect(typeof body.finishedAt).toBe("string");
    expect(typeof body.durationMs).toBe("number");
    expect(typeof body.stdout).toBe("string");
    expect(typeof body.stderr).toBe("string");
    expect(Array.isArray(body.events)).toBe(true);
    expect(typeof body.redacted).toBe("boolean");
  });

  it("returns deterministic envelope for dryRunAll success with taskResults", async () => {
    mockedRun.mockResolvedValue({
      ok: true,
      commandId: "dryRunAll",
      exitCode: 0,
      timedOut: false,
      errorType: "none",
      stdout: "[Task: DNS] [PASS]",
      stderr: "",
      taskResults: [
        {
          taskName: "DNS Stack Sanity Check",
          status: "PASS",
          reason: "[PASS]",
        },
      ],
    });

    const request = new Request("http://localhost/api/nlx/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commandId: "dryRunAll" }),
    });

    const response = await runPost(request);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.reasonCode).toBe("SUCCESS");
    expect(Array.isArray(body.taskResults)).toBe(true);
  });

  it("returns NOT_ALLOWED envelope for non-allowlisted command ids", async () => {
    const request = new Request("http://localhost/api/nlx/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commandId: "__not_allowed__" }),
    });

    const response = await runPost(request);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.badge).toBe("BROKEN");
    expect(body.reasonCode).toBe("NOT_ALLOWED");
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("returns VALIDATION envelope for malformed json", async () => {
    const request = new Request("http://localhost/api/nlx/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });

    const response = await runPost(request);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.reasonCode).toBe("VALIDATION");
    expect(body.badge).toBe("BROKEN");
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("returns SINGLE_FLIGHT envelope for concurrent runs and does not execute second command", async () => {
    let releaseFirstRun: ((value: Awaited<ReturnType<typeof runAllowlistedNlxCommand>>) => void) | null = null;
    mockedRun.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseFirstRun = resolve;
        }),
    );

    const firstRequest = new Request("http://localhost/api/nlx/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commandId: "dryRunAll" }),
    });
    const firstRunPromise = runPost(firstRequest);
    await Promise.resolve();

    const secondRequest = new Request("http://localhost/api/nlx/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commandId: "diagnose" }),
    });

    const secondResponse = await runPost(secondRequest);
    const secondBody = (await secondResponse.json()) as Record<string, unknown>;

    expect(secondResponse.status).toBe(200);
    expect(secondBody.ok).toBe(false);
    expect(secondBody.badge).toBe("DEGRADED");
    expect(secondBody.reasonCode).toBe("SINGLE_FLIGHT");
    expect(mockedRun).toHaveBeenCalledTimes(1);

    releaseFirstRun?.({
      ok: true,
      commandId: "dryRunAll",
      exitCode: 0,
      timedOut: false,
      errorType: "none",
      stdout: "",
      stderr: "",
      taskResults: [],
    });

    const firstResponse = await firstRunPromise;
    expect(firstResponse.status).toBe(200);
  });

  it("returns TIMEOUT envelope and DEGRADED badge when route wall clock timeout triggers", async () => {
    process.env.NLX_GUI_ROUTE_TIMEOUT_MS = "1000";
    mockedRun.mockImplementation(async (_commandId, _taskName, signal) => {
      await new Promise<void>((resolve) => {
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      return {
        ok: false,
        commandId: "dryRunAll",
        exitCode: 130,
        timedOut: false,
        errorType: "aborted",
        stdout: "",
        stderr: "aborted",
      };
    });

    const request = new Request("http://localhost/api/nlx/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commandId: "dryRunAll" }),
    });

    const response = await runPost(request);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.badge).toBe("DEGRADED");
    expect(body.reasonCode).toBe("TIMEOUT");
    expect(body.timedOut).toBe(true);
  });

  it("sets redacted=true and scrubs secret-like output strings", async () => {
    mockedRun.mockResolvedValue({
      ok: false,
      commandId: "dryRunAll",
      exitCode: 1,
      timedOut: false,
      errorType: "spawn_error",
      stdout: "WEBPASSWORD=supersecretvalue",
      stderr: "token=abcdefghijklmnopqrstuvwxyz1234567890",
    });

    const request = new Request("http://localhost/api/nlx/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commandId: "dryRunAll" }),
    });

    const response = await runPost(request);
    const body = (await response.json()) as { redacted: boolean; stdout: string; stderr: string };

    expect(response.status).toBe(200);
    expect(body.redacted).toBe(true);
    expect(body.stdout).not.toContain("supersecretvalue");
    expect(body.stderr).not.toContain("abcdefghijklmnopqrstuvwxyz1234567890");
  });
});
