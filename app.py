"""
MOM TV 2.0 — High-Performance Windows Smart TV & Remote Server
SEB-Style Brave Kiosk Supervisor & Chrome DevTools Protocol (CDP) Bridge.

Components:
1. Brave Kiosk Supervisor: Auto-detects Brave, manages dedicated TV profile, launches SEB kiosk mode with remote debugging on port 9222, and watches process health.
2. CDP Controller Bridge: Connects to Brave via WebSocket on port 9222, auto-injects tv-engine.js on all documents, enables single-window in-place navigation, and performs direct DOM/OS key injection.
3. Unified HTTP Server (port 8765): Serves Remote PWA, TV 4K Leanback Launcher, tv-engine.js, and APIs.
4. WebSocket Automation Engine (port 8766): Real-time command bridge between phone remotes and the TV.
"""

import os
import sys
import time
import json
import socket
import asyncio
import websockets
import ctypes
from ctypes import wintypes
import subprocess
import threading
import shutil
import urllib.parse
import urllib.request
import winreg
import atexit
import signal
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

# Ensure Windows stdout supports UTF-8 for clean ASCII QR code and emojis
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# ==============================================================================
# CONFIGURATION & USER APPS
# ==============================================================================
HTTP_PORT = 8765
WS_PORT = 8766
CDP_PORT = 9222
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BRAVE_PROFILE_DIR = os.path.join(BASE_DIR, ".brave_tv_profile")
TV_URL = f"http://localhost:{HTTP_PORT}/tv"

# Smart TV User-Agent for Tizen 6.0 (Forces YouTube & streaming apps to Leanback TV UI)
SMART_TV_UA = (
    "Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 "
    "(KHTML, like Gecko) SamsungBrowser/4.0 Chrome/108.0.0.0 TV Safari/537.36"
)

# Standard App Shortcuts & Streaming Services
APP_SHORTCUTS = {
    # Video & Streaming Services (Web Apps)
    "youtube": "https://www.youtube.com/tv",
    "yt": "https://www.youtube.com/tv",
    "netflix": "https://www.netflix.com",
    "hotstar": "https://www.hotstar.com",
    "prime": "https://www.primevideo.com",
    "jiocinema": "https://www.jiocinema.com",
    "zee5": "https://www.zee5.com",
    "sonyliv": "https://www.sonyliv.com",

    # Media & Curated Channels for Mom
    "bhajans": "https://www.youtube.com/results?search_query=morning+bhajans+peaceful+aarti",
    "news": "https://www.youtube.com/results?search_query=dd+news+live",

    # Local Files & Directories
    "photos": "file:///C:/Users/Public/Pictures",

    # MOM TV Internal Dashboards
    "launcher": TV_URL,
    "home": TV_URL,
    "tv": TV_URL,
}

# Load optional user overrides from 'apps.json' if present
CUSTOM_APPS_FILE = os.path.join(BASE_DIR, "apps.json")
if os.path.isfile(CUSTOM_APPS_FILE):
    try:
        with open(CUSTOM_APPS_FILE, "r", encoding="utf-8") as f:
            user_custom_apps = json.load(f)
            if isinstance(user_custom_apps, dict):
                APP_SHORTCUTS.update(user_custom_apps)
                print(f"[*] Loaded {len(user_custom_apps)} custom apps from apps.json")
    except Exception as e:
        print(f"[-] Warning: Failed to parse apps.json: {e}")

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
    "back": {"key": "Backspace", "code": "Backspace", "windowsVirtualKeyCode": 8},
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

# ==============================================================================
# WINDOWS LOW-LEVEL APIS & INPUT SIMULATION
# ==============================================================================
user32 = ctypes.windll.user32
powrprof = getattr(ctypes.windll, "powrprof", None)

KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_UNICODE = 0x0004
INPUT_KEYBOARD = 1
MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_RIGHTDOWN = 0x0008
MOUSEEVENTF_RIGHTUP = 0x0010
MOUSEEVENTF_WHEEL = 0x0800


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", wintypes.WORD),
        ("wScan", wintypes.WORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.c_ulonglong),
    ]


class INPUT(ctypes.Structure):
    class _INPUT(ctypes.Union):
        _fields_ = [("ki", KEYBDINPUT)]
    _anonymous_ = ("_input",)
    _fields_ = [("type", wintypes.DWORD), ("_input", _INPUT)]


def press_vk(vk_code: int):
    """Press and release a virtual key code."""
    user32.keybd_event(vk_code, 0, 0, 0)
    user32.keybd_event(vk_code, 0, KEYEVENTF_KEYUP, 0)


def combo(vk_list: list):
    """Press multiple keys simultaneously and release in reverse order."""
    for vk in vk_list:
        user32.keybd_event(vk, 0, 0, 0)
    for vk in reversed(vk_list):
        user32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)


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
        for char in text:
            vk = user32.VkKeyScanW(ord(char))
            vk_code = vk & 0xFF
            shift = bool((vk >> 8) & 1)
            if shift:
                user32.keybd_event(0x10, 0, 0, 0)
            press_vk(vk_code)
            if shift:
                user32.keybd_event(0x10, 0, KEYEVENTF_KEYUP, 0)


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
    is_test = os.environ.get("MOM_TV_TEST_MODE") == "1"

    if act in ("sleep", "standby"):
        print("💤 Triggering Windows Sleep/Standby...")
        if is_test:
            print("  [TEST MODE] Sleep action simulated (bypassing hardware sleep for automated test)")
            return
        if powrprof and hasattr(powrprof, "SetSuspendState"):
            powrprof.SetSuspendState(False, True, False)
        else:
            subprocess.run("rundll32.exe powrprof.dll,SetSuspendState 0,1,0", shell=True)
    elif act in ("screen_off", "display_off", "blank"):
        print("🖥️ Turning off display...")
        if is_test:
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


# ==============================================================================
# SEB-STYLE BRAVE KIOSK SUPERVISOR
# ==============================================================================
class BraveKioskSupervisor:
    """
    Supervises the Brave Browser in SEB-style TV Kiosk Mode.
    - Uses dedicated profile directory (.brave_tv_profile)
    - Launches Brave with --kiosk, --remote-debugging-port=9222, and Tizen TV UA
    - Watchdog daemon: Monitors process life and restarts on unexpected crashes
    - Clean shutdown: Graceful termination on server shutdown
    """

    def __init__(self, port: int = CDP_PORT, http_port: int = HTTP_PORT):
        self.port = port
        self.http_port = http_port
        self.profile_dir = BRAVE_PROFILE_DIR
        os.makedirs(self.profile_dir, exist_ok=True)
        self.browser_name, self.browser_path = self._detect_brave()
        self.process = None
        self._should_run = False
        self._watchdog_thread = None
        self._lock = threading.Lock()

    def _detect_brave(self) -> tuple[str, str | None]:
        """Detect Brave browser executable path with fallback to registry and standard locations."""
        # 1. Primary path
        primary = r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"
        if os.path.isfile(primary):
            return "Brave", primary

        # 2. Additional standard installation paths
        candidates = [
            ("Brave", r"C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe"),
            ("Brave", os.path.expandvars(r"%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe")),
            ("Brave", os.path.expandvars(r"%PROGRAMFILES%\BraveSoftware\Brave-Browser\Application\brave.exe")),
        ]
        for name, p in candidates:
            if os.path.isfile(p):
                return name, p

        # 3. Windows Registry App Paths
        for hkey in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
            try:
                with winreg.OpenKey(hkey, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\brave.exe") as key:
                    val, _ = winreg.QueryValueEx(key, "")
                    if val and os.path.isfile(val):
                        return "Brave", val
            except Exception:
                pass

        # 4. PATH lookup
        for name in ["brave.exe", "brave"]:
            p = shutil.which(name)
            if p and os.path.isfile(p):
                return "Brave", p

        # 5. Fallback browsers (Chrome / Edge) if Brave is not installed
        for name, fallback in [
            ("Chrome", r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
            ("Chrome", r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
            ("Chrome", os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe")),
            ("Edge", r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
            ("Edge", os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe")),
        ]:
            if os.path.isfile(fallback):
                print(f"[-] Notice: Brave not found. Using fallback browser: {name} ({fallback})")
                return name, fallback

        return "Default", None

    @property
    def is_running(self) -> bool:
        return self.process is not None and self.process.poll() is None

    def start(self):
        """Start the Brave Kiosk process and the health watchdog thread."""
        with self._lock:
            if self._should_run:
                return
            self._should_run = True
            self._launch_process()
            self._watchdog_thread = threading.Thread(target=self._watchdog_loop, name="BraveWatchdog", daemon=True)
            self._watchdog_thread.start()

    def _launch_process(self):
        if not self.browser_path or not os.path.isfile(self.browser_path):
            print(f"[-] [Kiosk Supervisor] Browser binary not found at: {self.browser_path}")
            return

        initial_url = f"http://localhost:{self.http_port}/tv"
        args = [
            self.browser_path,
            "--kiosk",
            f"--user-data-dir={self.profile_dir}",
            f"--remote-debugging-port={self.port}",
            f"--user-agent={SMART_TV_UA}",
            "--no-first-run",
            "--disable-pinch",
            "--overscroll-history-navigation=0",
            "--no-default-browser-check",
            "--disable-features=Translate,OptimizationHints,MediaRouter",
            "--autoplay-policy=no-user-gesture-required",
            "--disable-session-crashed-bubble",
            "--hide-crash-restore-bubble",
            "--password-store=basic",
            "--enable-features=NetworkService,NetworkServiceInProcess",
            "--window-position=0,0",
            "--start-maximized",
        ]

        extension_dir = os.path.join(BASE_DIR, "mom-tv-extension")
        if os.path.isdir(extension_dir):
            args.extend([
                f"--load-extension={extension_dir}",
                f"--disable-extensions-except={extension_dir}",
            ])
            print(f"🧩 [Kiosk Supervisor] Loaded Brave TV Extension: {extension_dir}")

        args.append(initial_url)

        print(f"🛡️  [Kiosk Supervisor] Launching {self.browser_name} in SEB Kiosk Mode on port {self.port}...")
        try:
            self.process = subprocess.Popen(args)
            print(f"✅ [Kiosk Supervisor] {self.browser_name} Kiosk started (PID: {self.process.pid})")
            park_cursor()
        except Exception as e:
            print(f"[-] [Kiosk Supervisor] Failed to launch {self.browser_name}: {e}")

    def _watchdog_loop(self):
        """Background watchdog to ensure Brave Kiosk stays alive and responsive."""
        while self._should_run:
            time.sleep(2.5)
            if not self._should_run:
                break
            with self._lock:
                if self.process is None or self.process.poll() is not None:
                    exit_code = self.process.poll() if self.process else "None"
                    print(f"⚠️  [Kiosk Supervisor] Brave process ended (Exit code: {exit_code}). Auto-restarting...")
                    self._launch_process()

    def stop(self):
        """Gracefully terminate the Brave Kiosk process."""
        self._should_run = False
        with self._lock:
            if self.process and self.process.poll() is None:
                pid = self.process.pid
                print(f"🛑 [Kiosk Supervisor] Terminating {self.browser_name} Kiosk (PID: {pid})...")
                try:
                    subprocess.run(f"taskkill /F /T /PID {pid}", shell=True, capture_output=True)
                except Exception:
                    try:
                        self.process.terminate()
                        self.process.wait(timeout=2.0)
                    except Exception:
                        try:
                            self.process.kill()
                        except Exception:
                            pass
                print("✅ [Kiosk Supervisor] Browser process terminated.")
            self.process = None


# ==============================================================================
# CHROME DEVTOOLS PROTOCOL (CDP) CONTROLLER BRIDGE
# ==============================================================================
class CDPControllerBridge:
    """
    Asynchronous Chrome DevTools Protocol (CDP) Controller Bridge.
    - Connects via WebSocket to Brave's active page target (port 9222).
    - Injects `tv-engine.js` automatically on every document via Page.addScriptToEvaluateOnNewDocument.
    - Enables single-window in-place navigation (zero new windows or tabs).
    - Synthesizes direct DOM key events and dispatches window.MomTV actions.
    """

    def __init__(self, cdp_port: int = CDP_PORT, http_port: int = HTTP_PORT):
        self.cdp_port = cdp_port
        self.http_port = http_port
        self.ws = None
        self._msg_id = 0
        self._pending_futures: dict[int, asyncio.Future] = {}
        self._connected = asyncio.Event()
        self._running = False
        self._lock = asyncio.Lock()
        self._active_target = None

    @property
    def is_connected(self) -> bool:
        return self._connected.is_set() and self.ws is not None

    def _fetch_targets(self) -> list[dict]:
        """Fetch open targets from http://127.0.0.1:CDP_PORT/json."""
        url = f"http://127.0.0.1:{self.cdp_port}/json"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "MOM-TV-Bridge/2.0"})
            with urllib.request.urlopen(req, timeout=1.0) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception:
            return []

    async def _discover_page_target(self) -> dict | None:
        """Find the active page target in Brave."""
        targets = await asyncio.to_thread(self._fetch_targets)
        if not targets:
            return None

        # Filter for actual page targets
        pages = [t for t in targets if t.get("type") == "page"]
        if not pages:
            return None

        # Prefer page whose URL matches MOM TV or non-blank page
        for p in pages:
            url = p.get("url", "")
            if f":{self.http_port}" in url:
                return p
        for p in pages:
            url = p.get("url", "")
            if url and url != "about:blank":
                return p

        return pages[0]

    async def run(self):
        """Maintain persistent CDP connection to Brave with automatic reconnection."""
        self._running = True
        print(f"🔄 [CDP Bridge] Worker started. Monitoring port {self.cdp_port}...")

        while self._running:
            try:
                target = await self._discover_page_target()
                if not target:
                    await asyncio.sleep(1.0)
                    continue

                ws_url = target.get("webSocketDebuggerUrl")
                if not ws_url:
                    await asyncio.sleep(1.0)
                    continue

                self._active_target = target
                print(f"🔌 [CDP Bridge] Connecting to Brave target: {target.get('title', 'MOM TV')}...")

                async with websockets.connect(ws_url, max_size=10 * 1024 * 1024) as ws:
                    self.ws = ws
                    self._connected.set()
                    print("⚡ [CDP Bridge] Connected to Brave Chrome DevTools Protocol!")

                    # Enable core domains
                    await self._send_internal("Page.enable")
                    await self._send_internal("Runtime.enable")

                    # Automatically inject tv-engine.js
                    await self._inject_tv_engine()

                    # Message reader pump
                    async for raw_message in ws:
                        try:
                            msg = json.loads(raw_message)
                        except Exception:
                            continue

                        msg_id = msg.get("id")
                        if msg_id is not None and msg_id in self._pending_futures:
                            fut = self._pending_futures.pop(msg_id)
                            if not fut.done():
                                fut.set_result(msg)
                        else:
                            # Handle CDP event notification
                            method = msg.get("method")
                            if method == "Runtime.consoleAPICalled":
                                args = msg.get("params", {}).get("args", [])
                                txt = " ".join(str(a.get("value", "")) for a in args)
                                if "[MOM TV Engine]" in txt:
                                    print(f"📺 [TV Console] {txt}")

            except (websockets.exceptions.ConnectionClosed, ConnectionRefusedError, OSError):
                pass
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"[-] [CDP Bridge] Connection exception: {e}")
            finally:
                self._cleanup_connection()
                if self._running:
                    await asyncio.sleep(1.5)

    def _cleanup_connection(self):
        """Clean up state on disconnect."""
        self._connected.clear()
        self.ws = None
        for fut in list(self._pending_futures.values()):
            if not fut.done():
                fut.cancel()
        self._pending_futures.clear()

    async def _send_internal(self, method: str, params: dict = None) -> dict | None:
        """Internal helper to dispatch RPC command over CDP."""
        if not self.ws:
            return None
        async with self._lock:
            self._msg_id += 1
            msg_id = self._msg_id

        req = {"id": msg_id, "method": method}
        if params:
            req["params"] = params

        loop = asyncio.get_running_loop()
        fut = loop.create_future()
        self._pending_futures[msg_id] = fut

        try:
            await self.ws.send(json.dumps(req))
            return await asyncio.wait_for(fut, timeout=4.0)
        except Exception:
            self._pending_futures.pop(msg_id, None)
            return None

    async def send(self, method: str, params: dict = None, wait_response: bool = True, timeout: float = 3.5) -> dict | None:
        """Send a CDP command with optional response waiting."""
        if not self.is_connected or not self.ws:
            return None

        async with self._lock:
            self._msg_id += 1
            msg_id = self._msg_id

        req = {"id": msg_id, "method": method}
        if params:
            req["params"] = params

        loop = asyncio.get_running_loop()
        fut = loop.create_future() if wait_response else None
        if wait_response:
            self._pending_futures[msg_id] = fut

        try:
            await self.ws.send(json.dumps(req))
            if wait_response:
                return await asyncio.wait_for(fut, timeout=timeout)
            return {"id": msg_id, "status": "sent"}
        except Exception:
            if wait_response:
                self._pending_futures.pop(msg_id, None)
            return None

    async def _inject_tv_engine(self):
        """Inject tv-engine.js on all future documents and evaluate on the current page."""
        engine_path = os.path.join(BASE_DIR, "tv-engine.js")
        if not os.path.isfile(engine_path):
            print("[-] Notice: tv-engine.js not found in directory. Skipping injection.")
            return

        try:
            with open(engine_path, "r", encoding="utf-8") as f:
                script_source = f.read()
        except Exception as e:
            print(f"[-] Failed to read tv-engine.js: {e}")
            return

        # 1. Register script for all new documents/pages
        res = await self.send("Page.addScriptToEvaluateOnNewDocument", {"source": script_source})
        if res and "result" in res:
            script_id = res["result"].get("identifier")
            print(f"📜 [CDP Bridge] Injected tv-engine.js into document lifecycle (Script ID: {script_id})")

        # 2. Evaluate immediately on the currently loaded document
        await self.send("Runtime.evaluate", {"expression": script_source, "returnByValue": True})
        print("⚡ [CDP Bridge] Evaluated tv-engine.js on current active page")

    # --------------------------------------------------------------------------
    # HIGH-LEVEL SINGLE-WINDOW NAVIGATION & CONTROL API
    # --------------------------------------------------------------------------
    async def navigate(self, url: str) -> bool:
        """Single-Window In-Place Navigation: Navigate existing kiosk tab without spawning new windows."""
        print(f"🧭 [CDP Bridge] Navigating in-place to: {url}")
        res = await self.send("Page.navigate", {"url": url})
        return bool(res and "result" in res)

    async def home(self) -> bool:
        """Navigate in-place back to MOM TV Leanback Launcher."""
        return await self.navigate(f"http://localhost:{self.http_port}/tv")

    async def reload(self, ignore_cache: bool = True) -> bool:
        """Reload the active page in-place."""
        print("🔄 [CDP Bridge] Reloading current page...")
        res = await self.send("Page.reload", {"ignoreCache": ignore_cache})
        return bool(res)

    async def evaluate(self, expression: str) -> any:
        """Execute arbitrary JavaScript expression in the active page."""
        res = await self.send("Runtime.evaluate", {"expression": expression, "returnByValue": True})
        if res and "result" in res:
            return res["result"].get("result", {}).get("value")
        return None

    async def go_back(self) -> bool:
        """Navigate back via custom tv-engine handler or browser history."""
        expr = "(window.MomTV && typeof window.MomTV.goBack === 'function') ? window.MomTV.goBack() : window.history.back()"
        res = await self.evaluate(expr)
        return bool(res)

    async def dispatch_key(self, key_name: str) -> bool:
        """
        Direct Key Injection:
        1. Calls window.MomTV?.handleKey(keyName) for spatial navigation & player takeover.
        2. Dispatches Input.dispatchKeyEvent (rawKeyDown + keyUp) directly into the page DOM.
        """
        k = (key_name or "").lower()

        # Step 1: Call injected engine handleKey()
        js_call = f"window.MomTV?.handleKey?.({json.dumps(k)})"
        handled = await self.evaluate(js_call)

        # Step 2: Synthesize CDP Input DOM Key Events if not handled by MomTV engine
        dispatched_cdp = False
        if not handled and k in CDP_KEY_MAP:
            info = CDP_KEY_MAP[k]
            vk = info["windowsVirtualKeyCode"]
            key_val = info["key"]
            code_val = info["code"]

            # Dispatch rawKeyDown
            await self.send("Input.dispatchKeyEvent", {
                "type": "rawKeyDown",
                "key": key_val,
                "code": code_val,
                "windowsVirtualKeyCode": vk,
                "nativeVirtualKeyCode": vk,
            }, wait_response=False)

            # Dispatch keyUp
            await self.send("Input.dispatchKeyEvent", {
                "type": "keyUp",
                "key": key_val,
                "code": code_val,
                "windowsVirtualKeyCode": vk,
                "nativeVirtualKeyCode": vk,
            }, wait_response=False)
            dispatched_cdp = True

        return bool(handled or dispatched_cdp)

    async def stop(self):
        """Stop worker and close connection."""
        self._running = False
        if self.ws:
            try:
                await self.ws.close()
            except Exception:
                pass
        self._cleanup_connection()


# Global Singleton Instances
kiosk_supervisor = BraveKioskSupervisor(port=CDP_PORT, http_port=HTTP_PORT)
cdp_bridge = CDPControllerBridge(cdp_port=CDP_PORT, http_port=HTTP_PORT)

# Ensure supervisor clean termination on Python exit
atexit.register(kiosk_supervisor.stop)


# ==============================================================================
# BROWSER & APP LAUNCH FALLBACK ENGINE
# ==============================================================================
def launch_target(target: str, is_home: bool = False):
    """Fallback launcher for desktop applications and local files."""
    if not target:
        return

    resolved = APP_SHORTCUTS.get(target.lower(), target)

    # Local file / directory fallback
    if not (resolved.startswith("http://") or resolved.startswith("https://")):
        if resolved.startswith("file:///") or os.path.exists(resolved):
            print(f"📂 Opening local target: {resolved}")
            os.startfile(resolved)
            park_cursor()
            return

    # If Brave Kiosk is active, fallback should delegate to CDP navigate
    if kiosk_supervisor.is_running and cdp_bridge.is_connected:
        asyncio.run_coroutine_threadsafe(cdp_bridge.navigate(resolved), asyncio.get_event_loop())
        park_cursor()
        return

    # Fallback to system browser or executable launch
    if kiosk_supervisor.browser_path:
        args = [
            kiosk_supervisor.browser_path,
            f"--app={resolved}",
            "--start-fullscreen",
            "--no-first-run",
            "--no-default-browser-check",
        ]
        if "youtube.com" in resolved.lower():
            args.append(f"--user-agent={SMART_TV_UA}")
        try:
            subprocess.Popen(args)
        except Exception:
            os.startfile(resolved)
    else:
        os.startfile(resolved)

    park_cursor()


# ==============================================================================
# HTTP REQUEST HANDLER & STATIC ASSET SERVER
# ==============================================================================
def get_local_ip() -> str:
    """Determine the LAN IP address of this machine."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


LOCAL_IP = get_local_ip()
QR_SVG_CACHE = None


def get_qr_svg_data() -> bytes:
    """Generate or return cached SVG QR code for pairing."""
    global QR_SVG_CACHE
    if QR_SVG_CACHE is not None:
        return QR_SVG_CACHE
    try:
        import qrcode
        import qrcode.image.svg
        import io
        qr = qrcode.QRCode(border=2, box_size=10, image_factory=qrcode.image.svg.SvgPathImage)
        qr.add_data(f"http://{LOCAL_IP}:{HTTP_PORT}/remote")
        img = qr.make_image()
        buf = io.BytesIO()
        img.save(buf)
        QR_SVG_CACHE = buf.getvalue()
        return QR_SVG_CACHE
    except Exception as e:
        return str(e).encode("utf-8")


class SmartTVHTTPRequestHandler(SimpleHTTPRequestHandler):
    """Custom HTTP Handler serving Remote, TV Launcher, tv-engine.js, PWA assets & APIs."""

    def log_message(self, format, *args):
        # Suppress verbose GET logging to keep terminal clean
        pass

    def end_headers_with_cors(self, content_type: str):
        self.send_header("Content-Type", content_type)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.end_headers()

    def do_OPTIONS(self):
        try:
            self.send_response(200)
            self.end_headers_with_cors("text/plain")
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            pass

    def serve_file_or_fallback(self, filename: str, content_type: str, fallback_bytes: bytes):
        try:
            filepath = os.path.join(BASE_DIR, filename)
            if os.path.isfile(filepath):
                try:
                    with open(filepath, "rb") as f:
                        data = f.read()
                    self.send_response(200)
                    self.end_headers_with_cors(content_type)
                    self.wfile.write(data)
                    return
                except Exception as e:
                    print(f"[-] Error reading {filename}: {e}")

            # Serve fallback if file doesn't exist yet
            self.send_response(200)
            self.end_headers_with_cors(content_type)
            self.wfile.write(fallback_bytes)
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            pass
        except Exception as e:
            print(f"[-] Error serving {filename}: {e}")

    def do_GET(self):
        try:
            self._handle_get()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            pass
        except Exception as e:
            print(f"[-] HTTP GET exception: {e}")

    def do_POST(self):
        try:
            self._handle_get()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            pass
        except Exception as e:
            print(f"[-] HTTP POST exception: {e}")

    def _handle_get(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip("/")
        if not path:
            path = "/"

        # 1. Remote Controller (index.html)
        if path in ("/", "/remote"):
            self.serve_file_or_fallback(
                "index.html",
                "text/html; charset=utf-8",
                b"<!DOCTYPE html><html><head><title>MOM TV Remote</title></head>"
                b"<body style='background:#111;color:#fff;'><h1>MOM TV Remote</h1></body></html>",
            )
            return

        # 2. TV Leanback Launcher (tv.html)
        if path == "/tv":
            fallback_tv = (
                b"<!DOCTYPE html><html><head><meta charset='UTF-8'>"
                b"<title>MOM TV Launcher</title></head>"
                b"<body style='background:#0b0c10;color:#fff;font-family:sans-serif;"
                b"display:flex;align-items:center;justify-content:center;height:100vh;margin:0;'>"
                b"<div style='text-align:center'><h1>MOM TV 2.0 Launcher Ready</h1>"
                b"<p style='color:#888'>Waiting for TV interface assets...</p></div></body></html>"
            )
            self.serve_file_or_fallback("tv.html", "text/html; charset=utf-8", fallback_tv)
            return

        # 2b. Injected Smart TV Engine (tv-engine.js)
        if path == "/tv-engine.js":
            fallback_engine = b"// MOM TV Injected Engine Fallback\nwindow.MomTV = window.MomTV || {};\n"
            self.serve_file_or_fallback("tv-engine.js", "application/javascript; charset=utf-8", fallback_engine)
            return

        # 3. PWA Manifest
        if path == "/manifest.json":
            fallback_manifest = json.dumps(
                {
                    "name": "MOM TV Remote",
                    "short_name": "MomTV",
                    "start_url": "/remote",
                    "display": "standalone",
                    "background_color": "#0b0c10",
                    "theme_color": "#0b0c10",
                    "orientation": "portrait",
                },
                indent=2,
            ).encode("utf-8")
            self.serve_file_or_fallback(
                "manifest.json", "application/manifest+json; charset=utf-8", fallback_manifest
            )
            return

        # 4. Service Worker
        if path == "/sw.js":
            fallback_sw = (
                b"self.addEventListener('install', (e) => self.skipWaiting());\n"
                b"self.addEventListener('activate', (e) => self.clients.claim());\n"
            )
            filepath = os.path.join(BASE_DIR, "sw.js")
            if os.path.isfile(filepath):
                with open(filepath, "rb") as f:
                    fallback_sw = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.send_header("Service-Worker-Allowed", "/")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(fallback_sw)
            return

        # 5. System Info API
        if path in ("/api/info", "/api/status", "/info"):
            payload = {
                "status": "online",
                "ip": LOCAL_IP,
                "http_port": HTTP_PORT,
                "ws_port": WS_PORT,
                "cdp_port": CDP_PORT,
                "cdp_connected": cdp_bridge.is_connected,
                "kiosk_active": kiosk_supervisor.is_running,
                "browser": kiosk_supervisor.browser_name,
                "browser_path": kiosk_supervisor.browser_path,
                "remote_url": f"http://{LOCAL_IP}:{HTTP_PORT}/remote",
                "tv_url": f"http://{LOCAL_IP}:{HTTP_PORT}/tv",
                "version": "2.0.0",
            }
            body = json.dumps(payload, indent=2).encode("utf-8")
            self.send_response(200)
            self.end_headers_with_cors("application/json; charset=utf-8")
            self.wfile.write(body)
            return

        # 5b. Pairing QR Code SVG API
        if path in ("/api/qr", "/api/qr.svg"):
            try:
                svg_data = get_qr_svg_data()
                self.send_response(200)
                self.end_headers_with_cors("image/svg+xml")
                self.wfile.write(svg_data)
                return
            except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
                return
            except Exception as e:
                try:
                    self.send_response(500)
                    self.end_headers_with_cors("text/plain")
                    self.wfile.write(str(e).encode("utf-8"))
                except Exception:
                    pass
                return

        # 5c. Kiosk Close API
        if path in ("/api/kiosk/close", "/api/kiosk_close", "/api/exit"):
            print("💻 [HTTP API] Exit to Windows requested. Stopping Brave Kiosk...")
            kiosk_supervisor.stop()
            try:
                user32.SetCursorPos(500, 500)
            except Exception:
                pass
            payload = {
                "status": "ok",
                "cmd": "kiosk_close",
                "message": "Brave Kiosk closed, returned to Windows desktop",
            }
            body = json.dumps(payload, indent=2).encode("utf-8")
            self.send_response(200)
            self.end_headers_with_cors("application/json; charset=utf-8")
            self.wfile.write(body)
            return

        # 5d. Search API
        if path == "/api/search":
            q_params = urllib.parse.parse_qs(parsed.query)
            query = q_params.get("q", [""])[0] or q_params.get("query", [""])[0]
            destination = (q_params.get("destination", ["youtube"])[0] or "youtube").lower()
            encoded = urllib.parse.quote_plus(query.strip())

            if destination in ("hotstar", "disney"):
                target_url = f"https://www.hotstar.com/in/explore?search_query={encoded}"
            elif destination in ("web", "google"):
                target_url = f"https://www.google.com/search?q={encoded}"
            else:
                target_url = f"https://www.youtube.com/results?search_query={encoded}"

            if query:
                if kiosk_supervisor.is_running and cdp_bridge.is_connected:
                    try:
                        asyncio.run_coroutine_threadsafe(cdp_bridge.navigate(target_url), asyncio.get_event_loop())
                    except Exception:
                        launch_target(target_url)
                else:
                    launch_target(target_url)
                park_cursor()

            payload = {
                "status": "ok",
                "cmd": "search",
                "query": query,
                "destination": destination,
                "target": target_url,
            }
            body = json.dumps(payload, indent=2).encode("utf-8")
            self.send_response(200)
            self.end_headers_with_cors("application/json; charset=utf-8")
            self.wfile.write(body)
            return

        # 6. Static Asset Handling (Icons, SVG, CSS, JS, etc.)
        clean_rel = parsed.path.lstrip("/").replace("\\", "/")
        norm_path = os.path.normpath(os.path.join(BASE_DIR, clean_rel))

        # Prevent directory traversal attacks
        if not norm_path.lower().startswith(BASE_DIR.lower()):
            self.send_response(403)
            self.end_headers_with_cors("text/plain")
            self.wfile.write(b"Forbidden")
            return

        if os.path.isfile(norm_path):
            ext = os.path.splitext(norm_path)[1].lower()
            mime = MIME_TYPES.get(ext, "application/octet-stream")
            try:
                with open(norm_path, "rb") as f:
                    content = f.read()
                self.send_response(200)
                self.end_headers_with_cors(mime)
                self.wfile.write(content)
                return
            except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
                return
            except Exception as e:
                try:
                    self.send_response(500)
                    self.end_headers_with_cors("text/plain")
                    self.wfile.write(str(e).encode("utf-8"))
                except Exception:
                    pass
                return

        # Not Found
        self.send_response(404)
        self.end_headers_with_cors("text/plain")
        self.wfile.write(b"404 Not Found")


class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True

    def handle_error(self, request, client_address):
        # Gracefully ignore socket disconnects when browsers abort requests
        exc_type, _, _ = sys.exc_info()
        if exc_type in (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            return
        super().handle_error(request, client_address)


def start_http_server():
    """Run multi-threaded HTTP server on port 8765 with auto-recovery."""
    while True:
        try:
            server = ReusableThreadingHTTPServer(("0.0.0.0", HTTP_PORT), SmartTVHTTPRequestHandler)
            server.serve_forever()
        except Exception as e:
            print(f"[-] HTTP server error: {e}. Recovering in 2s...")
            time.sleep(2)


# ==============================================================================
# WEBSOCKET AUTOMATION CONTROLLER
# ==============================================================================
CONNECTED_CLIENTS: set[websockets.WebSocketServerProtocol] = set()

# Server-side debounce tracking per client session (120ms debounce on directional/discrete keys)
# Guarantees that duplicate network packets or rapid touch repeats never trigger double moves
CLIENT_LAST_KEY_TIME: dict[any, float] = {}
SERVER_DEBOUNCE_KEYS = {"up", "down", "left", "right", "ok", "enter", "back"}
SERVER_DEBOUNCE_INTERVAL_SEC = 0.120  # 120ms


async def broadcast_status(data: dict):
    """Broadcast an event or status dictionary to all connected remotes."""
    if not CONNECTED_CLIENTS:
        return
    message = json.dumps(data)
    await asyncio.gather(
        *(client.send(message) for client in list(CONNECTED_CLIENTS)),
        return_exceptions=True,
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
        success = await cdp_bridge.home()
        if not success:
            launch_target(TV_URL, is_home=True)
        park_cursor()
        response["action"] = "home"
        response["method"] = "cdp_navigate" if success else "fallback_home"

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
                    combo([0x11, 0xBB])  # Ctrl + = (+)
                elif k in ("zoomout", "zoom_out"):
                    combo([0x11, 0xBD])  # Ctrl + -
                elif k in ("zoomreset", "zoom_reset"):
                    combo([0x11, 0x30])  # Ctrl + 0
                elif k in VK_MAP:
                    press_vk(VK_MAP[k])
        else:
            # Step 2: Hardware Fallback ONLY if CDP is completely offline/disconnected
            response["handled"] = False
            response["method"] = "vk_fallback"
            if k in VK_MAP:
                press_vk(VK_MAP[k])
            elif k == "back":
                combo([0x12, 0x25])  # Alt + Left (Hardware Browser Back)
            elif k == "forward":
                combo([0x12, 0x27])  # Alt + Right
            elif k in ("reload", "refresh"):
                combo([0x11, 0x52])  # Ctrl + R
            elif k in ("zoomin", "zoom_in"):
                combo([0x11, 0xBB])  # Ctrl + = (+)
            elif k in ("zoomout", "zoom_out"):
                combo([0x11, 0xBD])  # Ctrl + -
            elif k in ("zoomreset", "zoom_reset"):
                combo([0x11, 0x30])  # Ctrl + 0
            elif k in ("rewind", "rewind10", "replay"):
                press_vk(0x25)  # Left arrow
            elif k in ("forward10", "fastforward", "skip"):
                press_vk(0x27)  # Right arrow
            elif k in ("playpause", "play_pause", "toggle_play"):
                press_vk(0xB3)  # VK_MEDIA_PLAY_PAUSE

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
            combo(vk_list)
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


async def websocket_handler(ws):
    """Handle incoming WebSocket connections from phone remotes and TV clients."""
    CONNECTED_CLIENTS.add(ws)
    peer = ws.remote_address if hasattr(ws, "remote_address") else "unknown"
    print(f"📱 Remote connected: {peer} (Total active: {len(CONNECTED_CLIENTS)})")

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


# ==============================================================================
# STARTUP BANNER & TERMINAL ASCII QR CODE
# ==============================================================================
def print_startup_banner():
    """Print an ASCII QR code and setup guide in the console."""
    remote_url = f"http://{LOCAL_IP}:{HTTP_PORT}"
    tv_url = f"http://{LOCAL_IP}:{HTTP_PORT}/tv"

    print("\n" + "═" * 65)
    print("  📺  MOM TV 2.0 — SMART TV KIOSK & CDP REMOTE SERVER RUNNING")
    print("═" * 65)
    print(f"  ▶ Local LAN IP:        {LOCAL_IP}")
    print(f"  ▶ HTTP Web Server:     http://localhost:{HTTP_PORT} (Port {HTTP_PORT})")
    print(f"  ▶ WebSocket Engine:    ws://localhost:{WS_PORT} (Port {WS_PORT})")
    print(f"  ▶ Brave CDP Port:      http://127.0.0.1:{CDP_PORT} (Port {CDP_PORT})")
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
    # 1. Start HTTP Server in background daemon thread
    http_thread = threading.Thread(target=start_http_server, name="HTTPServerThread", daemon=True)
    http_thread.start()

    # 2. Print Startup Banner & QR code
    print_startup_banner()

    # 3. Launch Brave in SEB Kiosk Mode with Remote Debugging
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
        cdp_task.cancel()
        await cdp_bridge.stop()
        kiosk_supervisor.stop()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n🛑 MOM TV Server stopped by user.")
    except Exception as e:
        print(f"[-] MOM TV Server crashed: {e}")
    finally:
        kiosk_supervisor.stop()