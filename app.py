"""
MOM TV 2.0 — High-Performance Windows Smart TV & Remote Server
SEB-Style Brave Kiosk Supervisor & Chrome DevTools Protocol (CDP) Bridge.

Entry point orchestrating HTTP, WebSocket, CDP Bridge, and Kiosk Supervisor.
Decomposed into modular architecture under core/ following SRP.

NOTE ON THIS FILE'S ROLE: everything below the imports is a thin facade —
the real logic lives in core/*.py. This module's own code only ever touches
config constants, `kiosk_supervisor`, `cdp_bridge`, `websocket_handler` and
`start_http_server`; everything else in the re-export list exists purely so
other code can keep doing `from app import <symbol>` instead of reaching
into `core.*` directly. If nothing outside this file actually relies on that,
the re-export list below is safe to trim — it's kept as-is here since I can't
see core/*.py to confirm what's still referenced that way.

NOTE ON MAIN_LOOP: this is a bare module global, set once `main()` starts.
Any other module that needs the live event loop to schedule work from a
non-asyncio thread (e.g. a Win32 message-pump thread) must access it as
`app.MAIN_LOOP` (attribute lookup at call time), never `from app import
MAIN_LOOP` (name-binding at import time, which would freeze on the initial
`None` forever).
"""

import sys
import traceback
import threading
import asyncio
import websockets
import argparse

# Ensure Windows stdout supports UTF-8 for clean ASCII QR code and emojis
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from core.loop_registry import set_loop
from core.logging_config import setup_logging

# ==============================================================================
# SUBSYSTEM IMPORTS & RE-EXPORTS (SRP FACADE)
# ==============================================================================
from core.config import (
    HTTP_PORT,
    WS_PORT,
    CDP_PORT,
    AUTH_TOKEN,
    BASE_DIR,
    BRAVE_PROFILE_DIR,
    TV_URL,
    SMART_TV_UA,
    DEFAULT_APPS,
    CUSTOM_APPS_FILE,
    MIME_TYPES,
    VK_MAP,
    CDP_KEY_MAP,
)
from core.win32_input import (
    user32,
    powrprof,
    KEYEVENTF_KEYUP,
    KEYEVENTF_UNICODE,
    INPUT_KEYBOARD,
    MOUSEEVENTF_MOVE,
    MOUSEEVENTF_LEFTDOWN,
    MOUSEEVENTF_LEFTUP,
    MOUSEEVENTF_RIGHTDOWN,
    MOUSEEVENTF_RIGHTUP,
    MOUSEEVENTF_WHEEL,
    KEYBDINPUT,
    INPUT,
    press_vk,
    combo,
    send_unicode_text,
    park_cursor,
    handle_volume,
    handle_power,
)
from core.apps_manager import (
    APP_SHORTCUTS,
    load_all_apps,
    save_custom_app,
    delete_custom_app,
    extract_website_metadata,
)
from core.net_utils import (
    get_local_ip,
    LOCAL_IP,
    QR_SVG_CACHE,
    get_qr_svg_data,
)
from core.kiosk_supervisor import (
    BraveKioskSupervisor,
    kiosk_supervisor,
)
from core.cdp_bridge import (
    CDPControllerBridge,
    cdp_bridge,
)
from core.launcher import (
    launch_target,
)
from core.ws_controller import (
    CONNECTED_CLIENTS,
    CLIENT_LAST_KEY_TIME,
    SERVER_DEBOUNCE_KEYS,
    SERVER_DEBOUNCE_INTERVAL_SEC,
    broadcast_status,
    notify_apps_updated,
    handle_websocket_message,
    websocket_handler,
)
from core.http_server import (
    SmartTVHTTPRequestHandler,
    ReusableThreadingHTTPServer,
    start_http_server,
)

__all__ = [
    "MAIN_LOOP",
    "print_startup_banner",
    "main",
]

# Global reference to main asyncio loop for cross-thread scheduling.
# See the module docstring for why other modules must read this as
# `app.MAIN_LOOP` rather than importing the name.
MAIN_LOOP: asyncio.AbstractEventLoop | None = None


# ==============================================================================
# STARTUP BANNER & TERMINAL ASCII QR CODE
# ==============================================================================
def print_startup_banner():
    """Print an ASCII QR code and setup guide in the console."""
    remote_url = f"http://{LOCAL_IP}:{HTTP_PORT}/remote?token={AUTH_TOKEN}"
    tv_url = f"http://localhost:{HTTP_PORT}/tv?token={AUTH_TOKEN}"

    print("\n" + "═" * 65)
    print("  📺  MOM TV 2.0 — SMART TV KIOSK & CDP REMOTE SERVER RUNNING")
    print("═" * 65)
    print(f"  ▶ Local LAN IP:        {LOCAL_IP}")
    print(f"  ▶ HTTP Web Server:     http://localhost:{HTTP_PORT} (Port {HTTP_PORT})")
    print(f"  ▶ WebSocket Engine:    ws://localhost:{WS_PORT} (Port {WS_PORT})")
    print(f"  ▶ Brave CDP Port:      http://127.0.0.1:{CDP_PORT} (Port {CDP_PORT})")
    print(f"  ▶ Security Token:      {AUTH_TOKEN[:6]}... (Active)")
    print(f"  ▶ Browser Binary:      {kiosk_supervisor.browser_name} ({kiosk_supervisor.browser_path or 'Standard'})")
    print(f"  ▶ TV User Profile:     {BRAVE_PROFILE_DIR}")
    print("─" * 65)
    print(f"  📱 MOM'S PHONE REMOTE: {remote_url}")
    print(f"  🖥️  TV 10-FOOT LAUNCHER: {tv_url}")
    print("─" * 65)

    # Generate and print ASCII QR code
    try:
        import qrcode
        qr = qrcode.QRCode(border=1)
        qr.add_data(remote_url)
        qr.make(fit=True)
        print("  SCAN QR CODE WITH PHONE CAMERA TO CONNECT:\n")
        qr.print_ascii(invert=True)
    except Exception:
        print(f"  Scan or open in phone browser: {remote_url}")

    print("═" * 65 + "\n")


# ==============================================================================
# MAIN ENTRY POINT & LIFECYCLE SUPERVISOR
# ==============================================================================
async def main():
    parser = argparse.ArgumentParser(description="MOM TV 2.0 Server")
    parser.add_argument("--no-kiosk", action="store_true", help="Skip starting the browser kiosk")
    args = parser.parse_args()

    global MAIN_LOOP
    MAIN_LOOP = asyncio.get_running_loop()
    set_loop(MAIN_LOOP)
    setup_logging()

    # 1. Start HTTP Server in background daemon thread
    http_thread = threading.Thread(target=start_http_server, name="HTTPServerThread", daemon=True)
    http_thread.start()

    # 2. Print Startup Banner & QR code
    print_startup_banner()

    # 3. Launch Brave in SEB Kiosk Mode with Remote Debugging
    if not args.no_kiosk:
        kiosk_supervisor.start()

    # 4. Start CDP Controller Bridge Background Worker
    cdp_task = asyncio.create_task(cdp_bridge.run())

    # 5. Start Resilient WebSocket Automation Server on port 8766
    try:
        async with websockets.serve(websocket_handler, "0.0.0.0", WS_PORT):
            await asyncio.Future()  # Run indefinitely
    except asyncio.CancelledError:
        pass
    finally:
        # Cancel the CDP bridge task and actually wait for it to unwind before
        # calling cdp_bridge.stop() — previously these ran concurrently, so
        # stop() could tear down state the task's own cancellation handler
        # was still mid-cleanup on.
        cdp_task.cancel()
        try:
            await asyncio.wait_for(cdp_task, timeout=5)
        except asyncio.CancelledError:
            pass
        except asyncio.TimeoutError:
            print("[-] Timeout waiting for CDP bridge task to cancel")
        except Exception:
            traceback.print_exc()
        await cdp_bridge.stop()
        kiosk_supervisor.stop()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n🛑 MOM TV Server stopped by user.")
    except Exception:
        print("[-] MOM TV Server crashed:")
        traceback.print_exc()
    finally:
        kiosk_supervisor.stop()