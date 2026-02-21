export type CommandId = "diagnose" | "listTasks" | "dryRunTask" | "dryRunAll";

export interface CommandArgs {
  taskName?: string;
}

export interface RunnerResponse {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CommandExecutionResult extends RunnerResponse {
  commandId: CommandId;
  argv: string[];
  durationMs: number;
  timedOut: boolean;
}

export interface DiagnoseSummary {
  dnsMode: string;
  resolver: string;
  pihole: string;
  piholeUpstream: string;
  cloudflared: string;
  plaintextDns: string;
  notes: string;
}

export type HealthBadgeStatus = "OK" | "DEGRADED" | "BROKEN";
