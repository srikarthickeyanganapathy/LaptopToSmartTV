"""
core/ws_controller.py — Real-Time WebSocket Automation Engine
Responsibilities: Phone remote connection lifecycle, server-side directional key debounce (120ms), and command routing.
"""

import sys
import time
import json
import urllib.parse
import asyncio
import websockets
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

CONNECTED_CLIENTS: set[websockets.WebSocketServerProtocol] = set()

# Server-side debounce tracking per client session (120ms debounce on directional/discrete keys)
# Guarantees that duplicate network packets or rapid touch repeats never trigger double moves
CLIENT_LAST_KEY_TIME: dict[any, float] = {}
SERVER_DEBOUNCE_KEYS = {"up", "down", "left", "right", "ok", "enter", "back"}
SERVER_DEBOUNCE_INTERVAL_SEC = 0.080  # 80ms responsive debounce


def _get_main_loop() -> asyncio.AbstractEventLoop | None:
    """Safely obtain the active main asyncio event loop."""
    app_mod = sys.modules.get("app")
    if app_mod and getattr(app_mod, "MAIN_LOOP", None):
        return app_mod.MAIN_LOOP
    try:
        return asyncio.get_running_loop()
    except RuntimeError:
        return None


def _dispatch_press_vk(vk_code: int):
    """Dynamically resolve press_vk from app facade to respect unittest mocks."""
    app_mod = sys.modules.get("app")
    if app_mod and hasattr(app_mod, "press_vk"):
        app_mod.press_vk(vk_code)
    else:
        press_vk(vk_code)


def _dispatch_combo(vk_list: list):
    """Dynamically resolve combo from app facade to respect unittest mocks."""
    app_mod = sys.modules.get("app")
    if app_mod and hasattr(app_mod, "combo"):
        app_mod.combo(vk_list)
    else:
        combo(vk_list)


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
    loop = _get_main_loop()
    if loop and loop.is_running():
        apps = load_all_apps()
        asyncio.run_coroutine_threadsafe(
            broadcast_status({"type": "apps_updated", "apps": apps}),
            loop,
        )


async def handle_websocket_message(data: dict, ws=None) -> dict:
    """Process incoming command packet from phone remote or automation client."""
    cmd = data.get("cmd", "").lower()
    response = {"status": "ok", "cmd": cmd}

    # ------------------------------------------------------------------
    # 1. LAUNCH APP / URL (Single-Window CDP Navigation)
    # ------------------------------------------------------------------
    if cmd == "launch":
        target = data.get("url") or data.get("app") or data.get("target", "")
        resolved = APP_SHORTCUTS.get(target.lower(), target)

        if not kiosk_supervisor.is_running:
            # Cold start directly with target URL (eliminates race condition)
            kiosk_supervisor.start(initial_url=resolved)
            park_cursor()
            response["target"] = resolved
            response["method"] = "kiosk_launch"
            return response

        if resolved.startswith("http://") or resolved.startswith("https://"):
            # Use CDP Page.navigate on existing kiosk tab (ZERO new windows spawned!)
            success = await cdp_bridge.navigate(resolved)
            if not success:
                # Fallback if CDP is not connected yet
                launch_target(resolved)
            park_cursor()
            response["target"] = resolved
            response["method"] = "cdp_navigate" if success else "fallback_launch"
        elif resolved.startswith("file:///") or os.path.exists(resolved):
            # Local filesystem directory or file
            os.startfile(resolved)
            park_cursor()
            response["target"] = resolved
            response["method"] = "os_startfile"
        else:
            launch_target(resolved)
            response["target"] = resolved
            response["method"] = "fallback_launch"

    # ------------------------------------------------------------------
    # 2. HOME / LAUNCHER (In-place CDP Navigation)
    # ------------------------------------------------------------------
    elif cmd == "home":
        if not kiosk_supervisor.is_running:
            kiosk_supervisor.start()

        success = await cdp_bridge.home()
        if not success:
            launch_target(TV_URL, is_home=True)
        park_cursor()
        response["action"] = "home"
        response["method"] = "cdp_navigate" if success else "fallback_home"

    # ------------------------------------------------------------------
    # 2b. DYNAMIC APPS MANAGEMENT (WebSocket)
    # ------------------------------------------------------------------
    elif cmd == "get_apps":
        response["apps"] = load_all_apps()

    elif cmd == "add_app":
        app_dict = data.get("app") or data
        saved = save_custom_app(app_dict)
        notify_apps_updated()
        response["result"] = saved

    elif cmd == "delete_app":
        app_id = data.get("id") or data.get("app_id", "")
        deleted = delete_custom_app(app_id)
        notify_apps_updated()
        response["deleted"] = deleted

    # ------------------------------------------------------------------
    # 3. KEY INPUT (Dual-Layer: CDP DOM/Engine + Hardware Win32 Fallback)
    # ------------------------------------------------------------------
    elif cmd == "key":
        k = str(data.get("key", "")).lower()
        client_id = id(ws) if ws is not None else "global"
        now = time.monotonic()

        # Server-side timestamp debounce (120ms) on directional/discrete keys per client session
        # Guarantees that duplicate network packets never trigger double moves
        if k in SERVER_DEBOUNCE_KEYS:
            last_time = CLIENT_LAST_KEY_TIME.get(client_id, 0.0)
            if (now - last_time) < SERVER_DEBOUNCE_INTERVAL_SEC:
                response["key"] = k
                response["handled"] = False
                response["debounced"] = True
                return response
            CLIENT_LAST_KEY_TIME[client_id] = now

        response["key"] = k

        # Step 1: Send via CDP Bridge if active/connected
        # When CDP is connected and handled/attempted the key, DO NOT call press_vk!
        if cdp_bridge.is_connected:
            handled = await cdp_bridge.dispatch_key(k)
            response["handled"] = bool(handled)
            response["method"] = "cdp"

            # Browser commands not covered by direct CDP key dispatch
            if not handled and k not in CDP_KEY_MAP:
                if k in ("reload", "refresh"):
                    await cdp_bridge.reload()
                elif k in ("zoomin", "zoom_in"):
                    _dispatch_combo([0x11, 0xBB])  # Ctrl + = (+)
                elif k in ("zoomout", "zoom_out"):
                    _dispatch_combo([0x11, 0xBD])  # Ctrl + -
                elif k in ("zoomreset", "zoom_reset"):
                    _dispatch_combo([0x11, 0x30])  # Ctrl + 0
                elif k in VK_MAP:
                    _dispatch_press_vk(VK_MAP[k])
        else:
            # Step 2: Hardware Fallback ONLY if CDP is completely offline/disconnected
            response["handled"] = False
            response["method"] = "vk_fallback"
            if k in VK_MAP:
                _dispatch_press_vk(VK_MAP[k])
            elif k == "back":
                _dispatch_combo([0x12, 0x25])  # Alt + Left (Hardware Browser Back)
            elif k == "forward":
                _dispatch_combo([0x12, 0x27])  # Alt + Right
            elif k in ("reload", "refresh"):
                _dispatch_combo([0x11, 0x52])  # Ctrl + R
            elif k in ("zoomin", "zoom_in"):
                _dispatch_combo([0x11, 0xBB])  # Ctrl + = (+)
            elif k in ("zoomout", "zoom_out"):
                _dispatch_combo([0x11, 0xBD])  # Ctrl + -
            elif k in ("zoomreset", "zoom_reset"):
                _dispatch_combo([0x11, 0x30])  # Ctrl + 0
            elif k in ("rewind", "rewind10", "replay"):
                _dispatch_press_vk(0x25)  # Left arrow
            elif k in ("forward10", "fastforward", "skip"):
                _dispatch_press_vk(0x27)  # Right arrow
            elif k in ("playpause", "play_pause", "toggle_play"):
                _dispatch_press_vk(0xB3)  # VK_MEDIA_PLAY_PAUSE

        # Automatically park mouse cursor off screen for dpad navigation
        if k in ("up", "down", "left", "right", "enter", "ok", "back", "home"):
            park_cursor()

    # ------------------------------------------------------------------
    # 4. CUSTOM COMBO
    # ------------------------------------------------------------------
    elif cmd == "combo":
        keys = data.get("keys", [])
        vk_list = [VK_MAP.get(str(k).lower(), 0) for k in keys if str(k).lower() in VK_MAP]
        if vk_list:
            _dispatch_combo(vk_list)
            response["keys"] = keys

    # ------------------------------------------------------------------
    # 5. HARDWARE VOLUME CONTROLS (Win32 API)
    # ------------------------------------------------------------------
    elif cmd == "volume":
        action = data.get("action") or data.get("direction") or data.get("key", "")
        handle_volume(action)
        response["volume_action"] = action

    # ------------------------------------------------------------------
    # 6. HARDWARE POWER & DISPLAY STANDBY (Win32 API)
    # ------------------------------------------------------------------
    elif cmd == "power":
        action = data.get("action") or data.get("state", "sleep")
        handle_power(action)
        response["power_action"] = action

    # ------------------------------------------------------------------
    # 7. CURSOR PARKING
    # ------------------------------------------------------------------
    elif cmd in ("cursor", "park_cursor", "hide_cursor"):
        park_cursor()
        response["cursor"] = "parked"

    # ------------------------------------------------------------------
    # 7b. KIOSK CLOSE (Exit to Windows Desktop)
    # ------------------------------------------------------------------
    elif cmd in ("kiosk_close", "exit_windows", "close_kiosk"):
        print("💻 [Server] Exit to Windows requested. Stopping Brave Kiosk...")
        kiosk_supervisor.stop()
        try:
            user32.SetCursorPos(500, 500)
        except Exception as e:
            print(f"[-] Failed to reposition cursor: {e}")
        response["cmd"] = "kiosk_close"
        response["message"] = "Brave Kiosk closed, returned to Windows desktop"
        response["status"] = "ok"

    # ------------------------------------------------------------------
    # 7c. UNIVERSAL SEARCH (YouTube / Hotstar / Google Web)
    # ------------------------------------------------------------------
    elif cmd == "search":
        query = str(data.get("query", "")).strip()
        destination = str(data.get("destination", "youtube")).lower()
        encoded = urllib.parse.quote_plus(query)

        if destination in ("hotstar", "disney"):
            target_url = f"https://www.hotstar.com/in/explore?search_query={encoded}"
        elif destination in ("web", "google"):
            target_url = f"https://www.google.com/search?q={encoded}"
        else:  # default youtube
            target_url = f"https://www.youtube.com/results?search_query={encoded}"

        if query:
            if cdp_bridge.is_connected:
                await cdp_bridge.navigate(target_url)
            else:
                launch_target(target_url)
            park_cursor()

        response["cmd"] = "search"
        response["query"] = query
        response["destination"] = destination
        response["target"] = target_url
        response["status"] = "ok"

    # ------------------------------------------------------------------
    # 8. TEXT ENTRY
    # ------------------------------------------------------------------
    elif cmd == "text":
        val = data.get("value") or data.get("text", "")
        # Dispatch text into DOM via CDP if active
        if cdp_bridge.is_connected:
            await cdp_bridge.send("Input.insertText", {"text": val}, wait_response=False)
        send_unicode_text(val)
        response["typed_chars"] = len(val)

    # ------------------------------------------------------------------
    # 9. PING / KEEP-ALIVE
    # ------------------------------------------------------------------
    elif cmd == "ping":
        response["pong"] = True

    # ------------------------------------------------------------------
    # 10. MOUSE MOVEMENT (Magic Trackpad / Cursor Sync)
    # ------------------------------------------------------------------
    elif cmd == "mouse_move":
        try:
            dx = float(data.get("dx", 0))
            dy = float(data.get("dy", 0))
            # 1. Execute via CDP
            if cdp_bridge.is_connected:
                await cdp_bridge.send("Runtime.evaluate", {
                    "expression": f"window.MomTV?.moveCursor?.({dx}, {dy})",
                    "returnByValue": False
                }, wait_response=False)
            # 2. Dispatch Windows mouse_event (0x0001 = MOUSEEVENTF_MOVE)
            user32.mouse_event(MOUSEEVENTF_MOVE, int(dx), int(dy), 0, 0)
            response["dx"] = dx
            response["dy"] = dy
        except Exception as e:
            response["error"] = str(e)

    # ------------------------------------------------------------------
    # 11. MOUSE CLICK (Magic Trackpad / Cursor Click)
    # ------------------------------------------------------------------
    elif cmd == "mouse_click":
        try:
            button = str(data.get("button", "left")).lower()
            # 1. Execute via CDP
            if cdp_bridge.is_connected:
                await cdp_bridge.send("Runtime.evaluate", {
                    "expression": "window.MomTV?.clickCursor?.()",
                    "returnByValue": False
                }, wait_response=False)
            # 2. Dispatch Windows mouse_event for left click (0x02 | 0x04) or right click (0x08 | 0x10)
            if button == "right":
                user32.mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0)
                user32.mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0)
            else:
                user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
                user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
            response["button"] = button
        except Exception as e:
            response["error"] = str(e)

    # ------------------------------------------------------------------
    # 12. MOUSE SCROLL (Magic Trackpad / Two-Finger / Scroll Strip)
    # ------------------------------------------------------------------
    elif cmd == "mouse_scroll":
        try:
            dy = float(data.get("dy", 0))
            # 1. Execute via CDP: window.scrollBy(0, dy)
            if cdp_bridge.is_connected:
                await cdp_bridge.send("Runtime.evaluate", {
                    "expression": f"window.scrollBy(0, {dy})",
                    "returnByValue": False
                }, wait_response=False)
            # 2. Dispatch Windows mouse_event (0x0800 = MOUSEEVENTF_WHEEL, -dy in Windows convention)
            user32.mouse_event(MOUSEEVENTF_WHEEL, 0, 0, int(-dy), 0)
            response["dy"] = dy
        except Exception as e:
            response["error"] = str(e)

    else:
        response["status"] = "unknown_cmd"

    return response


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
            if token and token == AUTH_TOKEN:
                return True
        if data and isinstance(data, dict):
            if data.get("token") == AUTH_TOKEN or data.get("auth") == AUTH_TOKEN:
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

    # Immediate welcome handshake response
    welcome = {
        "type": "welcome",
        "status": "connected",
        "server": "MOM TV Server 2.0 (CDP Enabled)",
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
