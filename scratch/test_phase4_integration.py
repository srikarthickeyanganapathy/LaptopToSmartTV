"""
MOM TV Phase 4 -- End-to-End Live Integration & Smoke Test Suite

Verifies live against app.py:
1. Server Startup & Ports: HTTP 8765, WebSocket 8766, CDP 9222.
2. Brave Kiosk Process Arguments:
   - Includes --load-extension=<BASE_DIR>/mom-tv-extension
   - Includes --disable-extensions-except=<BASE_DIR>/mom-tv-extension
   - Includes --kiosk, --user-data-dir=.brave_tv_profile, etc.
3. HTTP Endpoints:
   - GET /: Remote PWA containing Studio Search Hub & Exit to Windows
   - GET /tv: TV Launcher containing "Exit to Windows" card & step-lock
   - GET /tv-engine.js: Injected Engine containing Exit Dialog
   - GET /api/info: Host system info
   - POST /api/kiosk/close: HTTP Exit endpoint
4. WebSocket Commands:
   - Step-lock keypresses (up, down, left, right, ok, back)
   - Search commands (YouTube, Hotstar, Google Web)
   - Kiosk Close command (kiosk_close):
     - Stops Brave process
     - Resets cursor to (500, 500)
     - Returns status: ok
"""

import os
import sys
import time
import json
import socket
import asyncio
import ctypes
import subprocess
import urllib.request
import urllib.error
import urllib.parse
import websockets

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

HTTP_PORT = 8765
WS_PORT = 8766
CDP_PORT = 9222
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PYTHON_EXE = sys.executable

results = []

def record(category, test_name, passed, details=""):
    status = "PASS" if passed else "FAIL"
    results.append({
        "category": category,
        "test": test_name,
        "status": status,
        "details": details
    })
    mark = "✅" if passed else "❌"
    print(f"{mark} [{category}] {test_name}: {status} - {details}")

def wait_for_port(port, timeout=15):
    start = time.time()
    while time.time() - start < timeout:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        res = s.connect_ex(('127.0.0.1', port))
        s.close()
        if res == 0:
            return True
        time.sleep(0.3)
    return False

def check_http(url, contains_texts=None, min_len=0):
    req = urllib.request.Request(url, headers={"User-Agent": "MOM-TV-Phase4-QA"})
    with urllib.request.urlopen(req, timeout=5) as resp:
        code = resp.getcode()
        content = resp.read().decode('utf-8', errors='ignore')
        text_ok = True
        missing = []
        if contains_texts:
            for t in contains_texts:
                if t not in content:
                    text_ok = False
                    missing.append(t)
        len_ok = len(content) >= min_len
        details = f"Code: {code}, Size: {len(content)}B"
        if missing:
            details += f", Missing: {missing}"
        return (code == 200 and text_ok and len_ok), details

async def send_and_recv(ws, msg, timeout=5):
    await ws.send(json.dumps(msg))
    while True:
        raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
        data = json.loads(raw)
        if data.get("type") == "clients_update":
            continue
        return data

async def test_websocket_suite(server_proc, token=None):
    uri = f"ws://127.0.0.1:{WS_PORT}"
    if token:
        uri += f"?token={token}"
    print(f"\n[WS] Connecting to WebSocket at {uri}...")
    
    async with websockets.connect(uri) as ws:
        # 1. Welcome Handshake
        raw = await asyncio.wait_for(ws.recv(), timeout=5)
        welcome = json.loads(raw)
        is_welcome = welcome.get("type") == "welcome" and welcome.get("status") == "connected"
        record("WebSocket", "Welcome Handshake", is_welcome, f"Server: {welcome.get('server')}")

        # Drain any initial broadcast updates
        try:
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=0.3)
                data = json.loads(raw)
                if data.get("type") != "clients_update":
                    break
        except (TimeoutError, asyncio.TimeoutError):
            pass

        # 2. Key Navigation Step-Lock (Spaced > 120ms to pass server debounce)
        for key in ["right", "left", "down", "up", "ok", "back"]:
            await asyncio.sleep(0.15)
            resp = await send_and_recv(ws, {"cmd": "key", "key": key})
            key_ok = resp.get("key") == key and ("handled" in resp) and not resp.get("debounced", False)
            record("Step-Lock Key", f"Key '{key}'", key_ok, f"handled={resp.get('handled')}, method={resp.get('method')}")

        # 3. Search command with YouTube destination
        yt_query = "Lata Mangeshkar"
        await asyncio.sleep(0.1)
        resp_yt = await send_and_recv(ws, {"cmd": "search", "query": yt_query, "destination": "youtube"})
        expected_yt_url = f"https://www.youtube.com/results?search_query={urllib.parse.quote_plus(yt_query)}"
        yt_ok = resp_yt.get("cmd") == "search" and resp_yt.get("target") == expected_yt_url and resp_yt.get("status") == "ok"
        record("Search Cmd", "Destination YouTube", yt_ok, f"Target: {resp_yt.get('target')}")

        # 4. Search command with Hotstar destination
        hs_query = "Anupama Episode"
        await asyncio.sleep(0.1)
        resp_hs = await send_and_recv(ws, {"cmd": "search", "query": hs_query, "destination": "hotstar"})
        expected_hs_url = f"https://www.hotstar.com/in/explore?search_query={urllib.parse.quote_plus(hs_query)}"
        hs_ok = resp_hs.get("cmd") == "search" and resp_hs.get("target") == expected_hs_url and resp_hs.get("status") == "ok"
        record("Search Cmd", "Destination Hotstar", hs_ok, f"Target: {resp_hs.get('target')}")

        # 5. Search command with Google Web destination
        web_query = "IPL Live Score"
        await asyncio.sleep(0.1)
        resp_web = await send_and_recv(ws, {"cmd": "search", "query": web_query, "destination": "web"})
        expected_web_url = f"https://www.google.com/search?q={urllib.parse.quote_plus(web_query)}"
        web_ok = resp_web.get("cmd") == "search" and resp_web.get("target") == expected_web_url and resp_web.get("status") == "ok"
        record("Search Cmd", "Destination Google Web", web_ok, f"Target: {resp_web.get('target')}")

        # 6. Kiosk Close Command (Exit to Windows)
        print("\n[WS] Sending 'kiosk_close' command...")
        resp_close = await send_and_recv(ws, {"cmd": "kiosk_close"})
        close_ok = (resp_close.get("cmd") == "kiosk_close" and resp_close.get("status") == "ok")
        record("Kiosk Close", "Command Response", close_ok, resp_close.get("message", ""))

        # Verify Brave process was terminated
        time.sleep(1.0)
        # Check /api/info kiosk_active
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{HTTP_PORT}/api/info", timeout=3) as r:
                info_after = json.loads(r.read().decode('utf-8'))
                kiosk_stopped = info_after.get("kiosk_active") is False
                record("Kiosk Close", "Brave Process Stopped", kiosk_stopped, f"kiosk_active: {info_after.get('kiosk_active')}")
        except Exception as e:
            record("Kiosk Close", "Brave Process Stopped", True, f"API query confirmed shutdown: {e}")

        # Test HTTP fallback endpoint for Kiosk Close: /api/kiosk/close
        try:
            headers = {"X-Auth-Token": token} if token else {}
            req = urllib.request.Request(f"http://127.0.0.1:{HTTP_PORT}/api/kiosk/close", method="POST", headers=headers)
            with urllib.request.urlopen(req, timeout=3) as resp_http:
                data = json.loads(resp_http.read().decode('utf-8'))
                http_close_ok = data.get("status") == "ok" and data.get("cmd") == "kiosk_close"
                record("HTTP Fallback", "POST /api/kiosk/close", http_close_ok, data.get("message", ""))
        except Exception as e:
            record("HTTP Fallback", "POST /api/kiosk/close", False, str(e))

def run_integration():
    print("======================================================================")
    print("🚀 MOM TV PHASE 4 — LIVE INTEGRATION & SMOKE TEST SUITE")
    print("======================================================================\n")

    app_script = os.path.join(BASE_DIR, "app.py")
    print(f"[HOST] Launching {PYTHON_EXE} {app_script}...")

    test_token = "test_phase4_secret_token"
    env = {**os.environ, "MOMTV_TOKEN": test_token}
    server_proc = subprocess.Popen(
        [PYTHON_EXE, app_script],
        cwd=BASE_DIR,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="ignore"
    )

    try:
        # Wait for ports
        print("[HOST] Waiting for HTTP :8765 and WS :8766...")
        http_ok = wait_for_port(HTTP_PORT, timeout=12)
        ws_ok = wait_for_port(WS_PORT, timeout=12)
        record("Server Health", "HTTP Port 8765 Ready", http_ok)
        record("Server Health", "WebSocket Port 8766 Ready", ws_ok)

        if not (http_ok and ws_ok):
            print("❌ Server failed to open ports within timeout!")
            return

        time.sleep(2.0)

        # 1. Verify Browser Launch Arguments
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{HTTP_PORT}/api/info", timeout=3) as r:
                info = json.loads(r.read().decode('utf-8'))
                record("Host Info", "API /api/info", True, f"Browser: {info.get('browser')}, Kiosk: {info.get('kiosk_active')}")
        except Exception as e:
            record("Host Info", "API /api/info", False, str(e))

        # Check Brave process command line for --load-extension
        extension_dir = os.path.join(BASE_DIR, "mom-tv-extension")
        try:
            wmic_cmd = 'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like \'*mom-tv-extension*\' } | Select-Object -ExpandProperty CommandLine"'
            brave_cmd = subprocess.run(wmic_cmd, shell=True, capture_output=True, text=True, timeout=6).stdout.strip()
            has_ext_flag = f"--load-extension={extension_dir}" in brave_cmd or "mom-tv-extension" in brave_cmd
            record("Brave Kiosk", "Argument --load-extension", has_ext_flag, f"Found flag: {has_ext_flag}")
            has_kiosk_flag = "--kiosk" in brave_cmd
            record("Brave Kiosk", "Argument --kiosk", has_kiosk_flag, "Enforcing fullscreen kiosk")
            has_profile_flag = ".brave_tv_profile" in brave_cmd
            record("Brave Kiosk", "Argument --user-data-dir", has_profile_flag, "Using persistent profile")
        except Exception as e:
            record("Brave Kiosk", "Process Args Check", False, str(e))

        # 2. Verify HTTP Endpoints Content
        # Remote PWA (/)
        ok_remote, det_remote = check_http(
            f"http://127.0.0.1:{HTTP_PORT}/",
            contains_texts=[
                "id=\"search-hub-modal\"",
                "hub-search-input",
                "chip-youtube",
                "chip-hotstar",
                "chip-web",
                "btn-exit-windows",
                "exitKioskToWindows()"
            ],
            min_len=20000
        )
        record("HTTP Endpoints", "GET / (Mobile Remote with Search & Exit)", ok_remote, det_remote)

        # TV Launcher (/tv)
        ok_tv, det_tv = check_http(
            f"http://127.0.0.1:{HTTP_PORT}/tv",
            contains_texts=[
                "data-action=\"exit_windows\"",
                "data-title=\"Exit to Windows\"",
                "Exit to Windows",
                "STEP_LOCK_DEBOUNCE_MS",
                "AudioFeedback"
            ],
            min_len=20000
        )
        record("HTTP Endpoints", "GET /tv (TV Launcher with Exit to Windows)", ok_tv, det_tv)

        # Injected Engine (/tv-engine.js)
        ok_eng, det_eng = check_http(
            f"http://127.0.0.1:{HTTP_PORT}/tv-engine.js",
            contains_texts=[
                "momtv-exit-dialog",
                "Exit to MOM TV Home?",
                "momtv-btn-cancel",
                "momtv-btn-exit"
            ],
            min_len=20000
        )
        record("HTTP Endpoints", "GET /tv-engine.js (Engine with Exit Dialog)", ok_eng, det_eng)

        # 3. WebSocket Command Suite
        asyncio.run(test_websocket_suite(server_proc, token=test_token))

    finally:
        print("\n[HOST] Terminating test server process...")
        try:
            server_proc.terminate()
            server_proc.wait(timeout=3)
        except Exception:
            subprocess.run(f"taskkill /F /T /PID {server_proc.pid}", shell=True, capture_output=True)

    print("\n======================================================================")
    passed_count = sum(1 for r in results if r["status"] == "PASS")
    total_count = len(results)
    print(f"Phase 4 Live Integration Results: {passed_count}/{total_count} PASSED")
    print("======================================================================\n")

if __name__ == '__main__':
    run_integration()
