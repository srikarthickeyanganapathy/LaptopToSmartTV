/**
 * MOM TV LEANBACK COMPANION — CONTENT ENGINE
 * Injected into every page loaded inside the MOM TV kiosk browser to provide a
 * 10-foot "leanback" experience: spatial D-pad navigation over ordinary web
 * pages, a video remote (rewind/forward/play/pause), a virtual mouse cursor
 * for Magic Trackpad mode, and an exit-to-home confirmation dialog.
 *
 * Public surface: window.MomTV.handleKey(name) — called by the native host
 * (or the phone remote via WebSocket) for every remote button press.
 */
(function () {
  'use strict';

  if (typeof window !== 'undefined') {
    if (window.__MOM_TV_ENGINE_LOADED__) return;
    window.__MOM_TV_ENGINE_LOADED__ = true;
    window.__MomTVLoaded = true; // kept for older host builds that check this flag
  }

  console.log('🚀 [MOM TV Companion 2.0] Initializing TV engine...');

  /* ==========================================================================
     0. SINGLE-WINDOW KIOSK ENFORCEMENT
     A kiosk has exactly one window. Anything that would open a new tab/window
     (window.open, target="_blank" links or forms) is redirected in-place.
     ========================================================================== */
  (function enforceSingleWindow() {
    try {
      if (typeof window === 'undefined') return;
      window.open = function (url) {
        if (url) window.location.href = url;
        return window;
      };

      if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('click', (e) => {
          const anchor = e.target && e.target.closest ? e.target.closest('a') : null;
          if (anchor && anchor.target === '_blank') anchor.target = '_self';
        }, true);

        document.addEventListener('submit', (e) => {
          const form = e.target;
          if (form && form.target === '_blank') form.target = '_self';
        }, true);
      }
    } catch (_) { /* best-effort — a page that blocks this still just opens normally */ }
  })();

  /* ==========================================================================
     1. ICON SET
     One inline-SVG icon language shared by the exit dialog, HUD and player
     action bar, matching the phone remote so the whole product feels unified
     instead of mixing emoji with UI chrome.
     ========================================================================== */
  const ICONS = {
    tv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="12" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="19" x2="12" y2="21"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>',
    rewind: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11 18V6l-8.5 6 8.5 6zm10 0V6l-8.5 6 8.5 6z"/></svg>',
    forward: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 6v12l8.5-6L13 6zM3 6v12l8.5-6L3 6z"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>',
    mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="4,9 8,9 12,5 12,19 8,15 4,15" fill="currentColor" stroke="none"/><line x1="17" y1="8" x2="22" y2="16"/><line x1="22" y1="8" x2="17" y2="16"/></svg>',
    unmute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="4,9 8,9 12,5 12,19 8,15 4,15" fill="currentColor" stroke="none"/><path d="M16 8a5 5 0 0 1 0 8"/><path d="M19 5a9 9 0 0 1 0 14"/></svg>',
    fullscreen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V5a1 1 0 0 1 1-1h4"/><path d="M20 9V5a1 1 0 0 0-1-1h-4"/><path d="M4 15v4a1 1 0 0 0 1 1h4"/><path d="M20 15v4a1 1 0 0 1-1 1h-4"/></svg>',
    windowed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4H5a1 1 0 0 0-1 1v4"/><path d="M15 4h4a1 1 0 0 1 1 1v4"/><path d="M9 20H5a1 1 0 0 1-1-1v-4"/><path d="M15 20h4a1 1 0 0 0 1-1v-4"/></svg>',
    exit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>'
  };
  const iconSpan = (name) => `<span class="momtv-icon">${ICONS[name] || ''}</span>`;

  /* ==========================================================================
     2. INJECT LEANBACK STYLES
     Safely handles execution at document_start where document.head and
     document.documentElement may be null. Defers until DOM is available.
     ========================================================================== */
  const STYLE_ID = 'momtv-companion-styles';
  const LEANBACK_CSS = `
html.momtv-10ft-scaled, html[data-momtv-zoom="135"] { zoom: 1.35 !important; }

.momtv-icon { display: inline-flex; width: 1em; height: 1em; vertical-align: -0.14em; }
.momtv-icon svg { width: 100%; height: 100%; }

.momtv-card-focused, .momtv-focused {
  outline: 4px solid #00f0ff !important;
  outline-offset: 4px !important;
  box-shadow: 0 0 25px rgba(0, 240, 255, 0.9) !important;
  transform: scale(1.05) !important;
  transition: transform 0.16s cubic-bezier(0.2, 0.9, 0.3, 1), outline 0.15s ease, box-shadow 0.16s ease !important;
  z-index: 999999 !important;
  position: relative !important;
}

.momtv-focused-input {
  outline: 4px solid #00f0ff !important;
  outline-offset: 3px !important;
  box-shadow: 0 0 25px rgba(0, 240, 255, 0.9) !important;
  background-color: rgba(12, 16, 24, 0.95) !important;
  color: #ffffff !important;
  z-index: 999999 !important;
}

[data-tv-card="true"] { outline: none; }

#momtv-exit-backdrop {
  position: fixed; inset: 0; width: 100vw; height: 100vh;
  background: rgba(4, 7, 15, 0.82);
  backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
  z-index: 2147483647;
  display: flex; align-items: center; justify-content: center;
  opacity: 0; pointer-events: none;
  transition: opacity 0.22s cubic-bezier(0.2, 0.9, 0.3, 1);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
#momtv-exit-backdrop.visible { opacity: 1; pointer-events: auto; }

#momtv-exit-dialog {
  background: linear-gradient(145deg, rgba(20, 28, 46, 0.94), rgba(10, 14, 24, 0.97));
  border: 2px solid rgba(0, 240, 255, 0.5);
  border-radius: 28px;
  box-shadow: 0 35px 90px rgba(0, 0, 0, 0.95), 0 0 50px rgba(0, 240, 255, 0.3);
  padding: 44px 52px; max-width: 580px; width: 90%; text-align: center;
  transform: scale(0.92) translateY(12px);
  transition: transform 0.24s cubic-bezier(0.2, 0.9, 0.3, 1);
}
#momtv-exit-backdrop.visible #momtv-exit-dialog { transform: scale(1) translateY(0); }

.momtv-exit-icon { width: 48px; height: 48px; margin: 0 auto 16px; color: #00f0ff; filter: drop-shadow(0 0 16px rgba(0, 240, 255, 0.6)); }
.momtv-exit-title { font-size: 28px; font-weight: 800; color: #ffffff; letter-spacing: 0.5px; margin: 0 0 14px; text-shadow: 0 2px 10px rgba(0, 0, 0, 0.6); }
.momtv-exit-subtitle { font-size: 18px; font-weight: 500; color: rgba(255, 255, 255, 0.75); line-height: 1.5; margin: 0 0 36px; }
.momtv-exit-btn-row { display: flex; gap: 22px; justify-content: center; align-items: center; }

.momtv-exit-btn {
  flex: 1; min-width: 170px; padding: 16px 28px; border-radius: 18px;
  font-size: 19px; font-weight: 700; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 10px;
  outline: none; user-select: none;
  transition: transform 0.16s cubic-bezier(0.2, 0.9, 0.3, 1), border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
}
.momtv-exit-btn .momtv-icon { width: 20px; height: 20px; }
.momtv-btn-cancel { background: rgba(255, 255, 255, 0.08); border: 2px solid rgba(255, 255, 255, 0.2); color: #ffffff; }
.momtv-btn-exit { background: linear-gradient(135deg, rgba(239, 68, 68, 0.38), rgba(185, 28, 28, 0.52)); border: 2px solid rgba(239, 68, 68, 0.65); color: #ffffff; }
.momtv-btn-cancel.active-focus { background: rgba(255, 255, 255, 0.4) !important; border: 3px solid #00f0ff !important; box-shadow: 0 0 30px rgba(0, 240, 255, 0.95), 0 0 15px rgba(255, 255, 255, 0.4) !important; transform: scale(1.08) !important; }
.momtv-btn-exit.active-focus { background: linear-gradient(135deg, rgba(239, 68, 68, 0.9), rgba(220, 38, 38, 1)) !important; border: 3px solid #00f0ff !important; box-shadow: 0 0 35px rgba(0, 240, 255, 0.95), 0 0 25px rgba(239, 68, 68, 0.8) !important; transform: scale(1.08) !important; }

#momtv-hud-pill {
  position: fixed; top: 10%; left: 50%; transform: translate(-50%, -50%) scale(0.92);
  background: rgba(10, 14, 24, 0.94);
  backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
  color: #ffffff; border: 1.5px solid rgba(0, 240, 255, 0.65); border-radius: 20px;
  padding: 14px 28px;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.85), 0 0 35px rgba(0, 240, 255, 0.35);
  z-index: 2147483647; opacity: 0; pointer-events: none;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  transition: opacity 0.2s cubic-bezier(0.2, 0.9, 0.3, 1), transform 0.2s cubic-bezier(0.2, 0.9, 0.3, 1);
  min-width: 240px; text-align: center;
}
#momtv-hud-pill.visible { opacity: 1; transform: translate(-50%, -50%) scale(1); }
.momtv-osd-header { display: flex; align-items: center; justify-content: center; gap: 12px; font-size: 22px; font-weight: 700; letter-spacing: 0.5px; }
.momtv-osd-header .momtv-icon { width: 24px; height: 24px; }
.momtv-osd-time { font-size: 16px; font-weight: 600; color: rgba(255, 255, 255, 0.85); font-variant-numeric: tabular-nums; }
.momtv-osd-track { width: 260px; height: 6px; background: rgba(255, 255, 255, 0.2); border-radius: 999px; overflow: hidden; margin-top: 4px; display: none; }
.momtv-osd-track.active { display: block; }
.momtv-osd-fill { height: 100%; background: #00f0ff; border-radius: 999px; box-shadow: 0 0 12px #00f0ff; transition: width 0.12s linear; }

#momtv-player-action-bar {
  position: fixed; bottom: 8%; left: 50%; transform: translateX(-50%) translateY(35px);
  background: rgba(10, 14, 24, 0.94);
  backdrop-filter: blur(28px); -webkit-backdrop-filter: blur(28px);
  border: 2px solid rgba(0, 240, 255, 0.5); border-radius: 24px;
  padding: 14px 26px; display: flex; flex-direction: column; align-items: center; gap: 10px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.9), 0 0 35px rgba(0, 240, 255, 0.3);
  z-index: 2147483647; opacity: 0; pointer-events: none;
  transition: opacity 0.22s cubic-bezier(0.2, 0.9, 0.3, 1), transform 0.22s cubic-bezier(0.2, 0.9, 0.3, 1);
  font-family: system-ui, -apple-system, sans-serif;
}
#momtv-player-action-bar.visible { opacity: 1; pointer-events: auto; transform: translateX(-50%) translateY(0); }
.momtv-bar-title { font-size: 11px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; color: rgba(0, 240, 255, 0.85); }
.momtv-bar-buttons { display: flex; align-items: center; gap: 12px; }
.momtv-action-btn {
  background: rgba(255, 255, 255, 0.08); border: 1.5px solid rgba(255, 255, 255, 0.16); border-radius: 14px;
  padding: 10px 18px; color: #ffffff; font-size: 15px; font-weight: 700;
  display: flex; align-items: center; gap: 8px; cursor: pointer; outline: none; user-select: none;
  transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}
.momtv-action-btn.active-focus { background: rgba(0, 240, 255, 0.6) !important; border-color: #00f0ff !important; box-shadow: 0 0 25px rgba(0, 240, 255, 0.95) !important; transform: scale(1.12) !important; color: #ffffff !important; font-weight: 800; }
.momtv-action-btn .momtv-icon { width: 18px; height: 18px; }
.momtv-action-btn .btn-label { font-size: 14px; letter-spacing: 0.4px; }

#momtv-virtual-cursor {
  position: fixed; top: 0; left: 0; width: 28px; height: 28px;
  pointer-events: none !important; z-index: 2147483647; opacity: 0;
  transform: translate(-100px, -100px);
  transition: opacity 0.22s cubic-bezier(0.2, 0.9, 0.3, 1), transform 0.04s linear;
  filter: drop-shadow(0 0 8px rgba(0, 240, 255, 0.95)) drop-shadow(0 0 18px rgba(0, 240, 255, 0.65));
  will-change: transform, opacity;
}
#momtv-virtual-cursor.visible { opacity: 1; }
#momtv-virtual-cursor.clicking { filter: drop-shadow(0 0 14px rgba(255, 255, 255, 1)) drop-shadow(0 0 28px rgba(0, 240, 255, 1)); transform: scale(0.85) !important; }
`;

  function injectLeanbackStyles() {
    try {
      if (typeof document === 'undefined' || !document) return;
      if (document.getElementById(STYLE_ID)) return;

      const target = document.head || document.documentElement;
      if (target && target.appendChild) {
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = LEANBACK_CSS;
        target.appendChild(style);
        return;
      }

      // If run at document_start before <html> or <head> exists
      const onReady = () => injectLeanbackStyles();
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onReady, { once: true });
      }
      if (typeof MutationObserver !== 'undefined') {
        const obs = new MutationObserver(() => {
          const t = document.head || document.documentElement;
          if (t && t.appendChild) {
            obs.disconnect();
            injectLeanbackStyles();
          }
        });
        try {
          obs.observe(document, { childList: true, subtree: true });
        } catch (_) {}
      }
    } catch (_) {}
  }
  injectLeanbackStyles();

  /* ==========================================================================
     3. SHARED UTILITIES
     ========================================================================== */
  function isElementInDoc(el) {
    if (!el) return false;
    return (document.documentElement && document.documentElement.contains)
      ? document.documentElement.contains(el)
      : (document.contains ? document.contains(el) : true);
  }

  function isInternalMomTVPage() {
    const host = (window.location.hostname || '').toLowerCase();
    const port = window.location.port || '';
    const path = (window.location.pathname || '').toLowerCase();
    return (host === 'localhost' || host === '127.0.0.1') && (port === '8765' || path.startsWith('/tv'));
  }

  function isYouTubeTVPage() {
    const host = (window.location.hostname || '').toLowerCase();
    const path = (window.location.pathname || '').toLowerCase();
    return host.includes('youtube.com') && path.startsWith('/tv');
  }

  function apply10FootScaling() {
    try {
      if (isInternalMomTVPage() || isYouTubeTVPage()) return;
      if (document.documentElement) {
        document.documentElement.classList.add('momtv-10ft-scaled');
        document.documentElement.setAttribute('data-momtv-zoom', '135');
      }
    } catch (_) {}
  }
  apply10FootScaling();
  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply10FootScaling, { once: true });
  }

  function formatTime(seconds) {
    if (isNaN(seconds) || !isFinite(seconds) || seconds < 0) return '00:00';
    const s = Math.floor(seconds % 60);
    const m = Math.floor((seconds / 60) % 60);
    const h = Math.floor(seconds / 3600);
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  /* ==========================================================================
     4. PROCEDURAL AUDIO ENGINE
     ========================================================================== */
  const AudioEngine = (() => {
    let ctx = null;
    let masterGain = null;
    let _audioInitialized = false;

    function init() {
      if (_audioInitialized) return;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        ctx = new AudioCtx();
        masterGain = ctx.createGain();
        masterGain.gain.setValueAtTime(1.0, ctx.currentTime);
        masterGain.connect(ctx.destination);
      }
      _audioInitialized = true;
    }

    function _ensureResumed() {
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    }

    // Each tone is (waveform, [startFreq, endFreq], durationSeconds, gain).
    const TONES = {
      focus:  { type: 'sine',     from: 540, to: 420, dur: 0.035, gain: 0.12 },
      select: { type: 'triangle', from: 640, to: 880, dur: 0.08,  gain: 0.15 },
      seek:   { type: 'sine',     from: 720, to: 580, dur: 0.03,  gain: 0.10 },
      back:   { type: 'sine',     from: 440, to: 320, dur: 0.06,  gain: 0.10 },
      dialog: { type: 'sine',     from: 520, to: 680, dur: 0.09,  gain: 0.14 }
    };

    function play(type) {
      try {
        init();
        _ensureResumed();
        if (!ctx || ctx.state !== 'running') return;
        const tone = TONES[type];
        if (!tone) return;

        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(masterGain || ctx.destination);

        osc.type = tone.type;
        osc.frequency.setValueAtTime(tone.from, now);
        osc.frequency.exponentialRampToValueAtTime(tone.to, now + tone.dur);
        gain.gain.setValueAtTime(tone.gain, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + tone.dur);
        osc.start(now);
        osc.stop(now + tone.dur);
      } catch (_) { /* audio unsupported — non-fatal */ }
    }

    if (typeof window !== 'undefined') {
      ['click', 'keydown', 'touchstart'].forEach((evt) => {
        window.addEventListener(evt, init, { once: true, passive: true });
      });
    }

    return { play };
  })();
  const playSound = AudioEngine.play;

  /* ==========================================================================
     5. EXIT CONFIRMATION DIALOG
     ========================================================================== */
  const ExitDialog = (() => {
    let isOpen = false;
    let activeBtnIndex = 0; // 0 = Cancel, 1 = Exit to Home
    let lastFocusedBeforeOpen = null;

    function ensureExitDialogElements() {
      let backdrop = document.getElementById('momtv-exit-backdrop');
      if (backdrop) return backdrop;

      const target = document.body || document.documentElement;
      if (!target) return null;

      backdrop = document.createElement('div');
      backdrop.id = 'momtv-exit-backdrop';
      backdrop.className = 'momtv-internal';
      backdrop.innerHTML = `
        <div id="momtv-exit-dialog" role="dialog" aria-modal="true" aria-labelledby="momtv-dialog-title">
          <div class="momtv-exit-icon">${ICONS.tv}</div>
          <h2 id="momtv-dialog-title" class="momtv-exit-title">Exit to MOM TV Home?</h2>
          <p class="momtv-exit-subtitle">Do you want to leave this app and return to Home?</p>
          <div class="momtv-exit-btn-row">
            <button id="momtv-btn-cancel" class="momtv-exit-btn momtv-btn-cancel" type="button">
              ${iconSpan('close')}<span>Cancel</span>
            </button>
            <button id="momtv-btn-exit" class="momtv-exit-btn momtv-btn-exit" type="button">
              ${iconSpan('home')}<span>Exit to Home</span>
            </button>
          </div>
        </div>`;
      target.appendChild(backdrop);

      const cancelBtn = backdrop.querySelector('#momtv-btn-cancel');
      if (cancelBtn) cancelBtn.addEventListener('click', hideExitDialog);
      const exitBtn = backdrop.querySelector('#momtv-btn-exit');
      if (exitBtn) {
        exitBtn.addEventListener('click', () => {
          playSound('select');
          window.location.href = 'http://localhost:8765/tv';
        });
      }

      return backdrop;
    }

    function updateExitDialogFocus() {
      const backdrop = ensureExitDialogElements();
      if (!backdrop) return;
      const cancelBtn = backdrop.querySelector('#momtv-btn-cancel');
      const exitBtn = backdrop.querySelector('#momtv-btn-exit');
      if (!cancelBtn || !exitBtn) return;
      const cancelActive = activeBtnIndex === 0;
      cancelBtn.classList.toggle('active-focus', cancelActive);
      exitBtn.classList.toggle('active-focus', !cancelActive);
      const toFocus = cancelActive ? cancelBtn : exitBtn;
      if (toFocus && toFocus.focus) toFocus.focus({ preventScroll: true });
    }

    function showExitDialog() {
      if (isInternalMomTVPage()) return; // never show the exit prompt on the launcher itself
      const backdrop = ensureExitDialogElements();
      if (!backdrop) return;
      lastFocusedBeforeOpen = SpatialNav.getFocused();
      isOpen = true;
      activeBtnIndex = 0; // default to the safe option
      backdrop.classList.add('visible');
      updateExitDialogFocus();
      playSound('dialog');
    }

    function hideExitDialog() {
      const backdrop = document.getElementById('momtv-exit-backdrop');
      if (backdrop) backdrop.classList.remove('visible');
      isOpen = false;
      playSound('back');
      if (lastFocusedBeforeOpen && isElementInDoc(lastFocusedBeforeOpen)) {
        SpatialNav.setFocus(lastFocusedBeforeOpen);
      }
    }

    function handleExitDialogKey(key) {
      const k = key.toLowerCase();

      if (['left', 'arrowleft'].includes(k)) { activeBtnIndex = 0; updateExitDialogFocus(); playSound('focus'); return true; }
      if (['right', 'arrowright'].includes(k)) { activeBtnIndex = 1; updateExitDialogFocus(); playSound('focus'); return true; }

      if (['enter', 'ok', 'select', 'space'].includes(k)) {
        if (activeBtnIndex === 1) {
          playSound('select');
          window.location.href = 'http://localhost:8765/tv';
        } else {
          hideExitDialog();
        }
        return true;
      }

      if (['back', 'escape'].includes(k)) { hideExitDialog(); return true; }
      return true; // swallow up/down so focus stays inside the dialog
    }

    return {
      get isOpen() { return isOpen; },
      show: showExitDialog,
      hide: hideExitDialog,
      handleKey: handleExitDialogKey,
      ensureElements: ensureExitDialogElements,
      updateFocusVisual: updateExitDialogFocus
    };
  })();

  /* ==========================================================================
     6. HUD (ON-SCREEN DISPLAY) & FLOATING PLAYER ACTION BAR
     ========================================================================== */
  const HUD = (() => {
    let hideTimer = null;

    function ensureElements() {
      let pill = document.getElementById('momtv-hud-pill');
      if (pill) return pill;
      const target = document.body || document.documentElement;
      if (!target) return null;
      pill = document.createElement('div');
      pill.id = 'momtv-hud-pill';
      pill.className = 'momtv-internal';
      pill.innerHTML = `
        <div class="momtv-osd-header"><span id="momtv-osd-action"></span><span id="momtv-osd-time" class="momtv-osd-time"></span></div>
        <div id="momtv-osd-track" class="momtv-osd-track"><div id="momtv-osd-fill" class="momtv-osd-fill"></div></div>`;
      target.appendChild(pill);
      return pill;
    }

    /** @param {string} text @param {string} [iconName] one of ICONS' keys */
    function show(text, iconName) {
      const pill = ensureElements();
      if (!pill) return;
      const actionEl = document.getElementById('momtv-osd-action');
      const timeEl = document.getElementById('momtv-osd-time');
      const trackEl = document.getElementById('momtv-osd-track');

      if (actionEl) actionEl.innerHTML = (iconName ? iconSpan(iconName) : '') + `<span>${text}</span>`;
      if (timeEl) timeEl.textContent = '';
      if (trackEl) trackEl.classList.remove('active');

      pill.classList.add('visible');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => pill && pill.classList.remove('visible'), 1500);
    }

    function showVideoProgress(video, actionText, iconName) {
      if (!video) return;
      const pill = ensureElements();
      if (!pill) return;
      const pct = Math.min(100, Math.max(0, (video.currentTime / (video.duration || 1)) * 100));

      const actionEl = document.getElementById('momtv-osd-action');
      const timeEl = document.getElementById('momtv-osd-time');
      const fillEl = document.getElementById('momtv-osd-fill');
      const trackEl = document.getElementById('momtv-osd-track');

      if (actionEl) actionEl.innerHTML = (iconName ? iconSpan(iconName) : '') + `<span>${actionText}</span>`;
      if (timeEl) timeEl.textContent = `[${formatTime(video.currentTime)} / ${formatTime(video.duration)}]`;
      if (fillEl) fillEl.style.width = `${pct}%`;
      if (trackEl) trackEl.classList.add('active');

      pill.classList.add('visible');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => pill && pill.classList.remove('visible'), 1800);
    }

    return { show, showVideoProgress };
  })();

  const NowPlaying = {
    _timer: null,
    show(text) {
      try {
        let el = document.getElementById('momtv-now-playing');
        if (!el) {
          const target = document.body || document.documentElement;
          if (!target) return;
          el = document.createElement('div');
          el.id = 'momtv-now-playing';
          el.style.cssText = 'position:fixed;top:16px;right:16px;padding:8px 16px;background:rgba(0,0,0,0.75);color:#fff;border-radius:8px;font:14px/1.4 system-ui;z-index:999999;transition:opacity 0.5s;pointer-events:none;';
          target.appendChild(el);
        }
        el.textContent = text;
        el.style.opacity = '1';
        clearTimeout(this._timer);
        this._timer = setTimeout(() => { if (el) el.style.opacity = '0'; }, 3000);
      } catch (_) {}
    }
  };

  if (typeof document !== 'undefined' && document.readyState === 'complete') {
    setTimeout(() => NowPlaying.show('MOM TV Loading...'), 500);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('load', () => setTimeout(() => NowPlaying.show('MOM TV Started'), 500), { once: true });
  }

  const PlayerActionBar = (() => {
    let isVisible = false;
    let activeIndex = 1;
    let hideTimer = null;

    const ACTIONS = [
      { action: 'rewind', icon: 'rewind', label: '-10s' },
      { action: 'playpause', icon: 'play', label: 'Play/Pause' },
      { action: 'forward', icon: 'forward', label: '+10s' },
      { action: 'audio', icon: 'unmute', label: 'Audio' },
      { action: 'subtitles', icon: 'tv', label: 'CC' },
      { action: 'fullscreen', icon: 'fullscreen', label: 'Fullscreen' }
    ];

    function ensureElements() {
      let bar = document.getElementById('momtv-player-action-bar');
      if (bar) return bar;

      const target = document.body || document.documentElement;
      if (!target) return null;

      bar = document.createElement('div');
      bar.id = 'momtv-player-action-bar';
      bar.className = 'momtv-internal';
      bar.innerHTML = `
        <div class="momtv-bar-title">MOM TV PLAYER CONTROLS</div>
        <div class="momtv-bar-buttons">
          ${ACTIONS.map(a => `<button class="momtv-action-btn" data-action="${a.action}">${iconSpan(a.icon)}<span class="btn-label">${a.label}</span></button>`).join('')}
        </div>`;
      target.appendChild(bar);

      const btns = bar.querySelectorAll('.momtv-action-btn');
      if (btns) {
        btns.forEach((btn, idx) => {
          btn.addEventListener('click', () => {
            activeIndex = idx;
            updateFocusVisual();
            execute(btn.getAttribute('data-action'));
          });
        });
      }
      return bar;
    }

    function updateFocusVisual() {
      const bar = ensureElements();
      if (!bar) return;
      const btns = bar.querySelectorAll('.momtv-action-btn');
      if (btns) {
        btns.forEach((btn, idx) => btn.classList.toggle('active-focus', idx === activeIndex));
      }
    }

    function show() {
      const bar = ensureElements();
      if (!bar) return;
      isVisible = true;
      updateFocusVisual();
      bar.classList.add('visible');
      playSound('focus');
      resetAutoHide();
    }

    function hide() {
      const bar = document.getElementById('momtv-player-action-bar');
      if (bar) bar.classList.remove('visible');
      isVisible = false;
      clearTimeout(hideTimer);
    }

    function resetAutoHide() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hide, 6000);
    }

    function execute(action) {
      const video = VideoControl.getActiveVideo();
      if (!video) return;
      resetAutoHide();

      switch (action) {
        case 'rewind':
          video.currentTime = Math.max(0, video.currentTime - 10);
          HUD.showVideoProgress(video, '-10s', 'rewind');
          playSound('seek');
          break;
        case 'forward':
          video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10);
          HUD.showVideoProgress(video, '+10s', 'forward');
          playSound('seek');
          break;
        case 'playpause':
          if (video.paused) { video.play().catch(() => {}); HUD.showVideoProgress(video, 'Play', 'play'); }
          else { video.pause(); HUD.showVideoProgress(video, 'Pause', 'pause'); }
          playSound('select');
          break;
        case 'audio': {
          video.muted = !video.muted;
          const btn = document.querySelector('.momtv-action-btn[data-action="audio"]');
          if (btn) {
            btn.querySelector('.momtv-icon').innerHTML = video.muted ? ICONS.mute : ICONS.unmute;
            btn.querySelector('.btn-label').textContent = video.muted ? 'Muted' : 'Audio';
          }
          HUD.show(video.muted ? 'Muted' : 'Unmuted', video.muted ? 'mute' : 'unmute');
          playSound('select');
          break;
        }
        case 'subtitles':
          if (video.textTracks && video.textTracks.length > 0) {
            const track = video.textTracks[0];
            track.mode = track.mode === 'showing' ? 'disabled' : 'showing';
            HUD.show(track.mode === 'showing' ? 'Subtitles ON' : 'Subtitles OFF', 'tv');
          } else {
            HUD.show('No Subtitles', 'tv');
          }
          playSound('select');
          break;
        case 'fullscreen':
          if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
            HUD.show('Windowed', 'windowed');
          } else {
            const target = video.parentElement || video;
            (target.requestFullscreen ? target : video).requestFullscreen().catch(() => {});
            HUD.show('Fullscreen', 'fullscreen');
          }
          playSound('select');
          break;
      }
    }

    function handleKey(key) {
      const k = key.toLowerCase();
      resetAutoHide();

      if (['left', 'arrowleft'].includes(k)) { activeIndex = Math.max(0, activeIndex - 1); updateFocusVisual(); playSound('focus'); return true; }
      if (['right', 'arrowright'].includes(k)) { activeIndex = Math.min(ACTIONS.length - 1, activeIndex + 1); updateFocusVisual(); playSound('focus'); return true; }
      if (['enter', 'ok', 'select', 'space'].includes(k)) { execute(ACTIONS[activeIndex].action); return true; }
      if (['up', 'arrowup', 'back', 'escape'].includes(k)) { hide(); playSound('back'); return true; }
      if (['down', 'arrowdown'].includes(k)) return true;
      return false;
    }

    return { get isVisible() { return isVisible; }, show, hide, handleKey };
  })();

  /* ==========================================================================
     7. VIDEO PLAYER DETECTION, SEEK ACCELERATION & PLATFORM ADAPTERS
     ========================================================================== */
  const VideoControl = (() => {
    const seekAccum = { direction: 0, count: 0, lastTime: 0 };
    let videoModeEngaged = false;
    let lastActiveVideo = null;

    function accumulatedSeekSeconds(pressCount) {
      if (pressCount <= 1) return 10;
      if (pressCount === 2) return 20;
      if (pressCount === 3) return 30;
      if (pressCount === 4) return 60;
      return 60 + (pressCount - 4) * 30;
    }

    let _cachedVideo = null, _cachedVideoTime = 0;

    function getActiveVideo() {
      const now = Date.now();
      if (_cachedVideo && (now - _cachedVideoTime) < 200) return _cachedVideo;

      function findVideo() {
        const videos = Array.from(document.querySelectorAll('video'));
        if (!videos.length) return null;

        const playing = videos.find(v => !v.paused && !v.ended && v.readyState > 1 && v.currentTime > 0);
        if (playing) return playing;

        const fs = videos.find(v => document.fullscreenElement === v || (document.fullscreenElement && document.fullscreenElement.contains(v)));
        if (fs) return fs;

        const visible = videos.filter(v => {
          const r = v.getBoundingClientRect();
          return r.width >= 120 && r.height >= 70;
        });
        if (visible.length) {
          visible.sort((a, b) => {
            const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
            return (rb.width * rb.height) - (ra.width * ra.height);
          });
          return visible[0];
        }
        return videos[0] || null;
      }

      _cachedVideo = findVideo();
      _cachedVideoTime = now;
      return _cachedVideo;
    }

    function isVideoModeActive() {
      const v = getActiveVideo();
      if (!v) { videoModeEngaged = false; return false; }
      if (!v.paused || document.fullscreenElement || PlayerActionBar.isVisible) {
        videoModeEngaged = true;
        lastActiveVideo = v;
        return true;
      }
      return videoModeEngaged && v === lastActiveVideo;
    }

    function markEngaged(video) { videoModeEngaged = true; lastActiveVideo = video; }
    function markDisengaged() { videoModeEngaged = false; }

    function handleKey(key, video) {
      const k = key.toLowerCase();

      if (PlayerActionBar.isVisible) return PlayerActionBar.handleKey(k);

      if (['left', 'rewind', 'arrowleft'].includes(k)) {
        const now = Date.now();
        seekAccum.count = (seekAccum.direction === -1 && now - seekAccum.lastTime < 850) ? seekAccum.count + 1 : 1;
        seekAccum.direction = -1;
        seekAccum.lastTime = now;
        const sec = accumulatedSeekSeconds(seekAccum.count);
        video.currentTime = Math.max(0, video.currentTime - sec);
        HUD.showVideoProgress(video, `-${sec}s`, 'rewind');
        playSound('seek');
        return true;
      }

      if (['right', 'forward', 'arrowright'].includes(k)) {
        const now = Date.now();
        seekAccum.count = (seekAccum.direction === 1 && now - seekAccum.lastTime < 850) ? seekAccum.count + 1 : 1;
        seekAccum.direction = 1;
        seekAccum.lastTime = now;
        const sec = accumulatedSeekSeconds(seekAccum.count);
        video.currentTime = Math.min(video.duration || Infinity, video.currentTime + sec);
        HUD.showVideoProgress(video, `+${sec}s`, 'forward');
        playSound('seek');
        return true;
      }

      if (['enter', 'ok', 'select', 'space', 'play', 'pause', 'playpause'].includes(k)) {
        if (video.paused) { video.play().catch(() => {}); HUD.showVideoProgress(video, 'Play', 'play'); }
        else { video.pause(); HUD.showVideoProgress(video, 'Pause', 'pause'); }
        markEngaged(video);
        playSound('select');
        return true;
      }

      if (['down', 'arrowdown'].includes(k)) { PlayerActionBar.show(); return true; }

      if (['up', 'arrowup'].includes(k)) return false;

      if (['back', 'escape'].includes(k)) {
        if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); HUD.show('Exit Fullscreen', 'windowed'); playSound('back'); return true; }
        if (!video.paused) { video.pause(); HUD.show('Paused', 'pause'); markDisengaged(); playSound('back'); return true; }
        if (videoModeEngaged) { markDisengaged(); HUD.show('Exit Video Mode'); playSound('back'); return true; }
      }

      return false;
    }

    return { getActiveVideo, isVideoModeActive, handleKey, markEngaged, markDisengaged };
  })();

  const NETFLIX_PLAYER_SELECTOR = '.watch-video, .nf-player-container, [data-uia="video-canvas"]';

  function createPlatformAdapter(config) {
    const { name, matchesHost, isPlayerRoute, selectors, dispatchStrategy = 'click' } = config;

    function query(sel) { return sel && typeof document !== 'undefined' && document.querySelector ? document.querySelector(sel) : null; }

    function isActive(video) {
      if (!matchesHost()) return false;
      return isPlayerRoute() || Boolean(video || VideoControl.getActiveVideo()) && VideoControl.isVideoModeActive();
    }

    function dispatchKey(keyStr, codeStr, keyCodeNum) {
      if (dispatchStrategy === 'keyboard') {
        const target = query(selectors.playerArea || 'video') || (typeof document !== 'undefined' && (document.body || document.documentElement)) || null;
        const opts = { key: keyStr, code: codeStr, keyCode: keyCodeNum, which: keyCodeNum, bubbles: true, cancelable: true };
        const down = new KeyboardEvent('keydown', opts);
        const up = new KeyboardEvent('keyup', opts);

        if (target && typeof target.dispatchEvent === 'function') {
          target.dispatchEvent(down);
          target.dispatchEvent(up);
        }
        if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function') {
          document.dispatchEvent(down);
          document.dispatchEvent(up);
        } else if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(down);
          window.dispatchEvent(up);
        }
      }
    }

    function handleKey(key, video) {
      const k = key.toLowerCase();
      const v = video || VideoControl.getActiveVideo();

      if (['enter', 'ok', 'select', 'space', 'play', 'pause', 'playpause'].includes(k)) {
        if (v) v.paused ? v.play().catch(() => {}) : v.pause();
        if (dispatchStrategy === 'keyboard') { dispatchKey(' ', 'Space', 32); }
        else { const btn = query(selectors.playPause); if (btn) btn.click(); }
        if (v) HUD.showVideoProgress(v, v.paused ? 'Pause' : 'Play', v.paused ? 'pause' : 'play');
        playSound('select');
        return true;
      }

      if (['left', 'rewind', 'arrowleft'].includes(k)) {
        if (v) { v.currentTime = Math.max(0, v.currentTime - 10); HUD.showVideoProgress(v, '-10s', 'rewind'); }
        if (dispatchStrategy === 'keyboard') { dispatchKey('ArrowLeft', 'ArrowLeft', 37); }
        else { const btn = query(selectors.rewind); if (btn) btn.click(); }
        playSound('seek');
        return true;
      }

      if (['right', 'forward', 'arrowright'].includes(k)) {
        if (v) { v.currentTime = Math.min(v.duration || Infinity, v.currentTime + 10); HUD.showVideoProgress(v, '+10s', 'forward'); }
        if (dispatchStrategy === 'keyboard') { dispatchKey('ArrowRight', 'ArrowRight', 39); }
        else { const btn = query(selectors.forward); if (btn) btn.click(); }
        playSound('seek');
        return true;
      }

      if (['back', 'escape'].includes(k)) {
        const btn = query(selectors.back);
        if (btn) { btn.click(); playSound('back'); return true; }
        if (dispatchStrategy === 'keyboard') {
          dispatchKey('Escape', 'Escape', 27);
          if (path().includes('/watch') && name === 'netflix') { window.location.href = 'https://www.netflix.com/browse'; return true; }
        }
      }

      return false;
    }

    function handleBack() {
      const btn = query(selectors.back);
      if (btn) { btn.click(); return true; }
      if (dispatchStrategy === 'keyboard' && path().includes('/watch') && name === 'netflix') {
        window.location.href = 'https://www.netflix.com/browse';
        return true;
      }
      return false;
    }

    return { name, matchesHost, isActive, handleKey, handleBack };
  }

  const host = () => (typeof window !== 'undefined' && window.location && window.location.hostname) || '';
  const path = () => (typeof window !== 'undefined' && window.location && window.location.pathname) || '';

  const NetflixAdapter = createPlatformAdapter({
    name: 'netflix',
    matchesHost: () => host().includes('netflix.com'),
    isPlayerRoute: () => path().includes('/watch') || Boolean(typeof document !== 'undefined' && document.querySelector && document.querySelector(NETFLIX_PLAYER_SELECTOR)),
    dispatchStrategy: 'keyboard',
    selectors: {
      playerArea: NETFLIX_PLAYER_SELECTOR + ', video',
      back: '[data-uia="nfplayer-exit"], .button-nfplayerBack, button[aria-label*="Back" i]'
    }
  });

  const HotstarAdapter = createPlatformAdapter({
    name: 'hotstar',
    matchesHost: () => host().includes('hotstar.com'),
    isPlayerRoute: () => path().includes('/watch') || path().includes('/play') || Boolean(typeof document !== 'undefined' && document.querySelector && document.querySelector('.player-container, .shaka-video-container')),
    selectors: {
      playPause: 'button[aria-label*="Play" i], button[aria-label*="Pause" i], .play-btn, [data-testid*="play-pause-btn" i], .shaka-play-button',
      rewind: 'button[aria-label*="Rewind" i], button[aria-label*="backward" i], [data-testid*="rewind" i], .rewind-btn',
      forward: 'button[aria-label*="Forward" i], [data-testid*="forward" i], .forward-btn',
      back: 'button[aria-label*="Back" i], [data-testid*="back-btn" i], .player-back-btn'
    }
  });

  const PrimeAdapter = createPlatformAdapter({
    name: 'prime',
    matchesHost: () => host().includes('primevideo.com') || (host().includes('amazon.') && path().includes('/video/')),
    isPlayerRoute: () => path().includes('/watch') || Boolean(typeof document !== 'undefined' && document.querySelector && document.querySelector('.atvwebplayersdk-player-container')),
    selectors: {
      playPause: '.atvwebplayersdk-playpause-button, button[aria-label*="Play" i], button[aria-label*="Pause" i]',
      rewind: '.atvwebplayersdk-rewind-button, button[aria-label*="10 seconds backward" i], .rewind-button',
      forward: '.fast-forward-button, button[aria-label*="10 seconds forward" i]',
      back: '.atvwebplayersdk-back-button, button[aria-label*="Back" i]'
    }
  });

  const JioCinemaAdapter = createPlatformAdapter({
    name: 'jiocinema',
    matchesHost: () => host().includes('jiocinema.com'),
    isPlayerRoute: () => path().includes('/watch') || Boolean(typeof document !== 'undefined' && document.querySelector && document.querySelector('.player-wrapper, .player-container')),
    selectors: {
      playPause: 'button[class*="play" i], button[class*="pause" i], button[aria-label*="Play" i], [data-testid*="play-pause" i]',
      rewind: 'button[aria-label*="Rewind" i], button[class*="rewind" i], [data-testid*="rewind" i]',
      forward: 'button[aria-label*="Forward" i], button[class*="forward" i], [data-testid*="forward" i]',
      back: 'button[aria-label*="Back" i], button[class*="back" i]'
    }
  });

  const PlatformAdapters = {
    all: [NetflixAdapter, HotstarAdapter, PrimeAdapter, JioCinemaAdapter],

    isNetflix: () => NetflixAdapter.matchesHost(),
    isNetflixPlayerActive: (video) => NetflixAdapter.isActive(video),
    handleNetflixKey: (key, video) => NetflixAdapter.handleKey(key, video),

    isHotstar: () => HotstarAdapter.matchesHost(),
    isHotstarPlayerActive: (video) => HotstarAdapter.isActive(video),
    handleHotstarKey: (key, video) => HotstarAdapter.handleKey(key, video),

    isPrime: () => PrimeAdapter.matchesHost(),
    isPrimePlayerActive: (video) => PrimeAdapter.isActive(video),
    handlePrimeKey: (key, video) => PrimeAdapter.handleKey(key, video),

    isJioCinema: () => JioCinemaAdapter.matchesHost(),
    isJioCinemaPlayerActive: (video) => JioCinemaAdapter.isActive(video),
    handleJioCinemaKey: (key, video) => JioCinemaAdapter.handleKey(key, video),

    dispatch(key, video) {
      for (const adapter of this.all) {
        if (adapter.isActive(video)) return adapter.handleKey(key, video);
      }
      return false;
    },

    handleBack() {
      for (const adapter of this.all) {
        if (adapter.matchesHost() && (adapter.handleBack ? adapter.handleBack() : adapter.isActive())) {
          return true;
        }
      }
      return false;
    }
  };

  /* ==========================================================================
     8. TRUSTED-EVENT CARD ACTIVATION
     ========================================================================== */
  function isSearchInput(el) {
    if (!el) return false;
    if (el.tagName === 'INPUT') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      return ['text', 'search'].includes(t) || !el.hasAttribute('type');
    }
    return el.getAttribute('role') === 'searchbox';
  }

  function findActionTarget(el) {
    if (!el) return null;
    if (el.tagName === 'A' && el.getAttribute('href')) return el;

    if (el.querySelectorAll) {
      const anchor = Array.from(el.querySelectorAll('a')).find(a => {
        const h = a.getAttribute('href');
        return h && !h.startsWith('javascript:') && !h.startsWith('#');
      });
      if (anchor) return anchor;
    }

    if (el.closest) {
      const parentAnchor = el.closest('a[href]');
      if (parentAnchor) return parentAnchor;
    }

    if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') return el;
    if (el.querySelector) {
      const innerBtn = el.querySelector('button, [role="button"]');
      if (innerBtn && !innerBtn.hasAttribute('disabled')) return innerBtn;
    }

    if (['INPUT', 'TEXTAREA'].includes(el.tagName) || el.getAttribute('role') === 'searchbox') return el;
    return el;
  }

  function dispatchPointerSequence(target, clientX, clientY) {
    const base = { bubbles: true, cancelable: true, view: window, clientX, clientY };
    target.dispatchEvent(new PointerEvent('pointerdown', { ...base, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    target.dispatchEvent(new MouseEvent('mousedown', { ...base, button: 0, buttons: 1 }));
    target.dispatchEvent(new PointerEvent('pointerup', { ...base, button: 0, buttons: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    target.dispatchEvent(new MouseEvent('mouseup', { ...base, button: 0, buttons: 0 }));
    target.dispatchEvent(new MouseEvent('click', { ...base, button: 0 }));
  }

  function executeCardAction(el) {
    if (!el) return false;
    const target = findActionTarget(el) || el._momTvActionTarget || el;

    if (isSearchInput(target) || ['INPUT', 'TEXTAREA'].includes(target.tagName)) {
      try { target.focus(); } catch (_) {}
      return true;
    }

    try {
      const rect = target.getBoundingClientRect();
      const cx = Math.round(rect.left + rect.width / 2);
      const cy = Math.round(rect.top + rect.height / 2);

      dispatchPointerSequence(target, cx, cy);
      if (el !== target) { dispatchPointerSequence(el, cx, cy); try { el.click(); } catch (_) {} }
      try { target.click(); } catch (_) {}

      const href = target.getAttribute && target.getAttribute('href');
      if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
        try {
          const resolved = new URL(href, window.location.href).href;
          setTimeout(() => { if (window.location.href !== resolved) window.location.href = resolved; }, 120);
        } catch (_) {}
      }
      return true;
    } catch (err) {
      console.warn('[MOM TV] executeCardAction failed:', err);
      try { target.click(); } catch (_) {}
      return true;
    }
  }

  function emulateMouseHover(el) {
    if (!el || !el.getBoundingClientRect) return;
    try {
      const rect = el.getBoundingClientRect();
      const base = { bubbles: true, cancelable: true, view: window, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, buttons: 0 };
      el.dispatchEvent(new PointerEvent('pointerover', { ...base, pointerType: 'mouse', isPrimary: true }));
      el.dispatchEvent(new PointerEvent('pointerenter', { ...base, pointerType: 'mouse', isPrimary: true }));
      el.dispatchEvent(new MouseEvent('mouseenter', base));
      el.dispatchEvent(new MouseEvent('mousemove', base));
    } catch (_) {}
  }

  function emulateMouseLeave(el) {
    if (!el || !el.getBoundingClientRect) return;
    try {
      const rect = el.getBoundingClientRect();
      const base = { bubbles: true, cancelable: true, view: window, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, buttons: 0 };
      el.dispatchEvent(new PointerEvent('pointerleave', { ...base, pointerType: 'mouse', isPrimary: true }));
      el.dispatchEvent(new MouseEvent('mouseleave', base));
    } catch (_) {}
  }

  /* ==========================================================================
     9. CARD DISCOVERY (structural filtering, junk removal, deduplication)
     ========================================================================== */
  const CardDiscovery = (() => {
    let cachedCards = null;
    let lastCardsScan = 0;
    let cachedHeaderItems = null;
    let lastHeaderScan = 0;
    const CACHE_TTL_MS = 600;
    const HEADER_CACHE_TTL_MS = 1000;

    let invalidateTimer = null;
    function invalidate() {
      clearTimeout(invalidateTimer);
      invalidateTimer = setTimeout(() => {
        cachedCards = null; lastCardsScan = 0;
        cachedHeaderItems = null; lastHeaderScan = 0;
      }, 120);
    }

    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(invalidate);
      const attach = () => {
        const root = document.body || document.documentElement;
        if (root && root.nodeType) {
          try {
            observer.observe(root, { childList: true, subtree: true, characterData: false, attributes: false });
          } catch (_) {}
        }
      };
      if (document.body || document.documentElement) {
        attach();
      } else {
        document.addEventListener('DOMContentLoaded', attach, { once: true });
      }
    }

    function isVisible(el) {
      if (!el || !el.getBoundingClientRect) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) < 0.08) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    const JUNK_SELECTORS = [
      'footer', '[role="contentinfo"]', '#footer', '.footer', '.site-footer',
      '[id*="cookie" i]', '[class*="cookie" i]', '[id*="consent" i]', '[class*="consent" i]',
      '[aria-label*="cookie" i]', '[aria-label*="consent" i]', '.qc-cmp2-container', '#onetrust-consent-sdk',
      '.ad-container', '.ad-banner', '.advertisement', '[id*="google_ads" i]', '[class*="google_ads" i]', '[id*="advertisement" i]',
      'ytd-channel-name', '#avatar-link', 'yt-icon', 'ytd-menu-renderer', '#guide-button', '#voice-search-button', '#notification-preference-button',
      'script', 'style', 'noscript', 'svg', 'path', '[aria-hidden="true"]'
    ].join(',');

    function isJunkElement(el) {
      if (!el || el.nodeType !== 1) return true;
      if (el.closest('#momtv-exit-backdrop, #momtv-exit-dialog, #momtv-hud-pill, #momtv-player-action-bar, .momtv-internal')) return true;
      try {
        if ((el.matches && el.matches(JUNK_SELECTORS)) || (el.closest && el.closest(JUNK_SELECTORS))) return true;
      } catch (_) {}
      const txt = (el.innerText || '').trim().toLowerCase();
      if (txt.length > 0 && txt.length < 60 && /privacy policy|terms of service|copyright|cookie policy|all rights reserved/i.test(txt)) return true;
      return false;
    }

    function isInHeaderNav(el) {
      return Boolean(el && el.closest && el.closest('header, nav, [role="navigation"], #masthead, .header-bar, .navbar, .nav-bar, #header'));
    }

    function isPrimaryActionButton(el) {
      if (!el) return false;
      if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') {
        const rect = el.getBoundingClientRect();
        return rect.width >= 50 && rect.height >= 24;
      }
      return false;
    }

    const CARD_SELECTOR_GROUPS = {
      STRUCTURAL: 'article, [role="article"]',
      TEST_IDS: '[data-testid*="tray" i], [data-testid*="card" i], [data-testid*="item" i], [data-testid*="title" i], [data-testid*="poster" i], [data-testid*="thumb" i]',
      CUSTOM_ATTRS: '[data-uia*="card" i], [data-card]',
      GENERIC_CARDS: 'div[class*="card" i]:not([class*="card-list" i]):not([class*="cards-grid" i])',
      MEDIA_CONTAINERS: 'div[class*="poster" i], div[class*="tray-item" i], div[class*="slider-item" i], div[class*="tile" i], div[class*="thumb" i]',
      SPECIFIC_CLASSES: '.title-card, .slider-item, .app-card, .video-card, .movie-card, .media-card, .show-card',
      MEDIA_LINKS: 'a[href*="/watch"], a[href*="/title/"], a[href*="/movies/"], a[href*="/shows/"], a[href*="/series/"], a[href*="/play/"], a[href*="/video/"], a[href*="/detail/"]',
      YOUTUBE_SPECIFIC: 'ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-reel-item-renderer, ytd-playlist-renderer, ytd-thumbnail',
      BUTTONS: 'button:not([disabled]), [role="button"]',
      INTERACTIVE: 'a[href], [role="button"]:not([aria-disabled="true"]), [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"]',
      INPUTS: 'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    };
    const CARD_SELECTORS = Object.values(CARD_SELECTOR_GROUPS).join(', ');

    function getFocusableCards(forceRefresh) {
      const now = Date.now();
      if (!forceRefresh && cachedCards && now - lastCardsScan < CACHE_TTL_MS) {
        const valid = cachedCards.filter(isElementInDoc);
        if (valid.length) return valid;
      }

      const candidates = [];
      for (const el of document.querySelectorAll(CARD_SELECTORS)) {
        if (isJunkElement(el) || isInHeaderNav(el) || !isVisible(el)) continue;
        const rect = el._momTvRect || el.getBoundingClientRect();
        const isCardGeom = rect.width >= 75 && rect.height >= 40;
        const isBtnGeom = isPrimaryActionButton(el) && rect.width >= 40 && rect.height >= 20;
        const tag = (el.tagName || '').toUpperCase();
        const isSmallInteractive = (['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(tag) || el.hasAttribute('tabindex')) && rect.width >= 16 && rect.height >= 16;
        if (!isCardGeom && !isBtnGeom && !isSmallInteractive) continue;
        el._momTvRect = rect;
        candidates.push(el);
      }

      const unique = [];
      for (let i = 0; i < candidates.length; i++) {
        const c1 = candidates[i];
        let dominated = false;
        for (let j = 0; j < candidates.length; j++) {
          if (i === j) continue;
          const c2 = candidates[j];
          if (c2.contains(c1)) {
            const r2 = c2._momTvRect, r1 = c1._momTvRect;
            if (r2.width > r1.width * 1.8) continue;
            c2._momTvActionTarget = findActionTarget(c1) || c1;
            dominated = true;
            break;
          }
        }
        if (!dominated && !unique.includes(c1)) {
          if (!c1._momTvActionTarget) c1._momTvActionTarget = findActionTarget(c1) || c1;
          unique.push(c1);
        }
      }

      for (const card of unique) {
        if (!card.hasAttribute('tabindex') || card.getAttribute('tabindex') === '-1') card.setAttribute('tabindex', '0');
        card.setAttribute('data-tv-card', 'true');
      }

      cachedCards = unique;
      lastCardsScan = Date.now();
      return unique;
    }

    const HEADER_SELECTORS = [
      'input[type="search"]', 'input[type="text"]', 'input:not([type])', '[role="searchbox"]',
      'header a[href]', 'header button:not([disabled])', 'nav a[href]', 'nav button:not([disabled])',
      '[role="navigation"] a[href]', '[role="navigation"] button:not([disabled])',
      '#masthead a[href]', '#masthead button:not([disabled])'
    ].join(',');

    function getHeaderItems(forceRefresh) {
      const now = Date.now();
      if (!forceRefresh && cachedHeaderItems && now - lastHeaderScan < HEADER_CACHE_TTL_MS) {
        const valid = cachedHeaderItems.filter(isElementInDoc);
        if (valid.length) return valid;
      }

      const valid = [];
      for (const el of document.querySelectorAll(HEADER_SELECTORS)) {
        if (isJunkElement(el) || !isVisible(el)) continue;
        const rect = el.getBoundingClientRect();
        el._momTvRect = rect;
        if (isSearchInput(el)) { if (rect.width >= 60 && rect.height >= 24) valid.push(el); }
        else if (rect.width >= 45 && rect.height >= 24) valid.push(el);
      }
      valid.sort((a, b) => (a._momTvRect.left - b._momTvRect.left));

      cachedHeaderItems = valid;
      lastHeaderScan = Date.now();
      return valid;
    }

    return { getFocusableCards, getHeaderItems, isVisible, isJunkElement, isInHeaderNav, invalidate };
  })();

  /* ==========================================================================
     10. SPATIAL 2D NAVIGATION (row/column matrix + vector fallback)
     ========================================================================== */
  const SpatialNav = (() => {
    let currentFocused = null;
    let inHeaderMode = false;

    function buildRows(cards) {
      if (!cards.length) return [];
      const scrollX = window.scrollX || 0, scrollY = window.scrollY || 0;

      const items = cards.map((el) => {
        const rect = el._momTvRect || el.getBoundingClientRect();
        const top = rect.top + scrollY;
        return { el, rect, top, bottom: top + rect.height, left: rect.left + scrollX, right: rect.left + scrollX + rect.width, centerX: rect.left + scrollX + rect.width / 2, centerY: top + rect.height / 2, height: rect.height };
      });
      items.sort((a, b) => (a.top !== b.top ? a.top - b.top : a.left - b.left));

      const rows = [];
      for (const item of items) {
        let row = rows.find(r => {
          const midDiff = Math.abs(item.centerY - r.centerY);
          const overlap = Math.min(item.bottom, r.bottom) - Math.max(item.top, r.top);
          return midDiff <= 35 || overlap >= 0.35 * Math.min(item.height, r.avgHeight);
        });
        if (row) {
          row.cards.push(item);
          row.top = Math.min(row.top, item.top);
          row.bottom = Math.max(row.bottom, item.bottom);
          row.centerY = (row.top + row.bottom) / 2;
          row.avgHeight = (row.avgHeight * (row.cards.length - 1) + item.height) / row.cards.length;
        } else {
          rows.push({ top: item.top, bottom: item.bottom, centerY: item.centerY, avgHeight: item.height, cards: [item] });
        }
      }
      rows.sort((a, b) => a.top - b.top);
      rows.forEach(r => r.cards.sort((a, b) => a.left - b.left));
      return rows;
    }

    function findVerticalScrollContainer(el) {
      let node = el ? el.parentElement : null;
      while (node && node !== document.body && node !== document.documentElement) {
        if (node.scrollHeight > node.clientHeight + 40) {
          const oy = window.getComputedStyle(node).overflowY;
          if (oy === 'auto' || oy === 'scroll') return node;
        }
        node = node.parentElement;
      }
      return window;
    }

    function tryPaginateCarousel(cardEl, direction) {
      if (!cardEl) return false;
      const chevronSelector = direction === 'right'
        ? 'button[aria-label*="next" i],button[aria-label*="right" i],button[aria-label*="forward" i],[class*="chevron-right" i],[class*="arrow-right" i],[class*="next-button" i],[class*="slider-right" i],[data-testid*="next" i],[data-uia*="next" i],.next-btn,.slider-button-next'
        : 'button[aria-label*="prev" i],button[aria-label*="previous" i],button[aria-label*="left" i],[class*="chevron-left" i],[class*="arrow-left" i],[class*="prev-button" i],[class*="slider-left" i],[data-testid*="prev" i],[data-uia*="prev" i],.prev-btn,.slider-button-prev';

      let node = cardEl.parentElement;
      while (node && node !== document.body && node !== document.documentElement) {
        const btn = node.querySelector(chevronSelector);
        if (btn && CardDiscovery.isVisible(btn)) { btn.click(); return true; }

        if (node.scrollWidth > node.clientWidth + 30) {
          const ox = window.getComputedStyle(node).overflowX;
          if (['auto', 'scroll', 'hidden'].includes(ox)) {
            node.scrollBy({ left: Math.round(node.clientWidth * 0.75) * (direction === 'right' ? 1 : -1), behavior: 'smooth' });
            return true;
          }
        }
        node = node.parentElement;
      }
      return false;
    }

    function scrollIntoComfortZone(el) {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const diffY = (rect.top + rect.height / 2) - window.innerHeight * 0.40;
      const container = findVerticalScrollContainer(el);
      if (container !== window) container.scrollBy({ top: diffY, behavior: 'smooth' });
      else if (Math.abs(diffY) > 20) window.scrollBy({ top: diffY, behavior: 'smooth' });

      let parent = el.parentElement;
      while (parent && parent !== document.body && parent !== document.documentElement) {
        if (parent.scrollWidth > parent.clientWidth + 20) {
          const ox = window.getComputedStyle(parent).overflowX;
          if (['auto', 'scroll', 'hidden'].includes(ox)) {
            const pRect = parent.getBoundingClientRect();
            const diffX = (rect.left - pRect.left) - pRect.width * 0.22;
            if (Math.abs(diffX) > 15) parent.scrollBy({ left: diffX, behavior: 'smooth' });
            break;
          }
        }
        parent = parent.parentElement;
      }
    }

    function setFocus(el) {
      if (currentFocused && currentFocused !== el) {
        currentFocused.classList.remove('momtv-card-focused', 'momtv-focused', 'momtv-focused-input');
        emulateMouseLeave(currentFocused);
      }
      currentFocused = el;
      if (!el) return;

      inHeaderMode = CardDiscovery.isInHeaderNav(el);
      el.classList.add(isSearchInput(el) ? 'momtv-focused-input' : 'momtv-card-focused', ...(isSearchInput(el) ? [] : ['momtv-focused']));
      try { el.focus({ preventScroll: true }); } catch (_) {}
      scrollIntoComfortZone(el);
      emulateMouseHover(el);
      playSound('focus');
    }

    function findSpatialCandidate(fromEl, direction, cardPool) {
      if (!fromEl) return null;
      const curRect = fromEl._momTvRect || fromEl.getBoundingClientRect();
      const curCX = curRect.left + curRect.width / 2, curCY = curRect.top + curRect.height / 2;

      const candidates = Array.from(new Set([...(cardPool || CardDiscovery.getFocusableCards()), ...CardDiscovery.getHeaderItems()]));
      let best = null, bestScore = Infinity;

      for (const el of candidates) {
        if (el === fromEl || !CardDiscovery.isVisible(el) || CardDiscovery.isJunkElement(el)) continue;
        const rect = el._momTvRect || el.getBoundingClientRect();
        const elCX = rect.left + rect.width / 2, elCY = rect.top + rect.height / 2;

        let valid = false, primary = 0, secondary = 0, overlap = false;
        if (direction === 'right' && (rect.left >= curRect.right - 15 || elCX > curCX + 10)) {
          valid = true; primary = Math.max(0, rect.left - curRect.right); secondary = Math.abs(elCY - curCY);
          overlap = rect.top < curRect.bottom && rect.bottom > curRect.top;
        } else if (direction === 'left' && (rect.right <= curRect.left + 15 || elCX < curCX - 10)) {
          valid = true; primary = Math.max(0, curRect.left - rect.right); secondary = Math.abs(elCY - curCY);
          overlap = rect.top < curRect.bottom && rect.bottom > curRect.top;
        } else if (direction === 'down' && (rect.top >= curRect.bottom - 15 || elCY > curCY + 10)) {
          valid = true; primary = Math.max(0, rect.top - curRect.bottom); secondary = Math.abs(elCX - curCX);
          overlap = rect.left < curRect.right && rect.right > curRect.left;
        } else if (direction === 'up' && (rect.bottom <= curRect.top + 15 || elCY < curCY - 10)) {
          valid = true; primary = Math.max(0, curRect.top - rect.bottom); secondary = Math.abs(elCX - curCX);
          overlap = rect.left < curRect.right && rect.right > curRect.left;
        }

        if (valid) {
          const weight = (direction === 'left' || direction === 'right') ? 2.5 : 1.8;
          let score = Math.hypot(primary, secondary * weight);
          if (overlap) score *= 0.65;
          if (score < bestScore) { bestScore = score; best = el; }
        }
      }
      return best;
    }

    function autoFocusFirst() {
      if (isYouTubeTVPage() || isInternalMomTVPage()) return;
      if (currentFocused && isElementInDoc(currentFocused)) return;

      const cards = CardDiscovery.getFocusableCards();
      if (cards.length) {
        let best = cards[0], bestScore = Infinity;
        for (const c of cards) {
          const r = c._momTvRect || c.getBoundingClientRect();
          if (r.top >= 0 && r.left >= 0 && r.top < window.innerHeight && r.left < window.innerWidth) {
            const s = r.top * 1.5 + r.left;
            if (s < bestScore) { bestScore = s; best = c; }
          }
        }
        setFocus(best);
      } else {
        const headers = CardDiscovery.getHeaderItems();
        if (headers.length) setFocus(headers[0]);
      }
    }

    if (typeof document !== 'undefined' && document.readyState === 'complete') setTimeout(autoFocusFirst, 350);
    else if (typeof window !== 'undefined') window.addEventListener('load', () => setTimeout(autoFocusFirst, 350), { once: true });

    function moveFocus(direction) {
      if (!currentFocused || !isElementInDoc(currentFocused)) {
        autoFocusFirst();
        return Boolean(currentFocused);
      }

      // Header row: left/right walk the header, down drops into the grid.
      if (inHeaderMode) {
        const headers = CardDiscovery.getHeaderItems();
        if (!headers.length) { inHeaderMode = false; }
        else {
          let idx = headers.indexOf(currentFocused);
          if (idx === -1) idx = 0;

          if (direction === 'left') { if (idx > 0) setFocus(headers[idx - 1]); else playSound('focus'); return true; }
          if (direction === 'right') { if (idx < headers.length - 1) setFocus(headers[idx + 1]); else playSound('focus'); return true; }
          if (direction === 'up') { playSound('focus'); return true; }
          if (direction === 'down') {
            inHeaderMode = false;
            const cards = CardDiscovery.getFocusableCards();
            const next = findSpatialCandidate(currentFocused, 'down', cards);
            if (next) { setFocus(next); return true; }
            const rows = buildRows(cards);
            if (rows.length && rows[0].cards.length) { setFocus(rows[0].cards[0].el); return true; }
            return false;
          }
        }
      }

      // Row/column matrix step (keeps neighboring cards feeling aligned).
      const cards = CardDiscovery.getFocusableCards();
      const rows = buildRows(cards);
      let rowIdx = -1, colIdx = -1;
      for (let r = 0; r < rows.length; r++) {
        const c = rows[r].cards.findIndex(c => c.el === currentFocused);
        if (c !== -1) { rowIdx = r; colIdx = c; break; }
      }

      if (rowIdx !== -1) {
        const row = rows[rowIdx];
        const card = row.cards[colIdx];

        if (direction === 'left' && colIdx > 0) { setFocus(row.cards[colIdx - 1].el); return true; }
        if (direction === 'right' && colIdx < row.cards.length - 1) { setFocus(row.cards[colIdx + 1].el); return true; }

        if (direction === 'down' && rowIdx < rows.length - 1) {
          const next = rows[rowIdx + 1];
          setFocus(next.cards.reduce((a, b) => Math.abs(b.centerX - card.centerX) < Math.abs(a.centerX - card.centerX) ? b : a).el);
          return true;
        }
        if (direction === 'up' && rowIdx > 0) {
          const prev = rows[rowIdx - 1];
          setFocus(prev.cards.reduce((a, b) => Math.abs(b.centerX - card.centerX) < Math.abs(a.centerX - card.centerX) ? b : a).el);
          return true;
        }
        if (direction === 'up' && rowIdx === 0) {
          const headers = CardDiscovery.getHeaderItems();
          if (headers.length) {
            inHeaderMode = true;
            setFocus(headers.reduce((a, b) => {
              const ra = a._momTvRect || a.getBoundingClientRect(), rb = b._momTvRect || b.getBoundingClientRect();
              return Math.abs((rb.left + rb.width / 2) - card.centerX) < Math.abs((ra.left + ra.width / 2) - card.centerX) ? b : a;
            }));
            return true;
          }
        }
      }

      // Vector fallback for irregular layouts (sidebars, wrapped cards).
      const spatial = findSpatialCandidate(currentFocused, direction, cards);
      if (spatial) { inHeaderMode = CardDiscovery.isInHeaderNav(spatial); setFocus(spatial); return true; }

      // Boundary: paginate a carousel or scroll the page, then retry.
      if (direction === 'right' || direction === 'left') {
        const paginated = tryPaginateCarousel(currentFocused, direction);
        playSound('focus');
        if (paginated) {
          HUD.show(direction === 'right' ? 'More' : 'Previous');
          CardDiscovery.invalidate();
          setTimeout(() => { const next = findSpatialCandidate(currentFocused, direction); if (next) setFocus(next); }, 240);
        }
        return true;
      }

      if (direction === 'down' || direction === 'up') {
        const container = findVerticalScrollContainer(currentFocused);
        const shift = Math.round(window.innerHeight * 0.55) * (direction === 'down' ? 1 : -1);
        (container === window ? window : container).scrollBy({ top: shift, behavior: 'smooth' });
        playSound('focus');
        HUD.show(direction === 'down' ? 'Loading More...' : 'Scrolling Up', direction === 'down' ? 'down' : 'up');
        CardDiscovery.invalidate();
        setTimeout(() => { const next = findSpatialCandidate(currentFocused, direction); if (next) setFocus(next); }, 300);
        return true;
      }

      return false;
    }

    return {
      moveFocus, setFocus, autoFocusFirst,
      getFocused: () => currentFocused
    };
  })();

  /* ==========================================================================
     11. BACK NAVIGATION
     ========================================================================== */
  const BackNav = (() => {
    let lastPressTime = 0;
    let consecutivePresses = 0;

    function isAtAppRoot() {
      const p = (window.location.pathname || '').toLowerCase();
      const rootPaths = ['/', '', '/browse', '/home', '/in', '/in/home', '/in/explore', '/tv'];
      return rootPaths.includes(p) && !window.location.search.includes('watch');
    }

    function goBack() {
      playSound('back');

      if (ExitDialog.isOpen) { ExitDialog.hide(); return true; }
      if (PlayerActionBar.isVisible) { PlayerActionBar.hide(); return true; }
      if (PlatformAdapters.handleBack()) return true;

      if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); HUD.show('Exit Fullscreen', 'windowed'); return true; }

      const video = VideoControl.getActiveVideo();
      if (video && !video.paused) { video.pause(); HUD.show('Paused', 'pause'); VideoControl.markDisengaged(); return true; }

      const now = Date.now();
      consecutivePresses = (now - lastPressTime < 1800) ? consecutivePresses + 1 : 1;
      lastPressTime = now;

      if (isAtAppRoot() || consecutivePresses >= 2 || window.history.length <= 1) { ExitDialog.show(); return true; }

      if (window.history.length > 1 && !isInternalMomTVPage()) { window.history.back(); return true; }

      ExitDialog.show();
      return true;
    }

    return { goBack };
  })();

  /* ==========================================================================
     12. VIRTUAL MOUSE CURSOR (Magic Trackpad mode)
     ========================================================================== */
  const VirtualCursor = (() => {
    let x = (typeof window !== 'undefined' && Math.round(window.innerWidth / 2)) || 960;
    let y = (typeof window !== 'undefined' && Math.round(window.innerHeight / 2)) || 540;
    let visible = false;
    let hideTimer = null;
    let el = null;

    function ensureElement() {
      el = document.getElementById('momtv-virtual-cursor');
      if (el) return el;
      const target = document.body || document.documentElement;
      if (!target) return null;
      el = document.createElement('div');
      el.id = 'momtv-virtual-cursor';
      el.className = 'momtv-internal';
      el.innerHTML = `<svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 3L11.5 24L15.5 15.5L24 11.5L4 3Z" fill="#00f0ff" stroke="#FFFFFF" stroke-width="1.6" stroke-linejoin="round"/>
        <circle cx="15.5" cy="15.5" r="2.5" fill="#FFFFFF"/></svg>`;
      target.appendChild(el);
      return el;
    }

    function render() {
      const e = ensureElement();
      if (e) e.style.transform = `translate(${x - 4}px, ${y - 3}px)`;
    }

    function show() {
      const e = ensureElement();
      if (e) e.classList.add('visible');
      visible = true;
      resetAutoHide();
    }

    function hide() {
      if (el) el.classList.remove('visible');
      visible = false;
      clearTimeout(hideTimer);
      hideTimer = null;
    }

    function resetAutoHide() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hide, 4000);
    }

    function set(nx, ny) {
      x = Math.max(0, Math.min(window.innerWidth - 1, Math.round(nx)));
      y = Math.max(0, Math.min(window.innerHeight - 1, Math.round(ny)));
      render(); show();
    }

    function moveBy(dx, dy) {
      x = Math.max(0, Math.min(window.innerWidth - 1, Math.round(x + dx)));
      y = Math.max(0, Math.min(window.innerHeight - 1, Math.round(y + dy)));
      render(); show();

      try {
        const target = document.elementFromPoint(x, y);
        if (target && !target.closest('.momtv-internal, #momtv-virtual-cursor, #momtv-hud-pill, #momtv-player-action-bar, #momtv-exit-backdrop')) {
          const base = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, buttons: 0 };
          target.dispatchEvent(new PointerEvent('pointermove', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
          target.dispatchEvent(new MouseEvent('mousemove', base));
        }
      } catch (_) {}
    }

    function click() {
      show();
      const e = ensureElement();
      if (e) {
        e.classList.add('clicking');
        setTimeout(() => el && el.classList.remove('clicking'), 160);
      }
      playSound('select');

      try {
        const target = document.elementFromPoint(x, y);
        if (target && !target.closest('#momtv-virtual-cursor, .momtv-internal')) {
          if (isSearchInput(target) || ['INPUT', 'TEXTAREA'].includes(target.tagName)) { try { target.focus(); } catch (_) {} }
          dispatchPointerSequence(target, x, y);
          try { target.click(); } catch (_) {}

          const innerAction = target.querySelector('.play-button, [class*="play-btn" i], [class*="playButton" i], [data-testid*="play" i], [aria-label*="Play" i], button, a[href]');
          if (innerAction && innerAction !== target) { try { innerAction.click(); } catch (_) {} }
        }
      } catch (err) { console.warn('[MOM TV] cursor click failed:', err); }

      resetAutoHide();
    }

    return { set, moveBy, click, hide };
  })();

  /* ==========================================================================
     13. PUBLIC API — window.MomTV.handleKey(name)
     ========================================================================== */
  const ENGINE_DEBOUNCE_MS = 140;
  let lastHandledAt = 0;

  window.MomTV = {
    handleKey(rawKey) {
      const k = (rawKey || '').toLowerCase();
      const now = Date.now();

      if (ExitDialog.isOpen) return ExitDialog.handleKey(k);

      if (isYouTubeTVPage()) return k === 'back' ? BackNav.goBack() : false; // Cobalt handles the rest natively

      if (isInternalMomTVPage() || document.querySelector('.tv-shell')) return k === 'back' ? BackNav.goBack() : false;

      if (['up', 'down', 'left', 'right', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) VirtualCursor.hide();

      if (now - lastHandledAt < ENGINE_DEBOUNCE_MS) return true;

      const video = VideoControl.getActiveVideo();
      if (PlatformAdapters.dispatch(k, video)) { lastHandledAt = Date.now(); return true; }
      if (video && VideoControl.isVideoModeActive() && VideoControl.handleKey(k, video)) { lastHandledAt = Date.now(); return true; }

      if (['f', 'fullscreen'].includes(k)) {
        if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); HUD.show('Windowed', 'windowed'); }
        else {
          const target = (video && video.parentElement) || video || document.documentElement;
          if (target && target.requestFullscreen) { target.requestFullscreen().catch(() => {}); HUD.show('Fullscreen', 'fullscreen'); }
        }
        playSound('select');
        lastHandledAt = Date.now();
        return true;
      }

      if (['up', 'down', 'left', 'right', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        const dir = k.replace('arrow', '');
        const handled = SpatialNav.moveFocus(dir);
        if (handled) lastHandledAt = Date.now();
        return handled;
      }

      if (['enter', 'ok', 'select'].includes(k)) {
        if (!SpatialNav.getFocused() || !isElementInDoc(SpatialNav.getFocused())) SpatialNav.autoFocusFirst();
        const focused = SpatialNav.getFocused();
        if (focused) {
          playSound('select');
          HUD.show('Selected', 'check');
          const res = executeCardAction(focused);
          lastHandledAt = Date.now();
          return res;
        }
      }

      if (['back', 'escape'].includes(k)) {
        const res = BackNav.goBack();
        if (res) lastHandledAt = Date.now();
        return res;
      }

      if (['f12', 'devtools'].includes(k)) {
        toggleDevTools();
        lastHandledAt = Date.now();
        return true;
      }

      return false;
    },

    goBack: BackNav.goBack,
    isExitDialogOpen: () => ExitDialog.isOpen,
    showExitDialog: ExitDialog.show,
    hideExitDialog: ExitDialog.hide,
    getActiveVideo: VideoControl.getActiveVideo,
    setFocus: SpatialNav.setFocus,
    getFocusedElement: SpatialNav.getFocused,
    showHUD: HUD.show,
    showVideoOSD: HUD.showVideoProgress,
    showPlayerActionBar: PlayerActionBar.show,
    hidePlayerActionBar: PlayerActionBar.hide,
    playSound,
    dumpState() {
      return {
        videoMode: VideoControl.isVideoModeActive(),
        focusedCard: SpatialNav.getFocused()?.textContent?.slice(0, 50),
        totalCards: CardDiscovery.getFocusableCards().length,
        platform: 'generic',
        url: location.href,
      };
    },
    getFocusableCards: CardDiscovery.getFocusableCards,
    invalidateCardsCache: CardDiscovery.invalidate,
    executeCardAction,
    emulateMouseHover,
    moveCursor: VirtualCursor.moveBy,
    setCursor: VirtualCursor.set,
    clickCursor: VirtualCursor.click,
    PlatformAdapters,
    toggleDevTools
  };

  /* ==========================================================================
     13b. DEVTOOLS CONSOLE & INSPECTOR CONTROLLER
     ========================================================================== */
  function toggleDevTools() {
    try {
      if (window.eruda) {
        if (window.__erudaActive) {
          window.eruda.hide();
          window.__erudaActive = false;
        } else {
          window.eruda.show();
          window.__erudaActive = true;
        }
        return true;
      }

      const target = document.head || document.documentElement;
      if (!target) return false;

      const script = document.createElement('script');
      script.src = '/static/eruda.min.js';
      script.onload = () => {
        try {
          if (window.eruda) {
            window.eruda.init();
            window.eruda.show();
            window.__erudaActive = true;
          }
        } catch (_) {}
      };
      script.onerror = () => {
        const cdnScript = document.createElement('script');
        cdnScript.src = 'https://cdn.jsdelivr.net/npm/eruda@3.4.1/eruda.min.js';
        cdnScript.onload = () => {
          try {
            if (window.eruda) {
              window.eruda.init();
              window.eruda.show();
              window.__erudaActive = true;
            }
          } catch (_) {}
        };
        const cdnTarget = document.head || document.documentElement;
        if (cdnTarget) cdnTarget.appendChild(cdnScript);
      };
      target.appendChild(script);
      return true;
    } catch (_) {
      return false;
    }
  }

  /* ==========================================================================
     14. PHYSICAL KEYBOARD BRIDGE
     ========================================================================== */
  const KEY_MAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    Enter: 'ok', ' ': 'ok', Escape: 'back', Backspace: 'back', BrowserBack: 'back',
    MediaPlayPause: 'playpause', MediaPlay: 'play', MediaPause: 'pause',
    MediaTrackPrevious: 'rewind', MediaTrackNext: 'forward'
  };

  let lastKeydownAt = 0;

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && ['I', 'J', 'C'].includes((e.key || '').toUpperCase()))) {
        e.preventDefault();
        e.stopPropagation();
        toggleDevTools();
        return;
      }

      const mapped = KEY_MAP[e.key];
      if (!mapped) return;

      if (isInternalMomTVPage() || document.querySelector('.tv-shell')) {
        if (mapped === 'back' && window.MomTV.handleKey(mapped)) { e.preventDefault(); e.stopPropagation(); }
        return;
      }

      const now = Date.now();
      if (now - lastKeydownAt < ENGINE_DEBOUNCE_MS) { e.preventDefault(); e.stopPropagation(); return; }

      const active = document.activeElement;
      const isTyping = active && (['INPUT', 'TEXTAREA'].includes(active.tagName) || active.isContentEditable);
      if (isTyping && ['ArrowLeft', 'ArrowRight'].includes(e.key) && !active.classList.contains('momtv-focused-input')) return;

      lastKeydownAt = now;
      if (window.MomTV.handleKey(mapped)) { e.preventDefault(); e.stopPropagation(); }
    }, true);
  }

  console.log('✅ [MOM TV Companion 2.0] TV engine ready. window.MomTV is live.');
})();