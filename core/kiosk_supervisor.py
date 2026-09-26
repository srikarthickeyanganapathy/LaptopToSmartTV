"""
core/kiosk_supervisor.py — SEB-Style Brave Kiosk Process Supervisor
Responsibilities: Browser path detection, dedicated kiosk profile launch, crash watchdog thread, and clean shutdown.
"""

import os
import time
import subprocess
import threading
import shutil
import winreg
import atexit
from core.config import CDP_PORT, HTTP_PORT, BRAVE_PROFILE_DIR, BASE_DIR, SMART_TV_UA, TV_URL
from core.win32_input import park_cursor

__all__ = [
    "BraveKioskSupervisor",
    "kiosk_supervisor",
]


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

    def start(self, initial_url: str | None = None):
        """Start the Brave Kiosk process and the health watchdog thread."""
        with self._lock:
            if self._should_run:
                return
            self._should_run = True
            self._launch_process(initial_url=initial_url)
            self._watchdog_thread = threading.Thread(target=self._watchdog_loop, name="BraveWatchdog", daemon=True)
            self._watchdog_thread.start()

    def _launch_process(self, initial_url: str | None = None):
        if not self.browser_path or not os.path.isfile(self.browser_path):
            print(f"[-] [Kiosk Supervisor] Browser binary not found at: {self.browser_path}")
            return

        target_url = initial_url or TV_URL
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

        args.append(target_url)

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


# Global Singleton Instance & Exit Registration
kiosk_supervisor = BraveKioskSupervisor(port=CDP_PORT, http_port=HTTP_PORT)
atexit.register(kiosk_supervisor.stop)
