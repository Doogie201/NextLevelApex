"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, Terminal, ShieldAlert, Cpu, Play, CheckCircle2, XCircle, Clock, Zap, Target } from "lucide-react";
import clsx from "clsx";

const MODE_META = {
  run: { icon: Play, label: "RUN", desc: "Standard workflow execution", color: "var(--color-run)" },
  test: { icon: Target, label: "TEST", desc: "Validation & verification passes", color: "var(--color-test)" },
  stress: { icon: Zap, label: "STRESS", desc: "High-load volume testing", color: "var(--color-stress)" },
  security: { icon: ShieldAlert, label: "SECURITY", desc: "Vulnerability & hardening scans", color: "var(--color-security)" },
};

export default function Home() {
  const [tasks, setTasks] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<keyof typeof MODE_META>("run");
  const [logs, setLogs] = useState<{ id: number; text: string; time: string }[]>([]);
  const logCounter = useRef(0);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchTasks();
    addLog("System initialized. Awaiting commands...");
  }, []);

  useEffect(() => {
    // Auto-scroll terminal
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const addLog = (text: string) => {
    const now = new Date().toLocaleTimeString('en-US', { hour12: false, hour: "numeric", minute: "numeric", second: "numeric" });
    setLogs((prev) => [...prev, { id: logCounter.current++, text, time: now }]);
  };

  const fetchTasks = async () => {
    try {
      const res = await fetch("http://localhost:8000/api/tasks");
      const data = await res.json();
      setTasks(data.tasks || {});
      setLoading(false);
    } catch (e) {
      addLog("ERROR: Failed to fetch tasks geometry from APEX core.");
      setLoading(false);
    }
  };

  const handleRunAll = async () => {
    setRunning(true);
    addLog(`INIT: Executing Global Run [Mode: ${mode.toUpperCase()}]`);
    try {
      const res = await fetch("http://localhost:8000/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: mode }),
      });
      const data = await res.json();
      addLog(`SUCCESS: Run cycle completed with status [${data.status}]`);
      await fetchTasks();
    } catch (e) {
      addLog("CRITICAL: Connection severed to orchestrator core.");
    }
    setRunning(false);
  };

  const handleDiagnose = async (taskName: string) => {
    addLog(`DIAGNOSTIC: Probing ${taskName} sequence...`);
    try {
      const res = await fetch("http://localhost:8000/api/diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_name: taskName, autofix: false }),
      });
      const data = await res.json();
      addLog(`DIAGNOSTIC: [${taskName}] Returned status: ${data.status}`);
      if (data.status === "error") {
        addLog(`FAULT TRACE: ${data.message}`);
      }
    } catch (e) {
      addLog("CRITICAL: Failed to run diagnostic telemetry.");
    }
  };

  const handleHeal = async (taskName: string) => {
    addLog(`HEALING PROTOCOL: Initiated for ${taskName}...`);
    try {
      const res = await fetch("http://localhost:8000/api/diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_name: taskName, autofix: true }),
      });
      const data = await res.json();

      if (data.status === "success" && data.result?.healing_logs) {
        data.result.healing_logs.forEach((logStr: string) => {
            addLog(`HEAL [${taskName}]: ${logStr}`);
        });

        if (data.result.status === "PASS") {
             addLog(`HEAL SUCCESS: Node restored.`);
             await fetchTasks();
        } else {
             addLog(`HEAL FAILED: Manual intervention required.`);
        }
      } else {
         addLog(`HEALING PROTOCOL: Backend returned status ${data.status}`);
      }
    } catch (e) {
      addLog("CRITICAL: Failed to execute healing protocol.");
    }
  };

  const ActiveIcon = MODE_META[mode].icon;

  return (
    <div data-theme={mode} className="min-h-screen relative overflow-hidden font-sans text-sm selection:bg-[var(--theme-main)] selection:text-white pb-20">
      <div className="bg-glow" />

      {/* Decorative cyber grid overlay */}
      <div className="absolute inset-0 z-[-1] opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.5) 1px, transparent 1px)', backgroundSize: '40px 40px' }}></div>

      <main className="max-w-7xl mx-auto px-6 pt-12 flex flex-col gap-10">

        {/* HEADER */}
        <motion.header
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6"
        >
          <div className="flex gap-4 items-center">
            <div className="w-14 h-14 rounded-2xl glass flex items-center justify-center border-[var(--theme-main)] shadow-[0_0_20px_var(--theme-glow)]">
              <Cpu className="text-[var(--theme-main)] w-8 h-8" />
            </div>
            <div>
              <h1 className="text-4xl font-extrabold tracking-tight text-white m-0 leading-tight">NextLevelApex</h1>
              <p className="text-[var(--theme-main)] tracking-widest uppercase text-xs font-bold mt-1 opacity-80">Orchestration & Telemetry Matrix</p>
            </div>
          </div>

          <div className="glass p-2 rounded-xl flex items-center gap-4 border-white/10 w-full lg:w-auto overflow-hidden relative">

            {/* Mode Selector */}
            <div className="flex bg-black/40 p-1 rounded-lg">
              {(Object.keys(MODE_META) as Array<keyof typeof MODE_META>).map((m) => {
                const Icon = MODE_META[m].icon;
                const isActive = mode === m;
                return (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    disabled={running}
                    className={clsx(
                      "flex items-center gap-2 px-4 py-2 rounded-md transition-all font-semibold uppercase text-xs tracking-wider",
                      isActive ? "bg-[var(--theme-badge)] text-[var(--theme-main)] shadow-sm" : "text-white/50 hover:text-white hover:bg-white/5"
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    {isActive && <motion.span layoutId="mode-label">{m}</motion.span>}
                  </button>
                );
              })}
            </div>

            <button
              onClick={handleRunAll}
              disabled={running}
              className="btn-theme shrink-0 flex items-center gap-2 pr-6"
            >
              {running ? (
                <>
                  <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2, ease: "linear" }}>
                    <Activity className="w-4 h-4" />
                  </motion.div>
                  Executing...
                </>
              ) : (
                <>
                  <ActiveIcon className="w-4 h-4" />
                  EXECUTE
                </>
              )}
            </button>
          </div>
        </motion.header>

        {/* MODE DESCRIPTION CALLOUT */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          key={mode}
          className="glass border-[var(--theme-main)] border-opacity-30 p-4 rounded-xl flex gap-3 items-center"
        >
          <ActiveIcon className="text-[var(--theme-main)] w-5 h-5 flex-shrink-0" />
          <p className="text-white/80"><strong className="text-white uppercase tracking-wide mr-2">{mode} MODE:</strong> {MODE_META[mode].desc}</p>
        </motion.div>


        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:h-[600px]">

          {/* TASKS MATRIX */}
          <section className="lg:col-span-7 flex flex-col gap-4">
            <h2 className="text-lg font-bold text-white uppercase tracking-widest flex items-center gap-2 opacity-90">
              <Activity className="w-4 h-4 text-[var(--theme-main)]" />
              Node Matrix
            </h2>

            <div className="flex-1 overflow-y-auto pr-2 flex flex-col gap-3 pb-8">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="glass-card h-20 animate-pulse bg-white/5" />
                ))
              ) : Object.keys(tasks).length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center opacity-40 glass-card">
                  <Activity className="w-12 h-12 mb-4" />
                  <p>NO NODES DISCOVERED</p>
                </div>
              ) : (
                <AnimatePresence>
                  {Object.entries(tasks).map(([name, info]: [string, any], i) => (
                    <motion.div
                      key={name}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="glass-card p-4 flex flex-col sm:flex-row justify-between sm:items-center gap-4 group"
                    >
                      <div>
                        <h3 className="font-bold text-base text-white mb-1 group-hover:text-[var(--theme-main)] transition-colors">{name}</h3>
                        <p className="text-xs text-white/40 flex items-center gap-1 font-mono">
                          <Clock className="w-3 h-3" />
                          {info.last_update ? new Date(info.last_update).toLocaleString() : "TBD"}
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className={`badge-status badge-${info.status}`}>
                          {info.status === "PASS" && <CheckCircle2 className="w-4 h-4" />}
                          {info.status === "FAIL" && <XCircle className="w-4 h-4" />}
                          {info.status === "PENDING" && <Activity className="w-4 h-4" />}
                          {info.status}
                        </span>

                        {info.status === "FAIL" && (
                          <button
                            onClick={() => handleHeal(name)}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide bg-[var(--theme-security)]/20 text-[var(--theme-security)] hover:bg-[var(--theme-security)] hover:text-white transition-all border border-[var(--theme-security)]/40"
                          >
                            Heal
                          </button>
                        )}

                        <button
                          onClick={() => handleDiagnose(name)}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide bg-white/5 text-white hover:bg-[var(--theme-main)] hover:text-white transition-all border border-white/10 group-hover:border-[var(--theme-main)]"
                        >
                          Diagnose
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>
          </section>

          {/* TERMINAL UI */}
          <section className="lg:col-span-5 flex flex-col gap-4">
             <h2 className="text-lg font-bold text-white uppercase tracking-widest flex items-center gap-2 opacity-90">
              <Terminal className="w-4 h-4 text-[var(--theme-main)]" />
              Live Telemetry
            </h2>
            <div className="terminal-window flex-1 p-4 overflow-y-auto flex flex-col relative">
              <div className="sticky top-0 bg-[#010409]/90 backdrop-blur-sm pb-2 mb-2 border-b border-white/5 z-10 flex text-[10px] text-white/30 tracking-widest font-bold uppercase">
                <span className="w-24">Timestamp</span>
                <span>Event Log</span>
              </div>

              <AnimatePresence initial={false}>
                {logs.map((log) => (
                  <motion.div
                    key={log.id}
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="terminal-line"
                  >
                    <span className="text-white/30 text-[11px] w-24 shrink-0 flex-none leading-[1.6]">
                      [{log.time}]
                    </span>
                    <span className="text-white/70 leading-[1.6]">
                      <span className="terminal-prompt mr-2">❯</span>
                      {log.text}
                    </span>
                  </motion.div>
                ))}
              </AnimatePresence>
              <div ref={terminalEndRef} className="h-2" />
            </div>
          </section>

        </div>
      </main>
    </div>
  );
}
