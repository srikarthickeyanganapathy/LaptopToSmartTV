import hmac
from core.config import AUTH_TOKEN

__all__ = ["compare_token", "extract_token_from_headers"]

def compare_token(candidate: str, expected: str = AUTH_TOKEN) -> bool:
    """Compare tokens securely using hmac.compare_digest."""
    if not candidate or not expected:
        return False
    return hmac.compare_digest(candidate, expected)

def extract_token_from_headers(headers_dict: dict) -> str | None:
    """Extract token from various possible header locations."""
    # 1. Check X-Auth-Token header
    token = headers_dict.get("X-Auth-Token")
    if token:
        return token
        
    # 2. Check Authorization Bearer
    auth = headers_dict.get("Authorization")
    if auth and auth.lower().startswith("bearer "):
        return auth[7:].strip()
        
    # 3. Check Cookie
    cookie = headers_dict.get("Cookie")
    if cookie:
        for part in cookie.split(";"):
            part = part.strip()
            if part.startswith("token="):
                return part[6:]
                
    return None
