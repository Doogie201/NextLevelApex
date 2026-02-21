import type { HealthBadgeStatus } from "../engine/types";

interface DashboardScreenProps {
  status: HealthBadgeStatus;
  lastRunAt: string;
  onRunDiagnose: () => Promise<void>;
}

export function DashboardScreen({ status, lastRunAt, onRunDiagnose }: DashboardScreenProps) {
  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Dashboard</h2>
        <p className="subtle">Primary observability view for the local DNS stack.</p>
      </header>
      <div className="badge-row">
        <span className={`health-badge health-${status.toLowerCase()}`}>{status}</span>
        <span className="timestamp">Last run: {lastRunAt || "never"}</span>
      </div>
      <button className="primary" onClick={() => void onRunDiagnose()}>
        Run Diagnose
      </button>
    </section>
  );
}
