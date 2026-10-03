"""
core/win32_input.py — Low-Level Windows Input Simulation & Power Controls
Responsibilities: Virtual keystroke injection, text typing via SendInput, cursor parking, and display standby.
"""

import sys
import ctypes
from ctypes import wintypes
import subprocess
from core.config import VK_MAP, TEST_MODE

__all__ = [
    "user32",
    "powrprof",
    "KEYEVENTF_KEYUP",
    "KEYEVENTF_UNICODE",
    "INPUT_KEYBOARD",
    "MOUSEEVENTF_MOVE",
    "MOUSEEVENTF_LEFTDOWN",
    "MOUSEEVENTF_LEFTUP",
    "MOUSEEVENTF_RIGHTDOWN",
    "MOUSEEVENTF_RIGHTUP",
    "MOUSEEVENTF_WHEEL",
    "KEYBDINPUT",
    "INPUT",
    "press_vk",
    "combo",
    "send_unicode_text",
    "park_cursor",
    "handle_volume",
    "handle_power",
]

IS_WINDOWS = sys.platform == "win32"


class _Win32Stub:
    """FIX: no-op stand-in so this module imports (and unit tests run) on non-Windows machines."""

    def __getattr__(self, _name):
        def _noop(*_args, **_kwargs):
            return 0
        return _noop


if IS_WINDOWS:
    user32 = ctypes.windll.user32
    powrprof = getattr(ctypes.windll, "powrprof", None)
else:
    user32 = _Win32Stub()
    powrprof = None

KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_UNICODE = 0x0004
INPUT_KEYBOARD = 1
MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_RIGHTDOWN = 0x0008
MOUSEEVENTF_RIGHTUP = 0x0010
MOUSEEVENTF_WHEEL = 0x0800


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", wintypes.LONG),
        ("dy", wintypes.LONG),
        ("mouseData", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.c_size_t),  # ULONG_PTR
    ]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", wintypes.WORD),
        ("wScan", wintypes.WORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.c_size_t),  # ULONG_PTR
    ]


class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [
        ("uMsg", wintypes.DWORD),
        ("wParamL", wintypes.WORD),
        ("wParamH", wintypes.WORD),
    ]


class _INPUT_UNION(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT), ("hi", HARDWAREINPUT)]


class INPUT(ctypes.Structure):
    _anonymous_ = ("_input",)
    _fields_ = [("type", wintypes.DWORD), ("_input", _INPUT_UNION)]


# ============================================================================
# FIX (CRITICAL): the union previously contained ONLY KEYBDINPUT, which made
# ctypes.sizeof(INPUT) == 32 bytes on x64 instead of the 40 bytes Windows
# requires. SendInput() validates cbSize and silently rejects the call when it
# does not match — every OS-level key injection (volume, power hotkeys, text
# typing, all VK fallbacks) was a complete no-op. Including MOUSEINPUT and
# HARDWAREINPUT in the union restores the correct 40-byte (x64) / 28-byte (x86)
# layout, so SendInput now actually delivers keystrokes.
# ============================================================================
if IS_WINDOWS:
    user32.SendInput.argtypes = [wintypes.UINT, ctypes.POINTER(INPUT), ctypes.c_int]
    user32.SendInput.restype = wintypes.UINT
    # FIX: VkKeyScanW returns a SHORT (high byte = modifier flags, -1 = no mapping);
    # without restype the value came back sign-extended garbage.
    user32.VkKeyScanW.argtypes = [wintypes.UINT]
    user32.VkKeyScanW.restype = ctypes.c_short


def press_vk(vk_code: int):
    """Press and release a virtual key code."""
    i_down = INPUT(type=INPUT_KEYBOARD)
    i_down.ki.wVk = vk_code
    i_down.ki.wScan = 0
    i_down.ki.dwFlags = 0

    i_up = INPUT(type=INPUT_KEYBOARD)
    i_up.ki.wVk = vk_code
    i_up.ki.wScan = 0
    i_up.ki.dwFlags = KEYEVENTF_KEYUP

    arr = (INPUT * 2)(i_down, i_up)
    user32.SendInput(2, arr, ctypes.sizeof(INPUT))


def combo(vk_list: list):
    """Press multiple keys simultaneously and release in reverse order."""
    inputs = []
    for vk in vk_list:
        i_down = INPUT(type=INPUT_KEYBOARD)
        i_down.ki.wVk = vk
        i_down.ki.wScan = 0
        i_down.ki.dwFlags = 0
        inputs.append(i_down)
    for vk in reversed(vk_list):
        i_up = INPUT(type=INPUT_KEYBOARD)
        i_up.ki.wVk = vk
        i_up.ki.wScan = 0
        i_up.ki.dwFlags = KEYEVENTF_KEYUP
        inputs.append(i_up)

    n = len(inputs)
    arr = (INPUT * n)(*inputs)
    user32.SendInput(n, arr, ctypes.sizeof(INPUT))


def send_unicode_text(text: str):
    """Type arbitrary text accurately using SendInput KEYEVENTF_UNICODE."""
    if not text:
        return
    try:
        inputs = []
        for char in text:
            code = ord(char)
            # Key Down
            i_down = INPUT(type=INPUT_KEYBOARD)
            i_down.ki.wVk = 0
            i_down.ki.wScan = code
            i_down.ki.dwFlags = KEYEVENTF_UNICODE
            inputs.append(i_down)
            # Key Up
            i_up = INPUT(type=INPUT_KEYBOARD)
            i_up.ki.wVk = 0
            i_up.ki.wScan = code
            i_up.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP
            inputs.append(i_up)

        n = len(inputs)
        arr = (INPUT * n)(*inputs)
        user32.SendInput(n, arr, ctypes.sizeof(INPUT))
    except Exception:
        # Fallback using VkKeyScanW if SendInput encounters platform limits
        # Note: This fallback only handles Shift modifiers, not AltGr/Ctrl+Alt combos.
        for char in text:
            vk = user32.VkKeyScanW(ord(char))
            if vk == -1:
                # FIX: -1 means "this keyboard layout cannot produce this char" —
                # pressing VK 0xFF (the old behavior) injected a garbage key.
                continue
            vk_code = vk & 0xFF
            shift = bool((vk >> 8) & 1)
            if shift:
                combo([0x10, vk_code])  # Use combo for shift
            else:
                press_vk(vk_code)


def park_cursor():
    """Move cursor off-screen to (9999, 9999) to keep the TV display clean."""
    try:
        user32.SetCursorPos(9999, 9999)
    except Exception as e:
        print(f"[-] Failed to park cursor: {e}")


def handle_volume(action: str):
    """Handle volume commands (up, down, mute)."""
    act = action.lower()
    if act in ("up", "volume_up"):
        press_vk(VK_MAP["volume_up"])
    elif act in ("down", "volume_down"):
        press_vk(VK_MAP["volume_down"])
    elif act in ("mute", "toggle_mute", "volume_mute"):
        press_vk(VK_MAP["volume_mute"])


def handle_power(action: str):
    """Handle power and display standby states."""
    act = action.lower()

    if act in ("sleep", "standby"):
        print("💤 Triggering Windows Sleep/Standby...")
        if TEST_MODE:
            print("  [TEST MODE] Sleep action simulated (bypassing hardware sleep for automated test)")
            return
        if powrprof and hasattr(powrprof, "SetSuspendState"):
            powrprof.SetSuspendState(False, True, False)
        else:
            subprocess.run("rundll32.exe powrprof.dll,SetSuspendState 0,1,0", shell=True)
    elif act in ("screen_off", "display_off", "blank"):
        print("🖥️ Turning off display...")
        if TEST_MODE:
            print("  [TEST MODE] Display off simulated (bypassing display blanking for automated test)")
            return
        # HWND_BROADCAST=0xFFFF, WM_SYSCOMMAND=0x0112, SC_MONITORPOWER=0xF170, 2=Turn Off
        user32.SendMessageW(0xFFFF, 0x0112, 0xF170, 2)
    elif act in ("wake", "screen_on", "display_on"):
        print("☀️ Waking screen...")
        # -1 = Turn On
        user32.SendMessageW(0xFFFF, 0x0112, 0xF170, -1)
        # Nudge mouse slightly to notify Windows power manager
        user32.mouse_event(MOUSEEVENTF_MOVE, 0, 1, 0, 0)
        user32.mouse_event(MOUSEEVENTF_MOVE, 0, -1, 0, 0)