"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, Terminal, ShieldAlert, Cpu, Play, CheckCircle2, XCircle, Clock, Zap, Target, FileText, Settings, RefreshCw, Archive, Info, Download } from "lucide-react";
import clsx from "clsx";

const MODE_META = {
  run: { icon: Play, label: "RUN", desc: "Standard workflow execution", color: "var(--color-run)" },
  test: { icon: Target, label: "TEST", desc: "Validation & verification passes", color: "var(--color-test)" },
  stress: { icon: Zap, label: "STRESS", desc: "High-load volume testing", color: "var(--color-stress)" },
  security: { icon: ShieldAlert, label: "SECURITY", desc: "Vulnerability & hardening scans", color: "var(--color-security)" },
};

interface TaskInfo {
  status: string;
  last_update?: string;
}

interface TaskDetail {
  name: string;
  docstring: string;
  status: { status?: string; last_update?: string };
  history: Array<{ status: string; timestamp: string }>;
}

export default function Home() {
  const [tasks, setTasks] = useState<Record<string, TaskInfo>>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<keyof typeof MODE_META>("run");
  const [logs, setLogs] = useState<{ id: number; text: string; time: string }[]>([]);
  const logCounter = useRef(0);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // New states for extended CLI mapping
  const [dryRun, setDryRun] = useState(false);
  const [noReports, setNoReports] = useState(false);
  const [selectedTasks, setSelectedTasks] = useState<string[]>([]);
  const [selectedTaskDetail, setSelectedTaskDetail] = useState<TaskDetail | null>(null);

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
    } catch {
      addLog("ERROR: Failed to fetch tasks geometry from APEX core.");
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    fetchTasks();
    addLog("System initialized. Awaiting commands...");
  }, []);

  useEffect(() => {
    // Auto-scroll terminal
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleRunAll = async () => {
    setRunning(true);
    addLog(`INIT: Executing Global Run [Mode: ${mode.toUpperCase()}]`);
    addLog(`PARAMS: DryRun=${dryRun}, NoReports=${noReports}, Filters=${selectedTasks.length > 0 ? selectedTasks.join(',') : 'None'}`);

    try {
      const payload = {
          mode: mode,
          dry_run: dryRun,
          no_reports: noReports,
          task_filters: selectedTasks.length > 0 ? selectedTasks : null
      };

      const res = await fetch("http://localhost:8000/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      addLog(`SUCCESS: Run cycle completed with status [${data.status}]`);
      await fetchTasks();
    } catch {
      addLog("CRITICAL: Connection severed to orchestrator core.");
    }
    setRunning(false);
  };

  const handleGlobalAction = async (endpoint: string, payload: Record<string, unknown> = {}) => {
    addLog(`ACTION: Triggering ${endpoint}...`);
    try {
      const res = await fetch(`http://localhost:8000/api/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      addLog(`RESULT: [${endpoint}] ${data.message || data.status}`);
      if (endpoint === 'reset' || endpoint === 'autofix') {
         await fetchTasks();
      }
    } catch {
      addLog(`CRITICAL: Failed action ${endpoint}`);
    }
  };

  const showTaskInfo = async (taskName: string) => {
    try {
      const res = await fetch(`http://localhost:8000/api/tasks/${taskName}`);
      const data = await res.json();
      setSelectedTaskDetail(data);
    } catch {
      addLog(`CRITICAL: Failed to load info for ${taskName}`);
    }
  };

  const toggleTaskSelection = (name: string) => {
      if (selectedTasks.includes(name)) {
          setSelectedTasks(prev => prev.filter(t => t !== name));
      } else {
          setSelectedTasks(prev => [...prev, name]);
      }
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
    } catch {
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
    } catch {
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

        {/* CONTROLS PANELS */}
        <div className="flex flex-col lg:flex-row gap-4">
          {/* RUN CONFIG */}
          <div className="glass flex items-center gap-6 p-4 rounded-xl border-white/10 w-full lg:w-1/3 text-white/80">
            <h3 className="font-bold text-white text-xs tracking-wider uppercase flex-shrink-0 mr-4">Run Config</h3>
            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer hover:text-white">
              <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} className="accent-[var(--theme-main)]" />
              DRY RUN
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer hover:text-white">
              <input type="checkbox" checked={noReports} onChange={e => setNoReports(e.target.checked)} className="accent-[var(--theme-main)]" />
              NO REPORTS
            </label>
            <div className="text-xs font-semibold text-[var(--theme-main)]">
              {selectedTasks.length > 0 ? `${selectedTasks.length} FILTERED` : "ALL TARGETS"}
            </div>
          </div>

          {/* GLOBAL ACTIONS MATRIX */}
          <div className="glass flex items-center justify-around p-4 rounded-xl border-white/10 w-full flex-wrap gap-2 text-xs uppercase font-extrabold text-white/60 tracking-wider">
             <button onClick={() => handleGlobalAction('report')} className="flex items-center gap-1.5 hover:text-white hover:bg-white/10 p-2 rounded transition-all"><FileText className="w-4 h-4 text-blue-400" /> Report</button>
             <button onClick={() => handleGlobalAction('autofix', {dry_run: dryRun})} className="flex items-center gap-1.5 hover:text-white hover:bg-white/10 p-2 rounded transition-all"><Cpu className="w-4 h-4 text-green-400" /> Autofix</button>
             <button onClick={() => handleGlobalAction('reset', {only_failed: false, backup: true})} className="flex items-center gap-1.5 hover:text-white hover:bg-white/10 p-2 rounded transition-all"><RefreshCw className="w-4 h-4 text-purple-400" /> Reset State</button>
             <button onClick={() => handleGlobalAction('export', {fmt: 'json'})} className="flex items-center gap-1.5 hover:text-white hover:bg-white/10 p-2 rounded transition-all"><Download className="w-4 h-4 text-orange-400" /> Export</button>
             <button onClick={() => handleGlobalAction('config/generate')} className="flex items-center gap-1.5 hover:text-white hover:bg-white/10 p-2 rounded transition-all"><Settings className="w-4 h-4 text-slate-400" /> Config</button>
             <button onClick={() => handleGlobalAction('maintenance/archive')} className="flex items-center gap-1.5 hover:text-white hover:bg-white/10 p-2 rounded transition-all"><Archive className="w-4 h-4 text-yellow-400" /> Archive</button>
             <button onClick={() => handleGlobalAction('maintenance/install-archiver')} className="flex items-center gap-1.5 hover:text-white hover:bg-white/10 p-2 rounded transition-all"><Clock className="w-4 h-4 text-teal-400" /> Cron Install</button>
          </div>
        </div>

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
                  {Object.entries(tasks).map(([name, info]: [string, TaskInfo], i) => (
                    <motion.div
                      key={name}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className={clsx(
                        "glass-card p-4 flex flex-col sm:flex-row justify-between sm:items-center gap-4 group transition-all",
                        selectedTasks.includes(name) ? "border-[var(--theme-main)] bg-[var(--theme-main)]/5" : ""
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <input
                           type="checkbox"
                           checked={selectedTasks.includes(name)}
                           onChange={() => toggleTaskSelection(name)}
                           className="w-4 h-4 rounded bg-white/10 border-white/20 accent-[var(--theme-main)] cursor-pointer"
                        />
                        <div>
                          <h3 className="font-bold text-base text-white mb-1 group-hover:text-[var(--theme-main)] transition-colors flex items-center gap-2">
                             {name}
                             <button onClick={() => showTaskInfo(name)} className="text-white/30 hover:text-white transition-colors" title="Task Info">
                                <Info className="w-3.5 h-3.5" />
                             </button>
                          </h3>
                          <p className="text-xs text-white/40 flex items-center gap-1 font-mono">
                            <Clock className="w-3 h-3" />
                            {info.last_update ? new Date(info.last_update as string).toLocaleString() : "TBD"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className={`badge-status badge-${info.status}`}>
                          {info.status === "PASS" && <CheckCircle2 className="w-4 h-4" />}
                          {info.status === "FAIL" && <XCircle className="w-4 h-4" />}
                          {info.status === "PENDING" && <Activity className="w-4 h-4" />}
                          {info.status as string}
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

          {/* TASK DETAILS MODAL / HOVERVIEW */}
          <AnimatePresence>
             {selectedTaskDetail && (
                <motion.div
                   initial={{ opacity: 0, scale: 0.95 }}
                   animate={{ opacity: 1, scale: 1 }}
                   exit={{ opacity: 0, scale: 0.95 }}
                   className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-md"
                   onClick={() => setSelectedTaskDetail(null)}
                >
                   <div
                      className="glass border-[var(--theme-main)] border flex flex-col max-w-2xl w-full max-h-[85vh] rounded-2xl overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.8)]"
                      onClick={e => e.stopPropagation()}
                   >
                       <div className="p-6 border-b border-white/10 flex justify-between items-center bg-white/5">
                           <h2 className="text-2xl font-black text-[var(--theme-main)] tracking-widest">{selectedTaskDetail.name}</h2>
                           <button onClick={() => setSelectedTaskDetail(null)} className="text-white/50 hover:text-white"><XCircle className="w-6 h-6" /></button>
                       </div>
                       <div className="p-6 overflow-y-auto custom-scrollbar flex flex-col gap-6">
                           <div>
                               <h3 className="text-[10px] font-black tracking-[0.2em] text-white/40 mb-2 uppercase">Docstring</h3>
                               <div className="font-mono text-sm text-white/80 bg-black/40 p-4 rounded-lg whitespace-pre-wrap border border-white/5 leading-relaxed">
                                   {selectedTaskDetail.docstring}
                               </div>
                           </div>
                           <div className="grid grid-cols-2 gap-4">
                               <div className="bg-black/40 p-4 rounded-lg border border-white/5">
                                   <h3 className="text-[10px] font-black tracking-[0.2em] text-white/40 mb-2 uppercase">Current Status</h3>
                                   <p className={`font-bold text-lg badge-${selectedTaskDetail.status.status || 'PENDING'}`}>{selectedTaskDetail.status.status || 'PENDING'}</p>
                                   <p className="text-xs text-white/50 mt-1">{selectedTaskDetail.status.last_update ? new Date(selectedTaskDetail.status.last_update).toLocaleString() : 'Never run'}</p>
                               </div>
                           </div>
                           <div>
                               <h3 className="text-[10px] font-black tracking-[0.2em] text-white/40 mb-2 uppercase">Health Trend</h3>
                               <div className="flex gap-2 p-4 bg-black/40 rounded-lg border border-white/5 flex-wrap">
                                   {selectedTaskDetail.history && selectedTaskDetail.history.length > 0 ? (
                                       selectedTaskDetail.history.map((h, i: number) => (
                                           <div key={i} className={clsx("w-6 h-6 rounded-md border flex items-center justify-center text-[10px] font-bold cursor-help", h.status === 'PASS' ? 'bg-green-500/20 border-green-500/50 text-green-400' : h.status === 'FAIL' ? 'bg-red-500/20 border-red-500/50 text-red-400' : 'bg-gray-500/20 border-gray-500/50')} title={new Date(h.timestamp as string).toLocaleString()}>
                                              {h.status === 'PASS' ? 'P' : h.status === 'FAIL' ? 'F' : '-'}
                                           </div>
                                       ))
                                   ) : (
                                       <span className="text-white/30 text-xs italic">No historical data found.</span>
                                   )}
                               </div>
                           </div>
                       </div>
                   </div>
                </motion.div>
             )}
          </AnimatePresence>

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
