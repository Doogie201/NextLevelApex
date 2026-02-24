import {
  checkBranch,
  checkPageForOverlay,
  checkServerLog,
  runCert,
  CERT_URL_MATRIX,
  OVERLAY_MARKERS,
  STDERR_SIGNATURES,
} from "../releaseCert";
import type { ExecFn } from "../releaseCert";
import { writeFileSync, unlinkSync } from "node:fs";

function fakeExec(branch: string, porcelain: string): ExecFn {
  return (cmd: string) => {
    if (cmd.includes("rev-parse")) return `${branch}\n`;
    return porcelain;
  };
}

// --- checkPageForOverlay ---

describe("checkPageForOverlay", () => {
  it("returns no markers for clean HTML", () => {
    const html = "<html><body><div id='app'>Hello</div></body></html>";
    const result = checkPageForOverlay(html);
    expect(result.overlayDetected).toBe(false);
    expect(result.markers).toEqual([]);
  });

  it("detects nextjs-portal marker", () => {
    const html = '<html><body><div id="nextjs-portal"><div>Error</div></div></body></html>';
    const result = checkPageForOverlay(html);
    expect(result.overlayDetected).toBe(true);
    expect(result.markers).toContain("nextjs-portal");
  });

  it("detects Unhandled Runtime Error text", () => {
    const html = "<html><body><h1>Unhandled Runtime Error</h1><p>Something broke</p></body></html>";
    const result = checkPageForOverlay(html);
    expect(result.overlayDetected).toBe(true);
    expect(result.markers).toContain("Unhandled Runtime Error");
  });

  it("detects Maximum update depth exceeded", () => {
    const html = "<html><body><pre>Error: Maximum update depth exceeded</pre></body></html>";
    const result = checkPageForOverlay(html);
    expect(result.overlayDetected).toBe(true);
    expect(result.markers).toContain("Maximum update depth exceeded");
  });

  it("detects Internal Server Error", () => {
    const html = "<html><body><h1>500 Internal Server Error</h1></body></html>";
    const result = checkPageForOverlay(html);
    expect(result.overlayDetected).toBe(true);
    expect(result.markers).toContain("Internal Server Error");
  });

  it("detects multiple markers simultaneously", () => {
    const html =
      '<html><body><div id="nextjs-portal">Unhandled Runtime Error: Maximum update depth exceeded</div></body></html>';
    const result = checkPageForOverlay(html);
    expect(result.overlayDetected).toBe(true);
    expect(result.markers.length).toBeGreaterThanOrEqual(3);
    expect(result.markers).toContain("nextjs-portal");
    expect(result.markers).toContain("Unhandled Runtime Error");
    expect(result.markers).toContain("Maximum update depth exceeded");
  });

  it("performs case-insensitive matching", () => {
    const html = "<html><body><div>INTERNAL SERVER ERROR</div></body></html>";
    const result = checkPageForOverlay(html);
    expect(result.overlayDetected).toBe(true);
    expect(result.markers).toContain("Internal Server Error");
  });
});

// --- CERT_URL_MATRIX ---

describe("CERT_URL_MATRIX", () => {
  it("has at least 10 entries", () => {
    expect(CERT_URL_MATRIX.length).toBeGreaterThanOrEqual(10);
  });

  it("all paths start with /", () => {
    for (const entry of CERT_URL_MATRIX) {
      expect(entry.path).toMatch(/^\//);
    }
  });

  it("covers event deep-link", () => {
    expect(CERT_URL_MATRIX.some((e) => e.path.includes("event="))).toBe(true);
  });

  it("covers session deep-link", () => {
    expect(CERT_URL_MATRIX.some((e) => e.path.includes("session="))).toBe(true);
  });

  it("covers group parameter", () => {
    expect(CERT_URL_MATRIX.some((e) => e.path.includes("group="))).toBe(true);
  });

  it("covers severity parameter", () => {
    expect(CERT_URL_MATRIX.some((e) => e.path.includes("severity="))).toBe(true);
  });

  it("covers workspace layout parameter", () => {
    expect(CERT_URL_MATRIX.some((e) => e.path.includes("layout="))).toBe(true);
  });
});

// --- OVERLAY_MARKERS ---

describe("OVERLAY_MARKERS", () => {
  it("includes both dev and production error markers", () => {
    expect(OVERLAY_MARKERS).toContain("nextjs-portal");
    expect(OVERLAY_MARKERS).toContain("Internal Server Error");
    expect(OVERLAY_MARKERS).toContain("Hydration failed");
  });
});

// --- STDERR_SIGNATURES ---

describe("STDERR_SIGNATURES", () => {
  it("includes critical server crash patterns", () => {
    expect(STDERR_SIGNATURES).toContain("⨯ Error");
    expect(STDERR_SIGNATURES).toContain("TypeError:");
    expect(STDERR_SIGNATURES).toContain("Hydration failed");
    expect(STDERR_SIGNATURES).toContain("digest:");
  });
});

// --- checkServerLog ---

describe("checkServerLog", () => {
  const tmpLog = "/tmp/s24-test-server.log";

  afterEach(() => {
    try { unlinkSync(tmpLog); } catch { /* ignore */ }
  });

  it("returns ok:true when logPath is null", () => {
    const result = checkServerLog(null);
    expect(result.ok).toBe(true);
    expect(result.signatures).toEqual([]);
  });

  it("returns ok:true for clean log file", () => {
    writeFileSync(tmpLog, "Ready in 200ms\nListening on port 3000\n");
    const result = checkServerLog(tmpLog);
    expect(result.ok).toBe(true);
    expect(result.signatures).toEqual([]);
  });

  it("detects stderr crash signatures", () => {
    writeFileSync(tmpLog, "Ready in 200ms\n⨯ Error: component threw during render\n  digest: '123'\n");
    const result = checkServerLog(tmpLog);
    expect(result.ok).toBe(false);
    expect(result.signatures).toContain("⨯ Error");
    expect(result.signatures).toContain("digest:");
  });

  it("returns ok:true when log file does not exist", () => {
    const result = checkServerLog("/tmp/nonexistent-s24.log");
    expect(result.ok).toBe(true);
  });
});

// --- S24 Harness: composed overlay-fallacy proof (AT-S24-02/03/04) ---

describe("S24 overlay-fallacy harness (DI + fixtures)", () => {
  const tmpLog = "/tmp/s24-harness-server.log";
  afterEach(() => { try { unlinkSync(tmpLog); } catch { /* noop */ } });

  const CLEAN_HTML = '<html lang="en"><body><div id="__next">OK</div></body></html>';
  const CRASH_LOG =
    "✓ Ready in 200ms\n⨯ Error: component threw during server render\n" +
    "    at Page (.next/server/page.js:1:42) {\n  digest: '2338785109'\n}\n";
  const CLEAN_LOG = "✓ Ready in 200ms\n";

  it("AT-S24-02: clean HTML passes old overlay-only detection", () => {
    const { overlayDetected, markers } = checkPageForOverlay(CLEAN_HTML);
    expect(overlayDetected).toBe(false);
    expect(markers).toEqual([]);
  });

  it("AT-S24-03: upgraded cert FAILS for 200 + clean HTML + stderr crash", () => {
    const overlay = checkPageForOverlay(CLEAN_HTML);
    expect(overlay.overlayDetected).toBe(false);
    writeFileSync(tmpLog, CRASH_LOG);
    const stderr = checkServerLog(tmpLog);
    expect(stderr.ok).toBe(false);
    expect(stderr.signatures.length).toBeGreaterThan(0);
    // Old logic: status 200 + no overlay = pass. New logic adds stderr → fail.
    expect(!overlay.overlayDetected).toBe(true);  // old cert: PASS
    expect(!overlay.overlayDetected && stderr.ok).toBe(false); // new cert: FAIL
  });

  it("AT-S24-04: upgraded cert PASSES for 200 + clean HTML + clean stderr", () => {
    expect(checkPageForOverlay(CLEAN_HTML).overlayDetected).toBe(false);
    writeFileSync(tmpLog, CLEAN_LOG);
    expect(checkServerLog(tmpLog).ok).toBe(true);
  });
});

// --- checkBranch (injected exec) ---

describe("checkBranch", () => {
  it("returns ok:true when on main with clean tree (AT-S18-02)", () => {
    const result = checkBranch(fakeExec("main", ""));
    expect(result.branch).toBe("main");
    expect(result.cleanTree).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("returns ok:false when on non-main branch (AT-S18-01)", () => {
    const result = checkBranch(fakeExec("feature/foo", ""));
    expect(result.branch).toBe("feature/foo");
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when tree is dirty (AT-S18-01)", () => {
    const result = checkBranch(fakeExec("main", " M src/foo.ts\n"));
    expect(result.branch).toBe("main");
    expect(result.cleanTree).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false for sprint branch", () => {
    const result = checkBranch(fakeExec("sprint/S18-release-cert-v2", ""));
    expect(result.branch).toBe("sprint/S18-release-cert-v2");
    expect(result.ok).toBe(false);
  });
});

// --- runCert (injected exec) ---

describe("runCert", () => {
  it("returns pass:false with empty pages when branch is not main (AT-S18-01)", async () => {
    const result = await runCert("http://localhost:3000", fakeExec("sprint/S18", ""));
    expect(result.pass).toBe(false);
    expect(result.pages).toEqual([]);
    expect(result.branchCheck.ok).toBe(false);
    expect(result.stderrCheck).toBeDefined();
  });

  it("returns structured failure with FETCH_ERROR when server is unreachable", async () => {
    const result = await runCert("http://localhost:1", fakeExec("main", ""));
    expect(result.pass).toBe(false);
    expect(result.pages.length).toBe(CERT_URL_MATRIX.length);
    expect(result.pages[0].status).toBe(0);
    expect(result.pages[0].markers).toContain("FETCH_ERROR");
    expect(result.stderrCheck).toBeDefined();
  });

  it("fails when serverLogPath contains crash signatures", async () => {
    const tmpLog = "/tmp/s24-runcert-crash.log";
    writeFileSync(tmpLog, "⨯ Error: crash\ndigest: '999'\n");
    const result = await runCert(
      { baseUrl: "http://localhost:1", exec: fakeExec("main", ""), serverLogPath: tmpLog },
    );
    expect(result.pass).toBe(false);
    expect(result.stderrCheck.ok).toBe(false);
    expect(result.stderrCheck.signatures.length).toBeGreaterThan(0);
    try { unlinkSync(tmpLog); } catch { /* ignore */ }
  });
});
