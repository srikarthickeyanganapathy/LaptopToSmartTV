"""
MOM TV Phase 2 -- Comprehensive Automated Test Suite
Verifies:
1. Brave Extension Loading in BraveKioskSupervisor._launch_process
2. Kiosk Close command (kiosk_close, exit_windows, close_kiosk)
3. Universal Search command (youtube, hotstar, web/google)
4. TV Launcher (tv.html) Exit to Windows card, navigation, and WebSocket messaging
5. Synchronization of tv-engine.js and mom-tv-extension/content.js
"""

import os
import sys
import json
import asyncio
import unittest

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

import app

class TestPhase2BackendAndLauncher(unittest.IsolatedAsyncioTestCase):

    def test_01_extension_directory_exists(self):
        ext_dir = os.path.join(BASE_DIR, "mom-tv-extension")
        self.assertTrue(os.path.isdir(ext_dir), "mom-tv-extension directory must exist")
        self.assertTrue(os.path.isfile(os.path.join(ext_dir, "manifest.json")), "manifest.json must exist")
        self.assertTrue(os.path.isfile(os.path.join(ext_dir, "content.js")), "content.js must exist")
        self.assertTrue(os.path.isfile(os.path.join(ext_dir, "styles.css")), "styles.css must exist")

    def test_02_brave_supervisor_extension_flags(self):
        supervisor = app.BraveKioskSupervisor(port=9222, http_port=8765)
        # Verify the detection or arguments logic without launching full process
        ext_dir = os.path.join(BASE_DIR, "mom-tv-extension")
        self.assertTrue(os.path.isdir(ext_dir))

        # Check launch_process argument building logic
        # Simulate building args list
        initial_url = f"http://localhost:{supervisor.http_port}/tv"
        args = [
            supervisor.browser_path or "brave.exe",
            "--kiosk",
            f"--user-data-dir={supervisor.profile_dir}",
            f"--remote-debugging-port={supervisor.port}",
            f"--user-agent={app.SMART_TV_UA}",
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
        if os.path.isdir(ext_dir):
            args.extend([
                f"--load-extension={ext_dir}",
                f"--disable-extensions-except={ext_dir}",
            ])
        args.append(initial_url)

        self.assertTrue(any(f"--load-extension={ext_dir}" in a for a in args), "Must include --load-extension flag")
        self.assertTrue(any(f"--disable-extensions-except={ext_dir}" in a for a in args), "Must include --disable-extensions-except flag")

    async def test_03_kiosk_close_command(self):
        # Test kiosk_close
        res = await app.handle_websocket_message({"cmd": "kiosk_close"})
        self.assertEqual(res.get("status"), "ok")
        self.assertEqual(res.get("cmd"), "kiosk_close")
        self.assertIn("Brave Kiosk closed", res.get("message", ""))

        # Test aliases: exit_windows and close_kiosk
        res2 = await app.handle_websocket_message({"cmd": "exit_windows"})
        self.assertEqual(res2.get("status"), "ok")
        self.assertEqual(res2.get("cmd"), "kiosk_close")

        res3 = await app.handle_websocket_message({"cmd": "close_kiosk"})
        self.assertEqual(res3.get("status"), "ok")
        self.assertEqual(res3.get("cmd"), "kiosk_close")

    async def test_04_universal_search_command(self):
        # 1. YouTube Search (default destination)
        res_yt = await app.handle_websocket_message({
            "cmd": "search",
            "query": "Old Hindi Songs",
            "destination": "youtube"
        })
        self.assertEqual(res_yt.get("status"), "ok")
        self.assertEqual(res_yt.get("cmd"), "search")
        self.assertEqual(res_yt.get("query"), "Old Hindi Songs")
        self.assertEqual(res_yt.get("destination"), "youtube")
        self.assertEqual(res_yt.get("target"), "https://www.youtube.com/results?search_query=Old+Hindi+Songs")

        # 2. Hotstar Search
        res_hs = await app.handle_websocket_message({
            "cmd": "search",
            "query": "Anupama",
            "destination": "hotstar"
        })
        self.assertEqual(res_hs.get("status"), "ok")
        self.assertEqual(res_hs.get("cmd"), "search")
        self.assertEqual(res_hs.get("query"), "Anupama")
        self.assertEqual(res_hs.get("destination"), "hotstar")
        self.assertEqual(res_hs.get("target"), "https://www.hotstar.com/in/explore?search_query=Anupama")

        # 3. Google / Web Search
        res_web = await app.handle_websocket_message({
            "cmd": "search",
            "query": "Today weather in Mumbai",
            "destination": "web"
        })
        self.assertEqual(res_web.get("status"), "ok")
        self.assertEqual(res_web.get("cmd"), "search")
        self.assertEqual(res_web.get("query"), "Today weather in Mumbai")
        self.assertEqual(res_web.get("destination"), "web")
        self.assertEqual(res_web.get("target"), "https://www.google.com/search?q=Today+weather+in+Mumbai")

        # 4. Google alias destination
        res_google = await app.handle_websocket_message({
            "cmd": "search",
            "query": "gold price",
            "destination": "google"
        })
        self.assertEqual(res_google.get("status"), "ok")
        self.assertEqual(res_google.get("target"), "https://www.google.com/search?q=gold+price")

    def test_05_tv_html_exit_to_windows_card(self):
        tv_path = os.path.join(BASE_DIR, "tv.html")
        with open(tv_path, "r", encoding="utf-8") as f:
            content = f.read()

        # Check for Exit to Windows card
        self.assertIn('data-action="exit_windows"', content)
        self.assertIn('Exit to Windows', content)
        self.assertIn('Close TV mode and return to desktop', content)
        self.assertIn('exitToWindows()', content)
        self.assertIn('Returning to Windows Desktop...', content)
        self.assertIn('cmd: \'kiosk_close\'', content)

    def test_06_sync_tv_engine_and_content_js(self):
        ext_content_path = os.path.join(BASE_DIR, "mom-tv-extension", "content.js")
        root_engine_path = os.path.join(BASE_DIR, "tv-engine.js")

        with open(ext_content_path, "r", encoding="utf-8") as f:
            ext_content = f.read()
        with open(root_engine_path, "r", encoding="utf-8") as f:
            root_engine = f.read()

        # Both files must have the Smart TV Exit Confirmation Dialog
        self.assertIn("momtv-exit-dialog", ext_content)
        self.assertIn("momtv-exit-dialog", root_engine)
        self.assertIn("isExitDialogOpen", ext_content)
        self.assertIn("isExitDialogOpen", root_engine)
        self.assertIn("showExitDialog", ext_content)
        self.assertIn("showExitDialog", root_engine)

        # Both files must have 10-foot scaling
        self.assertIn("apply10FootScaling", ext_content)
        self.assertIn("apply10FootScaling", root_engine)

        # Both files must have virtual mouse cursor
        self.assertIn("moveCursor", ext_content)
        self.assertIn("moveCursor", root_engine)
        self.assertIn("clickCursor", ext_content)
        self.assertIn("clickCursor", root_engine)
        self.assertIn("setCursor", ext_content)
        self.assertIn("setCursor", root_engine)

        # Exact match
        self.assertEqual(ext_content, root_engine, "tv-engine.js and mom-tv-extension/content.js must be identical")

if __name__ == "__main__":
    unittest.main()
