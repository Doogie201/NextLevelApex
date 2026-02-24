import {
  checkBranch,
  checkPageForOverlay,
  runCert,
  CERT_URL_MATRIX,
  OVERLAY_MARKERS,
} from "../releaseCert";
import type { ExecFn } from "../releaseCert";

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
  });

  it("returns structured failure with FETCH_ERROR when server is unreachable", async () => {
    const result = await runCert("http://localhost:1", fakeExec("main", ""));
    expect(result.pass).toBe(false);
    expect(result.pages.length).toBe(CERT_URL_MATRIX.length);
    expect(result.pages[0].status).toBe(0);
    expect(result.pages[0].markers).toContain("FETCH_ERROR");
  });
});
