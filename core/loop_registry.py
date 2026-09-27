import asyncio
import sys

__all__ = ["get_loop", "set_loop"]

_main_loop = None

def get_loop() -> asyncio.AbstractEventLoop:
    """Get the main event loop cleanly across Windows and other platforms."""
    global _main_loop
    if _main_loop is not None:
        return _main_loop
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        if sys.platform == 'win32':
            asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop

def set_loop(loop: asyncio.AbstractEventLoop):
    """Set the main event loop to be retrieved later."""
    global _main_loop
    _main_loop = loop
