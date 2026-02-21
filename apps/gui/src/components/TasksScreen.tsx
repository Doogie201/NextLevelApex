interface TasksScreenProps {
  tasks: string[];
  selectedTask: string;
  onSelectTask: (task: string) => void;
  onRefreshTasks: () => Promise<void>;
  onRunTask: () => Promise<void>;
  taskResult: string;
}

export function TasksScreen({
  tasks,
  selectedTask,
  onSelectTask,
  onRefreshTasks,
  onRunTask,
  taskResult,
}: TasksScreenProps) {
  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Tasks</h2>
        <p className="subtle">Read-only dry-run diagnostics for a selected task.</p>
      </header>

      <div className="task-controls">
        <button className="secondary" onClick={() => void onRefreshTasks()}>
          Refresh Task List
        </button>
        <button className="primary" onClick={() => void onRunTask()} disabled={!selectedTask}>
          Run Dry-Run
        </button>
      </div>

      <label className="select-wrap">
        <span>Task</span>
        <select value={selectedTask} onChange={(event) => onSelectTask(event.target.value)}>
          <option value="">Select a task</option>
          {tasks.map((task) => (
            <option key={task} value={task}>
              {task}
            </option>
          ))}
        </select>
      </label>

      <p className="subtle">Latest task result: {taskResult}</p>
    </section>
  );
}
