import sys
import os
import json
import time
import asyncio
import urllib.request
import websockets

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core.config import SMART_TV_UA
from core.cdp_bridge import SMART_TV_UA_METADATA, DESKTOP_UA, DESKTOP_UA_METADATA

async def test_full_pipeline():
    print("=" * 70)
    print("🚀 MOM TV 2.0 FULL END-TO-END VERIFICATION PIPELINE")
    print("=" * 70)

    # 1. Connect to CDP
    targets = json.loads(urllib.request.urlopen("http://127.0.0.1:9222/json").read().decode())
    page = [t for t in targets if t.get("type") == "page"][0]
    ws_url = page["webSocketDebuggerUrl"]
    print(f"🔌 Connected to Brave CDP target: {ws_url}")

    async with websockets.connect(ws_url, max_size=10 * 1024 * 1024) as ws:
        msg_id = 0
        async def cdp(method, params=None):
            nonlocal msg_id
            msg_id += 1
            cur_id = msg_id
            await ws.send(json.dumps({"id": cur_id, "method": method, "params": params or {}}))
            while True:
                msg = json.loads(await ws.recv())
                if msg.get("id") == cur_id:
                    return msg.get("result", {})

        async def evaluate(expr):
            res = await cdp("Runtime.evaluate", {"expression": expr, "returnByValue": True})
            if "exceptionDetails" in res:
                print("JS Exception:", res["exceptionDetails"])
            return res.get("result", {}).get("value")

        # --- STEP 1: VERIFY YOUTUBE TV MODE ---
        print("\n--- STEP 1: Verifying YouTube TV Mode (Smart TV UA + Metadata) ---")
        await cdp("Emulation.setUserAgentOverride", {
            "userAgent": SMART_TV_UA,
            "platform": "Tizen",
            "userAgentMetadata": SMART_TV_UA_METADATA
        })
        await cdp("Page.navigate", {"url": "https://www.youtube.com/tv"})
        await asyncio.sleep(4.0)

        yt_state = await evaluate("JSON.stringify({ url: location.href, title: document.title, ua: navigator.userAgent, platform: navigator.platform, isCobalt: Boolean(document.querySelector('ytlr-app, ytlr-surface-page')) })")
        yt_data = json.loads(yt_state)
        print("YouTube TV State:", yt_data)
        assert "youtube.com/tv" in yt_data["url"], "Must be on youtube.com/tv"
        assert yt_data["isCobalt"], "Cobalt Leanback TV elements must be loaded"
        print("✅ STEP 1 PASSED: YouTube TV mode is fully opening with Leanback UI!")

        # --- STEP 2: VERIFY MOM TV LEANBACK LAUNCHER ---
        print("\n--- STEP 2: Verifying MOM TV Launcher ---")
        await cdp("Page.navigate", {"url": "http://localhost:8765/tv"})
        await asyncio.sleep(2.0)

        launcher_state = await evaluate("JSON.stringify({ url: location.href, hasShell: Boolean(document.querySelector('.tv-shell')), cardCount: document.querySelectorAll('.app-card').length })")
        launcher_data = json.loads(launcher_state)
        print("Launcher State:", launcher_data)
        assert launcher_data["hasShell"], "MOM TV .tv-shell must be present"
        assert launcher_data["cardCount"] >= 2, "Must have YouTube and custom cards"
        print("✅ STEP 2 PASSED: MOM TV Launcher rendered successfully with all apps!")

        # --- STEP 3: VERIFY SPATIAL ENGINE PERFORMANCE & LATENCY ---
        print("\n--- STEP 3: Verifying Spatial Engine Performance & Latency ---")
        # Load tv-engine.js onto launcher to measure handleKey performance
        with open("tv-engine.js", "r", encoding="utf-8") as f:
            engine_code = f.read()
        await cdp("Runtime.evaluate", {"expression": "delete window.__MOM_TV_EXTENSION_LOADED__; delete window.__MOM_TV_ENGINE_LOADED__;"})
        await cdp("Runtime.evaluate", {"expression": engine_code})

        perf_test = """
        JSON.stringify((() => {
            const t0 = performance.now();
            window.MomTV.invalidateCardsCache();
            const cards = window.MomTV.getFocusableCards();
            const grid = window.MomTV.buildCardGrid(cards);
            const t1 = performance.now();
            return {
                scanTimeMs: (t1 - t0),
                cardCount: cards.length,
                rowCount: grid.length
            };
        })())
        """
        perf_res = await evaluate(perf_test)
        perf_data = json.loads(perf_res)
        print("Spatial Engine Performance Benchmark:", perf_data)
        assert perf_data["scanTimeMs"] < 25.0, f"Cold scan took too long: {perf_data['scanTimeMs']}ms"
        print(f"✅ STEP 3 PASSED: Spatial scan completed in {perf_data['scanTimeMs']:.2f}ms (< 25ms threshold)!")

        # Test cached performance (warm tap)
        warm_perf_test = """
        JSON.stringify((() => {
            const t0 = performance.now();
            const cards = window.MomTV.getFocusableCards();
            const grid = window.MomTV.buildCardGrid(cards);
            const t1 = performance.now();
            return {
                warmScanTimeMs: (t1 - t0)
            };
        })())
        """
        warm_res = await evaluate(warm_perf_test)
        warm_perf = json.loads(warm_res)
        print("Warm Cached Performance Benchmark:", warm_perf)
        assert warm_perf["warmScanTimeMs"] < 2.0, f"Warm cache took too long: {warm_perf['warmScanTimeMs']}ms"
        print(f"✅ STEP 3b PASSED: Warm cached scan completed in {warm_perf['warmScanTimeMs']:.3f}ms (< 2ms)!")

    print("\n" + "=" * 70)
    print("🎉 ALL END-TO-END VERIFICATION CHECKS PASSED FLAWLESSLY! 🚀")
    print("=" * 70)

if __name__ == "__main__":
    asyncio.run(test_full_pipeline())
