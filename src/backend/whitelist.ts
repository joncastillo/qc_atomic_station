import type {Request, Response, NextFunction} from "express";
import { execSync } from "child_process";
import { matches } from "ip-matching";
import fs from "fs";
import path from "path";

interface WhitelistConfig {
  enabled: boolean;
  ips: string[];
  macs: string[];
}

const CONFIG_PATH = path.resolve("./whitelist.json");

const DEFAULT_CONFIG: WhitelistConfig = {
  enabled: false,
  ips: ["127.0.0.1", "::1", "::ffff:127.0.0.1"],
  macs: [],
};

export function loadWhitelist(): WhitelistConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return DEFAULT_CONFIG;
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveWhitelist(config: WhitelistConfig) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function arpLookup(ip: string): string | null {
  try {
    const clean = ip.replace("::ffff:", "");
    const output = execSync(`arp -n ${clean} 2>/dev/null || arp -a ${clean} 2>/dev/null`, {
      encoding: "utf-8",
      timeout: 3000,
    });
    const match = output.match(/([0-9a-f]{2}[:-]){5}[0-9a-f]{2}/i);
    return match ? match[0].toLowerCase().replace(/-/g, ":") : null;
  } catch {
    return null;
  }
}

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0]?.trim() ?? forwarded.trim();
  return req.socket.remoteAddress ?? "unknown";
}

const LOCALHOST = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];

function isLocalhost(ip: string): boolean {
  return LOCALHOST.some(l => ip === l || ip === `::ffff:${l}`);
}

function checkIp(clientIp: string, allowedIps: string[]): boolean {
  if (allowedIps.length === 0) return true;
  const normalized = clientIp.replace("::ffff:", "");
  return allowedIps.some(pattern => {
    const normalizedPattern = pattern.replace("::ffff:", "");
    try {
      return matches(normalized, normalizedPattern);
    } catch {
      // Fall back to exact match if pattern is invalid
      return clientIp === pattern || clientIp === `::ffff:${pattern}`;
    }
  });
}

function checkMac(clientIp: string, allowedMacs: string[]): boolean {
  if (allowedMacs.length === 0) return true;
  const mac = arpLookup(clientIp);
  if (mac && !allowedMacs.includes(mac)) return false;
  return true;
}

export function deviceWhitelist(req: Request, res: Response, next: NextFunction) {
  const config = loadWhitelist();
  const clientIp = getClientIp(req);

  if (req.path === "/api/whitelist") {
    if (isLocalhost(clientIp)) return next();
    res.status(403).json({ ok: false, message: "Whitelist admin is localhost-only." });
    return;
  }

  if (!config.enabled) {
    if (isLocalhost(clientIp)) return next();
    console.warn(`[whitelist] disabled — blocked non-local IP: ${clientIp}`);
    res.status(403).json({ ok: false, message: "Access restricted to localhost." });
    return;
  }

  if (!checkIp(clientIp, config.ips)) {
    console.warn(`[whitelist] blocked IP: ${clientIp}`);
    res.status(403).json({ ok: false, message: `IP ${clientIp} not whitelisted.` });
    return;
  }

  if (!checkMac(clientIp, config.macs)) {
    const mac = arpLookup(clientIp);
    console.warn(`[whitelist] blocked MAC: ${mac} (IP: ${clientIp})`);
    res.status(403).json({ ok: false, message: "Device not whitelisted." });
    return;
  }

  next();
}
