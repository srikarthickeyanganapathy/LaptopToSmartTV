/**
 * MOM TV — background service worker
 * Applies a per-site browser zoom and tells the page what the zoom is, so the MOM TV
 * overlay (exit dialog, HUD, player bar, cursor) can counter-scale and stay a fixed size.
 */
const DEFAULT_ZOOM = 1.25; // change this to make websites larger/smaller by default
const STEP = 0.1;
const MIN_ZOOM = 0.75;
const MAX_ZOOM = 2.0;

function isLauncherOrNativeTV(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (local && (u.port === '8765' || u.pathname.startsWith('/tv'))) return true;
    return u.hostname.endsWith('youtube.com') && u.pathname.startsWith('/tv');
  } catch (_) {
    return true; // FIX: unknown URL → assume native TV so we never force zoom on the launcher
  }
}

async function getZoomFor(host) {
  const { zoom = {} } = await chrome.storage.local.get('zoom');
  return zoom[host] ?? DEFAULT_ZOOM;
}

async function saveZoomFor(host, factor) {
  const { zoom = {} } = await chrome.storage.local.get('zoom');
  zoom[host] = factor;
  await chrome.storage.local.set({ zoom });
}

// onCommitted fires before the new page paints, so sites open already zoomed (no visible jump).
chrome.webNavigation.onCommitted.addListener(async (d) => {
  if (d.frameId !== 0 || !/^https?:/.test(d.url)) return;
  try {
    const factor = isLauncherOrNativeTV(d.url) ? 1 : await getZoomFor(new URL(d.url).hostname);
    await chrome.tabs.setZoom(d.tabId, factor);
  } catch (_) { /* tab closed or restricted */ }
});

// Any zoom change (ours, or the user's) is pushed to the page so the overlay can compensate.
chrome.tabs.onZoomChange.addListener((info) => {
  // FIX: defensive guard — ignore malformed events / invalid tab ids instead of throwing.
  if (!info || typeof info.tabId !== 'number' || info.tabId < 0) return;
  chrome.tabs.sendMessage(info.tabId, { type: 'zoom-changed', factor: info.newZoomFactor }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !sender.tab) return;

  if (msg.type === 'getZoom') {
    chrome.tabs.getZoom(sender.tab.id).then((factor) => sendResponse({ factor })).catch(() => sendResponse({}));
    return true;
  }

  if (msg.type !== 'zoom' || !sender.tab.url) return;
  (async () => {
    try {
      const host = new URL(sender.tab.url).hostname;
      const current = await chrome.tabs.getZoom(sender.tab.id);
      const dir = Math.sign(Number(msg.delta) || 0);
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((current + dir * STEP) * 100) / 100));
      await chrome.tabs.setZoom(sender.tab.id, next);
      await saveZoomFor(host, next);
      // FIX: this direct reply is now consumed by bridge.js — it guarantees the page learns the
      // zoom factor even when setZoom() is a no-op (already at MIN/MAX), where onZoomChange never fires.
      sendResponse({ factor: next });
    } catch (_) {
      sendResponse({});
    }
  })();
  return true; // async response
});