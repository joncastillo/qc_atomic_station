import fs from "fs";
import path from "path";
import crypto from "crypto";
import dotenv from "dotenv";

export interface LoginResult {
  statusCode: number;
  body: unknown;
  cookie: string;
  csrf: string;
}

// ── Encryption (AES-256-GCM, key from SSH private key) ──────────────────────

const ALGO = "aes-256-gcm";

function deriveKey(sshKeyPath: string, salt: string): Buffer {
  if (!fs.existsSync(sshKeyPath)) throw new Error(`SSH key not found: ${sshKeyPath}`);
  return crypto.pbkdf2Sync(fs.readFileSync(sshKeyPath), salt, 100_000, 32, "sha512");
}

function encrypt(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(b => b.toString("base64")).join(":");
}

function decrypt(packed: string, key: Buffer): string {
  const [iv, tag, data] = packed.split(":").map(s => Buffer.from(s, "base64"));
  if (!iv || !tag || !data) throw new Error("Malformed encrypted value");
  const d = crypto.createDecipheriv(ALGO, key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}

// ── Env file helpers ─────────────────────────────────────────────────────────

function readEnv(filepath: string): Record<string, string> {
  return fs.existsSync(filepath) ? dotenv.parse(fs.readFileSync(filepath)) : {};
}

function writeEnv(filepath: string, data: Record<string, string>) {
  const lines = Object.entries(data)
      .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`)
      .join("\n");
  fs.writeFileSync(filepath, lines + "\n");
}

// ── Manager ──────────────────────────────────────────────────────────────────

export class OutlierCredentialsManager {
  static readonly OUTLIER_BASE_URL = "https://app.outlier.ai";
  static readonly REMOTASKS_BASE_URL = "https://www.remotasks.com";

  private readonly envPath: string;
  private readonly store: string;
  private suffix: string;
  private cookie: string | null = null;
  private csrf: string | null = null;

  constructor(store = "default_user", folder = "./env", suffix = "") {
    this.store = store;
    this.suffix = suffix;
    this.envPath = path.join(folder, `${store}.env`);
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    this.loadSession();
  }

  // key("COOKIE") → "COOKIE" or "COOKIE_prod"
  private key(name: string) {
    return this.suffix ? `${name}_${this.suffix}` : name;
  }

  private get salt() {
    return `outlier-creds:${this.store}:${this.suffix}`;
  }

  private sshKey(override?: string) {
    if (override) return deriveKey(override, this.salt);
    const sshDir = path.join(process.env.HOME ?? process.env.USERPROFILE ?? "~", ".ssh");
    for (const name of ["id_rsa", "id_ed25519", "id_ecdsa", "id_ecdsa_sk", "id_ed25519_sk"]) {
      const p = path.join(sshDir, name);
      if (fs.existsSync(p)) return deriveKey(p, this.salt);
    }
    throw new Error(`No SSH private key found in ${sshDir}`);
  }

  // ── Session ────────────────────────────────────────────────────────────

  private loadSession() {
    const cfg = readEnv(this.envPath);
    this.cookie = cfg[this.key("COOKIE")] ?? null;
    this.csrf = cfg[this.key("CSRF")] ?? null;
  }

  private saveSession(_username: string, cookie: string, csrf: string) {
    const cfg = readEnv(this.envPath);
    cfg[this.key("COOKIE")] = cookie;
    cfg[this.key("CSRF")] = csrf;
    writeEnv(this.envPath, cfg);
  }

  getCookie() { return this.cookie; }
  getCsrf() { return this.csrf; }
  getEnvPath() { return this.envPath; }
  hasCredentials() { return !!(this.cookie && this.csrf); }

  setSuffix(s: string) {
    this.suffix = s;
    this.loadSession();
  }

  // ── Credential storage ─────────────────────────────────────────────────

  storeCredentials(email: string, password: string, sshKeyPath?: string) {
    const k = this.sshKey(sshKeyPath);
    const cfg = readEnv(this.envPath);
    cfg[this.key("ENC_EMAIL")] = encrypt(email, k);
    cfg[this.key("ENC_PASSWORD")] = encrypt(password, k);
    writeEnv(this.envPath, cfg);
  }

  getStoredCredentials(sshKeyPath?: string) {
    const cfg = readEnv(this.envPath);
    const enc = cfg[this.key("ENC_EMAIL")];
    const pwd = cfg[this.key("ENC_PASSWORD")];
    if (!enc || !pwd) return null;

    try {
      const k = this.sshKey(sshKeyPath);
      return { email: decrypt(enc, k), password: decrypt(pwd, k) };
    } catch (err) {
      console.error("[credentials] decryption failed:", err);
      return null;
    }
  }

  clear() {
    const cfg = readEnv(this.envPath);
    for (const name of ["COOKIE", "CSRF", "ENC_EMAIL", "ENC_PASSWORD"]) {
      delete cfg[this.key(name)];
    }
    writeEnv(this.envPath, cfg);
    this.cookie = null;
    this.csrf = null;
  }

  // ── HTTP ───────────────────────────────────────────────────────────────

  private async request(
      method: string, endpoint: string,
      data?: Record<string, unknown>, useOutlier = true, attempt = 1,
  ): Promise<Response | null> {
    const base = useOutlier
        ? OutlierCredentialsManager.OUTLIER_BASE_URL
        : OutlierCredentialsManager.REMOTASKS_BASE_URL;
    const url = `${base}${endpoint}`;

    const headers: Record<string, string> = {
      "accept": "*/*",
      "accept-language": "en-US,en-GB;q=0.9,en;q=0.8",
      "cache-control": "no-cache",
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    };

    try {
      const opts: RequestInit = { method, headers };
      if (data) opts.body = JSON.stringify(data);
      const resp = await fetch(url, opts);
      if (resp.status >= 500) console.error(`[request] ${resp.status} ${resp.statusText}`);
      return resp;
    } catch (err) {
      console.error(`[request] network error:`, err);
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, Math.min(2 ** attempt * 1000, 10_000)));
        return this.request(method, endpoint, data, useOutlier, attempt + 1);
      }
      return null;
    }
  }

  // ── Login ──────────────────────────────────────────────────────────────

  private parseCookies(resp: Response): Record<string, string> {
    const jar: Record<string, string> = {};
    const raw: string[] = resp.headers.getSetCookie?.() ?? [];
    if (!raw.length) {
      const h = resp.headers.get("set-cookie");
      if (h) raw.push(...h.split(/,(?=\s*\w+=)/));
    }
    for (const entry of raw) {
      const pair = entry.split(";")[0] ?? "";
      const eq = pair.indexOf("=");
      if (eq > 0) jar[pair.substring(0, eq).trim()] = pair.substring(eq + 1).trim();
    }
    return jar;
  }

  private async doLogin(email: string, password: string, useOutlier: boolean): Promise<LoginResult | null> {
    const endpoint = useOutlier ? "/internal/loginNext/expert" : "/internal/loginNext/worker";
    const resp = await this.request("POST", endpoint, { email, password }, useOutlier);
    if (!resp) return null;

    let body: unknown = null;
    try { body = await resp.json(); } catch { /* empty */ }

    const jar = this.parseCookies(resp);
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
    const csrf = decodeURIComponent(jar["_csrf"] ?? "");

    if (cookie) {
      this.saveSession(email, cookie, csrf);
      this.loadSession();
    }

    return { statusCode: resp.status, body, cookie, csrf };
  }

  // two clear entry points, no overload gymnastics
  async login(email: string, password: string, useOutlier = true) {
    return this.doLogin(email, password, useOutlier);
  }

  async loginWithStoredCredentials(useOutlier = true, sshKeyPath?: string) {
    const creds = this.getStoredCredentials(sshKeyPath);
    if (!creds) {
      console.error(`[login] no stored credentials (suffix="${this.suffix}"). Call storeCredentials() first.`);
      return null;
    }
    return this.doLogin(creds.email, creds.password, useOutlier);
  }
}
