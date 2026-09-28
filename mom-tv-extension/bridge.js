/**
 * MOM TV — isolated-world bridge.
 * content.js runs in the page's MAIN world (so the native host can call window.MomTV), which
 * cannot use chrome.* APIs. This relays zoom requests to the background worker and forwards
 * the current browser-zoom factor to the engine so it can keep the overlay a constant size.
 */
const tell = (factor) => window.postMessage({ __momtv_reply: 1, factor }, '*');

// Ask for the current zoom on load; later changes arrive as 'zoom-changed'.
chrome.runtime.sendMessage({ type: 'getZoom' }).then((r) => { if (r && r.factor) tell(r.factor); }).catch(() => {});
chrome.runtime.onMessage.addListener((m) => { if (m && m.type === 'zoom-changed' && m.factor) tell(m.factor); });

// Zoom requests from the engine (remote keys 'zoomin' / 'zoomout').
window.addEventListener('message', (e) => {
  const d = e.data;
  if (e.source !== window || !d || d.__momtv !== 1 || d.type !== 'zoom') return;
  chrome.runtime.sendMessage({ type: 'zoom', delta: Number(d.delta) || 0 }).catch(() => {});
});