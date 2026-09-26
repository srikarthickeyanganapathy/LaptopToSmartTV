"""
core/launcher.py — High-Level Application & Website Launch Router
Responsibilities: Coordinates CDP in-place navigation, supervised kiosk launching, and local OS startfile.
"""

import os
import sys
import asyncio
from core.apps_manager import APP_SHORTCUTS
from core.kiosk_supervisor import kiosk_supervisor
from core.cdp_bridge import cdp_bridge
from core.win32_input import park_cursor

__all__ = ["launch_target"]


def _get_main_loop() -> asyncio.AbstractEventLoop | None:
    """Safely obtain the active main asyncio event loop."""
    app_mod = sys.modules.get("app")
    if app_mod and getattr(app_mod, "MAIN_LOOP", None):
        return app_mod.MAIN_LOOP
    try:
        return asyncio.get_running_loop()
    except RuntimeError:
        return None


def launch_target(target: str, is_home: bool = False):
    """Fallback launcher that prioritizes Kiosk supervisor over unmanaged browser spawns."""
    if not target:
        return

    resolved = APP_SHORTCUTS.get(target.lower(), target)
    if resolved == "photos://modal":
        return

    # If Brave Kiosk supervisor is not running, start it cleanly in supervised mode!
    if not kiosk_supervisor.is_running:
        print("🛡️ [Launcher] Starting Brave Kiosk Supervisor...")
        kiosk_supervisor.start()
        park_cursor()
        return

    # If Brave Kiosk is active and CDP connected, navigate in-place!
    loop = _get_main_loop()
    if kiosk_supervisor.is_running and cdp_bridge.is_connected and loop and not loop.is_closed():
        asyncio.run_coroutine_threadsafe(cdp_bridge.navigate(resolved), loop)
        park_cursor()
        return

    # Local file / directory fallback ONLY if not a web URL
    if not (resolved.startswith("http://") or resolved.startswith("https://")):
        if resolved.startswith("file:///") or os.path.exists(resolved):
            print(f"📂 Opening local target: {resolved}")
            os.startfile(resolved)
            park_cursor()
            return

    # Last resort fallback: restart supervised kiosk
    if not kiosk_supervisor.is_running:
        kiosk_supervisor.start()

    park_cursor()
