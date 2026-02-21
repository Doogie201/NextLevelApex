import type { CommandId } from "./commandContract";

export interface DiagnoseSummary {
  dnsMode: string;
  resolver: string;
  pihole: string;
  piholeUpstream: string;
  cloudflared: string;
  plaintextDns: string;
  notes: string;
}

export interface TaskResult {
  taskName: string;
  status: "PASS" | "FAIL" | "WARN" | "SKIP" | "UNKNOWN";
  reason: string;
}

export type HealthBadge = "OK" | "DEGRADED" | "BROKEN";

export type CommandErrorType =
  | "missing_nlx"
  | "permission"
  | "timeout"
  | "aborted"
  | "spawn_error"
  | "nonzero_exit"
  | "none";

export interface CommandResponse {
  ok: boolean;
  commandId: CommandId;
  exitCode: number;
  timedOut: boolean;
  errorType: CommandErrorType;
  stdout: string;
  stderr: string;
  taskNames?: string[];
  taskResults?: TaskResult[];
  diagnose?: {
    summary: DiagnoseSummary;
    badge: HealthBadge;
  };
  error?: string;
  httpStatus: number;
}

export type CommandOutcome = "RUNNING" | "PASS" | "WARN" | "FAIL";

export interface CommandEvent {
  id: string;
  commandId: CommandId;
  label: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  outcome: CommandOutcome;
  note: string;
  stdout: string;
  stderr: string;
  taskResults: TaskResult[];
}

export function classifyCommandOutcome(result: CommandResponse): CommandOutcome {
  if (!result.ok) {
    return "FAIL";
  }

  if (result.commandId === "diagnose") {
    if (!result.diagnose || result.diagnose.badge === "BROKEN") {
      return "FAIL";
    }
    return result.diagnose.badge === "OK" ? "PASS" : "WARN";
  }

  if (result.taskResults?.some((task) => task.status === "FAIL")) {
    return "FAIL";
  }

  if (result.taskResults?.some((task) => task.status === "WARN" || task.status === "UNKNOWN")) {
    return "WARN";
  }

  return "PASS";
}

export function summarizeCommandResult(result: CommandResponse): string {
  if (!result.ok) {
    if (result.errorType === "missing_nlx") {
      return "nlx not found. Install dependencies and verify `poetry run nlx diagnose`.";
    }
    if (result.errorType === "timeout") {
      return "Command timed out before completion.";
    }
    if (result.errorType === "aborted") {
      return "Command canceled by user.";
    }
    return result.error || result.stderr || "Command failed.";
  }

  if (result.commandId === "diagnose" && result.diagnose) {
    return result.diagnose.badge === "OK"
      ? "Diagnose confirms expected secure local DNS path."
      : "Diagnose reports degraded DNS state. Review notes.";
  }

  if (result.commandId === "listTasks") {
    return `Discovered ${result.taskNames?.length ?? 0} task(s).`;
  }

  if (result.taskResults && result.taskResults.length > 0) {
    const failures = result.taskResults.filter((task) => task.status === "FAIL").length;
    const warnings = result.taskResults.filter((task) => task.status === "WARN").length;
    if (failures > 0 || warnings > 0) {
      return `Completed with ${failures} fail / ${warnings} warn.`;
    }
    return `Completed ${result.taskResults.length} task checks with no warnings.`;
  }

  return "Command completed.";
}

export function healthBadgeFromDiagnose(result: CommandResponse): HealthBadge {
  if (!result.ok) {
    if (result.errorType === "missing_nlx" || result.errorType === "timeout" || result.errorType === "nonzero_exit") {
      return "DEGRADED";
    }
    return "BROKEN";
  }

  if (!result.diagnose) {
    return "BROKEN";
  }

  return result.diagnose.badge;
}

export function formatCommandLabel(commandId: CommandId, taskName?: string): string {
  if (commandId === "diagnose") {
    return "Diagnose";
  }
  if (commandId === "listTasks") {
    return "List Tasks";
  }
  if (commandId === "dryRunAll") {
    return "Dry-Run Sweep";
  }
  return taskName ? `Dry-Run Task: ${taskName}` : "Dry-Run Task";
}

export function isStale(lastUpdatedAtIso: string | null, nowMs: number, staleAfterMs = 10 * 60 * 1000): boolean {
  if (!lastUpdatedAtIso) {
    return true;
  }

  const parsed = Date.parse(lastUpdatedAtIso);
  if (Number.isNaN(parsed)) {
    return true;
  }

  return nowMs - parsed > staleAfterMs;
}
