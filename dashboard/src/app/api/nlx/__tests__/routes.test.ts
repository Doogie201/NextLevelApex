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

describe("nlx run API route", () => {
  const mockedRun = vi.mocked(runAllowlistedNlxCommand);

  beforeEach(() => {
    mockedRun.mockReset();
  });

  it("rejects non-allowlisted command ids", async () => {
    const request = new Request("http://localhost/api/nlx/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commandId: "autofix" }),
    });

    const response = await runPost(request);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/allowlisted/i);
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("rejects non-string command ids", async () => {
    const request = new Request("http://localhost/api/nlx/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commandId: 42 }),
    });

    const response = await runPost(request);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/allowlisted/i);
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("rejects invalid task names", async () => {
    const request = new Request("http://localhost/api/nlx/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commandId: "dryRunTask", taskName: "DNS; rm -rf /" }),
    });

    const response = await runPost(request);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/unsupported characters|invalid/i);
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("rejects dryRunTask without taskName", async () => {
    const request = new Request("http://localhost/api/nlx/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commandId: "dryRunTask" }),
    });

    const response = await runPost(request);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/taskName is required/i);
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("rejects taskName on commands that do not accept it", async () => {
    const request = new Request("http://localhost/api/nlx/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commandId: "diagnose", taskName: "Mise" }),
    });

    const response = await runPost(request);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/only valid with dryRunTask/i);
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("returns successful allowlisted command responses", async () => {
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
    const body = (await response.json()) as { ok: boolean; commandId: string };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.commandId).toBe("diagnose");
    expect(mockedRun).toHaveBeenCalledWith("diagnose", undefined, expect.any(AbortSignal));
  });

  it("maps timeout command failures to 504", async () => {
    mockedRun.mockResolvedValue({
      ok: false,
      commandId: "dryRunAll",
      exitCode: 124,
      timedOut: true,
      errorType: "timeout",
      stdout: "",
      stderr: "Command timed out",
    });

    const request = new Request("http://localhost/api/nlx/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commandId: "dryRunAll" }),
    });

    const response = await runPost(request);
    const body = (await response.json()) as { errorType: string; timedOut: boolean };

    expect(response.status).toBe(504);
    expect(body.errorType).toBe("timeout");
    expect(body.timedOut).toBe(true);
  });

  it("maps aborted command failures to 499", async () => {
    mockedRun.mockResolvedValue({
      ok: false,
      commandId: "dryRunAll",
      exitCode: 130,
      timedOut: false,
      errorType: "aborted",
      stdout: "",
      stderr: "aborted",
    });

    const request = new Request("http://localhost/api/nlx/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commandId: "dryRunAll" }),
    });

    const response = await runPost(request);
    expect(response.status).toBe(499);
  });
});
