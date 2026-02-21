import type { CommandRunner } from "./nlxBridge";
import type { RunnerResponse } from "./types";

const DIAGNOSE_SAMPLE =
  'DNS_MODE=local-private RESOLVER=192.168.64.2 PIHOLE=running PIHOLE_UPSTREAM=host.docker.internal#5053 CLOUDFLARED=ok PLAINTEXT_DNS=no NOTES="demo-mode"';

const TASK_SAMPLE = `Task                   | Status   | Last Update         \n--------------------------------------------------------\nMise Globals           | PASS     | 2026-02-21T00:00:00`;

const DRY_RUN_SAMPLE = `[Task: Mise Globals]\n  [RUN] Executing task (DRY RUN)\n    [PASS]`;

export function createDemoRunner(): CommandRunner {
  return {
    async run(argv: string[]): Promise<RunnerResponse> {
      if (argv[1] === "diagnose") {
        return { stdout: `${DIAGNOSE_SAMPLE}\n`, stderr: "", exitCode: 0 };
      }

      if (argv[1] === "list-tasks") {
        return { stdout: `${TASK_SAMPLE}\n`, stderr: "", exitCode: 0 };
      }

      if (argv.includes("--dry-run")) {
        return { stdout: `${DRY_RUN_SAMPLE}\n`, stderr: "", exitCode: 0 };
      }

      return { stdout: "", stderr: "Unsupported command in demo mode", exitCode: 1 };
    },
  };
}
