import { useState, useEffect, useCallback } from "react";
import { loadConfig, DEFAULT_CONFIG } from "./api";
import type { Config } from "./api";
import StoreCreds from "./components/StoreCreds";
import KeyManagement from "./components/KeyManagement";
import DeviceWhitelist from "./components/DeviceWhitelist";
import LogPanel from "./components/LogPanel";

export type LogLevel = "info" | "warn" | "err";
export type LogEntry = { text: string; level: LogLevel; ts: string };

function ts() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

export default function Home() {
  const [cfg, setCfg] = useState<Config>(DEFAULT_CONFIG);
  const [logs, setLogs] = useState<LogEntry[]>([{ text: "ready.", level: "info", ts: ts() }]);
  const [status, setStatus] = useState<"ok" | "none" | "err">("none");
  const [token, setToken] = useState("");

  const log = useCallback((text: string, level: LogLevel = "info") => {
    setLogs((prev) => [...prev, { text, level, ts: ts() }]);
  }, []);

  useEffect(() => {
    loadConfig().then((c) => {
      setCfg(c);
      log(`backend → ${c.host}:${c.port}`);
    });
  }, [log]);

  return (
    <>
      <header>
        <div className="header-icon">☢</div>
        <h1>qc_atomic_station</h1>
        <input
          type="password"
          className="header-token"
          placeholder="access token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
        />
        <span className="header-badge">credentials</span>
      </header>
      <div className="page-wrapper">
        <StoreCreds cfg={cfg} log={log} token={token} />
        <KeyManagement cfg={cfg} log={log} setStatus={setStatus} token={token} />
        <DeviceWhitelist cfg={cfg} log={log} token={token} />
        <LogPanel logs={logs} status={status} />
      </div>
    </>
  );
}
