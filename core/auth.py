"""
core/auth.py — Session token comparison & extraction
"""

import hmac
from core.config import AUTH_TOKEN

__all__ = ["compare_token", "extract_token_from_headers"]


def compare_token(candidate: str, expected: str = AUTH_TOKEN) -> bool:
    """Compare tokens securely using hmac.compare_digest."""
    if not candidate or not expected:
        return False
    return hmac.compare_digest(str(candidate), str(expected))


def _get_header(headers_dict, name: str):
    """
    FIX: header lookup is now case-insensitive. dict(self.headers) preserves the
    exact casing the client sent (HTTP/2 proxies often lowercase everything),
    so a plain .get("X-Auth-Token") used to miss perfectly valid requests.
    """
    if not headers_dict:
        return None
    # Fast path: exact match (works for plain dicts and email.message.Message).
    try:
        value = headers_dict.get(name)
        if value:
            return value
    except AttributeError:
        pass
    # Slow path: case-insensitive scan.
    try:
        for k, v in headers_dict.items():
            if isinstance(k, str) and k.lower() == name and v:
                return v
    except AttributeError:
        pass
    return None


def extract_token_from_headers(headers_dict: dict) -> str | None:
    """Extract token from various possible header locations."""
    if not headers_dict:
        return None

    # 1. Check X-Auth-Token header (case-insensitive)
    token = _get_header(headers_dict, "x-auth-token")
    if token:
        return token

    # 2. Check Authorization Bearer
    auth = _get_header(headers_dict, "authorization")
    if auth and auth.lower().startswith("bearer "):
        return auth[7:].strip()

    # 3. Check Cookie
    # FIX: also accept the `momtv_token=` cookie that http_server sets when a
    # client pairs via ?token=... — previously only `token=` was parsed, so
    # cookie-based auth (and the PWA share target, which relies on that cookie)
    # never worked even though the server was setting the cookie.
    cookie = _get_header(headers_dict, "cookie")
    if cookie:
        for part in cookie.split(";"):
            part = part.strip()
            for prefix in ("token=", "momtv_token="):
                if part.startswith(prefix):
                    return part[len(prefix):].strip()

    return None