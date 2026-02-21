export type TaskMoveDirection = "next" | "prev";

const DEFAULT_WINDOW_SIZE = 200;

export function moveTaskSelection(
  taskNames: string[],
  currentTaskName: string | null,
  direction: TaskMoveDirection,
): string | null {
  if (taskNames.length === 0) {
    return null;
  }

  const currentIndex = currentTaskName ? taskNames.indexOf(currentTaskName) : -1;
  if (currentIndex < 0) {
    return direction === "prev" ? taskNames[taskNames.length - 1] : taskNames[0];
  }

  const delta = direction === "next" ? 1 : -1;
  const nextIndex = (currentIndex + delta + taskNames.length) % taskNames.length;
  return taskNames[nextIndex];
}

export function nextVisibleTaskLimit(current: number, total: number, step = DEFAULT_WINDOW_SIZE): number {
  if (total <= 0) {
    return 0;
  }

  const normalizedStep = step > 0 ? step : DEFAULT_WINDOW_SIZE;
  const normalizedCurrent = Math.max(0, current);
  return Math.min(total, normalizedCurrent + normalizedStep);
}
