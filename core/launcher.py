"""
core/launcher.py — High-Level Application & Website Launch Router
Responsibilities: Coordinates CDP in-place navigation, supervised kiosk launching, and local OS startfile.
"""

import os
import sys
import asyncio
import logging
from core.apps_manager import APP_SHORTCUTS
from core.kiosk_supervisor import kiosk_supervisor
from core.cdp_bridge import cdp_bridge
from core.win32_input import park_cursor
from core.loop_registry import get_loop

__all__ = ["launch_target"]

logger = logging.getLogger(__name__)

# Targets to ignore silently (e.g. internal frontend modals that don't need backend routing)
IGNORED_TARGETS = {'photos://modal'}

def _strategy_ignored(resolved: str) -> bool:
    if resolved in IGNORED_TARGETS:
        return True
    return False

def _strategy_start_kiosk(resolved: str) -> bool:
    if not kiosk_supervisor.is_running:
        logger.info("🛡️ [Launcher] Starting Brave Kiosk Supervisor...")
        # FIX: pass the requested URL. Previously the kiosk booted into the
        # launcher and silently dropped the app the user actually asked to open.
        kiosk_supervisor.start(initial_url=resolved)
        park_cursor()
        return True
    return False

def _strategy_cdp_navigate(resolved: str) -> bool:
    loop = get_loop()
    if kiosk_supervisor.is_running and cdp_bridge.is_connected and loop and not loop.is_closed():
        asyncio.run_coroutine_threadsafe(cdp_bridge.navigate(resolved), loop)
        park_cursor()
        return True
    return False

def _strategy_local_file(resolved: str) -> bool:
    if not (resolved.startswith("http://") or resolved.startswith("https://")):
        if resolved.startswith("file:///") or os.path.exists(resolved):
            logger.info(f"📂 Opening local target: {resolved}")
            if hasattr(os, "startfile"):
                os.startfile(resolved)
            park_cursor()
            return True
    return False

def _strategy_fallback(resolved: str) -> bool:
    if not kiosk_supervisor.is_running:
        # FIX: same as _strategy_start_kiosk — boot the kiosk INTO the requested
        # target instead of the launcher.
        kiosk_supervisor.start(initial_url=resolved)
    park_cursor()
    return True

_LAUNCH_STRATEGIES = [
    _strategy_ignored,
    _strategy_start_kiosk,
    _strategy_cdp_navigate,
    _strategy_local_file,
    _strategy_fallback
]


def launch_target(target: str, is_home: bool = False):
    """Fallback launcher that prioritizes Kiosk supervisor over unmanaged browser spawns."""
    if not target:
        return

    resolved = APP_SHORTCUTS.get(target.lower(), target)
    
    for strategy in _LAUNCH_STRATEGIES:
        if strategy(resolved):
            break