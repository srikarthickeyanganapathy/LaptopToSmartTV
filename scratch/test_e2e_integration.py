"""
MOM TV 2.0 -- End-to-End QA, Integration & Smoke Test Suite (Phase 3)
Verifies:
1. Server launch and HTTP endpoints (/, /remote, /tv, /tv-engine.js, /api/info, /api/qr.svg, /manifest.json, /sw.js)
2. Brave Kiosk launch with persistence flags (--disable-session-crashed-bubble, --password-store=basic, --hide-crash-restore-bubble, .brave_tv_profile)
3. WebSocket command protocol on port 8766 (handshake, d-pad commands, volume, power, cursor, Magic Trackpad: mouse_move, mouse_click, mouse_scroll)
4. System info verification (kiosk_active: True, cdp_connected: True)
"""

import os
import sys
import time
import json
import socket
import asyncio
import subprocess
import urllib.request
import urllib.error
import websockets

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

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
    mark = "[OK]" if passed else "[FAIL]"
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

def check_http_endpoint(url, expected_type=None, contains_text=None, min_len=0):
    req = urllib.request.Request(url, headers={"User-Agent": "MOM-TV-QA-Suite/3.0"})
    with urllib.request.urlopen(req, timeout=5) as resp:
        code = resp.getcode()
        headers = dict(resp.getheaders())
        content = resp.read()
        
        type_ok = True
        if expected_type:
            ct = headers.get("Content-Type", "")
            type_ok = expected_type.lower() in ct.lower()
            
        text_ok = True
        if contains_text:
            if isinstance(contains_text, str):
                text_ok = contains_text.encode('utf-8') in content
            else:
                text_ok = all(t.encode('utf-8') in content for t in contains_text)
                
        len_ok = len(content) >= min_len
        return code == 200 and type_ok and text_ok and len_ok, code, headers, content

async def send_and_recv(ws, msg, timeout=5):
    await ws.send(json.dumps(msg))
    while True:
        raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
        data = json.loads(raw)
        if data.get("type") == "clients_update":
            continue
        return data

async def test_websocket_commands():
    uri = f"ws://127.0.0.1:{WS_PORT}"
    print(f"\n[WS] Connecting to WebSocket at {uri}...")
    async with websockets.connect(uri) as ws:
        # 1. Welcome Handshake
        raw = await asyncio.wait_for(ws.recv(), timeout=5)
        welcome = json.loads(raw)
        is_welcome = welcome.get("type") == "welcome" and welcome.get("status") == "connected"
        record("WebSocket", "Welcome Handshake", is_welcome, f"Server: {welcome.get('server')}, IP: {welcome.get('ip')}")

        # Drain any initial broadcast updates
        try:
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=0.5)
                data = json.loads(raw)
                if data.get("type") != "clients_update":
                    break
        except (TimeoutError, asyncio.TimeoutError):
            pass

        # 2. Ping command
        resp = await send_and_recv(ws, {"cmd": "ping"})
        record("WebSocket", "Ping / Keep-alive", resp.get("pong") is True, f"Response: {resp}")

        # 3. D-Pad Discrete Key Commands (Spaced >120ms)
        for key in ["up", "down", "left", "right", "ok", "back"]:
            await asyncio.sleep(0.14)  # Ensure outside 120ms server debounce window
            resp = await send_and_recv(ws, {"cmd": "key", "key": key})
            key_ok = resp.get("key") == key and ("handled" in resp) and not resp.get("debounced", False)
            record("Step-Lock WebSocket", f"Key D-Pad '{key}' (Spaced)", key_ok, f"Handled: {resp.get('handled')}, Debounced: {resp.get('debounced', False)}")

        # 4. Rapid Burst Protection (< 120ms): Verify burst packets are cleanly dropped by server
        burst_key = "right"
        # First key establishes baseline timestamp
        await asyncio.sleep(0.14)
        first_resp = await send_and_recv(ws, {"cmd": "key", "key": burst_key})
        first_ok = first_resp.get("key") == burst_key and not first_resp.get("debounced", False)
        record("Step-Lock WebSocket", "Burst Baseline Packet (Allowed)", first_ok, f"Handled: {first_resp.get('handled')}")

        # Fire 4 rapid burst packets with 0ms sleep (< 120ms)
        burst_drops = []
        for i in range(4):
            burst_resp = await send_and_recv(ws, {"cmd": "key", "key": burst_key})
            burst_drops.append(burst_resp.get("debounced", False) is True)
        all_bursts_dropped = all(burst_drops)
        record("Step-Lock WebSocket", "Rapid Burst Packets (<120ms) Debounced", all_bursts_dropped, f"4/4 Packets Dropped: {burst_drops}")

        # 5. Recovery after Debounce Interval: Spaced packet (> 120ms) passes through
        await asyncio.sleep(0.15)  # 150ms > 120ms
        rec_resp = await send_and_recv(ws, {"cmd": "key", "key": burst_key})
        rec_ok = rec_resp.get("key") == burst_key and not rec_resp.get("debounced", False)
        record("Step-Lock WebSocket", "Post-Burst Spaced Packet (>120ms)", rec_ok, f"Handled: {rec_resp.get('handled')}, Debounced: {rec_resp.get('debounced', False)}")

        # 6. Multi-Client Session Isolation: Client B is not blocked by Client A's debounce
        async with websockets.connect(uri) as ws2:
            # Drain welcome on ws2
            await asyncio.wait_for(ws2.recv(), timeout=5)
            # Send immediately on ws2 right after ws sent
            ws2_resp = await send_and_recv(ws2, {"cmd": "key", "key": "right"})
            ws2_ok = ws2_resp.get("key") == "right" and not ws2_resp.get("debounced", False)
            record("Step-Lock WebSocket", "Session Isolation (Client B Not Debounced)", ws2_ok, f"Client B Handled: {ws2_resp.get('handled')}")

        # 4. Volume commands
        for act in ["up", "down", "mute"]:
            resp = await send_and_recv(ws, {"cmd": "volume", "action": act})
            vol_ok = resp.get("volume_action") == act
            record("WebSocket", f"Volume '{act}'", vol_ok, f"Response: {resp}")

        # 5. Power command
        resp = await send_and_recv(ws, {"cmd": "power", "action": "status"})
        record("WebSocket", "Power Status", resp.get("power_action") == "status", f"Response: {resp}")

        # 6. Cursor Parking command
        resp = await send_and_recv(ws, {"cmd": "cursor"})
        record("WebSocket", "Cursor Park", resp.get("cursor") == "parked", f"Response: {resp}")

        # 7. Navigation: Home command
        resp = await send_and_recv(ws, {"cmd": "home"})
        record("WebSocket", "Home Navigation", resp.get("action") == "home", f"Method: {resp.get('method')}")

        # 8. Navigation: Launch TV command
        resp = await send_and_recv(ws, {"cmd": "launch", "app": "tv"})
        record("WebSocket", "Launch TV", "target" in resp, f"Target: {resp.get('target')}")

        # 9. Magic Trackpad: mouse_move
        resp = await send_and_recv(ws, {"cmd": "mouse_move", "dx": 28.5, "dy": -14.2})
        move_ok = resp.get("dx") == 28.5 and resp.get("dy") == -14.2
        record("Magic Trackpad", "mouse_move (dx, dy)", move_ok, f"dx: {resp.get('dx')}, dy: {resp.get('dy')}")

        # 10. Magic Trackpad: mouse_click left
        resp = await send_and_recv(ws, {"cmd": "mouse_click", "button": "left"})
        click_ok = resp.get("button") == "left"
        record("Magic Trackpad", "mouse_click (left)", click_ok, f"Button: {resp.get('button')}")

        # 11. Magic Trackpad: mouse_click right
        resp = await send_and_recv(ws, {"cmd": "mouse_click", "button": "right"})
        rclick_ok = resp.get("button") == "right"
        record("Magic Trackpad", "mouse_click (right)", rclick_ok, f"Button: {resp.get('button')}")

        # 12. Magic Trackpad: mouse_scroll
        resp = await send_and_recv(ws, {"cmd": "mouse_scroll", "dy": 60.0})
        scroll_ok = resp.get("dy") == 60.0
        record("Magic Trackpad", "mouse_scroll (vertical wheel)", scroll_ok, f"dy: {resp.get('dy')}")

def inspect_brave_process_flags():
    print("\n[INSPECT] Inspecting Brave process command line arguments...")
    try:
        cmd = 'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name like \'%brave%\'\\" | Select-Object -ExpandProperty CommandLine"'
        output = subprocess.check_output(cmd, shell=True, text=True, errors='replace')
        
        # Check for persistence flags
        has_kiosk = "--kiosk" in output
        has_profile = ".brave_tv_profile" in output
        has_crash_bubble = "--disable-session-crashed-bubble" in output
        has_hide_restore = "--hide-crash-restore-bubble" in output
        has_password_store = "--password-store=basic" in output
        has_network_service = "--enable-features=NetworkService,NetworkServiceInProcess" in output

        record("Brave Kiosk", "Flag: --kiosk", has_kiosk, "SEB TV full screen enforcement")
        record("Brave Kiosk", "Flag: --user-data-dir (.brave_tv_profile)", has_profile, "Isolated persistent profile")
        record("Brave Kiosk", "Flag: --disable-session-crashed-bubble", has_crash_bubble, "Crash restore prompt disabled")
        record("Brave Kiosk", "Flag: --hide-crash-restore-bubble", has_hide_restore, "Clean headless/kiosk recovery")
        record("Brave Kiosk", "Flag: --password-store=basic", has_password_store, "Persistent credential vault")
        record("Brave Kiosk", "Flag: NetworkServiceInProcess", has_network_service, "Optimized network stack")
        return True
    except Exception as e:
        record("Brave Kiosk", "Process Flag Inspection", False, str(e))
        return False

async def main():
    print("=" * 70)
    print("MOM TV 2.0 -- PHASE 3 E2E QA INTEGRATION & VERIFICATION SUITE")
    print("=" * 70)

    app_py = os.path.join(BASE_DIR, "app.py")
    print(f"[LAUNCH] Launching server: {PYTHON_EXE} {app_py}")
    
    server_proc = subprocess.Popen(
        [PYTHON_EXE, app_py],
        cwd=BASE_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1
    )

    try:
        # Wait for HTTP server port 8765
        print("[WAIT] Waiting for HTTP server on port 8765...")
        if not wait_for_port(HTTP_PORT, timeout=15):
            record("Server", "Port 8765 Listening", False, "Timeout waiting for port 8765")
            return
        record("Server", "Port 8765 Listening", True, "HTTP server ready")

        # Wait for WebSocket server port 8766
        print("[WAIT] Waiting for WebSocket server on port 8766...")
        if not wait_for_port(WS_PORT, timeout=10):
            record("Server", "Port 8766 Listening", False, "Timeout waiting for port 8766")
            return
        record("Server", "Port 8766 Listening", True, "WebSocket server ready")

        # Wait for Brave Kiosk CDP port 9222
        print("[WAIT] Waiting for Brave Kiosk CDP on port 9222...")
        cdp_ready = wait_for_port(CDP_PORT, timeout=15)
        record("Brave Kiosk", "Port 9222 CDP Ready", cdp_ready, "Brave browser remote debugging active")

        # Give CDP bridge time to connect
        time.sleep(2)

        # -------------------------------------------------------------
        # HTTP ENDPOINT TESTS
        # -------------------------------------------------------------
        print("\n[HTTP] Testing HTTP Endpoints on port 8765...")
        
        # 1. / (Root Remote)
        ok, code, _, data = check_http_endpoint(
            f"http://127.0.0.1:{HTTP_PORT}/",
            expected_type="text/html",
            contains_text=["MOM TV Remote", "Magic Trackpad", "mode-switcher"],
            min_len=20000
        )
        record("HTTP Endpoints", "GET / (Remote PWA)", ok, f"Code: {code}, Length: {len(data)}B")

        # 2. /remote
        ok, code, _, data = check_http_endpoint(
            f"http://127.0.0.1:{HTTP_PORT}/remote",
            expected_type="text/html",
            contains_text=["MOM TV Remote", "Magic Trackpad"],
            min_len=20000
        )
        record("HTTP Endpoints", "GET /remote", ok, f"Code: {code}, Length: {len(data)}B")

        # 3. /tv (Leanback Launcher)
        ok, code, _, data = check_http_endpoint(
            f"http://127.0.0.1:{HTTP_PORT}/tv",
            expected_type="text/html",
            contains_text=["MOM TV", "clock", "weather"],
            min_len=20000
        )
        record("HTTP Endpoints", "GET /tv (Leanback Launcher)", ok, f"Code: {code}, Length: {len(data)}B")

        # 4. /tv-engine.js
        ok, code, _, data = check_http_endpoint(
            f"http://127.0.0.1:{HTTP_PORT}/tv-engine.js",
            expected_type="application/javascript",
            contains_text=[
                "emulateMouseHover",
                "emulateCoordinateClick",
                "isNetflix",
                "handleNetflixKey",
                "isHotstar",
                "handleHotstarKey",
                "isPrime",
                "handlePrimeKey",
                "isJioCinema",
                "handleJioCinemaKey",
                "moveCursor",
                "clickCursor"
            ],
            min_len=50000
        )
        record("HTTP Endpoints", "GET /tv-engine.js (Universal Engine)", ok, f"Code: {code}, Length: {len(data)}B, Adapters verified")

        # 5. /api/info
        info_ok = False
        info_json = {}
        for _ in range(5):
            ok, code, _, data = check_http_endpoint(
                f"http://127.0.0.1:{HTTP_PORT}/api/info",
                expected_type="application/json"
            )
            if ok:
                try:
                    info_json = json.loads(data.decode('utf-8'))
                    if info_json.get("kiosk_active") and info_json.get("cdp_connected"):
                        info_ok = True
                        break
                except Exception:
                    pass
            time.sleep(1)

        record("HTTP Endpoints", "GET /api/info (kiosk_active & cdp_connected)", info_ok,
               f"kiosk_active: {info_json.get('kiosk_active')}, cdp_connected: {info_json.get('cdp_connected')}, browser: {info_json.get('browser')}")

        # 6. /api/qr.svg
        ok, code, _, data = check_http_endpoint(
            f"http://127.0.0.1:{HTTP_PORT}/api/qr.svg",
            expected_type="image/svg+xml",
            contains_text="<svg",
            min_len=1000
        )
        record("HTTP Endpoints", "GET /api/qr.svg (Pairing QR)", ok, f"Code: {code}, Length: {len(data)}B")

        # 7. /manifest.json
        ok, code, _, data = check_http_endpoint(
            f"http://127.0.0.1:{HTTP_PORT}/manifest.json",
            expected_type="application/manifest+json",
            contains_text=["MOM TV Remote", "start_url"],
            min_len=100
        )
        record("HTTP Endpoints", "GET /manifest.json (PWA Manifest)", ok, f"Code: {code}, Length: {len(data)}B")

        # 8. /sw.js
        ok, code, headers, data = check_http_endpoint(
            f"http://127.0.0.1:{HTTP_PORT}/sw.js",
            expected_type="application/javascript",
            min_len=100
        )
        sw_allowed = headers.get("Service-Worker-Allowed") == "/"
        record("HTTP Endpoints", "GET /sw.js (Service Worker)", ok and sw_allowed, f"Code: {code}, SW-Allowed header: {headers.get('Service-Worker-Allowed')}")

        # 9. /icon.svg
        ok, code, _, data = check_http_endpoint(
            f"http://127.0.0.1:{HTTP_PORT}/icon.svg",
            expected_type="image/svg+xml",
            contains_text="<svg",
            min_len=500
        )
        record("PWA Assets", "GET /icon.svg (Vector Icon)", ok, f"Code: {code}, Length: {len(data)}B")

        # 10. /icon-192.png
        ok, code, _, data = check_http_endpoint(
            f"http://127.0.0.1:{HTTP_PORT}/icon-192.png",
            expected_type="image/png",
            min_len=1000
        )
        record("PWA Assets", "GET /icon-192.png (192px PWA Icon)", ok, f"Code: {code}, Length: {len(data)}B")

        # 11. /icon-512.png
        ok, code, _, data = check_http_endpoint(
            f"http://127.0.0.1:{HTTP_PORT}/icon-512.png",
            expected_type="image/png",
            min_len=5000
        )
        record("PWA Assets", "GET /icon-512.png (512px PWA Icon)", ok, f"Code: {code}, Length: {len(data)}B")

        # -------------------------------------------------------------
        # BRAVE KIOSK PROCESS & PERSISTENCE VERIFICATION
        # -------------------------------------------------------------
        inspect_brave_process_flags()

        # -------------------------------------------------------------
        # WEBSOCKET COMMANDS VERIFICATION
        # -------------------------------------------------------------
        await test_websocket_commands()

    finally:
        print("\n[STOP] Shutting down server and cleaning up...")
        server_proc.terminate()
        try:
            server_proc.wait(timeout=5)
        except Exception:
            server_proc.kill()
        
        # Also clean up any orphan Brave processes started with our test profile
        try:
            subprocess.run(
                'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name like \'%brave%\' and CommandLine like \'%.brave_tv_profile%\'\\" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"',
                shell=True,
                capture_output=True
            )
        except Exception:
            pass

    # -----------------------------------------------------------------
    # SUMMARY
    # -----------------------------------------------------------------
    print("\n" + "=" * 70)
    print("FINAL QA VERIFICATION SUMMARY")
    print("=" * 70)
    passed_count = sum(1 for r in results if r["status"] == "PASS")
    total_count = len(results)
    print(f"Total Tests: {total_count}")
    print(f"Passed:      {passed_count}")
    print(f"Failed:      {total_count - passed_count}")
    print(f"Pass Rate:   {(passed_count / total_count) * 100:.1f}%")
    print("=" * 70)

    if passed_count == total_count:
        print("[SUCCESS] ALL TESTS PASSED! 100% SUCCESS RATE.")
    else:
        print("[WARN] Some tests failed. Review details above.")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
