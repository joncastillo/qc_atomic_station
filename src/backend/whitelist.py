import ipaddress
import json
import logging
import re
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)

CONFIG_PATH = Path("./whitelist.json")
LOCALHOST = {"127.0.0.1", "::1", "::ffff:127.0.0.1"}

DEFAULT_CONFIG: dict = {
    "enabled": False,
    "ips": ["127.0.0.1", "::1", "::ffff:127.0.0.1"],
    "macs": [],
}


def load_whitelist() -> dict:
    if not CONFIG_PATH.exists():
        CONFIG_PATH.write_text(json.dumps(DEFAULT_CONFIG, indent=2))
        return DEFAULT_CONFIG.copy()
    try:
        return json.loads(CONFIG_PATH.read_text())
    except Exception:
        return DEFAULT_CONFIG.copy()


def save_whitelist(config: dict) -> None:
    CONFIG_PATH.write_text(json.dumps(config, indent=2))


def _arp_lookup(ip: str) -> str | None:
    try:
        clean = ip.replace("::ffff:", "")
        result = subprocess.run(["arp", "-n", clean], capture_output=True, text=True, timeout=3)
        if result.returncode != 0:
            result = subprocess.run(["arp", "-a", clean], capture_output=True, text=True, timeout=3)
        match = re.search(r"([0-9a-f]{2}[:-]){5}[0-9a-f]{2}", result.stdout, re.IGNORECASE)
        return match.group(0).lower().replace("-", ":") if match else None
    except Exception:
        return None


def _is_localhost(ip: str) -> bool:
    return ip in LOCALHOST or f"::ffff:{ip}" in LOCALHOST


def _check_ip(client_ip: str, allowed_ips: list[str]) -> bool:
    if not allowed_ips:
        return True
    normalized = client_ip.replace("::ffff:", "")
    for pattern in allowed_ips:
        norm_pattern = pattern.replace("::ffff:", "")
        try:
            if ipaddress.ip_address(normalized) in ipaddress.ip_network(norm_pattern, strict=False):
                return True
        except ValueError:
            if client_ip == pattern or client_ip == f"::ffff:{pattern}":
                return True
    return False


def _check_mac(client_ip: str, allowed_macs: list[str]) -> bool:
    if not allowed_macs:
        return True
    mac = _arp_lookup(client_ip)
    if mac and mac not in allowed_macs:
        return False
    return True


def check_whitelist(client_ip: str, path: str) -> tuple[bool, str]:
    config = load_whitelist()

    if not config["enabled"]:
        if _is_localhost(client_ip):
            return True, ""
        logger.warning("[whitelist] disabled — blocked non-local IP: %s", client_ip)
        return False, "Access restricted to localhost."

    if not _check_ip(client_ip, config["ips"]):
        logger.warning("[whitelist] blocked IP: %s", client_ip)
        return False, f"IP {client_ip} not whitelisted."

    if not _check_mac(client_ip, config["macs"]):
        mac = _arp_lookup(client_ip)
        logger.warning("[whitelist] blocked MAC: %s (IP: %s)", mac, client_ip)
        return False, "Device not whitelisted."

    return True, ""
