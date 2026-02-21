import { redactOutput } from "./redaction";
import type { TaskResult } from "./viewModel";

export interface TaskDetailsSummaryInput {
  taskName: string;
  status: TaskResult["status"];
  reason: string;
  lastRunAt?: string | null;
  outputSnippet?: string;
}

export function buildTaskDetailsSummary(input: TaskDetailsSummaryInput): string {
  const lines = [
    `Task: ${input.taskName}`,
    `Status: ${input.status}`,
    `Last run: ${input.lastRunAt ?? "n/a"}`,
    `Reason: ${redactOutput(input.reason) || "n/a"}`,
  ];

  const snippet = redactOutput(input.outputSnippet ?? "").trim();
  if (snippet.length > 0) {
    lines.push(`Output snippet: ${snippet}`);
  }

  return lines.join("\n");
}
