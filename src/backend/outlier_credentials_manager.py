import asyncio
import base64
import logging
import os
from pathlib import Path
from urllib.parse import unquote

import httpx
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from dotenv import dotenv_values

logger = logging.getLogger(__name__)

OUTLIER_BASE_URL = "https://app.outlier.ai"
REMOTASKS_BASE_URL = "https://www.remotasks.com"

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def _derive_key(ssh_key_path: str, salt: str) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA512(), length=32, salt=salt.encode(), iterations=100_000)
    return kdf.derive(Path(ssh_key_path).read_bytes())


def _encrypt(plaintext: str, key: bytes) -> str:
    iv = os.urandom(16)
    encryptor = Cipher(algorithms.AES(key), modes.GCM(iv)).encryptor()
    ct = encryptor.update(plaintext.encode()) + encryptor.finalize()
    tag = encryptor.tag
    return ":".join(base64.b64encode(x).decode() for x in [iv, tag, ct])


def _decrypt(packed: str, key: bytes) -> str:
    iv_b, tag_b, ct_b = [base64.b64decode(p) for p in packed.split(":")]
    decryptor = Cipher(algorithms.AES(key), modes.GCM(iv_b, tag_b)).decryptor()
    return (decryptor.update(ct_b) + decryptor.finalize()).decode()


def _read_env(filepath: str) -> dict[str, str]:
    if not Path(filepath).exists():
        return {}
    return {k: v for k, v in dotenv_values(filepath).items() if v is not None}


def _write_env(filepath: str, data: dict[str, str]) -> None:
    content = "\n".join(
        '{}="{}"'.format(k, v.replace('"', '\\"')) for k, v in data.items()
    ) + "\n"
    Path(filepath).write_text(content)


class OutlierCredentialsManager:
    def __init__(self, store: str = "default_user", folder: str = "./env", suffix: str = ""):
        self.store = store
        self.suffix = suffix
        self.env_path = str(Path(folder) / f"{store}.env")
        Path(folder).mkdir(parents=True, exist_ok=True)
        self._cookie: str | None = None
        self._csrf: str | None = None
        self._load_session()

    def _key(self, name: str) -> str:
        return f"{name}_{self.suffix}" if self.suffix else name

    @property
    def _salt(self) -> str:
        return f"outlier-creds:{self.store}:{self.suffix}"

    def _ssh_key(self, override: str | None = None) -> bytes:
        if override:
            return _derive_key(override, self._salt)
        ssh_dir = (
            Path(os.environ.get("HOME") or os.environ.get("USERPROFILE") or "~").expanduser() / ".ssh"
        )
        for name in ["id_rsa", "id_ed25519", "id_ecdsa", "id_ecdsa_sk", "id_ed25519_sk"]:
            p = ssh_dir / name
            if p.exists():
                return _derive_key(str(p), self._salt)
        raise FileNotFoundError(f"No SSH private key found in {ssh_dir}")

    def _load_session(self) -> None:
        cfg = _read_env(self.env_path)
        self._cookie = cfg.get(self._key("COOKIE"))
        self._csrf = cfg.get(self._key("CSRF"))

    def _save_session(self, cookie: str, csrf: str) -> None:
        cfg = _read_env(self.env_path)
        cfg[self._key("COOKIE")] = cookie
        cfg[self._key("CSRF")] = csrf
        _write_env(self.env_path, cfg)

    def get_cookie(self) -> str | None:
        return self._cookie

    def get_csrf(self) -> str | None:
        return self._csrf

    def has_credentials(self) -> bool:
        return bool(self._cookie and self._csrf)

    def store_credentials(self, email: str, password: str, ssh_key_path: str | None = None) -> None:
        k = self._ssh_key(ssh_key_path)
        cfg = _read_env(self.env_path)
        cfg[self._key("ENC_EMAIL")] = _encrypt(email, k)
        cfg[self._key("ENC_PASSWORD")] = _encrypt(password, k)
        _write_env(self.env_path, cfg)

    def get_stored_credentials(self, ssh_key_path: str | None = None) -> dict[str, str] | None:
        cfg = _read_env(self.env_path)
        enc_email = cfg.get(self._key("ENC_EMAIL"))
        enc_pwd = cfg.get(self._key("ENC_PASSWORD"))
        if not enc_email or not enc_pwd:
            return None
        try:
            k = self._ssh_key(ssh_key_path)
            return {"email": _decrypt(enc_email, k), "password": _decrypt(enc_pwd, k)}
        except Exception as e:
            logger.error("Decryption failed: %s", e)
            return None

    def clear(self) -> None:
        cfg = _read_env(self.env_path)
        for name in ["COOKIE", "CSRF", "ENC_EMAIL", "ENC_PASSWORD"]:
            cfg.pop(self._key(name), None)
        _write_env(self.env_path, cfg)
        self._cookie = None
        self._csrf = None

    def _parse_cookies(self, headers: httpx.Headers) -> dict[str, str]:
        jar: dict[str, str] = {}
        for value in headers.get_list("set-cookie"):
            pair = value.split(";")[0]
            eq = pair.find("=")
            if eq > 0:
                jar[pair[:eq].strip()] = pair[eq + 1:].strip()
        return jar

    async def _request(
        self,
        method: str,
        endpoint: str,
        data: dict | None = None,
        use_outlier: bool = True,
        attempt: int = 1,
    ) -> httpx.Response | None:
        base = OUTLIER_BASE_URL if use_outlier else REMOTASKS_BASE_URL
        headers = {
            "accept": "*/*",
            "accept-language": "en-US,en-GB;q=0.9,en;q=0.8",
            "cache-control": "no-cache",
            "content-type": "application/json",
            "user-agent": _UA,
        }
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.request(method, f"{base}{endpoint}", headers=headers, json=data)
                if resp.status_code >= 500:
                    logger.error("[request] %s %s", resp.status_code, resp.reason_phrase)
                return resp
        except httpx.RequestError as e:
            logger.error("[request] network error: %s", e)
            if attempt < 2:
                await asyncio.sleep(min(2**attempt, 10))
                return await self._request(method, endpoint, data, use_outlier, attempt + 1)
            return None

    async def _do_login(self, email: str, password: str, use_outlier: bool) -> dict | None:
        endpoint = "/internal/loginNext/expert" if use_outlier else "/internal/loginNext/worker"
        resp = await self._request("POST", endpoint, {"email": email, "password": password}, use_outlier)
        if not resp:
            return None

        try:
            body = resp.json()
        except Exception:
            body = None

        jar = self._parse_cookies(resp.headers)
        cookie = "; ".join(f"{k}={v}" for k, v in jar.items())
        csrf = unquote(jar.get("_csrf", ""))

        if cookie:
            self._save_session(cookie, csrf)
            self._load_session()

        return {"statusCode": resp.status_code, "body": body, "cookie": cookie, "csrf": csrf}

    async def login(self, email: str, password: str, use_outlier: bool = True) -> dict | None:
        return await self._do_login(email, password, use_outlier)

    async def login_with_stored_credentials(
        self, use_outlier: bool = True, ssh_key_path: str | None = None
    ) -> dict | None:
        creds = self.get_stored_credentials(ssh_key_path)
        if not creds:
            logger.error('[login] no stored credentials (suffix="%s")', self.suffix)
            return None
        return await self._do_login(creds["email"], creds["password"], use_outlier)
