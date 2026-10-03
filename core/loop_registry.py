"""
core/loop_registry.py — Shared asyncio event-loop registry
"""

import asyncio
import sys

__all__ = ["get_loop", "set_loop"]

_main_loop = None


def get_loop() -> asyncio.AbstractEventLoop:
    """Get the main event loop cleanly across Windows and other platforms."""
    global _main_loop

    if _main_loop is not None and not _main_loop.is_closed():
        return _main_loop

    # Already running inside a loop (e.g. called from an async handler)? Reuse it.
    try:
        loop = asyncio.get_running_loop()
        _main_loop = loop
        return loop
    except RuntimeError:
        pass

    if sys.platform == 'win32':
        try:
            asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        except Exception:
            pass
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    # FIX: cache the loop we just created. Previously every call from a worker
    # thread (HTTP handler, notify_apps_updated, ...) built a BRAND-NEW loop
    # that nobody ever ran, so run_coroutine_threadsafe() scheduled work that
    # silently never executed (CDP navigation from the HTTP API did nothing).
    _main_loop = loop
    return loop


def set_loop(loop: asyncio.AbstractEventLoop):
    """Set the main event loop to be retrieved later."""
    global _main_loop
    _main_loop = loop