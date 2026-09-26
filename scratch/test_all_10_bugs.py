"""
Regression & Verification Test Suite for All 10 Critical Bugs
=============================================================
Directly exercises and validates each of the 10 security, race-condition,
and stability bug fixes implemented in MOM TV.

Bug 1: Static file handler path restriction (profile/secrets leak)
Bug 2: Directory traversal check & URL decoding
Bug 3: State-changing endpoints converted to POST + Auth token enforcement
Bug 4: SSRF protection in website metadata extraction (/api/app/preview)
Bug 5: APP_SHORTCUTS reset on app deletion & reserved keys hijack protection
Bug 6: delete_custom_app() returns False for nonexistent apps & supports dict/list formats
Bug 7: Launch race elimination (cold start directly with initial_url)
Bug 8: Single-tab enforcement tab-killing & desynchronization fixes
Bug 9: Duplicate script injection prevention & frontend idempotency
Bug 10: Thread-safe apps.json atomic read-modify-write
"""

import os
import sys
import json
import time
import socket
import urllib.request
import urllib.error
import urllib.parse
import threading
import tempfile
import asyncio
from unittest.mock import MagicMock, AsyncMock, patch

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from core.config import (
    AUTH_TOKEN,
    ALLOWED_STATIC_FILES,
    ALLOWED_STATIC_DIRS,
    HTTP_PORT,
    WS_PORT,
)
import ipaddress
import core.apps_manager as apps_manager
from core.apps_manager import (
    save_custom_app,
    delete_custom_app,
    load_all_apps,
    APP_SHORTCUTS,
    extract_website_metadata,
    is_safe_ip,
)
from core.http_server import SmartTVHTTPRequestHandler
from core.cdp_bridge import CDPControllerBridge
from core.kiosk_supervisor import BraveKioskSupervisor

test_results = []


def record(bug_num, title, passed, details=""):
    mark = "✅" if passed else "❌"
    status = "PASS" if passed else "FAIL"
    test_results.append((bug_num, title, passed, details))
    print(f"{mark} [Bug {bug_num}] {title}: {status} - {details}")


# =====================================================================
# Bug 1 & 2: Static file handler allowlist & Directory traversal
# =====================================================================
def test_bugs_1_and_2():
    print("\n--- Testing Bug 1 (Allowlist) & Bug 2 (Traversal & Encoding) ---")
    handler = SmartTVHTTPRequestHandler.__new__(SmartTVHTTPRequestHandler)

    # Bug 1: Forbidden paths
    leak_attempts = [
        "/.brave_tv_profile/Default/Cookies",
        "/.brave_tv_profile/Default/Login Data",
        "/apps.json",
        "/apps.json.example",
        "/app.py",
        "/.gitignore",
        "/core/config.py",
    ]
    for path in leak_attempts:
        resolved = handler._resolve_static_path(path)
        record(1, f"Forbidden Access Blocked: {path}", resolved is None, f"Resolved to: {resolved}")

    # Bug 1: Allowed paths
    allowed_attempts = [
        "/",
        "/tv",
        "/tv-engine.js",
        "/manifest.json",
        "/sw.js",
        "/icon.svg",
    ]
    for path in allowed_attempts:
        resolved = handler._resolve_static_path(path)
        is_ok = resolved is not None and os.path.exists(resolved)
        record(1, f"Allowed Static Asset: {path}", is_ok, f"Resolved to: {resolved}")

    # Bug 2: Directory traversal tricks
    traversal_attempts = [
        "/..%2f..%2fwindows/win.ini",
        "/../MOM TV Backup/secrets.json",
        "/./../..//etc/passwd",
        "/index.html%00.txt",
        "/%2e%2e/%2e%2e/boot.ini",
    ]
    for path in traversal_attempts:
        resolved = handler._resolve_static_path(path)
        record(2, f"Directory Traversal Rejected: {path}", resolved is None, f"Resolved to: {resolved}")


# =====================================================================
# Bug 3: Auth Token Verification & HTTP Method Enforcement
# =====================================================================
def test_bug_3():
    print("\n--- Testing Bug 3 (Token Verification & Origin Security) ---")
    handler = SmartTVHTTPRequestHandler.__new__(SmartTVHTTPRequestHandler)

    # 1. Verify token via header X-Auth-Token
    handler.headers = {"X-Auth-Token": AUTH_TOKEN}
    handler.path = "/api/info"
    record(3, "Auth via X-Auth-Token header", handler._verify_token() is True)

    # 2. Verify token via Bearer header
    handler.headers = {"Authorization": f"Bearer {AUTH_TOKEN}"}
    handler.path = "/api/info"
    record(3, "Auth via Bearer Authorization", handler._verify_token() is True)

    # 3. Verify token via URL query parameter
    handler.headers = {}
    handler.path = f"/api/info?token={AUTH_TOKEN}"
    record(3, "Auth via Query Parameter", handler._verify_token() is True)

    # 4. Verify token via JSON body
    handler.headers = {}
    handler.path = "/api/launch"
    record(3, "Auth via JSON body", handler._verify_token({"token": AUTH_TOKEN}) is True)

    # 5. Invalid / Missing token
    handler.headers = {"X-Auth-Token": "invalid_wrong_token"}
    handler.path = "/api/launch"
    record(3, "Reject Invalid Token", handler._verify_token() is False)

    handler.headers = {}
    handler.path = "/api/launch"
    record(3, "Reject Missing Token", handler._verify_token() is False)

    # 6. Origin check
    handler.headers = {"Origin": "http://evil-attacker.com"}
    allowed, origin_str = handler._is_origin_allowed()
    record(3, "Reject Evil Origin", allowed is False, f"origin_str: {origin_str}")

    handler.headers = {"Origin": "http://localhost:8765"}
    allowed, origin_str = handler._is_origin_allowed()
    record(3, "Allow Localhost Origin", allowed is True, f"origin_str: {origin_str}")


# =====================================================================
# Bug 4: SSRF Mitigations in Website Metadata Extraction
# =====================================================================
def test_bug_4():
    print("\n--- Testing Bug 4 (SSRF Protection & Safe IP Resolution) ---")
    unsafe_ips = [
        "127.0.0.1",
        "127.0.1.1",
        "10.0.0.1",
        "192.168.1.100",
        "172.16.0.5",
        "169.254.169.254",  # AWS/Cloud metadata
        "0.0.0.0",
        "::1",
        "fe80::1",
    ]
    for ip in unsafe_ips:
        is_safe = is_safe_ip(ipaddress.ip_address(ip))
        record(4, f"SSRF Block IP: {ip}", is_safe is False, f"Allowed: {is_safe}")

    safe_ips = [
        "8.8.8.8",
        "1.1.1.1",
        "142.250.190.46",
    ]
    for ip in safe_ips:
        is_safe = is_safe_ip(ipaddress.ip_address(ip))
        record(4, f"Safe External IP Allowed: {ip}", is_safe is True, f"Allowed: {is_safe}")

    # Metadata extraction on loopback address must be blocked immediately
    meta = extract_website_metadata("http://127.0.0.1:9222/json")
    record(4, "Block Localhost Metadata Query", meta.get("status") == "error", f"Returned: {meta}")


# =====================================================================
# Bug 5 & Bug 6: APP_SHORTCUTS reset, Reserved Keys, and delete_custom_app
# =====================================================================
def test_bugs_5_and_6():
    print("\n--- Testing Bug 5 (Shortcut Reset & Reserved Keys) & Bug 6 (Delete Compatibility) ---")

    # Bug 5: Cannot hijack reserved keys
    reserved_keys = ["home", "tv", "launcher", "youtube", "youtubetv"]
    for rk in reserved_keys:
        res = save_custom_app({
            "id": rk,
            "name": f"Hacked {rk}",
            "url": "https://hacked.com",
        })
        is_blocked = res.get("status") == "error"
        record(5, f"Block Hijack Reserved Key '{rk}'", is_blocked, f"Result: {res.get('message')}")

    # Bug 5: Reset on deletion
    test_app = {
        "id": "test_qa_app_temp",
        "name": "QA Temp App",
        "url": "https://test.qa.stream",
        "category": "video"
    }
    save_custom_app(test_app)
    record(5, "Save Custom App Registers Shortcut", "test_qa_app_temp" in APP_SHORTCUTS, f"URL: {APP_SHORTCUTS.get('test_qa_app_temp')}")

    # Bug 6: Deleting existing app returns True
    del_ok = delete_custom_app("test_qa_app_temp")
    record(6, "Delete Existing App Returns True", del_ok is True)

    # Bug 5: Verify shortcut is completely cleaned up
    record(5, "Shortcut Cleaned After Delete", "test_qa_app_temp" not in APP_SHORTCUTS)

    # Bug 6: Deleting nonexistent app returns False (NOT True)
    del_missing = delete_custom_app("nonexistent_qa_app_id_99999")
    record(6, "Delete Nonexistent App Returns False", del_missing is False)

    # Bug 6: Dict-format compatibility test
    with patch("core.apps_manager.CUSTOM_APPS_FILE", tempfile.mktemp(suffix=".json")):
        # Write legacy dict format {"app_1": {...}}
        with open(apps_manager.CUSTOM_APPS_FILE, "w", encoding="utf-8") as f:
            json.dump({"app_1": {"id": "app_1", "name": "App 1", "url": "https://app1.com"}}, f)

        apps = load_all_apps()
        record(6, "Load Legacy Dict Format", any(a["id"] == "app_1" for a in apps))

        del_dict_ok = delete_custom_app("app_1")
        record(6, "Delete from Legacy Dict Format", del_dict_ok is True)

        try:
            os.remove(apps_manager.CUSTOM_APPS_FILE)
        except OSError:
            pass


# =====================================================================
# Bug 7: Launch Race Elimination
# =====================================================================
def test_bug_7():
    print("\n--- Testing Bug 7 (Launch Race Elimination) ---")
    supervisor = BraveKioskSupervisor()
    with patch.object(supervisor, "_launch_process") as mock_launch:
        supervisor.start(initial_url="https://youtube.com/tv")
        passed = mock_launch.called and (
            mock_launch.call_args.kwargs.get("initial_url") == "https://youtube.com/tv"
            or (mock_launch.call_args[0] and mock_launch.call_args[0][0] == "https://youtube.com/tv")
        )
        record(7, "Supervisor Accepts initial_url", passed)


# =====================================================================
# Bug 8: Single-Tab Enforcement (close_secondary_tabs & bringToFront)
# =====================================================================
def test_bug_8():
    print("\n--- Testing Bug 8 (Single-Tab Enforcement & MRU Preservation) ---")
    bridge = CDPControllerBridge()

    # Mock targets list
    mock_pages = [
        {"id": "tab1", "type": "page", "url": "http://localhost:8765/tv", "title": "Home"},
        {"id": "tab2", "type": "page", "url": "https://www.youtube.com/tv", "title": "YouTube", "tabActive": True},
    ]

    with patch.object(bridge, "_fetch_targets", return_value=mock_pages), \
         patch("urllib.request.urlopen") as mock_urlopen:

        closed_count = bridge.close_secondary_tabs()
        record(8, "close_secondary_tabs executes cleanly", closed_count == 1, f"Closed: {closed_count}")

        urls_called = [c[0][0].full_url if hasattr(c[0][0], "full_url") else str(c[0][0]) for c in mock_urlopen.call_args_list]
        activated_tab2 = any("activate/tab2" in u for u in urls_called)
        record(8, "Brought active foreground tab (tab2) to front", activated_tab2, f"URLs: {urls_called}")

        closed_tab1 = any("close/tab1" in u for u in urls_called)
        record(8, "Closed background tab (tab1)", closed_tab1)


# =====================================================================
# Bug 9: Duplicate Script Injection & Idempotency
# =====================================================================
def test_bug_9():
    print("\n--- Testing Bug 9 (Script Injection Idempotency) ---")
    bridge = CDPControllerBridge()
    bridge._connected.set()
    bridge.ws = MagicMock()
    bridge._script_identifier = "script-ident-1234"

    async def mock_send(method, params=None, **kwargs):
        if method == "Page.addScriptToEvaluateOnNewDocument":
            return {"result": {"identifier": "script-ident-5678"}}
        return {"result": {}}

    with patch.object(bridge, "send", side_effect=mock_send) as patch_send:
        asyncio.run(bridge._inject_tv_engine())

        called_remove = any(
            c[0][0] == "Page.removeScriptToEvaluateOnNewDocument" and c[0][1].get("identifier") == "script-ident-1234"
            for c in patch_send.call_args_list
        )
        record(9, "Old Script Identifier Removed Before Re-injection", called_remove)
        record(9, "New Script Identifier Tracked", bridge._script_identifier == "script-ident-5678")

    # Check frontend tv-engine.js has idempotency guard
    engine_path = os.path.join(BASE_DIR, "tv-engine.js")
    with open(engine_path, "r", encoding="utf-8") as f:
        code = f.read()
    has_guard = "window.__MomTVLoaded = true" in code and "window.__MomTVLoaded" in code
    record(9, "Frontend tv-engine.js Idempotency Guard Present", has_guard)


# =====================================================================
# Bug 10: Thread-Safe Concurrency & Atomic Writes in apps.json
# =====================================================================
def test_bug_10():
    print("\n--- Testing Bug 10 (Thread-Safe Concurrency & Atomic File Writes) ---")

    test_file = tempfile.mktemp(suffix=".json")
    with open(test_file, "w", encoding="utf-8") as f:
        json.dump([], f)

    with patch("core.apps_manager.CUSTOM_APPS_FILE", test_file):
        num_threads = 10
        errors = []

        def worker(idx):
            try:
                for i in range(5):
                    app_id = f"concur_app_{idx}_{i}"
                    save_custom_app({
                        "id": app_id,
                        "name": f"Concurrent {idx}-{i}",
                        "url": f"https://example.com/{idx}/{i}",
                        "category": "utility"
                    })
                    time.sleep(0.01)
                    delete_custom_app(app_id)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker, args=(t,)) for t in range(num_threads)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        record(10, "Concurrent Save & Delete No Exceptions", len(errors) == 0, f"Errors: {errors}")

        # Ensure apps.json is valid JSON after all concurrency
        with open(test_file, "r", encoding="utf-8") as f:
            final_data = json.load(f)
        record(10, "apps.json Integrity Preserved", isinstance(final_data, (list, dict)))

    try:
        os.remove(test_file)
    except OSError:
        pass


def main():
    print("======================================================================")
    print("🛡️  MOM TV COMPREHENSIVE REGRESSION SUITE: ALL 10 CRITICAL BUGS")
    print("======================================================================")

    test_bugs_1_and_2()
    test_bug_3()
    test_bug_4()
    test_bugs_5_and_6()
    test_bug_7()
    test_bug_8()
    test_bug_9()
    test_bug_10()

    print("\n======================================================================")
    passed = sum(1 for r in test_results if r[2])
    total = len(test_results)
    print(f"Results: {passed}/{total} PASSED")
    print("======================================================================\n")

    if passed != total:
        sys.exit(1)


if __name__ == "__main__":
    main()
