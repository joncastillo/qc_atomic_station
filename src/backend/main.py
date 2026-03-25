import logging
import os
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from outlier_credentials_manager import OutlierCredentialsManager
from whitelist import check_whitelist, load_whitelist, save_whitelist

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

ACCESS_TOKEN = os.environ.get("QC_ATOMIC_STATION_TOKEN") or secrets.token_hex(16)
print(f"[auth] ACCESS_TOKEN: {ACCESS_TOKEN}")

PORT = int(os.environ.get("PORT", 5000))
ENV_FOLDER = os.environ.get("ENV_FOLDER", "./env")


@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"ok": False, "message": exc.detail})


@app.middleware("http")
async def whitelist_middleware(request: Request, call_next):
    forwarded = request.headers.get("x-forwarded-for", "")
    client_ip = forwarded.split(",")[0].strip() if forwarded else ""
    if not client_ip and request.client:
        client_ip = request.client.host
    client_ip = client_ip or "unknown"

    allowed, msg = check_whitelist(client_ip, request.url.path)
    if not allowed:
        return JSONResponse(status_code=403, content={"ok": False, "message": msg})
    return await call_next(request)


_bearer = HTTPBearer()

def require_token(credentials: HTTPAuthorizationCredentials = Depends(_bearer)) -> None:
    if credentials.credentials != ACCESS_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized.")


class StoreCredentialBody(BaseModel):
    email: str
    password: str
    store: str = "default_user"
    suffix: str = ""


class UpdateKeyBody(BaseModel):
    store: str = "default_user"
    suffix: str = ""
    useOutlier: bool = True


class WhitelistBody(BaseModel):
    enabled: bool | None = None
    ips: list[str] | None = None
    macs: list[str] | None = None


@app.get("/api/get_key")
async def get_key(
    store: str = "default_user",
    suffix: str = "",
    useOutlier: str = "true",
    _: None = Depends(require_token),
):
    mgr = OutlierCredentialsManager(store, ENV_FOLDER, suffix)
    if mgr.has_credentials():
        return {"ok": True, "cookie": mgr.get_cookie(), "csrf": mgr.get_csrf()}

    result = await mgr.login_with_stored_credentials(useOutlier != "false")
    if not result or not result.get("cookie"):
        return {"ok": False, "message": "No session and no stored credentials to renew with."}

    return {"ok": True, "cookie": result["cookie"], "csrf": result["csrf"], "renewed": True}


@app.post("/api/store_credential")
async def store_credential(body: StoreCredentialBody, _: None = Depends(require_token)):
    if not body.email or not body.password:
        raise HTTPException(status_code=400, detail="Email and password required.")
    mgr = OutlierCredentialsManager(body.store, ENV_FOLDER, body.suffix)
    try:
        mgr.store_credentials(body.email, body.password)
        return {"ok": True, "message": "Credentials stored."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/update_key")
async def update_key(body: UpdateKeyBody, _: None = Depends(require_token)):
    mgr = OutlierCredentialsManager(body.store, ENV_FOLDER, body.suffix)
    result = await mgr.login_with_stored_credentials(body.useOutlier)
    if not result:
        raise HTTPException(
            status_code=400,
            detail="No stored credentials. Call /api/store_credential first.",
        )
    return {
        "ok": bool(result.get("cookie") and result.get("csrf")),
        "statusCode": result.get("statusCode"),
        "cookie": result.get("cookie"),
        "csrf": result.get("csrf"),
        "body": result.get("body"),
    }


@app.delete("/api/clear")
async def clear(
    store: str = "default_user",
    suffix: str = "",
    _: None = Depends(require_token),
):
    OutlierCredentialsManager(store, ENV_FOLDER, suffix).clear()
    return {"ok": True, "message": "Cleared."}


@app.get("/api/whitelist")
async def get_whitelist(_: None = Depends(require_token)):
    return load_whitelist()


@app.put("/api/whitelist")
async def put_whitelist(body: WhitelistBody, _: None = Depends(require_token)):
    current = load_whitelist()
    save_whitelist({
        "enabled": body.enabled if body.enabled is not None else current["enabled"],
        "ips": body.ips if body.ips is not None else current["ips"],
        "macs": [m.lower() for m in (body.macs if body.macs is not None else current["macs"])],
    })
    return {"ok": True, **load_whitelist()}


dist_public = Path(__file__).parent.parent.parent / "dist" / "public"
if dist_public.exists():
    app.mount("/", StaticFiles(directory=str(dist_public), html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=PORT,
        ssl_certfile=os.environ.get("SSL_CERTFILE") or None,
        ssl_keyfile=os.environ.get("SSL_KEYFILE") or None,
    )
