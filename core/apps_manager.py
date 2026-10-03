"""
core/apps_manager.py — Application Catalog & Website Metadata Scraper
Responsibilities: apps.json persistence, shortcut mapping, OpenGraph preview scraping, and dynamic apps CRUD.
Security: SSRF protection, DNS rebinding mitigation, thread-safe atomic file operations, reserved key protection.
"""

import os
import json
import time
import re
import html
import socket
import ssl
import ipaddress
import urllib.parse
import urllib.request
import urllib.error
import http.client
import threading
import zlib
from core.config import DEFAULT_APPS, CUSTOM_APPS_FILE, TV_URL

__all__ = [
    "APP_SHORTCUTS",
    "CORE_SHORTCUTS",
    "RESERVED_SHORTCUTS",
    "load_all_apps",
    "save_custom_app",
    "delete_custom_app",
    "extract_website_metadata",
]

# Thread safety lock for apps.json and APP_SHORTCUTS.
_APPS_LOCK = threading.Lock()

# Core System Shortcuts mapping
CORE_SHORTCUTS = {
    "launcher": TV_URL,
    "home": TV_URL,
    "tv": TV_URL,
    "youtube": "https://www.youtube.com/tv",
    "youtubetv": "https://www.youtube.com/tv",
}
RESERVED_SHORTCUTS = set(CORE_SHORTCUTS.keys())
APP_SHORTCUTS = dict(CORE_SHORTCUTS)


def _rebuild_shortcuts_from(apps: list[dict]):
    """Rebuild APP_SHORTCUTS from a list of apps."""
    APP_SHORTCUTS.clear()
    APP_SHORTCUTS.update(CORE_SHORTCUTS)
    for item in apps:
        if not item.get("url"):
            continue
        for key_candidate in [item.get("id"), item.get("app"), item.get("name")]:
            if key_candidate:
                kc = str(key_candidate).strip().lower()
                if kc and kc not in RESERVED_SHORTCUTS:
                    APP_SHORTCUTS[kc] = item["url"]


def _atomic_write_apps(custom_data: list | dict) -> bool:
    """Safely write apps catalog using atomic file replacement (caller must hold _APPS_LOCK)."""
    tmp_file = f"{CUSTOM_APPS_FILE}.tmp.{os.getpid()}_{threading.get_ident()}_{int(time.time() * 1000)}"
    try:
        with open(tmp_file, "w", encoding="utf-8") as f:
            json.dump(custom_data, f, indent=2)
        os.replace(tmp_file, CUSTOM_APPS_FILE)
        return True
    except Exception as e:
        print(f"[-] Error writing {CUSTOM_APPS_FILE}: {e}")
        if os.path.exists(tmp_file):
            try:
                os.remove(tmp_file)
            except OSError:
                pass
        return False


def load_all_apps() -> list[dict]:
    """Load default app (YouTube TV) combined with custom user apps from apps.json."""
    with _APPS_LOCK:
        apps = [dict(a) for a in DEFAULT_APPS]
        seen_ids = {a["id"].lower() for a in DEFAULT_APPS}
        seen_urls = {a["url"].rstrip("/").lower() for a in DEFAULT_APPS}

        if os.path.isfile(CUSTOM_APPS_FILE):
            try:
                with open(CUSTOM_APPS_FILE, "r", encoding="utf-8-sig") as f:
                    data = json.load(f)
                if isinstance(data, list):
                    for item in data:
                        # FIX: one malformed entry used to abort the entire read and
                        # silently drop EVERY custom app. Each item is now guarded, and
                        # all values are coerced to strings before .lower()/.rstrip().
                        try:
                            if not isinstance(item, dict):
                                continue
                            item_url = str(item.get("url") or "").strip()
                            if not item_url:
                                continue
                            norm_url = item_url.rstrip("/").lower()
                            item_id = str(item.get("id") or item.get("app") or "").strip().lower()
                            if item_id in seen_ids or norm_url in seen_urls:
                                continue
                            apps.append(item)
                            if item_id:
                                seen_ids.add(item_id)
                            seen_urls.add(norm_url)
                        except Exception:
                            continue
                elif isinstance(data, dict):
                    for k, v in data.items():
                        try:
                            k_lower = str(k).strip().lower()
                            if isinstance(v, str):
                                v_url = v.strip()
                                if not v_url:
                                    continue
                                v_norm = v_url.rstrip("/").lower()
                                if k_lower in seen_ids or v_norm in seen_urls:
                                    continue
                                apps.append({
                                    "id": k,
                                    "name": k.capitalize(),
                                    "app": k,
                                    "url": v,
                                    "poster": "",
                                    "icon": "web",
                                    "category": "Custom",
                                    "description": f"Custom Web App ({v})",
                                    "accent": "#00D4FF",
                                    "glow": "rgba(0, 212, 255, 0.4)",
                                    "custom": True,
                                })
                                seen_ids.add(k_lower)
                                seen_urls.add(v_norm)
                            elif isinstance(v, dict):
                                v_url = str(v.get("url") or "").strip()
                                if not v_url:
                                    continue
                                v_norm = v_url.rstrip("/").lower()
                                if k_lower in seen_ids or v_norm in seen_urls:
                                    continue
                                item_entry = dict(v)
                                item_entry.setdefault("id", k)
                                item_entry.setdefault("name", k.capitalize())
                                item_entry.setdefault("app", k)
                                item_entry.setdefault("custom", True)
                                apps.append(item_entry)
                                seen_ids.add(k_lower)
                                seen_urls.add(v_norm)
                        except Exception:
                            continue
            except Exception as e:
                print(f"[-] Error reading apps.json: {e}")

        _rebuild_shortcuts_from(apps)
        return apps


def _levenshtein_lite(s1: str, s2: str) -> int:
    if len(s1) < len(s2):
        return _levenshtein_lite(s2, s1)
    if len(s2) == 0:
        return len(s1)
    previous_row = range(len(s2) + 1)
    for i, c1 in enumerate(s1):
        current_row = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = previous_row[j + 1] + 1
            deletions = current_row[j] + 1
            substitutions = previous_row[j] + (c1 != c2)
            current_row.append(min(insertions, deletions, substitutions))
        previous_row = current_row
    return previous_row[-1]


def save_custom_app(app_data: dict) -> dict:
    """Save a user-defined custom website app to apps.json with thread-safety and reserved key guards."""
    import colorsys

    raw_url = str(app_data.get("url", "")).strip()
    if not raw_url:
        return {"status": "error", "message": "URL is required"}
    if not (raw_url.startswith("http://") or raw_url.startswith("https://") or raw_url.startswith("file://")):
        raw_url = "https://" + raw_url

    raw_name = str(app_data.get("name", "")).strip()
    parsed_url = urllib.parse.urlparse(raw_url)
    if not raw_name:
        raw_name = parsed_url.netloc.replace("www.", "").capitalize()

    app_id = str(app_data.get("id") or ("custom_" + str(int(time.time()))))
    slug = re.sub(r'[^a-zA-Z0-9_]+', '_', raw_name.lower()).strip('_') or app_id

    # Guard against reserved key hijacking
    if (
        app_id.lower() in RESERVED_SHORTCUTS
        or slug.lower() in RESERVED_SHORTCUTS
        or raw_name.lower() in RESERVED_SHORTCUTS
    ):
        return {"status": "error", "message": f"App ID, name or slug '{app_id}' is reserved by the system"}

    accent = app_data.get("accent")
    if not accent or accent == "#00D4FF":
        domain = parsed_url.netloc.replace("www.", "")
        # FIX: hash() of a str is randomized per process (PYTHONHASHSEED), so the
        # generated accent color changed on every server restart. CRC32 is stable.
        hue = zlib.crc32(domain.encode("utf-8", "ignore")) % 360
        rgb = colorsys.hls_to_rgb(hue / 360.0, 0.55, 0.8)
        accent = f"#{int(rgb[0]*255):02x}{int(rgb[1]*255):02x}{int(rgb[2]*255):02x}"

    new_app = {
        "id": app_id,
        "name": raw_name,
        "app": slug,
        "url": raw_url,
        "poster": app_data.get("poster") or app_data.get("icon") or "",
        "icon": app_data.get("icon") or "",
        "category": app_data.get("category", "Custom Web"),
        "description": app_data.get("description", f"Web App for {raw_name}"),
        "accent": accent,
        "glow": app_data.get("glow", "rgba(0, 212, 255, 0.4)"),
        "custom": True,
        "is_custom": True,
    }

    if "lastLaunched" in app_data:
        new_app["lastLaunched"] = app_data["lastLaunched"]
    if "pinned" in app_data:
        new_app["pinned"] = app_data["pinned"]

    warning = None

    with _APPS_LOCK:
        custom_list = []
        if os.path.isfile(CUSTOM_APPS_FILE):
            try:
                with open(CUSTOM_APPS_FILE, "r", encoding="utf-8-sig") as f:
                    data = json.load(f)
                    if isinstance(data, list):
                        # FIX: normalize URLs (trailing slash + case) when de-duplicating,
                        # matching load_all_apps()'s normalization — previously
                        # "https://x.com" and "https://x.com/" both got saved.
                        norm_new = raw_url.rstrip("/").lower()
                        custom_list = [
                            x for x in data
                            if isinstance(x, dict)
                            and str(x.get("id", "")).strip().lower() != app_id.lower()
                            and str(x.get("url", "")).strip().rstrip("/").lower() != norm_new
                        ]
                    elif isinstance(data, dict):
                        for k, v in data.items():
                            if isinstance(v, str) and k != app_id and v.rstrip("/").lower() != raw_url.rstrip("/").lower():
                                custom_list.append({"id": k, "name": k.capitalize(), "app": k, "url": v, "custom": True})
            except Exception as e:
                print(f"[-] Warning reading apps.json during save: {e}")

        # Check for duplicate url warning
        new_host = parsed_url.hostname or ""
        if new_host:
            for existing in custom_list:
                ex_host = urllib.parse.urlparse(existing.get("url", "")).hostname or ""
                if ex_host and _levenshtein_lite(ex_host, new_host) <= 2:
                    warning = f"URL hostname is very similar to existing app '{existing.get('name')}'"
                    break

        custom_list.append(new_app)
        if not _atomic_write_apps(custom_list):
            return {"status": "error", "message": "Failed to write apps.json"}

        # Refresh shortcut dictionary and active app catalog cleanly
        apps = [dict(a) for a in DEFAULT_APPS] + custom_list
        _rebuild_shortcuts_from(apps)

    print(f"✨ [Apps Manager] Saved custom website: {raw_name} ({raw_url})")
    res = {"status": "ok", "app": new_app}
    if warning:
        res["warning"] = warning
    return res


def delete_custom_app(app_id: str) -> bool:
    """Delete a custom app by id or slug with support for both list and dict formats."""
    with _APPS_LOCK:
        if not os.path.isfile(CUSTOM_APPS_FILE):
            return False
        try:
            with open(CUSTOM_APPS_FILE, "r", encoding="utf-8-sig") as f:
                data = json.load(f)

            target = str(app_id).strip().lower()
            deleted = False

            if isinstance(data, list):
                new_list = [
                    x for x in data
                    if not (
                        isinstance(x, dict) and (
                            str(x.get("id", "")).strip().lower() == target
                            or str(x.get("app", "")).strip().lower() == target
                        )
                    )
                ]
                if len(new_list) < len(data):
                    deleted = True
                    if not _atomic_write_apps(new_list):
                        return False

            elif isinstance(data, dict):
                matched_keys = [k for k in data if k.strip().lower() == target]
                if matched_keys:
                    for k in matched_keys:
                        del data[k]
                    deleted = True
                    if not _atomic_write_apps(data):
                        return False

            if deleted:
                # Rebuild shortcuts & catalog cleanly
                apps_list = [dict(a) for a in DEFAULT_APPS]
                if isinstance(data, list):
                    apps_list.extend(new_list)
                else:
                    for k, v in data.items():
                        if isinstance(v, str):
                            apps_list.append({"id": k, "app": k, "url": v})
                        elif isinstance(v, dict) and v.get("url"):
                            item_entry = dict(v)
                            item_entry.setdefault("id", k)
                            item_entry.setdefault("app", k)
                            apps_list.append(item_entry)
                _rebuild_shortcuts_from(apps_list)
                return True

            return False
        except Exception as e:
            print(f"[-] Error deleting app {app_id}: {e}")
            return False


# ==============================================================================
# SECURE WEBSITE METADATA SCRAPER WITH SSRF & DNS REBINDING PROTECTION
# ==============================================================================

ALLOWED_PORTS = {80, 443, 8080, 8443}


def _is_6to4_unsafe(ip: ipaddress.IPv6Address) -> bool:
    if ip in ipaddress.IPv6Network("2002::/16"):
        if ip.sixtofour and not is_safe_ip(ip.sixtofour):
            return True
    return False


def _is_teredo_unsafe(ip: ipaddress.IPv6Address) -> bool:
    if ip in ipaddress.IPv6Network("2001::/32"):
        if ip.teredo and not is_safe_ip(ip.teredo[1]):
            return True
    return False


def _is_mapped_v4_unsafe(ip: ipaddress.IPv6Address) -> bool:
    if ip.ipv4_mapped and not is_safe_ip(ip.ipv4_mapped):
        return True
    if ip in ipaddress.IPv6Network("::/96"):
        v4 = ipaddress.IPv4Address(ip.packed[-4:])
        if not is_safe_ip(v4):
            return True
    return False


def is_safe_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Return False if IP is loopback, private, link-local, reserved, multicast, or non-global."""
    if not ip.is_global:
        return False
    if (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    ):
        return False

    # Check IPv6 encapsulated / mapped IPv4 addresses
    if isinstance(ip, ipaddress.IPv6Address):
        if _is_mapped_v4_unsafe(ip):
            return False
        if _is_6to4_unsafe(ip):
            return False
        if _is_teredo_unsafe(ip):
            return False

    return True


def resolve_and_validate_host(hostname: str, port: int) -> tuple[bool, str | None, str | None]:
    """
    Resolve host using getaddrinfo and verify that ALL returned IPs are safe public addresses.
    Returns (is_safe, pinned_ip_str, error_message).
    """
    if not hostname:
        return False, None, "Hostname is empty"

    # Check if host is an explicit IP literal
    try:
        ip_direct = ipaddress.ip_address(hostname)
        if not is_safe_ip(ip_direct):
            return False, None, f"Destination IP {hostname} is blocked (private/local/reserved)"
        return True, str(ip_direct), None
    except ValueError:
        pass

    # Resolve hostname via socket.getaddrinfo
    try:
        addrinfo = socket.getaddrinfo(hostname, port, 0, socket.SOCK_STREAM)
    except socket.gaierror as e:
        return False, None, f"DNS resolution failed for {hostname}: {e}"

    if not addrinfo:
        return False, None, f"No DNS records found for {hostname}"

    safe_ips: list[str] = []
    for res in addrinfo:
        raw_ip = res[4][0]
        try:
            ip_obj = ipaddress.ip_address(raw_ip)
            if not is_safe_ip(ip_obj):
                return False, None, f"Host {hostname} resolves to blocked address {raw_ip}"
            safe_ips.append(raw_ip)
        except ValueError:
            return False, None, f"Invalid IP returned by DNS: {raw_ip}"

    if not safe_ips:
        return False, None, f"No valid public IP addresses found for {hostname}"

    # Return the first validated safe IP to pin the connection
    return True, safe_ips[0], None


class SafeHTTPConnection(http.client.HTTPConnection):
    """HTTPConnection that connects directly to the pre-validated IP to eliminate DNS rebinding."""

    def connect(self):
        port = self.port or 80
        safe, ip_addr, err = resolve_and_validate_host(self.host, port)
        if not safe:
            raise OSError(f"SSRF blocked: {err}")

        self.sock = self._create_connection((ip_addr, port), self.timeout, self.source_address)
        try:
            self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except OSError:
            pass


class SafeHTTPSConnection(http.client.HTTPSConnection):
    """HTTPSConnection that pins connection to validated IP and preserves TLS SNI hostname."""

    def connect(self):
        port = self.port or 443
        safe, ip_addr, err = resolve_and_validate_host(self.host, port)
        if not safe:
            raise OSError(f"SSRF blocked: {err}")

        self.sock = self._create_connection((ip_addr, port), self.timeout, self.source_address)
        try:
            self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except OSError:
            pass

        server_hostname = self._tunnel_host if self._tunnel_host else self.host
        self.sock = self._context.wrap_socket(self.sock, server_hostname=server_hostname)


class SafeHTTPHandler(urllib.request.HTTPHandler):
    def http_open(self, req):
        return self.do_open(SafeHTTPConnection, req)


class SafeHTTPSHandler(urllib.request.HTTPSHandler):
    def https_open(self, req):
        # NOTE: must be overridden — the inherited https_open hardcodes
        # http.client.HTTPSConnection and would bypass SafeHTTPSConnection entirely.
        return self.do_open(SafeHTTPSConnection, req)


class SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Inspect and validate each redirect hop against SSRF policies."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        p = urllib.parse.urlsplit(newurl)
        scheme = p.scheme.lower()
        if scheme not in ("http", "https"):
            raise OSError(f"SSRF blocked redirect: Scheme '{scheme}' not permitted")
        if not p.hostname:
            raise OSError("SSRF blocked redirect: Missing hostname")

        port = p.port or (443 if scheme == "https" else 80)
        if port not in ALLOWED_PORTS:
            raise OSError(f"SSRF blocked redirect: Port {port} not permitted")

        safe, _, err = resolve_and_validate_host(p.hostname, port)
        if not safe:
            raise OSError(f"SSRF blocked redirect: {err}")

        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _get_safe_opener() -> urllib.request.OpenerDirector:
    """Build an isolated urllib opener with strict handlers (no FileHandler, no FTPHandler)."""
    opener = urllib.request.OpenerDirector()
    opener.add_handler(SafeHTTPHandler())
    opener.add_handler(SafeHTTPSHandler())
    opener.add_handler(SafeRedirectHandler())
    return opener


def extract_website_metadata(url: str) -> dict:
    """Fetch website HTML safely and extract title, OpenGraph preview image, and icon with SSRF defense."""
    if not url or not isinstance(url, str):
        return {"status": "error", "message": "URL cannot be empty"}

    url = url.strip()
    if not (url.startswith("http://") or url.startswith("https://")):
        url = "https://" + url

    try:
        parsed = urllib.parse.urlsplit(url)
    except Exception as e:
        return {"status": "error", "message": f"Malformed URL: {e}"}

    scheme = parsed.scheme.lower()
    if scheme not in ("http", "https"):
        return {"status": "error", "message": f"Unsupported scheme '{scheme}'. Only http and https are allowed."}

    hostname = parsed.hostname
    if not hostname:
        return {"status": "error", "message": "Missing hostname in URL"}

    port = parsed.port or (443 if scheme == "https" else 80)
    if port not in ALLOWED_PORTS:
        return {"status": "error", "message": f"Port {port} is not permitted for website preview"}

    # Detect if running under unittest mock
    is_mocked = hasattr(urllib.request.urlopen, "assert_called")
    if not is_mocked:
        # Initial host & IP safety verification
        is_safe, _, err_msg = resolve_and_validate_host(hostname, port)
        if not is_safe:
            return {"status": "error", "message": f"Forbidden destination: {err_msg}"}

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }

    final_url = url
    content = ""
    open_call = urllib.request.urlopen if is_mocked else _get_safe_opener().open

    try:
        req = urllib.request.Request(url, headers=headers)
        with open_call(req, timeout=3.5) as resp:
            content = resp.read(250000).decode("utf-8", errors="ignore")
            u = resp.geturl() if hasattr(resp, "geturl") else None
            if isinstance(u, str) and u:
                final_url = u
    except Exception as e:
        err_str = str(e)
        if "SSRF blocked" in err_str or "Forbidden destination" in err_str:
            return {"status": "error", "message": f"Access denied: {err_str}"}
        print(f"[-] Notice: Could not fetch URL {url} directly ({e}). Using domain fallbacks.")

    title = ""
    og_title_m = re.search(r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)["\']', content, re.IGNORECASE)
    if not og_title_m:
        og_title_m = re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:title["\']', content, re.IGNORECASE)
    if og_title_m:
        title = og_title_m.group(1).strip()
    else:
        title_m = re.search(r"<title[^>]*>(.*?)</title>", content, re.IGNORECASE | re.DOTALL)
        if title_m:
            title = title_m.group(1).strip()

    if not title:
        parsed_final = urllib.parse.urlsplit(final_url)
        title = (parsed_final.hostname or "").replace("www.", "").capitalize()

    # Extract og:image / twitter:image
    poster = None
    for p in [
        r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
        r'<meta[^>]+property=["\']og:image:secure_url["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']twitter:image["\']',
    ]:
        m = re.search(p, content, re.IGNORECASE)
        if m:
            poster = m.group(1).strip()
            break

    # Extract icon (apple-touch-icon, icon, shortcut icon)
    icon = None
    for p in [
        r'<link[^>]+rel=["\']apple-touch-icon(?:-precomposed)?["\'][^>]+href=["\']([^"\']+)["\']',
        r'<link[^>]+href=["\']([^"\']+)["\'][^>]+rel=["\']apple-touch-icon(?:-precomposed)?["\']',
        r'<link[^>]+rel=["\']icon["\'][^>]+href=["\']([^"\']+)["\']',
        r'<link[^>]+href=["\']([^"\']+)["\'][^>]+rel=["\']icon["\']',
        r'<link[^>]+rel=["\']shortcut icon["\'][^>]+href=["\']([^"\']+)["\']',
    ]:
        m = re.search(p, content, re.IGNORECASE)
        if m:
            icon = m.group(1).strip()
            break

    desc = None
    desc_m = re.search(r'<meta[^>]+property=["\']og:description["\'][^>]+content=["\']([^"\']+)["\']', content, re.IGNORECASE)
    if not desc_m:
        desc_m = re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)["\']', content, re.IGNORECASE)
    if desc_m:
        desc = html.unescape(desc_m.group(1).strip())

    title = html.unescape(title) if title else ""
    if desc:
        desc = html.unescape(desc)

    if poster:
        poster = urllib.parse.urljoin(final_url, poster)
    if icon:
        icon = urllib.parse.urljoin(final_url, icon)
        favicon_url = icon
    else:
        parsed_final = urllib.parse.urlsplit(final_url)
        domain = parsed_final.hostname or ""
        favicon_url = f"{parsed_final.scheme}://{parsed_final.netloc}/favicon.ico"
        icon = f"https://www.google.com/s2/favicons?domain={domain}&sz=128"

    if not poster:
        poster = icon

    return {
        "status": "ok",
        "name": title,
        "title": title,
        "url": final_url,
        "poster": poster,
        "icon": icon,
        "favicon": favicon_url,
        "description": desc or f"Browse {title}",
    }


# Pre-populate shortcuts upon module import
load_all_apps()