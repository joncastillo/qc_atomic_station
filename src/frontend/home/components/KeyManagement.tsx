import { useState } from "react";
import { apiUrl, authHeaders } from "../api";
import type { Config } from "../api";
import type { LogLevel } from "../Home";

interface CredData {
  ok: boolean;
  cookie?: string;
  csrf?: string;
  renewed?: boolean;
  message?: string;
  statusCode?: number;
}

interface Props {
  cfg: Config;
  log: (msg: string, level?: LogLevel) => void;
  setStatus: (s: "ok" | "none" | "err") => void;
  token: string;
}

function trunc(s: string, n = 120) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

export default function KeyManagement({ cfg, log, setStatus, token }: Props) {
  const [store, setStore] = useState("default_user");
  const [suffix, setSuffix] = useState("");
  const [useOutlier, setUseOutlier] = useState(true);
  const [cred, setCred] = useState<CredData | null>(null);
  const [updating, setUpdating] = useState(false);

  function showCreds(d: CredData) {
    setCred(d);
    setStatus(d.ok ? "ok" : "none");
  }

  async function handleGetKey() {
    log(`get_key store=${store}`);
    try {
      const qs = new URLSearchParams({ store, suffix, useOutlier: String(useOutlier) });
      const r = await fetch(`${apiUrl(cfg, cfg.routes.getKey)}?${qs}`, {
        headers: authHeaders(token),
      });
      const d = await r.json() as CredData;
      showCreds(d);
      log(
        d.ok ? (d.renewed ? "renewed & loaded." : "loaded.") : (d.message ?? "not found."),
        d.ok ? "info" : "warn",
      );
    } catch (e) {
      log((e as Error).message, "err");
      setStatus("err");
    }
  }

  async function handleUpdateKey() {
    log(`update_key store=${store} endpoint=${useOutlier ? "expert" : "worker"}`);
    setStatus("none");
    setUpdating(true);
    try {
      const r = await fetch(apiUrl(cfg, cfg.routes.updateKey), {
        method: "POST",
        headers: authHeaders(token, { "Content-Type": "application/json" }),
        body: JSON.stringify({ store, suffix, useOutlier }),
      });
      const d = await r.json() as CredData;
      log(`status=${d.statusCode ?? r.status}`);
      if (d.ok) { log("key renewed."); setStatus("ok"); }
      else { log(d.message ?? "renewal failed.", "warn"); setStatus("err"); }
      showCreds(d);
    } catch (e) {
      log((e as Error).message, "err");
      setStatus("err");
    } finally {
      setUpdating(false);
    }
  }

  async function handleClear() {
    try {
      const qs = new URLSearchParams({ store, suffix });
      await fetch(`${apiUrl(cfg, cfg.routes.clear)}?${qs}`, {
        method: "DELETE",
        headers: authHeaders(token),
      });
      log("cleared.", "warn");
      setStatus("none");
      setCred(null);
    } catch (e) {
      log((e as Error).message, "err");
    }
  }

  return (
    <section className="card">
      <h2 className="card-title">Key Management</h2>
      <div className="field-group">
        <div className="input-row">
          <div>
            <label>Store Name</label>
            <input type="text" placeholder="default_user" value={store} onChange={(e) => setStore(e.target.value)} />
          </div>
          <div>
            <label>Env Suffix</label>
            <input type="text" placeholder="(optional)" value={suffix} onChange={(e) => setSuffix(e.target.value)} />
          </div>
        </div>
        <div className="checkbox-row" style={{ paddingTop: "0.25rem" }}>
          <input type="checkbox" id="key-outlier" checked={useOutlier} onChange={(e) => setUseOutlier(e.target.checked)} />
          <label htmlFor="key-outlier" className="checkbox-label">Use Outlier endpoint (expert)</label>
        </div>
        <div className="btn-group">
          <button className="btn-primary" onClick={handleGetKey}><span>⊞</span> Get Key</button>
          <button className="btn-secondary" onClick={handleUpdateKey} disabled={updating}>
            {updating ? <><span className="spinner" /> Working…</> : <><span>↻</span> Update Key</>}
          </button>
          <button className="btn-danger" onClick={handleClear}><span>✕</span> Clear</button>
        </div>
        <pre className="cred-block">
          {cred ? (
            cred.ok && cred.cookie && cred.csrf ? (
              <>
                <span className="key-label">COOKIE</span>{"  "}<span className="val">{trunc(cred.cookie)}</span>
                {cred.renewed && <span className="log-warn"> (renewed)</span>}
                {"\n"}
                <span className="key-label">CSRF  </span>{"  "}<span className="val">{trunc(cred.csrf)}</span>
              </>
            ) : (
              <span className="text-slate-500">{cred.message ?? "No credentials."}</span>
            )
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </pre>
      </div>
    </section>
  );
}
