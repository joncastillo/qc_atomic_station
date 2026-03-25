export interface Config {
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

export const DEFAULT_CONFIG: Config = {
  host: "127.0.0.1",
  port: 5000,
  routes: {
    getKey: "/api/get_key",
    updateKey: "/api/update_key",
    storeCredential: "/api/store_credential",
    clear: "/api/clear",
    whitelist: "/api/whitelist",
  },
};

export async function loadConfig(): Promise<Config> {
  try {
    const r = await fetch("/config.json");
    if (!r.ok) return DEFAULT_CONFIG;
    return (await r.json()) as Config;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function apiUrl(cfg: Config, route: string): string {
  if (!cfg.host || cfg.host === "127.0.0.1" || cfg.host === "localhost") return route;
  return `https://${cfg.host}:${cfg.port}${route}`;
}

export function authHeaders(
  token: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return { Authorization: `Bearer ${token}`, ...extra };
}
