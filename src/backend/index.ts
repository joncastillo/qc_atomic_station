import "dotenv/config";
import express from "express";
import path from "path";
import crypto from "crypto";
import { OutlierCredentialsManager } from "./OutlierCredentialsManager.js";
import { deviceWhitelist, loadWhitelist, saveWhitelist } from "./whitelist.js";

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(import.meta.dirname, "../..");

// ── Auth token ───────────────────────────────────────────────────────────────

const ACCESS_TOKEN = process.env.ACCESS_TOKEN ?? crypto.randomBytes(16).toString("hex");
if (!process.env.ACCESS_TOKEN) console.log(`[auth] ACCESS_TOKEN: ${ACCESS_TOKEN}`);

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(deviceWhitelist);
app.use(express.static(path.join(ROOT, "public")));
app.use(express.static(path.join(ROOT, "dist", "public")));

app.use("/api", (req, res, next) => {
  if (req.headers["authorization"] !== `Bearer ${ACCESS_TOKEN}`) {
    res.status(401).json({ ok: false, message: "Unauthorized." });
    return;
  }
  next();
});

// ── GET /api/get_key ─────────────────────────────────────────────────────────
// Returns stored cookie/csrf. If missing, tries to renew via stored credentials.

app.get("/api/get_key", async (req, res) => {
  const store = (req.query.store as string) || "default_user";
  const suffix = (req.query.suffix as string) || "";
  const useOutlier = req.query.useOutlier !== "false";
  const mgr = new OutlierCredentialsManager(store, "./env", suffix);

  if (mgr.hasCredentials()) {
    res.json({ ok: true, cookie: mgr.getCookie(), csrf: mgr.getCsrf() });
    return;
  }

  // try to renew
  const result = await mgr.loginWithStoredCredentials(useOutlier);
  if (!result || !result.cookie) {
    res.json({ ok: false, message: "No session and no stored credentials to renew with." });
    return;
  }

  res.json({ ok: true, cookie: result.cookie, csrf: result.csrf, renewed: true });
});

// ── POST /api/store_credential ───────────────────────────────────────────────
// Encrypts and persists email + password. Overwrites if they already exist.

app.post("/api/store_credential", (req, res) => {
  const { email, password, store, suffix } = req.body;

  if (!email || !password) {
    res.status(400).json({ ok: false, message: "Email and password required." });
    return;
  }

  const mgr = new OutlierCredentialsManager(store || "default_user", "./env", suffix || "");
  try {
    mgr.storeCredentials(email, password);
    res.json({ ok: true, message: "Credentials stored." });
  } catch (err: unknown) {
    res.status(500).json({ ok: false, message: err instanceof Error ? err.message : String(err) });
  }
});

// ── POST /api/update_key ─────────────────────────────────────────────────────
// Decrypts stored credentials, logs in, stores the resulting cookie/csrf.

app.post("/api/update_key", async (req, res) => {
  const { store, suffix, useOutlier } = req.body;
  const mgr = new OutlierCredentialsManager(store || "default_user", "./env", suffix || "");

  const result = await mgr.loginWithStoredCredentials(useOutlier ?? true);
  if (!result) {
    res.status(400).json({ ok: false, message: "No stored credentials. Call /api/store_credential first." });
    return;
  }

  res.json({
    ok: !!(result.cookie && result.csrf),
    statusCode: result.statusCode,
    cookie: result.cookie || null,
    csrf: result.csrf || null,
    body: result.body,
  });
});

// ── DELETE /api/clear ────────────────────────────────────────────────────────
// Wipes credentials + session for a given store/suffix.

app.delete("/api/clear", (req, res) => {
  const store = (req.query.store as string) || "default_user";
  const suffix = (req.query.suffix as string) || "";
  new OutlierCredentialsManager(store, "./env", suffix).clear();
  res.json({ ok: true, message: "Cleared." });
});

// ── GET/PUT /api/whitelist ───────────────────────────────────────────────────

app.get("/api/whitelist", (_req, res) => {
  res.json(loadWhitelist());
});

app.put("/api/whitelist", (req, res) => {
  const { enabled, ips, macs } = req.body;
  const current = loadWhitelist();
  saveWhitelist({
    enabled: enabled ?? current.enabled,
    ips: ips ?? current.ips,
    macs: (macs ?? current.macs).map((m: string) => m.toLowerCase()),
  });
  res.json({ ok: true, ...loadWhitelist() });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`qc_atomic_station → http://0.0.0.0:${PORT}`);
});
