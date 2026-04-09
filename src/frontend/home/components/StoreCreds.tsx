import { useState } from "react";
import { apiUrl, authHeaders } from "../api";
import type { Config } from "../api";
import type { LogLevel } from "../Home";

interface Props {
  cfg: Config;
  log: (msg: string, level?: LogLevel) => void;
  token: string;
}

export default function StoreCreds({ cfg, log, token }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [store, setStore] = useState("default_user");
  const [suffix, setSuffix] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleStore() {
    if (!email || !password) { log("email & password required.", "warn"); return; }
    log(`store_credential email=${email} store=${store}`);
    setLoading(true);
    try {
      const r = await fetch(apiUrl(cfg, cfg.routes.storeCredential), {
        method: "POST",
        headers: authHeaders(token, { "Content-Type": "application/json" }),
        body: JSON.stringify({ email, password, store, suffix }),
      });
      const d = await r.json() as { ok: boolean; message?: string };
      log(d.ok ? "credentials encrypted & stored." : (d.message ?? "failed."), d.ok ? "info" : "err");
    } catch (e) {
      log((e as Error).message, "err");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card">
      <h2 className="card-title">Store Credentials</h2>
      <div className="field-group">
        <div>
          <label>Email</label>
          <input type="email" placeholder="you@outlier.ai" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </div>
        <div>
          <label>Password</label>
          <input type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
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
        <div className="btn-group">
          <button className="btn-primary" onClick={handleStore} disabled={loading}>
            {loading ? <><span className="spinner" /> Working…</> : <><span>⊞</span> Store Credentials</>}
          </button>
        </div>
      </div>
    </section>
  );
}
