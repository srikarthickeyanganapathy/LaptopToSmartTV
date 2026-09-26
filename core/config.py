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
    "AUTH_TOKEN",
    "BASE_DIR",
    "BRAVE_PROFILE_DIR",
    "TV_URL",
    "SMART_TV_UA",
    "DEFAULT_APPS",
    "CUSTOM_APPS_FILE",
    "MIME_TYPES",
    "ALLOWED_STATIC_FILES",
    "ALLOWED_STATIC_DIRS",
    "VK_MAP",
    "CDP_KEY_MAP",
]

# Network & Debugging Ports
HTTP_PORT = 8765
WS_PORT = 8766
CDP_PORT = 9222

# Dynamic Session Authentication Token (Protects LAN & Drive-By attacks)
AUTH_TOKEN = os.environ.get("MOMTV_TOKEN") or secrets.token_hex(16)

# System Directories & URLs
# BASE_DIR points to the root of the project (parent of core/)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
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

# Standard Built-in TV Applications:
# Only YouTube TV is retained as the default built-in application because MOM TV spoofed
# the Samsung Tizen Smart TV User-Agent specifically for YouTube's native Cobalt Leanback TV UI.
# All other websites are custom websites configured via apps.json.
DEFAULT_APPS = [
    {
        "id": "youtube",
        "name": "YouTube TV",
        "app": "youtube",
        "url": "https://www.youtube.com/tv",
        "poster": "https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?q=80&w=800&auto=format&fit=crop",
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

# Windows Virtual Key Codes
VK_MAP = {
    "up": 0x26,
    "down": 0x28,
    "left": 0x25,
    "right": 0x27,
    "enter": 0x0D,
    "ok": 0x0D,
    "select": 0x0D,
    "escape": 0x1B,
    "esc": 0x1B,
    "space": 0x20,
    "tab": 0x09,
    "backspace": 0x08,
    "delete": 0x2E,
    "pageup": 0x21,
    "pagedown": 0x22,
    "home_key": 0x24,
    "end": 0x23,
    "f5": 0x74,
    "f6": 0x75,
    "f11": 0x7A,          # VK_F11
    "menu": 0x5D,          # VK_APPS (Context Menu)
    "info": 0x49,          # 'i' key
    # Media controls
    "play": 0xB3,          # VK_MEDIA_PLAY_PAUSE
    "pause": 0xB3,
    "play_pause": 0xB3,
    "playpause": 0xB3,
    "stop": 0xB2,          # VK_MEDIA_STOP
    "next": 0xB0,          # VK_MEDIA_NEXT_TRACK
    "prev": 0xB1,          # VK_MEDIA_PREV_TRACK
    # Volume
    "volume_up": 0xAF,     # VK_VOLUME_UP
    "volume_down": 0xAE,   # VK_VOLUME_DOWN
    "volume_mute": 0xAD,   # VK_VOLUME_MUTE
}

# CDP Key dispatch mapping for DOM key event synthesis
CDP_KEY_MAP = {
    "up": {"key": "ArrowUp", "code": "ArrowUp", "windowsVirtualKeyCode": 38},
    "down": {"key": "ArrowDown", "code": "ArrowDown", "windowsVirtualKeyCode": 40},
    "left": {"key": "ArrowLeft", "code": "ArrowLeft", "windowsVirtualKeyCode": 37},
    "right": {"key": "ArrowRight", "code": "ArrowRight", "windowsVirtualKeyCode": 39},
    "enter": {"key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13},
    "ok": {"key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13},
    "select": {"key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13},
    "space": {"key": " ", "code": "Space", "windowsVirtualKeyCode": 32},
    "back": {"key": "BrowserBack", "code": "BrowserBack", "windowsVirtualKeyCode": 166},
    "rewind": {"key": "ArrowLeft", "code": "ArrowLeft", "windowsVirtualKeyCode": 37},
    "rewind10": {"key": "ArrowLeft", "code": "ArrowLeft", "windowsVirtualKeyCode": 37},
    "replay": {"key": "ArrowLeft", "code": "ArrowLeft", "windowsVirtualKeyCode": 37},
    "forward": {"key": "ArrowRight", "code": "ArrowRight", "windowsVirtualKeyCode": 39},
    "forward10": {"key": "ArrowRight", "code": "ArrowRight", "windowsVirtualKeyCode": 39},
    "fastforward": {"key": "ArrowRight", "code": "ArrowRight", "windowsVirtualKeyCode": 39},
    "play": {"key": "MediaPlayPause", "code": "MediaPlayPause", "windowsVirtualKeyCode": 179},
    "pause": {"key": "MediaPlayPause", "code": "MediaPlayPause", "windowsVirtualKeyCode": 179},
    "playpause": {"key": "MediaPlayPause", "code": "MediaPlayPause", "windowsVirtualKeyCode": 179},
    "play_pause": {"key": "MediaPlayPause", "code": "MediaPlayPause", "windowsVirtualKeyCode": 179},
    "escape": {"key": "Escape", "code": "Escape", "windowsVirtualKeyCode": 27},
    "esc": {"key": "Escape", "code": "Escape", "windowsVirtualKeyCode": 27},
    "f11": {"key": "F11", "code": "F11", "windowsVirtualKeyCode": 122},
    "fullscreen": {"key": "F11", "code": "F11", "windowsVirtualKeyCode": 122},
}
