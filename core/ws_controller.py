"""
core/ws_controller.py — Real-Time WebSocket Automation Engine
Responsibilities: Phone remote connection lifecycle, server-side directional key debounce (80ms), and command routing.
"""

import sys
import time
import json
import urllib.parse
import asyncio
import websockets
import os
import hmac
from core.config import (
    WS_PORT,
    HTTP_PORT,
    CDP_PORT,
    AUTH_TOKEN,
    TV_URL,
    VK_MAP,
    CDP_KEY_MAP,
)
from core.win32_input import (
    user32,
    press_vk,
    combo,
    send_unicode_text,
    park_cursor,
    handle_volume,
    handle_power,
    MOUSEEVENTF_MOVE,
    MOUSEEVENTF_LEFTDOWN,
    MOUSEEVENTF_LEFTUP,
    MOUSEEVENTF_RIGHTDOWN,
    MOUSEEVENTF_RIGHTUP,
    MOUSEEVENTF_WHEEL,
)
from core.apps_manager import (
    APP_SHORTCUTS,
    load_all_apps,
    save_custom_app,
    delete_custom_app,
)
from core.kiosk_supervisor import kiosk_supervisor
from core.cdp_bridge import cdp_bridge
from core.launcher import launch_target
from core.net_utils import LOCAL_IP

__all__ = [
    "CONNECTED_CLIENTS",
    "CLIENT_LAST_KEY_TIME",
    "SERVER_DEBOUNCE_KEYS",
    "SERVER_DEBOUNCE_INTERVAL_SEC",
    "broadcast_status",
    "notify_apps_updated",
    "handle_websocket_message",
    "websocket_handler",
]

# FIX: `set[websockets.WebSocketServerProtocol]` crashed the import on
# websockets >= 14 (the legacy protocol class was removed). A plain set with no
# protocol-specific annotation is version-proof.
CONNECTED_CLIENTS: set = set()

# Server-side debounce tracking per client session (80ms debounce on directional/discrete keys)
# Guarantees that duplicate network packets or rapid touch repeats never trigger double moves
CLIENT_LAST_KEY_TIME: dict = {}
SERVER_DEBOUNCE_KEYS = {"up", "down", "left", "right", "ok", "enter", "back"}
SERVER_DEBOUNCE_INTERVAL_SEC = 0.080  # 80ms responsive debounce
MAX_UNAUTHORIZED_ATTEMPTS = 5  # FIX: cap failed auth attempts before dropping the connection


from core.loop_registry import get_loop

# Tests should monkeypatch core.win32_input directly instead of relying on app facade indirection.

async def broadcast_status(data: dict):
    """Broadcast an event or status dictionary to all connected remotes."""
    if not CONNECTED_CLIENTS:
        return
    message = json.dumps(data)
    await asyncio.gather(
        *(client.send(message) for client in list(CONNECTED_CLIENTS)),
        return_exceptions=True,
    )


def notify_apps_updated():
    """Notify all connected WebSocket clients (TV & remotes) that apps have changed."""
    loop = get_loop()
    if loop and loop.is_running():
        apps = load_all_apps()
        asyncio.run_coroutine_threadsafe(
            broadcast_status({"type": "apps_updated", "apps": apps}),
            loop,
        )

async def _try_cdp_or_fallback(cdp_coro, fallback_fn):
    """Run CDP coroutine if connected, else run fallback synchronous function."""
    if cdp_bridge.is_connected:
        return await cdp_coro
    else:
        return fallback_fn()


async def _cmd_launch(data: dict, ws=None) -> dict:
    cmd = "launch"
    response = {"status": "ok", "cmd": cmd}
    target = data.get("url") or data.get("app") or data.get("target", "")
    resolved = APP_SHORTCUTS.get(str(target).lower(), target)

    if not kiosk_supervisor.is_running:
        kiosk_supervisor.start(initial_url=resolved)
        park_cursor()
        response["target"] = resolved
        response["method"] = "kiosk_launch"
        return response

    if resolved.startswith("http://") or resolved.startswith("https://"):
        success = await cdp_bridge.navigate(resolved)
        if not success:
            launch_target(resolved)
        park_cursor()
        response["target"] = resolved
        response["method"] = "cdp_navigate" if success else "fallback_launch"
    elif resolved.startswith("file:///") or os.path.exists(resolved):
        # FIX: os.startfile only exists on Windows — guard so non-Windows test runs don't crash.
        if hasattr(os, "startfile"):
            os.startfile(resolved)
        park_cursor()
        response["target"] = resolved
        response["method"] = "os_startfile"
    else:
        launch_target(resolved)
        response["target"] = resolved
        response["method"] = "fallback_launch"
    return response

async def _cmd_home(data: dict, ws=None) -> dict:
    cmd = "home"
    response = {"status": "ok", "cmd": cmd}
    if not kiosk_supervisor.is_running:
        kiosk_supervisor.start()

    success = await cdp_bridge.home()
    if not success:
        launch_target(TV_URL, is_home=True)
    park_cursor()
    response["action"] = "home"
    response["method"] = "cdp_navigate" if success else "fallback_home"
    return response

async def _cmd_get_apps(data: dict, ws=None) -> dict:
    return {"status": "ok", "cmd": "get_apps", "apps": load_all_apps()}

async def _cmd_add_app(data: dict, ws=None) -> dict:
    app_dict = data.get("app") or data
    saved = save_custom_app(app_dict)
    # FIX: only broadcast (and report success) when the save actually succeeded —
    # previously a failed save was reported as "ok" and still pushed to all clients.
    if saved.get("status") == "ok":
        notify_apps_updated()
    return {"status": saved.get("status", "error"), "cmd": "add_app", "result": saved}

async def _cmd_delete_app(data: dict, ws=None) -> dict:
    app_id = data.get("id") or data.get("app_id", "")
    deleted = delete_custom_app(app_id)
    if deleted:
        notify_apps_updated()
    return {"status": "ok" if deleted else "not_found", "cmd": "delete_app", "deleted": deleted}

async def _cmd_key(data: dict, ws=None) -> dict:
    cmd = "key"
    response = {"status": "ok", "cmd": cmd}
    k = str(data.get("key", "")).lower()
    client_id = id(ws) if ws is not None else "global"
    now = time.monotonic()

    if k in SERVER_DEBOUNCE_KEYS:
        last_time = CLIENT_LAST_KEY_TIME.get(client_id, 0.0)
        if (now - last_time) < SERVER_DEBOUNCE_INTERVAL_SEC:
            response["key"] = k
            response["handled"] = False
            response["debounced"] = True
            return response
        CLIENT_LAST_KEY_TIME[client_id] = now

    response["key"] = k

    if cdp_bridge.is_connected:
        handled = await cdp_bridge.dispatch_key(k)
        response["handled"] = bool(handled)
        response["method"] = "cdp"

        if not handled and k not in CDP_KEY_MAP:
            if k in ("reload", "refresh"):
                await cdp_bridge.reload()
            elif k == "home":
                # FIX: the 'home' remote key previously fell through and did nothing
                # when the engine didn't handle it — route it to the launcher.
                await cdp_bridge.home()
            elif k in ("zoomin", "zoom_in"):
                await cdp_bridge.evaluate("window.MomTV?.zoomIn?.()")
            elif k in ("zoomout", "zoom_out"):
                await cdp_bridge.evaluate("window.MomTV?.zoomOut?.()")
            elif k in ("zoomreset", "zoom_reset"):
                combo([0x11, 0x30])
            elif k in VK_MAP:
                press_vk(VK_MAP[k])
    else:
        response["handled"] = False
        response["method"] = "vk_fallback"
        if k in VK_MAP:
            press_vk(VK_MAP[k])
        elif k == "back":
            combo([0x12, 0x25])
        elif k == "forward":
            combo([0x12, 0x27])
        elif k in ("reload", "refresh"):
            combo([0x11, 0x52])
        elif k in ("zoomin", "zoom_in"):
            combo([0x11, 0xBB])
        elif k in ("zoomout", "zoom_out"):
            combo([0x11, 0xBD])
        elif k in ("zoomreset", "zoom_reset"):
            combo([0x11, 0x30])
        elif k in ("rewind", "rewind10", "replay"):
            press_vk(0x25)
        elif k in ("forward10", "fastforward", "skip"):
            press_vk(0x27)
        elif k in ("playpause", "play_pause", "toggle_play"):
            press_vk(0xB3)

    if k in ("up", "down", "left", "right", "enter", "ok", "back", "home"):
        park_cursor()

    return response

async def _cmd_combo(data: dict, ws=None) -> dict:
    response = {"status": "ok", "cmd": "combo"}
    keys = data.get("keys", [])
    vk_list = [VK_MAP.get(str(k).lower(), 0) for k in keys if str(k).lower() in VK_MAP]
    if vk_list:
        combo(vk_list)
        response["keys"] = keys
    return response

async def _cmd_volume(data: dict, ws=None) -> dict:
    action = data.get("action") or data.get("direction") or data.get("key", "")
    handle_volume(action)
    return {"status": "ok", "cmd": "volume", "volume_action": action}

async def _cmd_power(data: dict, ws=None) -> dict:
    action = data.get("action") or data.get("state", "sleep")
    handle_power(action)
    return {"status": "ok", "cmd": "power", "power_action": action}

async def _cmd_cursor(data: dict, ws=None) -> dict:
    park_cursor()
    return {"status": "ok", "cmd": "cursor", "cursor": "parked"}

async def _cmd_kiosk_close(data: dict, ws=None) -> dict:
    print("💻 [Server] Exit to Windows requested. Stopping Brave Kiosk...")
    kiosk_supervisor.stop()
    try:
        user32.SetCursorPos(500, 500)
    except Exception as e:
        print(f"[-] Failed to reposition cursor: {e}")
    return {"status": "ok", "cmd": "kiosk_close", "message": "Brave Kiosk closed, returned to Windows desktop"}

async def _cmd_search(data: dict, ws=None) -> dict:
    # FIX: accept the fields the PWA share-target / richer clients send
    # (query/q/text/title/url) — previously only "query" was read.
    query = str(
        data.get("query") or data.get("q") or data.get("text") or data.get("title") or ""
    ).strip()
    shared_url = str(data.get("url") or "").strip()
    if not query and shared_url:
        query = shared_url  # a bare link was shared
    destination = str(data.get("destination", "youtube")).lower()
    encoded = urllib.parse.quote_plus(query)

    if destination in ("hotstar", "disney", "jiohotstar"):
        target_url = f"https://www.jiohotstar.com/in/explore?search_query={encoded}"
    elif destination in ("web", "google"):
        target_url = f"https://www.google.com/search?q={encoded}"
    else:
        target_url = f"https://www.youtube.com/results?search_query={encoded}"

    if query:
        if cdp_bridge.is_connected:
            await cdp_bridge.navigate(target_url)
        else:
            launch_target(target_url)
        park_cursor()

    return {"status": "ok", "cmd": "search", "query": query, "destination": destination, "target": target_url}

async def _cmd_text(data: dict, ws=None) -> dict:
    val = data.get("value") or data.get("text", "")
    if cdp_bridge.is_connected:
        # Prefer MomTV.typeText — it handles React/Vue synthetic input events
        typed = await cdp_bridge.evaluate(f"window.MomTV?.typeText?.({json.dumps(val)})")
        if not typed:
            # Fallback to CDP raw text insertion
            await cdp_bridge.send("Input.insertText", {"text": val}, wait_response=False)
    else:
        # No CDP — use Win32 keyboard simulation
        send_unicode_text(val)
    return {"status": "ok", "cmd": "text", "typed_chars": len(val)}

async def _cmd_ping(data: dict, ws=None) -> dict:
    return {"status": "ok", "cmd": "ping", "pong": True}

async def _cmd_mouse_move(data: dict, ws=None) -> dict:
    response = {"status": "ok", "cmd": "mouse_move"}
    try:
        dx = float(data.get("dx", 0))
        dy = float(data.get("dy", 0))
        if cdp_bridge.is_connected:
            await cdp_bridge.send("Runtime.evaluate", {
                "expression": f"window.MomTV?.moveCursor?.({dx}, {dy})",
                "returnByValue": False
            }, wait_response=False)
        else:
            # FIX: only drive the real OS cursor when CDP is unavailable. Firing BOTH
            # (page virtual cursor + hidden OS cursor) moved/clicked twice per event.
            user32.mouse_event(MOUSEEVENTF_MOVE, int(dx), int(dy), 0, 0)
        response["dx"] = dx
        response["dy"] = dy
    except Exception as e:
        response["error"] = str(e)
    return response

async def _cmd_mouse_click(data: dict, ws=None) -> dict:
    response = {"status": "ok", "cmd": "mouse_click"}
    try:
        button = str(data.get("button", "left")).lower()
        if cdp_bridge.is_connected:
            await cdp_bridge.send("Runtime.evaluate", {
                "expression": "window.MomTV?.clickCursor?.()",
                "returnByValue": False
            }, wait_response=False)
        else:
            # FIX: same as mouse_move — real OS clicks only when CDP is down.
            if button == "right":
                user32.mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0)
                user32.mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0)
            else:
                user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
                user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
        response["button"] = button
    except Exception as e:
        response["error"] = str(e)
    return response

async def _cmd_mouse_scroll(data: dict, ws=None) -> dict:
    response = {"status": "ok", "cmd": "mouse_scroll"}
    try:
        dy = float(data.get("dy", 0))
        if cdp_bridge.is_connected:
            # FIX: MomTV.scrollBy() returns undefined, so the old
            # `MomTV?.scrollBy?.(dy) ?? window.scrollBy(0, dy)` ALSO executed
            # window.scrollBy — every remote scroll jumped the page twice.
            # Branch on existence instead of the return value.
            await cdp_bridge.send("Runtime.evaluate", {
                "expression": f"(window.MomTV && typeof window.MomTV.scrollBy === 'function') ? window.MomTV.scrollBy({dy}) : window.scrollBy(0, {dy})",
                "returnByValue": False
            }, wait_response=False)
        else:
            user32.mouse_event(MOUSEEVENTF_WHEEL, 0, 0, int(-dy), 0)
        response["dy"] = dy
    except Exception as e:
        response["error"] = str(e)
    return response


COMMAND_HANDLERS = {
    'launch': _cmd_launch,
    'home': _cmd_home,
    'get_apps': _cmd_get_apps,
    'add_app': _cmd_add_app,
    'delete_app': _cmd_delete_app,
    'key': _cmd_key,
    'combo': _cmd_combo,
    'volume': _cmd_volume,
    'power': _cmd_power,
    'cursor': _cmd_cursor,
    'park_cursor': _cmd_cursor,
    'hide_cursor': _cmd_cursor,
    'kiosk_close': _cmd_kiosk_close,
    'exit_windows': _cmd_kiosk_close,
    'close_kiosk': _cmd_kiosk_close,
    'search': _cmd_search,
    'text': _cmd_text,
    'ping': _cmd_ping,
    'mouse_move': _cmd_mouse_move,
    'mouse_click': _cmd_mouse_click,
    'mouse_scroll': _cmd_mouse_scroll,
}


async def handle_websocket_message(data: dict, ws=None) -> dict:
    """Process incoming command packet from phone remote or automation client."""
    cmd = data.get("cmd", "").lower()
    handler = COMMAND_HANDLERS.get(cmd)
    if handler:
        return await handler(data, ws)
    return {"status": "unknown_cmd", "cmd": cmd}


def _is_ws_origin_allowed(ws) -> bool:
    """Verify that WebSocket connection origin is from LAN or localhost."""
    try:
        req = getattr(ws, "request", None)
        origin = None
        if req and hasattr(req, "headers"):
            origin = req.headers.get("Origin") or req.headers.get("Referer")
        if not origin:
            return True
        p = urllib.parse.urlsplit(origin)
        host = (p.hostname or "").lower()
        allowed = {"localhost", "127.0.0.1", LOCAL_IP.lower()}
        return host in allowed
    except Exception:
        return True


def _is_ws_token_valid(ws, data: dict = None) -> bool:
    """Check if client presented valid AUTH_TOKEN in URL or message payload."""
    try:
        req = getattr(ws, "request", None)
        if req and hasattr(req, "path"):
            parsed = urllib.parse.urlsplit(req.path)
            q = urllib.parse.parse_qs(parsed.query)
            token = q.get("token", [""])[0]
            if token and hmac.compare_digest(token, AUTH_TOKEN):
                return True
        if data and isinstance(data, dict):
            t1 = data.get("token", "")
            t2 = data.get("auth", "")
            if (t1 and hmac.compare_digest(str(t1), AUTH_TOKEN)) or (t2 and hmac.compare_digest(str(t2), AUTH_TOKEN)):
                return True
    except Exception:
        pass
    return False


async def websocket_handler(ws):
    """Handle incoming WebSocket connections from phone remotes and TV clients."""
    peer = ws.remote_address if hasattr(ws, "remote_address") else "unknown"

    # Reject cross-origin connections from unauthorized domains (Bug 3 drive-by defense)
    if not _is_ws_origin_allowed(ws):
        print(f"🚫 [WebSocket] Rejected cross-origin connection from {peer}")
        try:
            await ws.close(1008, "Cross-origin rejected")
        except Exception:
            pass
        return

    CONNECTED_CLIENTS.add(ws)
    print(f"📱 Remote connected: {peer} (Total active: {len(CONNECTED_CLIENTS)})")

    # Mark authenticated if token was passed in query parameter
    if _is_ws_token_valid(ws):
        setattr(ws, "_is_auth", True)

    unauthorized_attempts = 0  # FIX: track failed auth attempts per connection

    # Immediate welcome handshake response
    welcome = {
        "type": "welcome",
        "status": "connected",
        "server": "MOM TV Server 2.1 (CDP Enabled)",
        "ip": LOCAL_IP,
        "http_port": HTTP_PORT,
        "ws_port": WS_PORT,
        "cdp_port": CDP_PORT,
        "browser": kiosk_supervisor.browser_name,
        "cdp_active": cdp_bridge.is_connected,
        "authenticated": getattr(ws, "_is_auth", False),
    }
    await ws.send(json.dumps(welcome))
    await broadcast_status({
        "type": "clients_update",
        "count": len(CONNECTED_CLIENTS),
        "has_remote": len(CONNECTED_CLIENTS) > 1,
    })

    try:
        async for raw_message in ws:
            try:
                data = json.loads(raw_message)
            except Exception:
                await ws.send(json.dumps({"status": "error", "message": "Invalid JSON"}))
                continue

            # Verify authentication
            if not getattr(ws, "_is_auth", False):
                if _is_ws_token_valid(ws, data):
                    setattr(ws, "_is_auth", True)
                    if data.get("cmd") == "auth":
                        await ws.send(json.dumps({"status": "ok", "type": "auth_success"}))
                        continue
                else:
                    # FIX: unauthenticated clients used to stay connected forever,
                    # able to spam auth attempts indefinitely. Cap the attempts.
                    unauthorized_attempts += 1
                    if unauthorized_attempts >= MAX_UNAUTHORIZED_ATTEMPTS:
                        try:
                            await ws.close(1008, "Too many unauthorized attempts")
                        except Exception:
                            pass
                        break
                    await ws.send(json.dumps({"status": "error", "message": "Unauthorized: valid token required"}))
                    continue

            response = await handle_websocket_message(data, ws)
            await ws.send(json.dumps(response))

    except websockets.exceptions.ConnectionClosed:
        pass
    except Exception as e:
        print(f"[-] WebSocket handler error: {e}")
    finally:
        CONNECTED_CLIENTS.discard(ws)
        CLIENT_LAST_KEY_TIME.pop(id(ws), None)
        print(f"📱 Remote disconnected: {peer} (Remaining: {len(CONNECTED_CLIENTS)})")
        await broadcast_status({
            "type": "clients_update",
            "count": len(CONNECTED_CLIENTS),
            "has_remote": len(CONNECTED_CLIENTS) > 1,
        })