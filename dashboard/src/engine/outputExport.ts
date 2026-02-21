import { redactOutput } from "./redaction";
import type { CommandEvent } from "./viewModel";

function asLine(label: string, value: string): string {
  return `${label}: ${redactOutput(value)}`;
}

export function buildRedactedEventText(event: CommandEvent): string {
  const lines: string[] = [];
  lines.push(asLine("Command", event.label));
  lines.push(asLine("Started", event.startedAt));
  lines.push(asLine("Finished", event.finishedAt ?? "pending"));
  lines.push(asLine("Duration", `${event.durationMs ?? 0}ms`));
  lines.push(asLine("Status", event.outcome));
  lines.push("");

  if (event.taskResults.length > 0) {
    lines.push("Task Results:");
    for (const item of event.taskResults) {
      lines.push(
        redactOutput(`- ${item.taskName} [${item.status}] ${item.reason}`),
      );
    }
    lines.push("");
  }

  lines.push("STDOUT:");
  lines.push(redactOutput(event.stdout || "(stdout empty)"));
  lines.push("");
  lines.push("STDERR:");
  lines.push(redactOutput(event.stderr || "(stderr empty)"));

  return lines.join("\n");
}

export function buildRedactedLogText(events: CommandEvent[]): string {
  if (events.length === 0) {
    return "No command events available.";
  }

  return events.map((event) => buildRedactedEventText(event)).join("\n\n---\n\n");
}
