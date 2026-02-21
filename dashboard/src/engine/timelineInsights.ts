import type { RunSession } from "./runSessions";
import type { CommandEvent, CommandOutcome } from "./viewModel";

export type TimelineGroupMode = "chronological" | "severity" | "phase";

export interface TimelineGroupSection {
  key: string;
  label: string;
  items: CommandEvent[];
}

export interface TimelineSummary {
  totalEvents: number;
  totalDurationMs: number;
  severityCounts: Record<CommandOutcome, number>;
  badgeDistribution: Array<{ badge: RunSession["badge"]; count: number }>;
  reasonCodeDistribution: Array<{ reasonCode: RunSession["reasonCode"]; count: number }>;
}

const OUTCOME_ORDER: CommandOutcome[] = ["FAIL", "WARN", "RUNNING", "PASS"];

function extractPhaseLabel(event: CommandEvent): string {
  const source = `${event.note}\n${event.label}`;
  const bracketed = source.match(/\[phase[:=\s]+([^\]]+)\]/i);
  if (bracketed && bracketed[1]) {
    return bracketed[1].trim();
  }
  const inline = source.match(/\bphase[:=]\s*([a-z0-9 _-]+)/i);
  if (inline && inline[1]) {
    return inline[1].trim();
  }
  return "Ungrouped";
}

function sortedCountEntries(values: string[]): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.value.localeCompare(right.value);
    });
}

export function groupTimelineEvents(events: CommandEvent[], mode: TimelineGroupMode): TimelineGroupSection[] {
  if (events.length === 0) {
    return [];
  }

  if (mode === "chronological") {
    return [
      {
        key: "chronological",
        label: "Chronological",
        items: events,
      },
    ];
  }

  if (mode === "severity") {
    const buckets = new Map<CommandOutcome, CommandEvent[]>();
    for (const event of events) {
      const current = buckets.get(event.outcome) ?? [];
      current.push(event);
      buckets.set(event.outcome, current);
    }

    return OUTCOME_ORDER.filter((outcome) => buckets.has(outcome)).map((outcome) => ({
      key: `severity-${outcome}`,
      label: outcome,
      items: buckets.get(outcome) ?? [],
    }));
  }

  const buckets = new Map<string, CommandEvent[]>();
  for (const event of events) {
    const phase = extractPhaseLabel(event);
    const current = buckets.get(phase) ?? [];
    current.push(event);
    buckets.set(phase, current);
  }

  return Array.from(buckets.entries())
    .sort(([left], [right]) => {
      if (left === "Ungrouped") {
        return 1;
      }
      if (right === "Ungrouped") {
        return -1;
      }
      return left.localeCompare(right);
    })
    .map(([phase, items]) => ({
      key: `phase-${phase}`,
      label: phase,
      items,
    }));
}

export function buildTimelineSummary(events: CommandEvent[], sessions: RunSession[]): TimelineSummary {
  const severityCounts: Record<CommandOutcome, number> = {
    PASS: 0,
    WARN: 0,
    FAIL: 0,
    RUNNING: 0,
  };

  for (const event of events) {
    severityCounts[event.outcome] += 1;
  }

  const badgeDistribution = sortedCountEntries(sessions.map((session) => session.badge)).map((item) => ({
    badge: item.value as RunSession["badge"],
    count: item.count,
  }));

  const reasonCodeDistribution = sortedCountEntries(sessions.map((session) => session.reasonCode)).map((item) => ({
    reasonCode: item.value as RunSession["reasonCode"],
    count: item.count,
  }));

  return {
    totalEvents: events.length,
    totalDurationMs: events.reduce((sum, event) => sum + Math.max(0, event.durationMs ?? 0), 0),
    severityCounts,
    badgeDistribution,
    reasonCodeDistribution,
  };
}
