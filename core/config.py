"""
core/config.py — Central Configuration & System Constants
Responsibilities: Ports, environment paths, default schemas, MIME types, and keycode mappings.
"""

import os
import secrets

__all__ = [
    "HTTP_PORT",
    "WS_PORT",
    "CDP_PORT",
    "TEST_MODE",
    "AUTH_TOKEN",
    "BASE_DIR",
    "BRAVE_PROFILE_DIR",
    "TV_URL",
    "SMART_TV_UA",
    "DESKTOP_UA",
    "BROWSER_CANDIDATES",
    "DEFAULT_APPS",
    "CUSTOM_APPS_FILE",
    "MIME_TYPES",
    "ALLOWED_STATIC_FILES",
    "ALLOWED_STATIC_DIRS",
    "KEY_TABLE",
    "VK_MAP",
    "CDP_KEY_MAP",
]

# Network & Debugging Ports
HTTP_PORT = int(os.environ.get("MOMTV_HTTP_PORT", 8765))
WS_PORT = int(os.environ.get("MOMTV_WS_PORT", 8766))
CDP_PORT = int(os.environ.get("MOMTV_CDP_PORT", 9222))

TEST_MODE = os.environ.get('MOM_TV_TEST_MODE') == '1'

# System Directories & URLs
# BASE_DIR points to the root of the project (parent of core/)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Dynamic Session Authentication Token (Protects LAN & Drive-By attacks)
_token_file = os.path.join(BASE_DIR, ".token")

# FIX: previously an empty/corrupt .token file produced AUTH_TOKEN == "" —
# compare_token() rejects empty tokens, so the whole system locked out
# permanently. Now an empty/missing token is (re)generated.
AUTH_TOKEN = os.environ.get("MOMTV_TOKEN") or ""
if not AUTH_TOKEN:
    try:
        with open(_token_file, "r", encoding="utf-8") as f:
            AUTH_TOKEN = f.read().strip()
    except OSError:
        AUTH_TOKEN = ""
if not AUTH_TOKEN:
    AUTH_TOKEN = secrets.token_hex(16)
    try:
        with open(_token_file, "w", encoding="utf-8") as f:
            f.write(AUTH_TOKEN)
    except OSError:
        pass

BRAVE_PROFILE_DIR = os.path.join(BASE_DIR, ".brave_tv_profile")
TV_URL = f"http://localhost:{HTTP_PORT}/tv?token={AUTH_TOKEN}"

# Allowed static files and directories for secure HTTP serving
ALLOWED_STATIC_FILES = {
    "index.html",
    "tv.html",
    "tv-engine.js",
    "manifest.json",
    "sw.js",
    "icon.svg",
    "icon-192.png",
    "icon-512.png",
    "favicon.ico",
}
ALLOWED_STATIC_DIRS = ("assets", "icons", "static")

# Smart TV User-Agent for Tizen 6.0 (Forces YouTube & streaming apps to Leanback TV UI)
SMART_TV_UA = (
    "Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 "
    "(KHTML, like Gecko) SamsungBrowser/4.0 Chrome/108.0.0.0 TV Safari/537.36"
)

# Desktop User-Agent for standard web viewing
DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

BROWSER_CANDIDATES = [
    ("Brave", r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"),
    ("Brave", r"C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe"),
    ("Brave", r"%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe"),
    ("Brave", r"%PROGRAMFILES%\BraveSoftware\Brave-Browser\Application\brave.exe"),
    ("Chrome", r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    ("Chrome", r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
    ("Chrome", r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    ("Edge", r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
    ("Edge", r"%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe"),
]

# Standard Built-in TV Applications:
DEFAULT_APPS = [
    {
        "id": "youtube",
        "name": "YouTube TV",
        "app": "youtube",
        "url": "https://www.youtube.com/tv",
        "poster": "https://www.gstatic.com/marketing-cms/assets/images/96/ff/14b02dc0467e8875e062e9565cbd/external-icon-core-1.png=n-w1860-h1047-fcrop64=1,00000000ffffffff-rw",
        "icon": "youtube",
        "category": "Streaming Entertainment",
        "description": "Watch favorite music, shows, recipe channels, bhajans, and live events in 4K Leanback mode.",
        "accent": "#FF0000",
        "glow": "rgba(255, 0, 0, 0.45)",
    }
]

CUSTOM_APPS_FILE = os.path.join(BASE_DIR, "apps.json")

# MIME Types for Static File Serving
MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
}

KEY_TABLE = {
    "up": {"vk": 0x26, "dom_key": "ArrowUp", "code": "ArrowUp", "windowsVirtualKeyCode": 38},
    "down": {"vk": 0x28, "dom_key": "ArrowDown", "code": "ArrowDown", "windowsVirtualKeyCode": 40},
    "left": {"vk": 0x25, "dom_key": "ArrowLeft", "code": "ArrowLeft", "windowsVirtualKeyCode": 37},
    "right": {"vk": 0x27, "dom_key": "ArrowRight", "code": "ArrowRight", "windowsVirtualKeyCode": 39},
    "enter": {"vk": 0x0D, "dom_key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13},
    "ok": {"vk": 0x0D, "dom_key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13},
    "select": {"vk": 0x0D, "dom_key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13},
    "escape": {"vk": 0x1B, "dom_key": "Escape", "code": "Escape", "windowsVirtualKeyCode": 27},
    "esc": {"vk": 0x1B, "dom_key": "Escape", "code": "Escape", "windowsVirtualKeyCode": 27},
    "space": {"vk": 0x20, "dom_key": " ", "code": "Space", "windowsVirtualKeyCode": 32},
    "tab": {"vk": 0x09},
    "backspace": {"vk": 0x08},
    "delete": {"vk": 0x2E},
    "pageup": {"vk": 0x21},
    "pagedown": {"vk": 0x22},
    "home_key": {"vk": 0x24},
    "end": {"vk": 0x23},
    "f5": {"vk": 0x74},
    "f6": {"vk": 0x75},
    "f11": {"vk": 0x7A, "dom_key": "F11", "code": "F11", "windowsVirtualKeyCode": 122},
    "menu": {"vk": 0x5D},
    "info": {"vk": 0x49},
    "play": {"vk": 0xB3, "dom_key": "MediaPlayPause", "code": "MediaPlayPause", "windowsVirtualKeyCode": 179},
    "pause": {"vk": 0xB3, "dom_key": "MediaPlayPause", "code": "MediaPlayPause", "windowsVirtualKeyCode": 179},
    "play_pause": {"vk": 0xB3, "dom_key": "MediaPlayPause", "code": "MediaPlayPause", "windowsVirtualKeyCode": 179},
    "playpause": {"vk": 0xB3, "dom_key": "MediaPlayPause", "code": "MediaPlayPause", "windowsVirtualKeyCode": 179},
    "stop": {"vk": 0xB2},
    "next": {"vk": 0xB0},
    "prev": {"vk": 0xB1},
    "volume_up": {"vk": 0xAF},
    "volume_down": {"vk": 0xAE},
    "volume_mute": {"vk": 0xAD},
    "back": {"dom_key": "BrowserBack", "code": "BrowserBack", "windowsVirtualKeyCode": 166},
    "rewind": {"dom_key": "ArrowLeft", "code": "ArrowLeft", "windowsVirtualKeyCode": 37},
    "rewind10": {"dom_key": "ArrowLeft", "code": "ArrowLeft", "windowsVirtualKeyCode": 37},
    "replay": {"dom_key": "ArrowLeft", "code": "ArrowLeft", "windowsVirtualKeyCode": 37},
    "forward": {"dom_key": "ArrowRight", "code": "ArrowRight", "windowsVirtualKeyCode": 39},
    "forward10": {"dom_key": "ArrowRight", "code": "ArrowRight", "windowsVirtualKeyCode": 39},
    "fastforward": {"dom_key": "ArrowRight", "code": "ArrowRight", "windowsVirtualKeyCode": 39},
    "fullscreen": {"dom_key": "F11", "code": "F11", "windowsVirtualKeyCode": 122},
}

# Windows Virtual Key Codes
VK_MAP = {k: v['vk'] for k, v in KEY_TABLE.items() if 'vk' in v}

# CDP Key dispatch mapping for DOM key event synthesis
CDP_KEY_MAP = {k: {'key': v['dom_key'], 'code': v['code'], 'windowsVirtualKeyCode': v.get('windowsVirtualKeyCode', v.get('vk', 0))} for k, v in KEY_TABLE.items() if 'dom_key' in v}