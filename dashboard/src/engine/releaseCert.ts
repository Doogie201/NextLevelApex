import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

export interface CertUrlCase {
  label: string;
  path: string;
}

export interface CertPageResult {
  url: string;
  label: string;
  status: number;
  overlayDetected: boolean;
  markers: string[];
}

export interface BranchCheck {
  branch: string;
  cleanTree: boolean;
  ok: boolean;
}

export interface StderrCheck {
  logPath: string | null;
  signatures: string[];
  ok: boolean;
}

export interface CertResult {
  branchCheck: BranchCheck;
  pages: CertPageResult[];
  stderrCheck: StderrCheck;
  pass: boolean;
}

export const CERT_URL_MATRIX: CertUrlCase[] = [
  { label: "home-default", path: "/" },
  { label: "view-dashboard", path: "/?view=dashboard" },
  { label: "view-tasks", path: "/?view=tasks" },
  { label: "view-output", path: "/?view=output" },
  { label: "view-bundles", path: "/?view=bundles" },
  { label: "deep-link-event", path: "/?view=output&event=evt-cert-probe" },
  { label: "deep-link-session", path: "/?view=output&session=run-cert-probe" },
  { label: "deep-link-group", path: "/?view=output&group=severity" },
  { label: "severity-filter", path: "/?view=dashboard&severity=error" },
  { label: "workspace-focus", path: "/?view=output&layout=focus-output" },
];

export const OVERLAY_MARKERS: string[] = [
  "nextjs-portal",
  "data-nextjs-dialog",
  "data-nextjs-error",
  "nextjs__container_errors",
  "Unhandled Runtime Error",
  "Maximum update depth exceeded",
  "Internal Server Error",
  "Application error: a server-side exception has occurred",
  "Hydration failed",
];

/** Stderr/log signatures that indicate server-side crashes in production. */
export const STDERR_SIGNATURES: string[] = [
  "⨯ Error",
  "TypeError:",
  "ReferenceError:",
  "SyntaxError:",
  "RangeError:",
  "ECONNREFUSED",
  "EADDRINUSE",
  "unhandledRejection",
  "uncaughtException",
  "Hydration failed",
  "digest:",
  "server-side exception",
];

export type ExecFn = (cmd: string) => string;

const defaultExec: ExecFn = (cmd) => execSync(cmd, { encoding: "utf-8" });

export function checkBranch(exec: ExecFn = defaultExec): BranchCheck {
  const branch = exec("git rev-parse --abbrev-ref HEAD").trim();
  const porcelain = exec("git status --porcelain").trim();
  const cleanTree = porcelain.length === 0;
  return { branch, cleanTree, ok: branch === "main" && cleanTree };
}

export function checkPageForOverlay(html: string): { overlayDetected: boolean; markers: string[] } {
  const lower = html.toLowerCase();
  const found = OVERLAY_MARKERS.filter((marker) => lower.includes(marker.toLowerCase()));
  return { overlayDetected: found.length > 0, markers: found };
}

/**
 * Reads a server log file and scans for stderr error signatures.
 * Returns ok:true only if no signatures are found (or no log path given).
 * Fail-closed: if logPath is provided but cannot be read, returns ok:false
 * with a LOG_READ_FAILED marker to prevent silent false-PASS.
 */
export function checkServerLog(logPath: string | null): StderrCheck {
  if (!logPath) {
    return { logPath: null, signatures: [], ok: true };
  }
  let content: string;
  try {
    content = readFileSync(logPath, "utf-8");
  } catch {
    // Fail closed: if caller requested log checking but log is unreadable,
    // cert must not silently pass. Return ok:false with diagnostic marker.
    return { logPath, signatures: ["LOG_READ_FAILED"], ok: false };
  }
  const lower = content.toLowerCase();
  const found = STDERR_SIGNATURES.filter((sig) => lower.includes(sig.toLowerCase()));
  return { logPath, signatures: found, ok: found.length === 0 };
}

export async function fetchAndCheck(baseUrl: string, urlCase: CertUrlCase): Promise<CertPageResult> {
  const url = `${baseUrl}${urlCase.path}`;
  const response = await fetch(url);
  const html = await response.text();
  const { overlayDetected, markers } = checkPageForOverlay(html);
  return { url, label: urlCase.label, status: response.status, overlayDetected, markers };
}

export interface RunCertOptions {
  baseUrl: string;
  exec?: ExecFn;
  serverLogPath?: string | null;
}

export async function runCert(
  baseUrlOrOpts: string | RunCertOptions,
  exec?: ExecFn,
): Promise<CertResult> {
  const opts: RunCertOptions =
    typeof baseUrlOrOpts === "string"
      ? { baseUrl: baseUrlOrOpts, exec, serverLogPath: null }
      : baseUrlOrOpts;
  const resolvedExec = opts.exec ?? exec;

  const branchCheck = checkBranch(resolvedExec);
  const emptyStderr: StderrCheck = { logPath: null, signatures: [], ok: true };

  if (!branchCheck.ok) {
    return { branchCheck, pages: [], stderrCheck: emptyStderr, pass: false };
  }

  const pages: CertPageResult[] = [];
  for (const urlCase of CERT_URL_MATRIX) {
    try {
      pages.push(await fetchAndCheck(opts.baseUrl, urlCase));
    } catch {
      pages.push({
        url: `${opts.baseUrl}${urlCase.path}`,
        label: urlCase.label,
        status: 0,
        overlayDetected: false,
        markers: ["FETCH_ERROR"],
      });
    }
  }

  const stderrCheck = checkServerLog(opts.serverLogPath ?? null);
  const allPagesOk = pages.every((p) => p.status === 200 && !p.overlayDetected);
  const pass = allPagesOk && stderrCheck.ok;

  return { branchCheck, pages, stderrCheck, pass };
}
