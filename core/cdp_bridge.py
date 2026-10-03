"""
core/cdp_bridge.py — Chrome DevTools Protocol (CDP) Bridge
Responsibilities: WebSocket connection to Brave remote debugging (port 9222), script injection, single-tab enforcement, and DOM key synthesis.
"""

import os
import json
import urllib.request
import asyncio
import websockets
from core.config import CDP_PORT, HTTP_PORT, BASE_DIR, CDP_KEY_MAP, SMART_TV_UA, TV_URL, DESKTOP_UA

# CDP-specific extensions of the base UA strings
SMART_TV_UA_METADATA = {
    "brands": [{"brand": "SamsungBrowser", "version": "4.0"}],
    "platform": "Tizen",
    "platformVersion": "6.0",
    "architecture": "arm",
    "model": "SMART-TV",
    "mobile": False,
}

DESKTOP_UA_METADATA = {
    "brands": [
        {"brand": "Chromium", "version": "131"},
        {"brand": "Google Chrome", "version": "131"},
        {"brand": "Not_A Brand", "version": "24"}
    ],
    "platform": "Windows",
    "platformVersion": "10.0.0",
    "architecture": "x86",
    "model": "",
    "mobile": False,
}

__all__ = [
    "CDPControllerBridge",
    "cdp_bridge",
]


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
        # FIX: asyncio.Event/Lock are created lazily inside the running loop.
        # Creating them at import time (old code) binds them to whatever loop
        # exists at import — on Python < 3.10 (or when app.py builds its own
        # loop) that produced "Future attached to a different loop" crashes.
        self._connected: asyncio.Event | None = None
        self._lock: asyncio.Lock | None = None
        self._running = False
        self._active_target = None
        self._script_identifier: str | None = None
        # FIX: UA-override state tracker (see _sync_ua_for_frame).
        self._applied_ua: str | None = None
        # FIX: reference to the main loop so worker threads can schedule calls safely.
        self._loop: asyncio.AbstractEventLoop | None = None

    def _ensure_primitives(self):
        if self._connected is None:
            self._connected = asyncio.Event()
        if self._lock is None:
            self._lock = asyncio.Lock()

    @property
    def is_connected(self) -> bool:
        return self._connected is not None and self._connected.is_set() and self.ws is not None

    async def wait_connected(self, timeout: float = 6.0) -> bool:
        """Wait asynchronously until CDP WebSocket connection is established."""
        if self.is_connected:
            return True
        self._ensure_primitives()
        try:
            await asyncio.wait_for(self._connected.wait(), timeout=timeout)
            return True
        except asyncio.TimeoutError:
            return False

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

    def _pick_ua_for_url(self, url: str) -> tuple[str, str, dict]:
        """Return the appropriate UA string, platform, and metadata based on URL pattern."""
        url_lower = (url or "").lower()
        if "youtube.com/tv" in url_lower or f":{self.http_port}/tv" in url_lower:
            return SMART_TV_UA, "Tizen", SMART_TV_UA_METADATA
        return DESKTOP_UA, "Win32", DESKTOP_UA_METADATA

    async def run(self):
        """Maintain persistent CDP connection to Brave with automatic reconnection."""
        self._running = True
        self._loop = asyncio.get_running_loop()  # FIX: capture for thread-safe scheduling
        self._ensure_primitives()
        print(f"🔄 [CDP Bridge] Worker started. Monitoring port {self.cdp_port}...")

        attempt = 0

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
                    attempt = 0  # reset on successful connection
                    print("⚡ [CDP Bridge] Connected to Brave Chrome DevTools Protocol!")

                    # Enable core domains
                    await self.send("Page.enable", wait_response=True)
                    await self.send("Runtime.enable", wait_response=True)

                    # Automatically inject tv-engine.js
                    await self._inject_tv_engine()

                    # FIX: sync the UA override for the page that is ALREADY loaded
                    # (fresh session → prev is None → applies without reloading).
                    current_url = target.get("url") or ""
                    if current_url.startswith(("http://", "https://")):
                        asyncio.create_task(self._sync_ua_for_frame(current_url))

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
                            elif method == "Page.frameNavigated":
                                frame = msg.get("params", {}).get("frame", {})
                                if not frame.get("parentId"):
                                    f_url = frame.get("url") or ""
                                    # FIX: only real http(s) frames — about:/chrome-error:
                                    # frames previously triggered pointless UA churn.
                                    if f_url.startswith(("http://", "https://")):
                                        asyncio.create_task(self._sync_ua_for_frame(f_url))

            except (websockets.exceptions.ConnectionClosed, ConnectionRefusedError, OSError):
                pass
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"[-] [CDP Bridge] Connection exception: {e}")
            finally:
                self._cleanup_connection()
                if self._running:
                    backoff = min(30.0, 1.5 * (1.5 ** attempt))
                    attempt += 1
                    await asyncio.sleep(backoff)

    async def _sync_ua_for_frame(self, url: str):
        """
        FIX: Emulation.setUserAgentOverride only affects FUTURE requests. The old
        code applied it from Page.frameNavigated — i.e. AFTER the navigation had
        already committed with the previous UA — so clicking a YouTube TV card in
        the launcher loaded the DESKTOP YouTube site. We now track the applied UA
        and, when the profile class changes mid-browsing, apply the override and
        reload once so the destination renders with the correct profile.
        (navigate() always sets the UA before Page.navigate, so its frames match
        and never trigger the reload.)
        """
        try:
            ua, plat, meta = self._pick_ua_for_url(url)
            if ua == self._applied_ua:
                return
            await self.send(
                "Emulation.setUserAgentOverride",
                {"userAgent": ua, "platform": plat, "userAgentMetadata": meta},
            )
            prev = self._applied_ua
            self._applied_ua = ua
            # Only reload when switching between two KNOWN profiles (never on the
            # first sync after connecting — that would reload the launcher on
            # every reconnect).
            if prev is not None and prev != ua:
                await self.send("Page.reload", {"ignoreCache": False})
        except Exception:
            pass

    def _cleanup_connection(self):
        """Clean up state on disconnect."""
        if self._connected is not None:
            self._connected.clear()
        self.ws = None
        self._script_identifier = None
        self._applied_ua = None  # a fresh DevTools session starts from the target's default UA
        for fut in list(self._pending_futures.values()):
            if not fut.done():
                fut.cancel()
        self._pending_futures.clear()

    async def send(self, method: str, params: dict = None, wait_response: bool = True, timeout: float = 3.5) -> dict | None:
        """Send a CDP command with optional response waiting."""
        if not self.is_connected or not self.ws:
            return None

        self._ensure_primitives()
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

        # Remove previous script if identifier exists to avoid accumulation
        if self._script_identifier:
            try:
                await self.send("Page.removeScriptToEvaluateOnNewDocument", {"identifier": self._script_identifier})
            except Exception:
                pass
            self._script_identifier = None

        # 1. Register script for all new documents/pages
        res = await self.send("Page.addScriptToEvaluateOnNewDocument", {"source": script_source})
        if res and "result" in res:
            self._script_identifier = res["result"].get("identifier")
            print(f"📜 [CDP Bridge] Injected tv-engine.js into document lifecycle (Script ID: {self._script_identifier})")

        # 2. Evaluate immediately on the currently loaded document
        await self.send("Runtime.evaluate", {"expression": script_source, "returnByValue": True})
        print("⚡ [CDP Bridge] Evaluated tv-engine.js on current active page")

    def _close_secondary_tabs(self, preserve_target_id: str = None) -> int:
        """Strict Single-Tab Kiosk Enforcement: Close all background tabs while preserving the active foreground tab."""
        targets = self._fetch_targets()
        pages = [t for t in targets if t.get("type") == "page"]
        if len(pages) <= 1:
            return 0

        primary = None
        # 1. Caller specified an explicit target to preserve (e.g. from navigate)
        if preserve_target_id:
            for p in pages:
                if p.get("id") == preserve_target_id:
                    primary = p
                    break

        # 2. Otherwise preserve the active foreground tab (tabActive == True, or MRU first page)
        if not primary:
            for p in pages:
                if p.get("tabActive") is True:
                    primary = p
                    break
            if not primary:
                primary = pages[0]

        primary_id = primary.get("id")

        # 3. Explicitly bring the primary tab to the front
        if primary_id:
            try:
                activate_url = f"http://127.0.0.1:{self.cdp_port}/json/activate/{primary_id}"
                req = urllib.request.Request(activate_url, headers={"User-Agent": "MOM-TV-Bridge/2.0"})
                with urllib.request.urlopen(req, timeout=1.0) as resp:
                    resp.read()
            except Exception:
                pass

        # 4. Close all non-primary tabs
        closed = 0
        for p in pages:
            pid = p.get("id")
            if pid and pid != primary_id:
                try:
                    url = f"http://127.0.0.1:{self.cdp_port}/json/close/{pid}"
                    req = urllib.request.Request(url, headers={"User-Agent": "MOM-TV-Bridge/2.0"})
                    with urllib.request.urlopen(req, timeout=1.0) as resp:
                        resp.read()
                    closed += 1
                except Exception:
                    pass

        # 5. If we closed the tab our WebSocket was attached to, update active target and cycle connection.
        # FIX: this method runs inside a WORKER THREAD (asyncio.to_thread). The old
        # asyncio.create_task(self.ws.close()) raised RuntimeError("no running event
        # loop") here, which propagated up through navigate() and aborted the whole
        # launch request (the remote never got a reply). Schedule on the main loop.
        if self._active_target and primary_id != self._active_target.get("id"):
            self._active_target = primary
            if self.ws and self._loop and self._loop.is_running():
                try:
                    asyncio.run_coroutine_threadsafe(self.ws.close(), self._loop)
                except Exception:
                    pass

        if closed > 0:
            print(f"🧹 [CDP Bridge] Closed {closed} secondary tab(s). Kept active tab: {primary.get('title', 'Primary')}")
        return closed

    # Deprecated alias
    def close_secondary_tabs(self, preserve_target_id: str = None) -> int:
        return self._close_secondary_tabs(preserve_target_id)

    # --------------------------------------------------------------------------
    # HIGH-LEVEL SINGLE-WINDOW NAVIGATION & CONTROL API
    # --------------------------------------------------------------------------
    async def navigate(self, url: str) -> bool:
        """Single-Window In-Place Navigation: Navigate existing kiosk tab without spawning new windows."""
        if not self.is_connected:
            await self.wait_connected(timeout=4.0)
        if not self.is_connected:
            # FIX: fail fast instead of firing no-op commands into a dead socket.
            return False
        print(f"🧭 [CDP Bridge] Navigating in-place to: {url}")

        ua, plat, meta = self._pick_ua_for_url(url)
        await self.send("Emulation.setUserAgentOverride", {"userAgent": ua, "platform": plat, "userAgentMetadata": meta})
        self._applied_ua = ua  # FIX: record it so frameNavigated won't reload this navigation
        if ua == SMART_TV_UA:
            print(f"📺 [CDP Bridge] Applied Smart TV User-Agent override for YouTube TV")
        else:
            print(f"💻 [CDP Bridge] Applied Desktop User-Agent for custom web application")

        await self.send("Page.bringToFront")
        res = await self.send("Page.navigate", {"url": url})
        target_id = self._active_target.get("id") if self._active_target else None
        # Clean up any secondary tabs that may have opened while preserving this target
        await asyncio.to_thread(self._close_secondary_tabs, target_id)
        return bool(res and "result" in res)

    async def home(self) -> bool:
        """Navigate in-place back to MOM TV Leanback Launcher and clean up extra tabs."""
        return await self.navigate(TV_URL)

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
        expr = "(window.MomTV && typeof window.MomTV.goBack === 'function') ? window.MomTV.goBack() : (window.history.length > 1 ? (window.history.back(), true) : false)"
        res = await self.evaluate(expr)
        if res:
            return True
        # Fallback browser back key dispatch via CDP
        await self.send("Input.dispatchKeyEvent", {
            "type": "rawKeyDown",
            "key": "BrowserBack",
            "code": "BrowserBack",
            "windowsVirtualKeyCode": 166,
            "nativeVirtualKeyCode": 166,
        }, wait_response=False)
        await self.send("Input.dispatchKeyEvent", {
            "type": "keyUp",
            "key": "BrowserBack",
            "code": "BrowserBack",
            "windowsVirtualKeyCode": 166,
            "nativeVirtualKeyCode": 166,
        }, wait_response=False)
        # FIX: previously this returned the (falsy) evaluate result even after
        # dispatching the fallback keys, so callers believed nothing happened.
        return True

    async def dispatch_key(self, key_name: str) -> bool:
        """
        Direct Key Injection:
        1. Calls window.MomTV?.handleKey(keyName) for spatial navigation & player takeover.
        2. ONLY if unhandled, dispatches Input.dispatchKeyEvent as a DOM fallback.
        """
        k = (key_name or "").lower()

        if k in ("back", "browserback"):
            return await self.go_back()

        # Step 1: Call injected engine handleKey()
        js_call = f"window.MomTV?.handleKey?.({json.dumps(k)})"
        handled = await self.evaluate(js_call)

        # Step 2: ONLY if the MomTV engine did NOT handle it, synthesize DOM key events.
        # If the engine handled it, dispatching CDP key events would cause double-processing
        # because the extension's keydown listener would also see them.
        if handled:
            return True

        if k in CDP_KEY_MAP:
            info = CDP_KEY_MAP[k]
            vk = info["windowsVirtualKeyCode"]
            key_val = info["key"]
            code_val = info["code"]

            await self.send("Input.dispatchKeyEvent", {
                "type": "rawKeyDown",
                "key": key_val,
                "code": code_val,
                "windowsVirtualKeyCode": vk,
                "nativeVirtualKeyCode": vk,
            }, wait_response=False)

            await self.send("Input.dispatchKeyEvent", {
                "type": "keyUp",
                "key": key_val,
                "code": code_val,
                "windowsVirtualKeyCode": vk,
                "nativeVirtualKeyCode": vk,
            }, wait_response=False)
            return True

        return False

    async def stop(self):
        """Stop worker and close connection."""
        self._running = False
        if self.ws:
            try:
                await self.ws.close()
            except Exception:
                pass
        self._cleanup_connection()


# Global Singleton Instance
cdp_bridge = CDPControllerBridge(cdp_port=CDP_PORT, http_port=HTTP_PORT)