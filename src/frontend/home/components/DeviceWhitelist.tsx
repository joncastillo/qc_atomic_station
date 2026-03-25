import { useState } from "react";
import { apiUrl, authHeaders } from "../api";
import type { Config } from "../api";
import type { LogLevel } from "../Home";

interface Props {
  cfg: Config;
  log: (msg: string, level?: LogLevel) => void;
  token: string;
}

export default function DeviceWhitelist({ cfg, log, token }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [ips, setIps] = useState("");
  const [macs, setMacs] = useState("");

  async function fetchWhitelist() {
    try {
      const r = await fetch(apiUrl(cfg, cfg.routes.whitelist), { headers: authHeaders(token) });
      const d = await r.json() as { enabled: boolean; ips: string[]; macs: string[]; message?: string };
      if (!r.ok) { log(d.message ?? `load failed (${r.status})`, "err"); return; }
      setEnabled(d.enabled);
      setIps((d.ips ?? []).join("\n"));
      setMacs((d.macs ?? []).join("\n"));
      log("whitelist loaded.");
    } catch (e) {
      log(`whitelist error: ${(e as Error).message}`, "err");
    }
  }

  async function handleSave() {
    const body = {
      enabled,
      ips: ips.split("\n").map((s) => s.trim()).filter(Boolean),
      macs: macs.split("\n").map((s) => s.trim()).filter(Boolean),
    };
    try {
      const d = await (
        await fetch(apiUrl(cfg, cfg.routes.whitelist), {
          method: "PUT",
          headers: authHeaders(token, { "Content-Type": "application/json" }),
          body: JSON.stringify(body),
        })
      ).json() as { enabled: boolean; ips: string[]; macs: string[] };
      log(`whitelist saved. enabled=${d.enabled} ips=${d.ips.length} macs=${d.macs.length}`);
    } catch (e) {
      log(`whitelist error: ${(e as Error).message}`, "err");
    }
  }

  return (
    <section className="card">
      <h2 className="card-title">Device Whitelist</h2>
      <div className="field-group">
        <div className="checkbox-row">
          <input type="checkbox" id="wl-enabled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <label htmlFor="wl-enabled" className="checkbox-label">Enable whitelist</label>
        </div>
        <div>
          <label>Allowed IPs <span className="field-hint">(one per line)</span></label>
          <textarea rows={3} placeholder={"127.0.0.1\n192.168.1.100"} value={ips} onChange={(e) => setIps(e.target.value)} />
        </div>
        <div>
          <label>Allowed MACs <span className="field-hint">(one per line)</span></label>
          <textarea rows={2} placeholder="aa:bb:cc:dd:ee:ff" value={macs} onChange={(e) => setMacs(e.target.value)} />
        </div>
        <div className="btn-group">
          <button className="btn-secondary" onClick={fetchWhitelist}><span>↓</span> Load</button>
          <button className="btn-primary" onClick={handleSave}><span>✓</span> Save Whitelist</button>
        </div>
      </div>
    </section>
  );
}
