import { useState, useEffect, useCallback, useRef } from "react";
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (!video || !overlay) return;

    const FADE_SECS = 1.5;
    let rafId: number;

    const tick = () => {
      const dur = video.duration;
      if (dur) {
        const t = video.currentTime;
        // overlay opacity: 1 = dark (hides video), 0 = transparent (video visible)
        let opacity = 0;
        if (t < FADE_SECS) opacity = 1 - t / FADE_SECS;
        else if (t > dur - FADE_SECS) opacity = (t - (dur - FADE_SECS)) / FADE_SECS;
        overlay.style.opacity = String(Math.max(0, Math.min(1, opacity)));
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <>
      <video
        ref={videoRef}
        autoPlay
        loop
        muted
        playsInline
        className="bg-video"
        src="/k_baby_octopus.mp4"
        //src="/k_deep_sea_octopus.mp4"
        //src="/f_deep_sea_octopus.mp4"
      />
      <div ref={overlayRef} className="video-overlay" />
      <div className="header-fade" />
      <header>
        <div className="header-icon">☢</div>
        <h1>qc_atomic_station</h1>
        <span className="header-badge">credentials</span>
        <input
          type="password"
          className="header-token"
          placeholder="Enter Access Token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
        />

      </header>
      <div className="page-wrapper">
        <div className="left-col">
          <StoreCreds cfg={cfg} log={log} token={token} />
          <KeyManagement cfg={cfg} log={log} setStatus={setStatus} token={token} />
          <DeviceWhitelist cfg={cfg} log={log} token={token} />
        </div>
        <LogPanel logs={logs} status={status} />
      </div>
    </>
  );
}
