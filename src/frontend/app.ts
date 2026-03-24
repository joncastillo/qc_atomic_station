const $ = (s: string) => document.querySelector(s) as HTMLElement;
const logArea = $("#log-area");
const credOut = $("#credential-output") as HTMLPreElement;

function esc(s: string): string { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
function ts(): string { return new Date().toLocaleTimeString("en-GB", { hour12: false }); }
function trunc(s: string, n = 120): string { return s.length > n ? s.slice(0, n) + "…" : s; }

function log(msg: string, lvl: "info" | "warn" | "err" = "info") {
    logArea.innerHTML += `<div class="log-${lvl}">[${ts()}] ${msg}</div>`;
    logArea.scrollTop = logArea.scrollHeight;
}

function setStatus(s: string) { $("#status-dot").className = `status-dot ${s}`; }

// each section has its own token / store / suffix inputs
function credParams() {
    return {
        token: ($("#cred-token") as HTMLInputElement).value.trim(),
        store: ($("#cred-store") as HTMLInputElement).value.trim() || "default_user",
        suffix: ($("#cred-suffix") as HTMLInputElement).value.trim(),
    };
}

function keyParams() {
    return {
        token: ($("#key-token") as HTMLInputElement).value.trim(),
        store: ($("#key-store") as HTMLInputElement).value.trim() || "default_user",
        suffix: ($("#key-suffix") as HTMLInputElement).value.trim(),
        useOutlier: ($("#key-outlier") as HTMLInputElement).checked,
    };
}

function wlToken(): string {
    return ($("#wl-token") as HTMLInputElement).value.trim();
}

// ── Config ──────────────────────────────────────────────────────────────────

interface Config {
    host: string;
    port: number;
    routes: {
        getKey: string;
        updateKey: string;
        storeCredential: string;
        clear: string;
        whitelist: string;
    };
}

const DEFAULT_CONFIG: Config = {
    host: "127.0.0.1",
    port: 3000,
    routes: {
        getKey:          "/api/get_key",
        updateKey:       "/api/update_key",
        storeCredential: "/api/store_credential",
        clear:           "/api/clear",
        whitelist:       "/api/whitelist",
    },
};

let cfg: Config = DEFAULT_CONFIG;

function api(route: string) {
    if (!cfg.host || cfg.host === "127.0.0.1" || cfg.host === "localhost") return route;
    return `http://${cfg.host}:${cfg.port}${route}`;
}

function auth(token: string, extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${token}`, ...extra };
}

async function loadConfig() {
    try {
        const r = await fetch("/config.json");
        cfg = await r.json();
        log(`backend → ${cfg.host}:${cfg.port}`);
    } catch {
        log("config.json not found, using defaults.", "warn");
    }
}

// ── UI helpers ──────────────────────────────────────────────────────────────

function showCreds(data: { ok: boolean; cookie?: string; csrf?: string; renewed?: boolean; message?: string }) {
    if (data.ok && data.cookie && data.csrf) {
        const tag = data.renewed ? ' <span class="log-warn">(renewed)</span>' : "";
        credOut.innerHTML =
            `<span class="key-label">COOKIE</span>  <span class="val">${esc(trunc(data.cookie))}</span>\n` +
            `<span class="key-label">CSRF  </span>  <span class="val">${esc(trunc(data.csrf))}</span>${tag}`;
        credOut.classList.remove("hidden");
        setStatus("ok");
    } else {
        credOut.innerHTML = `<span class="text-slate-500">${esc(data.message || "No credentials.")}</span>`;
        credOut.classList.remove("hidden");
        setStatus("none");
    }
}

function withSpinner(btn: HTMLButtonElement, fn: () => Promise<void>) {
    return async () => {
        const orig = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner"></span>Working…`;
        try { await fn(); }
        finally { btn.disabled = false; btn.innerHTML = orig; }
    };
}

// ── Store Credentials ───────────────────────────────────────────────────────

$("#btn-store-cred").addEventListener("click", withSpinner($("#btn-store-cred") as HTMLButtonElement, async () => {
    const email = ($("#cred-email") as HTMLInputElement).value.trim();
    const pass = ($("#cred-password") as HTMLInputElement).value.trim();
    if (!email || !pass) { log("email & password required.", "warn"); return; }

    const p = credParams();
    log(`store_credential email=${email} store=${p.store}`);

    try {
        const r = await fetch(api(cfg.routes.storeCredential), {
            method: "POST",
            headers: auth(p.token, { "Content-Type": "application/json" }),
            body: JSON.stringify({ email, password: pass, store: p.store, suffix: p.suffix }),
        });
        const d = await r.json();
        log(d.ok ? "credentials encrypted & stored." : (d.message || "failed."), d.ok ? "info" : "err");
    } catch (e: unknown) { log((e as Error).message, "err"); }
}));

// ── Get Key ─────────────────────────────────────────────────────────────────

$("#btn-get-key").addEventListener("click", async () => {
    const p = keyParams();
    log(`get_key store=${p.store}`);
    try {
        const qs = new URLSearchParams({ store: p.store, suffix: p.suffix, useOutlier: String(p.useOutlier) });
        const r = await fetch(`${api(cfg.routes.getKey)}?${qs}`, { headers: auth(p.token) });
        const d = await r.json();
        showCreds(d);
        log(d.ok ? (d.renewed ? "renewed & loaded." : "loaded.") : (d.message || "not found."), d.ok ? "info" : "warn");
    } catch (e: unknown) { log((e as Error).message, "err"); setStatus("err"); }
});

// ── Renew Key (update_key) ──────────────────────────────────────────────────

$("#btn-renew-key").addEventListener("click", withSpinner($("#btn-renew-key") as HTMLButtonElement, async () => {
    const p = keyParams();
    log(`update_key store=${p.store} endpoint=${p.useOutlier ? "expert" : "worker"}`);
    setStatus("none");

    try {
        const r = await fetch(api(cfg.routes.updateKey), {
            method: "POST",
            headers: auth(p.token, { "Content-Type": "application/json" }),
            body: JSON.stringify({ store: p.store, suffix: p.suffix, useOutlier: p.useOutlier }),
        });
        const d = await r.json();
        log(`status=${d.statusCode ?? r.status}`, "info");

        if (d.ok) { log("key renewed.", "info"); setStatus("ok"); }
        else { log(d.message || "renewal failed.", "warn"); setStatus("err"); }

        showCreds(d);
    } catch (e: unknown) { log((e as Error).message, "err"); setStatus("err"); }
}));

// ── Clear ───────────────────────────────────────────────────────────────────

$("#btn-clear").addEventListener("click", async () => {
    const p = keyParams();
    try {
        const qs = new URLSearchParams({ store: p.store, suffix: p.suffix });
        await fetch(`${api(cfg.routes.clear)}?${qs}`, { method: "DELETE", headers: auth(p.token) });
        log("cleared.", "warn");
        setStatus("none");
        credOut.classList.add("hidden");
    } catch (e: unknown) { log((e as Error).message, "err"); }
});

// ── Whitelist ───────────────────────────────────────────────────────────────

async function fetchWhitelist() {
    try {
        const t = wlToken();
        const d = await (await fetch(api(cfg.routes.whitelist), { headers: auth(t) })).json();
        ($("#wl-enabled") as HTMLInputElement).checked = d.enabled;
        ($("#wl-ips") as HTMLTextAreaElement).value = (d.ips || []).join("\n");
        ($("#wl-macs") as HTMLTextAreaElement).value = (d.macs || []).join("\n");
    } catch { /* first load, token might be empty */ }
}

$("#btn-save-wl").addEventListener("click", async () => {
    const t = wlToken();
    const body = {
        enabled: ($("#wl-enabled") as HTMLInputElement).checked,
        ips: ($("#wl-ips") as HTMLTextAreaElement).value.split("\n").map(s => s.trim()).filter(Boolean),
        macs: ($("#wl-macs") as HTMLTextAreaElement).value.split("\n").map(s => s.trim()).filter(Boolean),
    };
    try {
        const d = await (await fetch(api(cfg.routes.whitelist), {
            method: "PUT",
            headers: auth(t, { "Content-Type": "application/json" }),
            body: JSON.stringify(body),
        })).json();
        log(`whitelist saved. enabled=${d.enabled} ips=${d.ips.length} macs=${d.macs.length}`);
    } catch (e: unknown) { log(`whitelist error: ${(e as Error).message}`, "err"); }
});

// ── Init ────────────────────────────────────────────────────────────────────

async function init() {
    await loadConfig();
    await fetchWhitelist();
}

init();
