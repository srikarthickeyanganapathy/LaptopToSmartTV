"""
MOM TV — Server Deprecation & Automatic Upgrade Wrapper
======================================================
NOTICE: server.py was the prototype server from Phase 1.
The entire ecosystem has been upgraded to MOM TV 2.0 in `app.py`.

Key Enhancements in MOM TV 2.0 (`app.py`):
  • Unified HTTP (Port 8765) + WebSocket (Port 8766) Server
  • Cinema-grade 10-foot TV Launcher (`/tv`) with spatial focus & ambient sound
  • Studio-grade Mobile Remote (`/remote`) with tactile haptics & standalone PWA
  • Native Brave/Chrome Kiosk Mode (`--app`) with zero window chrome
  • Smart TV Tizen User-Agent for YouTube Leanback (`youtube.com/tv`)
  • Master Windows Volume, Screen Blanking & Standby controls
  • Automatic off-screen mouse cursor parking (`(9999, 9999)`)
  • Fast QR-code mobile pairing (`/api/qr.svg`)

Running this file will automatically delegate to `app.py`.
You can also run `app.py` directly:
    .\\.venv\\Scripts\\python.exe app.py
"""

import os
import sys

# Ensure Windows stdout supports UTF-8
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

print("\n" + "=" * 64)
print("  [MOM TV 2.0 UPGRADE NOTICE]")
print("  server.py has been upgraded to app.py (Commercial-Grade Engine)")
print("  Redirecting automatically to app.py...")
print("=" * 64 + "\n")

# Re-route execution to app.py in the same directory
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
APP_PATH = os.path.join(BASE_DIR, "app.py")

if __name__ == "__main__":
    if not os.path.exists(APP_PATH):
        print(f"[-] Error: Could not find app.py at {APP_PATH}")
        sys.exit(1)

    import subprocess
    try:
        result = subprocess.run([sys.executable, "app.py"], cwd=BASE_DIR)
        # FIX: propagate app.py's exit code (previously always exited 0, so
        # supervisors/scripts could not detect a crashed server).
        sys.exit(result.returncode)
    except KeyboardInterrupt:
        print("\n🛑 MOM TV Server stopped by user.")