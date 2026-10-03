"""
core/http_server.py — Multi-Threaded HTTP Server & REST API Dispatcher
Responsibilities: Serving Remote PWA, TV Leanback Launcher, static assets, and handling REST endpoints.
Security: Dynamic CORS origin validation, session token auth on state-changing endpoints, SSRF defense,
anti-directory-traversal with os.path.commonpath, and strict public asset allowlist.
"""

import os
import sys
import time
import json
import html
import urllib.parse
import asyncio
import logging
import hmac
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from core.config import (
    HTTP_PORT,
    WS_PORT,
    CDP_PORT,
    AUTH_TOKEN,
    BASE_DIR,
    MIME_TYPES,
    ALLOWED_STATIC_FILES,
    ALLOWED_STATIC_DIRS,
    TV_URL,
)
from core.auth import compare_token, extract_token_from_headers
from core.loop_registry import get_loop
from core.win32_input import user32, park_cursor
from core.apps_manager import (
    APP_SHORTCUTS,
    load_all_apps,
    save_custom_app,
    delete_custom_app,
    extract_website_metadata,
)
from core.kiosk_supervisor import kiosk_supervisor
from core.cdp_bridge import cdp_bridge
from core.launcher import launch_target
from core.net_utils import LOCAL_IP, get_qr_svg_data
from core.ws_controller import notify_apps_updated

__all__ = [
    "SmartTVHTTPRequestHandler",
    "ReusableThreadingHTTPServer",
    "start_http_server",
]

logger = logging.getLogger(__name__)
START_TIME = time.time()
_RATE_LIMITS = {}

# PERF: hoisted lowercase allowlists (were rebuilt on every request).
_ALLOWED_STATIC_FILES_LC = {f.lower() for f in ALLOWED_STATIC_FILES}
_ALLOWED_STATIC_DIRS_LC = {d.lower() for d in ALLOWED_STATIC_DIRS}
_MAX_POST_BODY = 2 * 1024 * 1024  # FIX: cap request bodies at 2 MB (was uncapped).


def _get_main_loop():
    # Helper backward compat
    app_mod = sys.modules.get("app")
    loop = getattr(app_mod, "MAIN_LOOP", None) if app_mod else None
    if loop and not loop.is_closed():
        return loop
    # FIX: consult the shared loop registry. Previously this helper ignored it and
    # could end up with a fresh (never-run) loop, making CDP navigation from the
    # HTTP API silently do nothing.
    try:
        loop = get_loop()
        if loop and not loop.is_closed():
            return loop
    except Exception:
        pass
    try:
        return asyncio.get_running_loop()
    except RuntimeError:
        return None

class SmartTVHTTPRequestHandler(SimpleHTTPRequestHandler):
    """Custom HTTP Handler serving Remote, TV Launcher, tv-engine.js, PWA assets & APIs."""

    def log_message(self, format, *args):
        # Suppress verbose GET logging to keep terminal clean
        pass

    def _is_origin_allowed(self) -> tuple[bool, str]:
        """Check if request origin is authorized (LAN client, localhost, or same-origin)."""
        origin = self.headers.get("Origin") or self.headers.get("Referer")
        if not origin:
            # Direct browser load / no Origin header sent
            return True, "*"
        try:
            p = urllib.parse.urlsplit(origin)
            host = (p.hostname or "").lower()
            allowed_hosts = {"localhost", "127.0.0.1", LOCAL_IP.lower()}
            if host in allowed_hosts:
                exact_origin = f"{p.scheme}://{p.netloc}"
                return True, exact_origin
            return False, ""
        except Exception:
            return False, ""

    def _verify_token(self, body_json: dict = None) -> bool:
        """Verify presence of valid session AUTH_TOKEN."""
        token = extract_token_from_headers(dict(self.headers))
        if token and hmac.compare_digest(token, AUTH_TOKEN):
            return True

        # 2. Query param ?token=
        parsed = urllib.parse.urlparse(self.path)
        q_params = urllib.parse.parse_qs(parsed.query)
        token_q = q_params.get("token", [""])[0]
        if token_q and hmac.compare_digest(token_q.strip(), AUTH_TOKEN):
            return True

        # 3. In JSON body
        if body_json and isinstance(body_json, dict):
            token_b = body_json.get("token")
            if token_b and hmac.compare_digest(str(token_b).strip(), AUTH_TOKEN):
                return True

        return False

    def end_headers_with_cors(self, content_type: str):
        allowed, origin_str = self._is_origin_allowed()
        self.send_header("Content-Type", content_type)
        if allowed:
            self.send_header("Access-Control-Allow-Origin", origin_str)
            if origin_str != "*":
                self.send_header("Access-Control-Allow-Credentials", "true")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Auth-Token, Authorization")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.end_headers()

    def do_OPTIONS(self):
        try:
            self.send_response(200)
            self.end_headers_with_cors("text/plain")
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            pass

    def _resolve_static_path(self, raw_path: str) -> str | None:
        """
        NOTE: This method is currently unused but kept as a utility;
        the actual static serving in _handle_get reimplements similar logic inline.
        """
        try:
            clean_path = raw_path.split("?", 1)[0].split("#", 1)[0]
            if clean_path in ("/", ""):
                clean_path = "/index.html"
            elif clean_path in ("/tv", "/tv/"):
                clean_path = "/tv.html"

            decoded_path = urllib.parse.unquote(clean_path)
            if "\x00" in decoded_path:
                return None

            clean_rel = decoded_path.lstrip("/\\").replace("\\", "/")
            path_segments = [seg for seg in clean_rel.split("/") if seg]

            if not path_segments or any(seg.startswith(".") for seg in path_segments):
                return None

            is_allowed = False
            if len(path_segments) == 1 and path_segments[0].lower() in _ALLOWED_STATIC_FILES_LC:
                is_allowed = True
            elif len(path_segments) > 1 and path_segments[0].lower() in _ALLOWED_STATIC_DIRS_LC:
                is_allowed = True

            if not is_allowed:
                return None

            base_dir = os.path.normpath(os.path.abspath(BASE_DIR))
            norm_path = os.path.normpath(os.path.abspath(os.path.join(base_dir, clean_rel)))

            if os.path.commonpath([norm_path, base_dir]).lower() != base_dir.lower():
                return None

            ext = os.path.splitext(norm_path)[1].lower()
            if ext not in MIME_TYPES:
                return None

            if os.path.isfile(norm_path):
                return norm_path

            return None
        except Exception:
            return None

    def serve_file_or_fallback(self, filename: str, content_type: str, fallback_bytes: bytes, set_auth_cookie: bool = False):
        try:
            filepath = os.path.join(BASE_DIR, filename)
            data = fallback_bytes
            if os.path.isfile(filepath):
                try:
                    with open(filepath, "rb") as f:
                        data = f.read()
                except Exception as e:
                    print(f"[-] Error reading {filename}: {e}")

            self.send_response(200)
            if set_auth_cookie:
                self.send_header("Set-Cookie", f"momtv_token={AUTH_TOKEN}; Path=/; SameSite=Lax; Max-Age=86400")
            self.end_headers_with_cors(content_type)
            self.wfile.write(data)
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            pass
        except Exception as e:
            print(f"[-] Error serving {filename}: {e}")

    def do_GET(self):
        try:
            self._handle_get()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            pass
        except Exception as e:
            print(f"[-] HTTP GET exception: {e}")

    def do_POST(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path.rstrip("/")
            if not path:
                path = "/"

            # Verify Origin
            allowed_origin, _ = self._is_origin_allowed()
            if not allowed_origin:
                self.send_response(403)
                self.end_headers_with_cors("application/json; charset=utf-8")
                self.wfile.write(b'{"status": "error", "message": "Cross-origin request rejected"}')
                return

            try:
                content_len = int(self.headers.get("Content-Length", 0) or 0)
            except ValueError:
                content_len = 0
            # FIX: cap the body — an uncapped read let a single request pin server memory.
            content_len = max(0, min(content_len, _MAX_POST_BODY))
            post_data = self.rfile.read(content_len) if content_len > 0 else b"{}"
            try:
                body_json = json.loads(post_data.decode("utf-8")) if post_data else {}
            except Exception:
                body_json = {}
            if not body_json:
                # FIX: PWA share-target posts arrive as application/x-www-form-urlencoded,
                # NOT JSON — parse them too so /api/search works when sharing from apps.
                ctype = (self.headers.get("Content-Type") or "").lower()
                if "application/x-www-form-urlencoded" in ctype:
                    try:
                        body_json = {
                            k: (v[0] if len(v) == 1 else v)
                            for k, v in urllib.parse.parse_qs(
                                post_data.decode("utf-8"), keep_blank_values=True
                            ).items()
                        }
                    except Exception:
                        body_json = {}

            # Enforce authentication on all state-changing endpoints
            if not self._verify_token(body_json):
                self.send_response(401)
                self.end_headers_with_cors("application/json; charset=utf-8")
                self.wfile.write(b'{"status": "error", "message": "Unauthorized: valid AUTH_TOKEN required"}')
                return

            client_ip = self.client_address[0]
            now = time.time()
            if path in ("/api/launch", "/api/open", "/api/search", "/api/kiosk/close", "/api/kiosk_close", "/api/exit"):
                # FIX: prune stale rate-limit buckets so _RATE_LIMITS can't grow forever.
                if len(_RATE_LIMITS) > 512:
                    for stale_ip in [ip for ip, ts in _RATE_LIMITS.items() if not ts or now - ts[-1] > 300]:
                        _RATE_LIMITS.pop(stale_ip, None)
                bucket = _RATE_LIMITS.setdefault(client_ip, [])
                bucket[:] = [t for t in bucket if now - t < 60]
                if len(bucket) >= 10:
                    self.send_response(429)
                    self.end_headers_with_cors("application/json; charset=utf-8")
                    self.wfile.write(b'{"status": "error", "message": "Too many requests"}')
                    return
                bucket.append(now)

            handlers = {
                "/api/apps": self._post_apps,
                "/api/apps/add": self._post_apps,
                "/api/app/preview": self._post_preview,
                "/api/preview": self._post_preview,
                "/api/launch": self._post_launch,
                "/api/open": self._post_launch,
                "/api/kiosk/close": self._post_kiosk_close,
                "/api/kiosk_close": self._post_kiosk_close,
                "/api/exit": self._post_kiosk_close,
                "/api/search": self._post_search,
            }
            handler = handlers.get(path)
            if handler:
                handler(body_json, parsed)
                return

            # Unknown API endpoint
            self.send_response(404)
            self.end_headers_with_cors("application/json; charset=utf-8")
            self.wfile.write(b'{"status": "error", "message": "Endpoint not found"}')
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            pass
        except Exception as e:
            print(f"[-] HTTP POST exception: {e}")

    def _post_apps(self, body_json, parsed):
        res = save_custom_app(body_json)
        if res.get("status") == "ok":
            notify_apps_updated()
        status_code = 200 if res.get("status") == "ok" else 400
        body = json.dumps(res, indent=2).encode("utf-8")
        self.send_response(status_code)
        self.end_headers_with_cors("application/json; charset=utf-8")
        self.wfile.write(body)

    def _post_preview(self, body_json, parsed):
        target_url = body_json.get("url") or body_json.get("target", "")
        res = extract_website_metadata(target_url)
        status_code = 200 if res.get("status") == "ok" else 400
        body = json.dumps(res, indent=2).encode("utf-8")
        self.send_response(status_code)
        self.end_headers_with_cors("application/json; charset=utf-8")
        self.wfile.write(body)

    def _post_launch(self, body_json, parsed):
        target = body_json.get("url") or body_json.get("app") or body_json.get("target", "")
        resolved = APP_SHORTCUTS.get(str(target).lower(), target)

        if not kiosk_supervisor.is_running:
            kiosk_supervisor.start(initial_url=resolved)
            park_cursor()
            res = {"status": "ok", "target": resolved, "method": "kiosk_launch"}
            body = json.dumps(res, indent=2).encode("utf-8")
            self.send_response(200)
            self.end_headers_with_cors("application/json; charset=utf-8")
            self.wfile.write(body)
            return

        loop = _get_main_loop()
        success = False
        if loop and loop.is_running():
            future = asyncio.run_coroutine_threadsafe(cdp_bridge.navigate(resolved), loop)
            try:
                # FIX: 6s was shorter than navigate()'s own internal waits
                # (4s connect + command timeouts), causing false fallbacks.
                success = future.result(timeout=10.0)
            except Exception:
                success = False

        if not success:
            launch_target(resolved)
        park_cursor()

        res = {"status": "ok", "target": resolved, "method": "cdp" if success else "fallback"}
        body = json.dumps(res, indent=2).encode("utf-8")
        self.send_response(200)
        self.end_headers_with_cors("application/json; charset=utf-8")
        self.wfile.write(body)

    def _post_kiosk_close(self, body_json, parsed):
        print("💻 [HTTP API] Exit to Windows requested. Stopping Brave Kiosk...")
        kiosk_supervisor.stop()
        try:
            user32.SetCursorPos(500, 500)
        except Exception:
            pass
        payload = {
            "status": "ok",
            "cmd": "kiosk_close",
            "message": "Brave Kiosk closed, returned to Windows desktop",
        }
        body = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(200)
        self.end_headers_with_cors("application/json; charset=utf-8")
        self.wfile.write(body)

    def _post_search(self, body_json, parsed):
        q_params = urllib.parse.parse_qs(parsed.query)
        # FIX: also accept the fields the PWA share-target sends (text/title/url).
        # Previously only query/q were read, so shared content was silently dropped.
        query = (
            body_json.get("query")
            or body_json.get("q")
            or body_json.get("text")
            or body_json.get("title")
            or q_params.get("q", [""])[0]
            or q_params.get("query", [""])[0]
        )
        query = str(query or "").strip()
        shared_url = str(body_json.get("url") or "").strip()
        if not query and shared_url:
            query = shared_url  # share-target: a bare link was shared
        destination = (body_json.get("destination") or q_params.get("destination", ["youtube"])[0] or "youtube").lower()
        encoded = urllib.parse.quote_plus(query)

        if destination in ("hotstar", "disney"):
            target_url = f"https://www.hotstar.com/in/explore?search_query={encoded}"
        elif destination in ("web", "google"):
            target_url = f"https://www.google.com/search?q={encoded}"
        else:
            target_url = f"https://www.youtube.com/results?search_query={encoded}"

        if query:
            loop = _get_main_loop()
            if kiosk_supervisor.is_running and loop and loop.is_running():
                try:
                    asyncio.run_coroutine_threadsafe(cdp_bridge.navigate(target_url), loop)
                except Exception:
                    launch_target(target_url)
            else:
                launch_target(target_url)
            park_cursor()

        # FIX: share-target requests are browser form POSTs — they expect an HTML
        # page, not raw JSON. Detect form posts and reply with a friendly page.
        ctype = (self.headers.get("Content-Type") or "").lower()
        if "application/x-www-form-urlencoded" in ctype or "multipart/form-data" in ctype:
            page = (
                "<!DOCTYPE html><html><head><meta charset='utf-8'>"
                "<meta name='viewport' content='width=device-width,initial-scale=1'>"
                "<title>Shared to MOM TV</title></head>"
                "<body style=\"background:#0b0c10;color:#fff;font-family:system-ui;display:flex;"
                "align-items:center;justify-content:center;height:100vh;margin:0\">"
                "<div style='text-align:center'><h1>✅ Sent to TV</h1>"
                f"<p style='color:#888'>{html.escape(query[:120])}</p></div></body></html>"
            ).encode("utf-8")
            self.send_response(200)
            self.end_headers_with_cors("text/html; charset=utf-8")
            self.wfile.write(page)
            return

        payload = {
            "status": "ok",
            "cmd": "search",
            "query": query,
            "destination": destination,
            "target": target_url,
        }
        body = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(200)
        self.end_headers_with_cors("application/json; charset=utf-8")
        self.wfile.write(body)


    def do_DELETE(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path.rstrip("/")

            allowed_origin, _ = self._is_origin_allowed()
            if not allowed_origin:
                self.send_response(403)
                self.end_headers_with_cors("application/json; charset=utf-8")
                self.wfile.write(b'{"status": "error", "message": "Cross-origin request rejected"}')
                return

            if not self._verify_token():
                self.send_response(401)
                self.end_headers_with_cors("application/json; charset=utf-8")
                self.wfile.write(b'{"status": "error", "message": "Unauthorized: valid AUTH_TOKEN required"}')
                return

            # FIX: URL-decode the app id — ids with spaces/special chars never matched.
            app_id = ""
            if path.startswith("/api/apps/"):
                app_id = urllib.parse.unquote(path.split("/api/apps/", 1)[1])
            elif path == "/api/apps":
                q_params = urllib.parse.parse_qs(parsed.query)
                app_id = q_params.get("id", [""])[0] or q_params.get("app", [""])[0]

            if app_id:
                deleted = delete_custom_app(app_id)
                if deleted:
                    notify_apps_updated()
                res = {"status": "ok" if deleted else "not_found", "deleted": deleted, "id": app_id}
                self.send_response(200 if deleted else 404)
            else:
                res = {"status": "error", "message": "Missing app id"}
                self.send_response(400)

            self.end_headers_with_cors("application/json; charset=utf-8")
            self.wfile.write(json.dumps(res, indent=2).encode("utf-8"))
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            pass
        except Exception as e:
            print(f"[-] HTTP DELETE exception: {e}")

    def _handle_get(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip("/")
        if not path:
            path = "/"
            
        if path == "/api/health":
            body = json.dumps({"status": "ok", "uptime": time.time() - START_TIME}).encode("utf-8")
            self.send_response(200)
            self.end_headers_with_cors("application/json; charset=utf-8")
            self.wfile.write(body)
            return

        # Block GET requests on state-changing endpoints (Fix for Bug 3 drive-by attacks)
        if path in ("/api/kiosk/close", "/api/kiosk_close", "/api/exit", "/api/search", "/api/launch", "/api/open"):
            self.send_response(405)
            self.send_header("Allow", "POST")
            self.end_headers_with_cors("application/json; charset=utf-8")
            self.wfile.write(b'{"status": "error", "message": "Method Not Allowed. State-changing endpoints require POST + token."}')
            return

        # 1. Remote Controller (index.html)
        if path in ("/", "/remote", "/index.html"):
            q_params = urllib.parse.parse_qs(parsed.query)
            token_param = q_params.get("token", [""])[0]
            set_cookie = bool(token_param and hmac.compare_digest(token_param, AUTH_TOKEN))
            self.serve_file_or_fallback(
                "index.html",
                "text/html; charset=utf-8",
                b"<!DOCTYPE html><html><head><title>MOM TV Remote</title></head>"
                b"<body style='background:#111;color:#fff;'><h1>MOM TV Remote</h1></body></html>",
                set_auth_cookie=set_cookie,
            )
            return

        # 2. TV Leanback Launcher (tv.html)
        if path in ("/tv", "/tv.html"):
            q_params = urllib.parse.parse_qs(parsed.query)
            token_param = q_params.get("token", [""])[0]
            set_cookie = bool(token_param and hmac.compare_digest(token_param, AUTH_TOKEN))
            fallback_tv = (
                b"<!DOCTYPE html><html><head><meta charset='UTF-8'>"
                b"<title>MOM TV Launcher</title></head>"
                b"<body style='background:#0b0c10;color:#fff;font-family:sans-serif;"
                b"display:flex;align-items:center;justify-content:center;height:100vh;margin:0;'>"
                b"<div style='text-align:center'><h1>MOM TV 2.0 Launcher Ready</h1>"
                b"<p style='color:#888'>Waiting for TV interface assets...</p></div></body></html>"
            )
            self.serve_file_or_fallback("tv.html", "text/html; charset=utf-8", fallback_tv, set_auth_cookie=set_cookie)
            return

        # 2b. Injected Smart TV Engine (tv-engine.js)
        if path == "/tv-engine.js":
            fallback_engine = b"// MOM TV Injected Engine Fallback\nwindow.MomTV = window.MomTV || {};\n"
            self.serve_file_or_fallback("tv-engine.js", "application/javascript; charset=utf-8", fallback_engine)
            return

        # 3. PWA Manifest
        if path == "/manifest.json":
            # FIX (SECURITY): never embed AUTH_TOKEN here. This endpoint is served
            # WITHOUT authentication, so a token in start_url leaked it to any
            # device on the LAN. The real token now reaches the client only via
            # the pairing link / Set-Cookie on / and /tv.
            fallback_manifest = json.dumps(
                {
                    "name": "MOM TV Remote",
                    "short_name": "MomTV",
                    "start_url": "/",
                    "display": "standalone",
                    "background_color": "#0b0c10",
                    "theme_color": "#0b0c10",
                    "orientation": "portrait",
                },
                indent=2,
            ).encode("utf-8")
            self.serve_file_or_fallback(
                "manifest.json", "application/manifest+json; charset=utf-8", fallback_manifest
            )
            return

        # 4. Service Worker
        if path == "/sw.js":
            fallback_sw = (
                b"self.addEventListener('install', (e) => self.skipWaiting());\n"
                b"self.addEventListener('activate', (e) => self.clients.claim());\n"
            )
            filepath = os.path.join(BASE_DIR, "sw.js")
            if os.path.isfile(filepath):
                with open(filepath, "rb") as f:
                    fallback_sw = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.send_header("Service-Worker-Allowed", "/")
            self.end_headers_with_cors("application/javascript; charset=utf-8")
            self.wfile.write(fallback_sw)
            return

        # 5. System Info API
        if path in ("/api/info", "/api/status", "/info"):
            payload = {
                "status": "online",
                "ip": LOCAL_IP,
                "http_port": HTTP_PORT,
                "ws_port": WS_PORT,
                "cdp_port": CDP_PORT,
                "cdp_connected": cdp_bridge.is_connected,
                "kiosk_active": kiosk_supervisor.is_running,
                "browser": kiosk_supervisor.browser_name,
                "browser_path": kiosk_supervisor.browser_path,
                "remote_url": f"http://{LOCAL_IP}:{HTTP_PORT}/remote?token={AUTH_TOKEN}",
                "tv_url": f"http://{LOCAL_IP}:{HTTP_PORT}/tv?token={AUTH_TOKEN}",
                "version": "2.1.1",
            }
            body = json.dumps(payload, indent=2).encode("utf-8")
            self.send_response(200)
            self.end_headers_with_cors("application/json; charset=utf-8")
            self.wfile.write(body)
            return

        # 5b. Pairing QR Code SVG API
        if path in ("/api/qr", "/api/qr.svg"):
            try:
                svg_data = get_qr_svg_data()
                self.send_response(200)
                self.end_headers_with_cors("image/svg+xml")
                self.wfile.write(svg_data)
                return
            except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
                return
            except Exception as e:
                try:
                    self.send_response(500)
                    self.end_headers_with_cors("text/plain")
                    self.wfile.write(str(e).encode("utf-8"))
                except Exception:
                    pass
                return

        # 5c. Apps API (GET all apps)
        if path == "/api/apps":
            apps = load_all_apps()
            body = json.dumps({"status": "ok", "apps": apps}, indent=2).encode("utf-8")
            self.send_response(200)
            self.end_headers_with_cors("application/json; charset=utf-8")
            self.wfile.write(body)
            return

        # 5d. App Preview API (Auto-extract metadata for custom website URL)
        if path in ("/api/app/preview", "/api/preview"):
            if not self._verify_token():
                self.send_response(401)
                self.end_headers_with_cors("application/json; charset=utf-8")
                self.wfile.write(b'{"status": "error", "message": "Unauthorized: valid AUTH_TOKEN required"}')
                return
            q_params = urllib.parse.parse_qs(parsed.query)
            target_url = q_params.get("url", [""])[0]
            meta = extract_website_metadata(target_url)
            status_code = 200 if meta.get("status") == "ok" else 400
            body = json.dumps(meta, indent=2).encode("utf-8")
            self.send_response(status_code)
            self.end_headers_with_cors("application/json; charset=utf-8")
            self.wfile.write(body)
            return

        # 6. Static Asset Handling (Strict Allowlist Enforcement & Safe Path Resolution)
        # Decode percent-encoded characters (e.g. %20 -> space), reject null bytes
        decoded_path = urllib.parse.unquote(parsed.path)
        if "\x00" in decoded_path:
            self.send_response(400)
            self.end_headers_with_cors("text/plain")
            self.wfile.write(b"Bad Request")
            return

        clean_rel = decoded_path.lstrip("/\\").replace("\\", "/")
        path_segments = [seg for seg in clean_rel.split("/") if seg]

        # Defense 1: Reject empty or hidden paths (.brave_tv_profile, .venv, .git, etc.)
        if not path_segments or any(seg.startswith(".") for seg in path_segments):
            self.send_response(403)
            self.end_headers_with_cors("text/plain")
            self.wfile.write(b"Forbidden")
            return

        # Defense 2: Validate against allowlists
        is_allowed = False
        if len(path_segments) == 1 and path_segments[0].lower() in _ALLOWED_STATIC_FILES_LC:
            is_allowed = True
        elif len(path_segments) > 1 and path_segments[0].lower() in _ALLOWED_STATIC_DIRS_LC:
            is_allowed = True

        if not is_allowed:
            self.send_response(404)
            self.end_headers_with_cors("text/plain")
            self.wfile.write(b"404 Not Found")
            return

        # Defense 3: Canonical path resolution & containment check via os.path.commonpath
        base_dir = os.path.normpath(os.path.abspath(BASE_DIR))
        norm_path = os.path.normpath(os.path.abspath(os.path.join(base_dir, clean_rel)))

        try:
            # FIX: `except (ValueError, Exception)` — Exception already covers ValueError.
            is_safe = os.path.commonpath([norm_path, base_dir]).lower() == base_dir.lower()
        except Exception:
            is_safe = False

        if not is_safe:
            self.send_response(403)
            self.end_headers_with_cors("text/plain")
            self.wfile.write(b"Forbidden")
            return

        # Defense 4: Enforce known safe MIME types only (never serve unknown extensions or code files)
        ext = os.path.splitext(norm_path)[1].lower()
        if ext not in MIME_TYPES:
            self.send_response(404)
            self.end_headers_with_cors("text/plain")
            self.wfile.write(b"404 Not Found")
            return

        if os.path.isfile(norm_path):
            mime = MIME_TYPES[ext]
            try:
                with open(norm_path, "rb") as f:
                    content = f.read()
                self.send_response(200)
                self.end_headers_with_cors(mime)
                self.wfile.write(content)
                return
            except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
                return
            except Exception as e:
                try:
                    self.send_response(500)
                    self.end_headers_with_cors("text/plain")
                    self.wfile.write(str(e).encode("utf-8"))
                except Exception:
                    pass
                return

        # Not Found
        self.send_response(404)
        self.end_headers_with_cors("text/plain")
        self.wfile.write(b"404 Not Found")


class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True

    def handle_error(self, request, client_address):
        # Gracefully ignore socket disconnects when browsers abort requests
        exc_type, _, _ = sys.exc_info()
        if exc_type in (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            return
        super().handle_error(request, client_address)


def start_http_server():
    """Run multi-threaded HTTP server on port 8765 with auto-recovery."""
    while True:
        try:
            server = ReusableThreadingHTTPServer(("0.0.0.0", HTTP_PORT), SmartTVHTTPRequestHandler)
            server.serve_forever()
        except Exception as e:
            print(f"[-] HTTP server error: {e}. Recovering in 2s...")
            time.sleep(2)