import unittest
import os
import sys
import json

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
import app

class TestCustomAppsAndMetadata(unittest.TestCase):
    def test_load_all_apps_defaults(self):
        # Default apps must only contain YouTube TV (Smart TV UA spoofed)
        self.assertEqual(len(app.DEFAULT_APPS), 1)
        self.assertEqual(app.DEFAULT_APPS[0]['id'], 'youtube')
        self.assertEqual(app.DEFAULT_APPS[0]['url'], 'https://www.youtube.com/tv')

        # Non-spoofed streaming services must not be in default apps or shortcuts
        non_spoofed_defaults = ['hotstar', 'netflix', 'prime', 'jiocinema', 'zee5', 'sonyliv', 'bhajans', 'photos', 'news']
        for d in non_spoofed_defaults:
            self.assertNotIn(d, app.APP_SHORTCUTS, f"{d} should not be in APP_SHORTCUTS")
            self.assertFalse(any(a['id'] == d for a in app.DEFAULT_APPS))

        # Core system shortcuts and youtube must be present
        self.assertIn('launcher', app.APP_SHORTCUTS)
        self.assertIn('home', app.APP_SHORTCUTS)
        self.assertIn('tv', app.APP_SHORTCUTS)
        self.assertIn('youtube', app.APP_SHORTCUTS)

        # Loaded apps must include YouTube TV + any custom apps
        apps = app.load_all_apps()
        self.assertTrue(any(a['id'] == 'youtube' for a in apps), "YouTube TV must be present in loaded apps")

    def test_metadata_extraction_heuristic(self):
        # Test with raw HTML extraction
        sample_html = """
        <html>
        <head>
          <title>Crunchyroll - Watch Popular Anime &amp; Read Manga</title>
          <meta property="og:image" content="https://www.crunchyroll.com/static/og.png">
          <meta property="og:description" content="Stream thousands of anime episodes.">
          <link rel="icon" href="/favicon.ico">
        </head>
        <body></body>
        </html>
        """
        # Patch urllib.request.urlopen to return sample_html
        from unittest.mock import patch, MagicMock
        mock_resp = MagicMock()
        mock_resp.read.return_value = sample_html.encode('utf-8')
        mock_resp.headers = {'Content-Type': 'text/html; charset=utf-8'}
        mock_resp.__enter__.return_value = mock_resp

        with patch('urllib.request.urlopen', return_value=mock_resp):
            meta = app.extract_website_metadata("https://www.crunchyroll.com")
            self.assertEqual(meta['title'], "Crunchyroll - Watch Popular Anime & Read Manga")
            self.assertEqual(meta['poster'], "https://www.crunchyroll.com/static/og.png")
            self.assertEqual(meta['description'], "Stream thousands of anime episodes.")
            self.assertEqual(meta['favicon'], "https://www.crunchyroll.com/favicon.ico")

    def test_save_and_delete_custom_app(self):
        test_app = {
            "name": "Twitch TV",
            "url": "https://www.twitch.tv",
            "poster": "https://twitch.tv/poster.png",
            "icon": "https://twitch.tv/icon.png",
            "category": "Live Streaming",
            "description": "Watch live gaming broadcasts"
        }
        res = app.save_custom_app(test_app)
        self.assertEqual(res.get('status'), 'ok')
        saved = res.get('app', {})
        self.assertTrue(saved.get('is_custom'))
        self.assertEqual(saved.get('name'), "Twitch TV")

        # Verify it appears in load_all_apps
        all_apps = app.load_all_apps()
        found = next((a for a in all_apps if a['id'] == saved['id']), None)
        self.assertIsNotNone(found)
        self.assertEqual(found['url'], "https://www.twitch.tv")

        # Now delete it
        deleted = app.delete_custom_app(saved['id'])
        self.assertTrue(deleted)

        # Verify it is removed
        all_apps_after = app.load_all_apps()
        self.assertIsNone(next((a for a in all_apps_after if a['id'] == saved['id']), None))

if __name__ == '__main__':
    unittest.main()
