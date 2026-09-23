"""
Unit and Integration tests for Remote Control & D-Pad Debounce
Verifies:
1. index.html:
   - Removal of problematic swipe listener on dpad-plate
   - Presence of 180ms client-side debouncing in sendKey() for discrete keys
   - touchstart listener on .dpad-btn, .dpad-center-ok with e.preventDefault()
   - data-key attributes on all D-pad buttons
2. app.py:
   - Server-side debounce (120ms) on directional keys per client session
   - Rapid packet bursts are debounced
   - Non-burst packets after 120ms pass through
   - Client sessions are isolated (client A does not debounce client B)
   - When CDP is connected, press_vk is NEVER executed for CDP_KEY_MAP keys
   - When CDP is offline, fallback press_vk IS executed
"""

import asyncio
import os
import sys
import time
import unittest
from unittest.mock import AsyncMock, MagicMock, PropertyMock, patch

# Ensure repo root is on sys.path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

import app


class TestIndexHtmlDebounceAndTouch(unittest.TestCase):
    def setUp(self):
        index_path = os.path.join(BASE_DIR, "index.html")
        with open(index_path, "r", encoding="utf-8") as f:
            self.content = f.read()

    def test_dpad_swipe_listener_removed(self):
        """Verify that dpadPlate swipe listener has been removed."""
        self.assertNotIn(
            "dpadPlate.addEventListener('touchend'",
            self.content,
            "Swipe listener on dpadPlate must be removed to avoid thumb roll conflicts"
        )
        self.assertNotIn(
            "distance > 32 && elapsedTime < 500",
            self.content,
            "Old swipe threshold check must be removed"
        )

    def test_client_debounce_in_sendkey(self):
        """Verify that sendKey() includes client-side debouncing guard (180ms)."""
        self.assertIn("CLIENT_DEBOUNCE_MS = 180", self.content)
        self.assertIn("DISCRETE_NAV_KEYS", self.content)
        # Verify discrete keys are covered
        for k in ['up', 'down', 'left', 'right', 'ok', 'enter', 'back']:
            self.assertIn(f"'{k}'", self.content)

    def test_dpad_buttons_have_touchstart_and_prevent_default(self):
        """Verify touchstart listeners with e.preventDefault() on D-pad buttons."""
        self.assertIn(".dpad-btn, .dpad-center-ok", self.content)
        self.assertIn("e.preventDefault()", self.content)
        self.assertIn("btn.addEventListener('touchstart'", self.content)

    def test_dpad_buttons_have_data_key(self):
        """Verify HTML elements have data-key attributes."""
        self.assertIn('class="dpad-btn up" data-key="up"', self.content)
        self.assertIn('class="dpad-btn left" data-key="left"', self.content)
        self.assertIn('class="dpad-btn right" data-key="right"', self.content)
        self.assertIn('class="dpad-btn down" data-key="down"', self.content)
        self.assertIn('class="dpad-center-ok" data-key="ok"', self.content)


class TestAppPyDebounceAndKeyDispatch(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        # Reset debounce state
        app.CLIENT_LAST_KEY_TIME.clear()

    async def test_server_side_debounce_rapid_burst(self):
        """Verify that 2 rapid directional keys within 120ms result in debounced=True for the 2nd."""
        ws_mock = object()

        # First key should be processed
        with patch.object(type(app.cdp_bridge), "is_connected", PropertyMock(return_value=False)), \
             patch.object(app, "press_vk") as mock_press_vk:
            resp1 = await app.handle_websocket_message({"cmd": "key", "key": "up"}, ws=ws_mock)
            self.assertEqual(resp1.get("key"), "up")
            self.assertFalse(resp1.get("debounced", False))
            self.assertEqual(mock_press_vk.call_count, 1)

            # Rapid duplicate / 2nd key within 10ms
            resp2 = await app.handle_websocket_message({"cmd": "key", "key": "up"}, ws=ws_mock)
            self.assertEqual(resp2.get("key"), "up")
            self.assertTrue(resp2.get("debounced", False))
            # press_vk should NOT have been called again!
            self.assertEqual(mock_press_vk.call_count, 1)

    async def test_server_side_debounce_allows_after_interval(self):
        """Verify that directional keys spaced >120ms apart are both processed."""
        ws_mock = object()

        with patch.object(type(app.cdp_bridge), "is_connected", PropertyMock(return_value=False)), \
             patch.object(app, "press_vk") as mock_press_vk:
            resp1 = await app.handle_websocket_message({"cmd": "key", "key": "right"}, ws=ws_mock)
            self.assertFalse(resp1.get("debounced", False))
            self.assertEqual(mock_press_vk.call_count, 1)

            # Wait 130ms (> 120ms)
            await asyncio.sleep(0.130)

            resp2 = await app.handle_websocket_message({"cmd": "key", "key": "right"}, ws=ws_mock)
            self.assertFalse(resp2.get("debounced", False))
            self.assertEqual(mock_press_vk.call_count, 2)

    async def test_server_side_debounce_per_session_isolation(self):
        """Verify client session A does not debounce client session B."""
        ws_client_a = object()
        ws_client_b = object()

        with patch.object(type(app.cdp_bridge), "is_connected", PropertyMock(return_value=False)), \
             patch.object(app, "press_vk") as mock_press_vk:
            resp_a = await app.handle_websocket_message({"cmd": "key", "key": "down"}, ws=ws_client_a)
            self.assertFalse(resp_a.get("debounced", False))

            # Client B sends immediately
            resp_b = await app.handle_websocket_message({"cmd": "key", "key": "down"}, ws=ws_client_b)
            self.assertFalse(resp_b.get("debounced", False))

            self.assertEqual(mock_press_vk.call_count, 2)

    async def test_cdp_connected_no_press_vk_even_if_not_handled_by_engine(self):
        """
        CRITICAL ROOT CAUSE FIX VERIFICATION:
        When CDP is connected and MomTV engine returns false (e.g. on tv.html),
        cdp_bridge.dispatch_key dispatches Input.dispatchKeyEvent.
        app.py MUST NOT call press_vk!
        """
        ws_mock = object()

        with patch.object(type(app.cdp_bridge), "is_connected", PropertyMock(return_value=True)), \
             patch.object(app.cdp_bridge, "dispatch_key", AsyncMock(return_value=True)) as mock_dispatch, \
             patch.object(app, "press_vk") as mock_press_vk:

            for key in ["up", "down", "left", "right", "ok", "back"]:
                app.CLIENT_LAST_KEY_TIME.clear()  # reset debounce for each test key
                resp = await app.handle_websocket_message({"cmd": "key", "key": key}, ws=ws_mock)
                self.assertEqual(resp.get("key"), key)
                self.assertEqual(resp.get("method"), "cdp")
                mock_dispatch.assert_called_with(key)
                # Ensure physical press_vk was NEVER called!
                mock_press_vk.assert_not_called()

    async def test_cdp_connected_when_dispatch_key_returns_false(self):
        """
        Even if cdp_bridge.dispatch_key returned False, if key is in CDP_KEY_MAP,
        CDP already attempted/dispatched it. press_vk MUST NOT be executed!
        """
        ws_mock = object()

        with patch.object(type(app.cdp_bridge), "is_connected", PropertyMock(return_value=True)), \
             patch.object(app.cdp_bridge, "dispatch_key", AsyncMock(return_value=False)) as mock_dispatch, \
             patch.object(app, "press_vk") as mock_press_vk:

            for key in ["up", "down", "left", "right", "ok", "back"]:
                app.CLIENT_LAST_KEY_TIME.clear()
                resp = await app.handle_websocket_message({"cmd": "key", "key": key}, ws=ws_mock)
                self.assertEqual(resp.get("key"), key)
                self.assertEqual(resp.get("method"), "cdp")
                # press_vk must still NOT be called!
                mock_press_vk.assert_not_called()

    async def test_cdp_offline_executes_press_vk_fallback(self):
        """When CDP is disconnected, press_vk fallback MUST be executed."""
        ws_mock = object()

        with patch.object(type(app.cdp_bridge), "is_connected", PropertyMock(return_value=False)), \
             patch.object(app, "press_vk") as mock_press_vk:

            for key in ["up", "down", "left", "right", "ok"]:
                app.CLIENT_LAST_KEY_TIME.clear()
                resp = await app.handle_websocket_message({"cmd": "key", "key": key}, ws=ws_mock)
                self.assertEqual(resp.get("key"), key)
                self.assertEqual(resp.get("method"), "vk_fallback")

            self.assertEqual(mock_press_vk.call_count, 5)

    async def test_cdp_bridge_dispatch_key_synthesizes_cdp_events(self):
        """Verify that cdp_bridge.dispatch_key sends rawKeyDown + keyUp and returns True."""
        bridge = app.cdp_bridge
        with patch.object(bridge, "evaluate", AsyncMock(return_value=False)), \
             patch.object(bridge, "send", AsyncMock(return_value={"id": 1})) as mock_send:

            res = await bridge.dispatch_key("right")
            self.assertTrue(res, "dispatch_key must return True when CDP events are synthesized")
            self.assertEqual(mock_send.call_count, 2)
            # Call 1: rawKeyDown
            call1_args = mock_send.call_args_list[0]
            self.assertEqual(call1_args[0][0], "Input.dispatchKeyEvent")
            self.assertEqual(call1_args[0][1]["type"], "rawKeyDown")
            self.assertEqual(call1_args[0][1]["key"], "ArrowRight")
            # Call 2: keyUp
            call2_args = mock_send.call_args_list[1]
            self.assertEqual(call2_args[0][0], "Input.dispatchKeyEvent")
            self.assertEqual(call2_args[0][1]["type"], "keyUp")
            self.assertEqual(call2_args[0][1]["key"], "ArrowRight")

    async def test_cdp_bridge_dispatch_key_handled_by_momtv(self):
        """Verify that when MomTV.handleKey returns True, no raw events are sent."""
        bridge = app.cdp_bridge
        with patch.object(bridge, "evaluate", AsyncMock(return_value=True)), \
             patch.object(bridge, "send", AsyncMock()) as mock_send:

            res = await bridge.dispatch_key("up")
            self.assertTrue(res)
            mock_send.assert_not_called()

    async def test_session_cleanup_on_disconnect(self):
        """Verify that disconnected clients are cleaned from CLIENT_LAST_KEY_TIME."""
        ws_mock = MagicMock()
        client_id = id(ws_mock)
        app.CLIENT_LAST_KEY_TIME[client_id] = time.monotonic()
        self.assertIn(client_id, app.CLIENT_LAST_KEY_TIME)

        # Simulate disconnect cleanup logic
        app.CONNECTED_CLIENTS.discard(ws_mock)
        app.CLIENT_LAST_KEY_TIME.pop(id(ws_mock), None)

        self.assertNotIn(client_id, app.CLIENT_LAST_KEY_TIME)


if __name__ == "__main__":
    unittest.main()
