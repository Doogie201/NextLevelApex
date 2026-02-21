export type TaskStatus = "PASS" | "FAIL" | "WARN" | "SKIP" | "UNKNOWN";

export interface TaskResult {
  taskName: string;
  status: TaskStatus;
  reason: string;
}

const TASK_HEADER = /^\[Task:\s*(.+?)\]\s*$/;

function statusFromLine(line: string): TaskStatus | null {
  if (line.includes("[PASS]")) {
    return "PASS";
  }
  if (line.includes("[SKIP]")) {
    return "SKIP";
  }
  if (line.includes("[WARN]")) {
    return "WARN";
  }
  if (line.includes("[FAIL") || line.includes("[ERROR]")) {
    return "FAIL";
  }
  return null;
}

export function parseTaskResults(stdout: string): TaskResult[] {
  const lines = stdout.split(/\r?\n/);
  const results: TaskResult[] = [];
  let currentTask: TaskResult | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const taskHeader = line.match(TASK_HEADER);
    if (taskHeader && taskHeader[1]) {
      currentTask = {
        taskName: taskHeader[1],
        status: "UNKNOWN",
        reason: "No task status marker emitted.",
      };
      results.push(currentTask);
      continue;
    }

    if (!currentTask) {
      continue;
    }

    const parsedStatus = statusFromLine(line);
    if (parsedStatus) {
      currentTask.status = parsedStatus;
      currentTask.reason = line.replace(/^\[[^\]]+\]\s*/, "") || line;
      continue;
    }

    if (line.startsWith("[ERROR]")) {
      currentTask.status = "FAIL";
      currentTask.reason = line;
    }
  }

  return results;
}
