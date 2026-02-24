import { execSync } from "node:child_process";

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

export interface CertResult {
  branchCheck: BranchCheck;
  pages: CertPageResult[];
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

export async function fetchAndCheck(baseUrl: string, urlCase: CertUrlCase): Promise<CertPageResult> {
  const url = `${baseUrl}${urlCase.path}`;
  const response = await fetch(url);
  const html = await response.text();
  const { overlayDetected, markers } = checkPageForOverlay(html);
  return { url, label: urlCase.label, status: response.status, overlayDetected, markers };
}

export async function runCert(baseUrl: string, exec?: ExecFn): Promise<CertResult> {
  const branchCheck = checkBranch(exec);
  if (!branchCheck.ok) {
    return { branchCheck, pages: [], pass: false };
  }
  const pages: CertPageResult[] = [];
  for (const urlCase of CERT_URL_MATRIX) {
    try {
      pages.push(await fetchAndCheck(baseUrl, urlCase));
    } catch {
      pages.push({
        url: `${baseUrl}${urlCase.path}`,
        label: urlCase.label,
        status: 0,
        overlayDetected: false,
        markers: ["FETCH_ERROR"],
      });
    }
  }
  const allPagesOk = pages.every((p) => p.status === 200 && !p.overlayDetected);
  return { branchCheck, pages, pass: allPagesOk };
}
