/**
 * MOM TV LEANBACK COMPANION 3.1 — CONTENT ENGINE
 * Turns any website into a 10-foot TV app driven by a D-pad.
 *
 *  - Shadow-DOM overlay (focus ring, HUD, player bar, exit dialog, cursor) that page CSS cannot break
 *  - Spatial navigation over real interactive elements, with focus memory, modal/cookie-banner trapping,
 *    occlusion checks, carousel pagination and focus recovery on SPA re-renders
 *  - Text entry mode (physical keyboard or phone remote via typeText/backspace/submit)
 *  - Video remote with seek acceleration, per-site profiles, skip-intro, volume, speed, subtitles
 *  - Virtual cursor for trackpad mode
 *
 * Public API: window.MomTV.handleKey(name) plus helpers (see bottom).
 */
(function () {
  'use strict';

  // Only bail if our own superior engine already ran (our API is frozen + non-configurable).
  // If the CDP-injected tv-engine.js set __MOM_TV_ENGINE_LOADED__, we STILL run — we are
  // the better engine with Shadow DOM, counter-scaling, trail memory, modal trapping, etc.
  const _desc = Object.getOwnPropertyDescriptor(window, 'MomTV');
  if (_desc && !_desc.configurable && _desc.value && Object.isFrozen(_desc.value)) return;
  window.__MOM_TV_ENGINE_LOADED__ = true;
  window.__MomTVLoaded = true; // older host builds check this flag

  const HOME_URL = 'http://localhost:8765/tv';
  const HOME_ORIGIN = new URL(HOME_URL).origin;
  const KEY_DEBOUNCE_MS = 70;
  const OVERLAY_SIZE = 1; // overlay size relative to a 100%-zoom screen (try 1.15 for a bigger TV UI)
  const DIRS = ['up', 'down', 'left', 'right'];
  const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };
  // FIX: hoisted so the engine and the player-bar logic share one list (was declared too late for Video).
  const MEDIA_KEYS = ['play', 'pause', 'playpause', 'rewind', 'forward'];

  /* ==========================================================================
     0. HELPERS
     ========================================================================== */
  const host = () => (location.hostname || '').toLowerCase();
  const path = () => (location.pathname || '').toLowerCase();
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const noop = () => {};
  const isHomePage = () => (host() === 'localhost' || host() === '127.0.0.1') && (location.port === '8765' || path().startsWith('/tv'));
  const isYouTubeTV = () => host().includes('youtube.com') && path().startsWith('/tv');
  const isNativeTV = () => isHomePage() || isYouTubeTV() || Boolean(document.querySelector && document.querySelector('.tv-shell'));

  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) return '00:00';
    const s = Math.floor(sec % 60), m = Math.floor((sec / 60) % 60), h = Math.floor(sec / 3600);
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
  }

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    if (typeof el.checkVisibility === 'function') {
      try {
        return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, opacityProperty: true, visibilityProperty: true });
      } catch (_) { /* fall through */ }
    }
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) >= 0.08;
  }

  function scrollParent(el) {
    for (let n = el && el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      if (n.scrollHeight > n.clientHeight + 40) {
        const oy = getComputedStyle(n).overflowY;
        if (oy === 'auto' || oy === 'scroll') return n;
      }
    }
    return document.scrollingElement || document.documentElement;
  }

  function canScroll(sp, dir) {
    return dir === 'down' ? sp.scrollTop + sp.clientHeight < sp.scrollHeight - 2 : sp.scrollTop > 2;
  }

  /**
   * FIX: Chrome's KeyboardEvent constructor silently IGNORES keyCode/which in the init dict,
   * yet many player UIs (Netflix, Prime, Shaka-based players) still branch on e.which/e.keyCode.
   * Shadow the prototype getters with the intended values so legacy handlers work.
   */
  function keyEvent(type, opts) {
    const ev = new KeyboardEvent(type, opts);
    try {
      const code = opts.keyCode || 0;
      Object.defineProperty(ev, 'keyCode', { get: () => code });
      Object.defineProperty(ev, 'which', { get: () => code });
    } catch (_) { /* best effort */ }
    return ev;
  }

  /* ==========================================================================
     1. SINGLE-WINDOW KIOSK ENFORCEMENT
     ========================================================================== */
  (function enforceSingleWindow() {
    try {
      window.open = function (url) { if (url) location.href = url; return window; };
      document.addEventListener('click', (e) => {
        const a = e.target && e.target.closest ? e.target.closest('a') : null;
        if (a && a.target === '_blank') a.target = '_self';
      }, true);
      document.addEventListener('submit', (e) => {
        if (e.target && e.target.target === '_blank') e.target.target = '_self';
      }, true);
    } catch (_) { /* best-effort */ }
  })();

  /* ==========================================================================
     2. ICONS
     ========================================================================== */
  const stroke = (b) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${b}</svg>`;
  const solid = (b) => `<svg viewBox="0 0 24 24" fill="currentColor">${b}</svg>`;
  const SPEAKER = '<polygon points="4,9 8,9 12,5 12,19 8,15 4,15" fill="currentColor" stroke="none"/>';
  const ICONS = {
    tv: stroke('<rect x="2" y="7" width="20" height="12" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="19" x2="12" y2="21"/>'),
    home: stroke('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>'),
    close: stroke('<line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/>'),
    rewind: solid('<path d="M11 18V6l-8.5 6 8.5 6zm10 0V6l-8.5 6 8.5 6z"/>'),
    forward: solid('<path d="M13 6v12l8.5-6L13 6zM3 6v12l8.5-6L3 6z"/>'),
    play: solid('<path d="M8 5v14l11-7z"/>'),
    pause: solid('<rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/>'),
    mute: stroke(SPEAKER + '<line x1="17" y1="8" x2="22" y2="16"/><line x1="22" y1="8" x2="17" y2="16"/>'),
    unmute: stroke(SPEAKER + '<path d="M16 8a5 5 0 0 1 0 8"/><path d="M19 5a9 9 0 0 1 0 14"/>'),
    fullscreen: stroke('<path d="M4 9V5a1 1 0 0 1 1-1h4"/><path d="M20 9V5a1 1 0 0 0-1-1h-4"/><path d="M4 15v4a1 1 0 0 0 1 1h4"/><path d="M20 15v4a1 1 0 0 1-1 1h-4"/>'),
    windowed: stroke('<path d="M9 4H5a1 1 0 0 0-1 1v4"/><path d="M15 4h4a1 1 0 0 1 1 1v4"/><path d="M9 20H5a1 1 0 0 1-1-1v-4"/><path d="M15 20h4a1 1 0 0 0 1-1v-4"/>'),
    up: stroke('<path d="M6 15l6-6 6 6"/>'),
    down: stroke('<path d="M6 9l6 6 6-6"/>')
  };
  const icon = (n) => `<span class="i">${ICONS[n] || ''}</span>`;

  const BAR_ACTIONS = [
    { action: 'rewind', icon: 'rewind', label: '-10s' },
    { action: 'playpause', icon: 'play', label: 'Play/Pause' },
    { action: 'forward', icon: 'forward', label: '+10s' },
    { action: 'audio', icon: 'unmute', label: 'Audio' },
    { action: 'subtitles', icon: 'tv', label: 'CC' },
    { action: 'speed', icon: 'forward', label: '1x' },
    { action: 'fullscreen', icon: 'fullscreen', label: 'Fullscreen' }
  ];

  /* ==========================================================================
     3. PROCEDURAL AUDIO
     ========================================================================== */
  const playSound = (() => {
    let ctx = null, master = null;
    const TONES = {
      focus: ['sine', 540, 420, 0.035, 0.12], select: ['triangle', 640, 880, 0.08, 0.15],
      seek: ['sine', 720, 580, 0.03, 0.10], back: ['sine', 440, 320, 0.06, 0.10], dialog: ['sine', 520, 680, 0.09, 0.14]
    };
    const init = () => {
      if (ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC(); master = ctx.createGain(); master.connect(ctx.destination);
    };
    ['click', 'keydown', 'touchstart'].forEach((e) => window.addEventListener(e, init, { once: true, passive: true }));
    return (type) => {
      try {
        init();
        if (!ctx) return;
        if (ctx.state === 'suspended') ctx.resume().catch(noop);
        if (ctx.state !== 'running' || !TONES[type]) return;
        const [wave, f0, f1, dur, vol] = TONES[type];
        const t = ctx.currentTime, osc = ctx.createOscillator(), g = ctx.createGain();
        osc.type = wave;
        osc.frequency.setValueAtTime(f0, t);
        osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        osc.connect(g); g.connect(master); osc.start(t); osc.stop(t + dur);
      } catch (_) { /* audio unsupported */ }
    };
  })();

  /* ==========================================================================
     4. SHADOW-DOM UI (focus ring, HUD, player bar, exit dialog, cursor)
     Everything lives inside one closed shadow root, so site CSS can't restyle it
     and our overlay can never leak into the page's own element scans.
     ========================================================================== */
  const UI_CSS = `
:host{all:initial}
*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.i{display:inline-flex;width:1em;height:1em;vertical-align:-.14em}.i svg{width:100%;height:100%}
.glass{background:rgba(10,14,24,.94);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1.5px solid rgba(0,240,255,.55);color:#fff;box-shadow:0 20px 50px rgba(0,0,0,.85),0 0 35px rgba(0,240,255,.3)}
#ring{position:fixed;left:0;top:0;width:0;height:0;border:calc(4px*var(--s,1)) solid #00f0ff;border-radius:calc(14px*var(--s,1));opacity:0;pointer-events:none;box-shadow:0 0 calc(26px*var(--s,1)) rgba(0,240,255,.85),inset 0 0 calc(14px*var(--s,1)) rgba(0,240,255,.25);will-change:transform,width,height}
#ring.glide{transition:transform .14s cubic-bezier(.2,.9,.3,1),width .14s,height .14s}
#hud{position:fixed;top:10%;left:50%;padding:14px 28px;border-radius:20px;min-width:240px;text-align:center;opacity:0;pointer-events:none;transform:translate(-50%,-50%) scale(calc(.92*var(--s,1)));transition:opacity .2s,transform .2s}
#hud.on{opacity:1;transform:translate(-50%,-50%) scale(var(--s,1))}
.hud-h{display:flex;align-items:center;justify-content:center;gap:14px;font-size:22px;font-weight:700}
#hud-t{display:flex;align-items:center;gap:10px}#hud-t .i{width:24px;height:24px}
#hud-time{font-size:16px;font-weight:600;color:rgba(255,255,255,.85);font-variant-numeric:tabular-nums}
#hud-track{display:none;width:260px;height:6px;margin:8px auto 0;background:rgba(255,255,255,.2);border-radius:99px;overflow:hidden}
#hud-track.on{display:block}#hud-fill{height:100%;background:#00f0ff;box-shadow:0 0 12px #00f0ff}
#bar{position:fixed;bottom:8%;left:50%;padding:14px 26px;border-radius:24px;display:flex;flex-direction:column;align-items:center;gap:10px;opacity:0;pointer-events:none;transform-origin:50% 100%;transform:translate(-50%,35px) scale(var(--s,1));transition:opacity .22s,transform .22s}
#bar.on{opacity:1;pointer-events:auto;transform:translate(-50%,0) scale(var(--s,1))}
.bar-title{font-size:11px;font-weight:800;letter-spacing:2px;color:rgba(0,240,255,.85)}
.bar-btns{display:flex;gap:12px}
.abtn{display:flex;align-items:center;gap:8px;padding:10px 18px;border-radius:14px;font-size:14px;font-weight:700;color:#fff;background:rgba(255,255,255,.08);border:1.5px solid rgba(255,255,255,.16);cursor:pointer;outline:none;transition:transform .15s,background .15s,box-shadow .15s}
.abtn .i{width:18px;height:18px}
.abtn.focus{background:rgba(0,240,255,.6);border-color:#00f0ff;box-shadow:0 0 25px rgba(0,240,255,.95);transform:scale(1.12)}
#exit{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(4,7,15,.82);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);opacity:0;pointer-events:none;transition:opacity .22s}
#exit.on{opacity:1;pointer-events:auto}
.dlg{width:90%;max-width:580px;padding:44px 52px;text-align:center;color:#fff;border-radius:28px;background:linear-gradient(145deg,rgba(20,28,46,.94),rgba(10,14,24,.97));border:2px solid rgba(0,240,255,.5);box-shadow:0 35px 90px rgba(0,0,0,.95),0 0 50px rgba(0,240,255,.3);transform:scale(calc(.92*var(--s,1)));transition:transform .24s cubic-bezier(.2,.9,.3,1)}
#exit.on .dlg{transform:scale(var(--s,1))}
.dlg-icon{width:48px;height:48px;margin:0 auto 16px;color:#00f0ff;filter:drop-shadow(0 0 16px rgba(0,240,255,.6))}
.dlg h2{margin:0 0 14px;font-size:28px;font-weight:800}.dlg p{margin:0 0 36px;font-size:18px;line-height:1.5;color:rgba(255,255,255,.75)}
.dlg-row{display:flex;gap:22px;justify-content:center}
.btn{flex:1;min-width:170px;display:flex;align-items:center;justify-content:center;gap:10px;padding:16px 28px;border-radius:18px;font-size:19px;font-weight:700;color:#fff;background:rgba(255,255,255,.08);border:2px solid rgba(255,255,255,.2);cursor:pointer;outline:none;transition:transform .16s,background .16s,box-shadow .16s}
.btn .i{width:20px;height:20px}
.btn.red{background:linear-gradient(135deg,rgba(239,68,68,.38),rgba(185,28,28,.52));border-color:rgba(239,68,68,.65)}
.btn.focus{background:rgba(255,255,255,.4);border:3px solid #00f0ff;box-shadow:0 0 30px rgba(0,240,255,.95);transform:scale(1.08)}
.btn.red.focus{background:linear-gradient(135deg,rgba(239,68,68,.9),rgba(220,38,38,1))}
#cur{position:fixed;left:0;top:0;width:28px;height:28px;transform-origin:0 0;opacity:0;pointer-events:none;transition:opacity .22s;filter:drop-shadow(0 0 8px rgba(0,240,255,.95)) drop-shadow(0 0 18px rgba(0,240,255,.65));will-change:transform}
#cur.on{opacity:1}#cur.click svg{transform:scale(.8)}
.dbg{position:fixed;border:2px dashed rgba(255,214,0,.9);background:rgba(255,214,0,.06);color:#ffd600;font:700 11px monospace;pointer-events:none}.dbg.cur{border-color:#f0f;background:rgba(255,0,255,.1)}
`;

  const UI_BUTTONS = {}; // id -> handler, filled in by modules below

  const UI = (() => {
    let root = null, sh = null, scale = 1;
    function ensure() {
      if (root && root.isConnected) return sh;
      const parent = document.documentElement;
      if (!parent) return null;
      root = document.createElement('momtv-root');
      root.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:block;';
      sh = root.attachShadow({ mode: 'closed' });
      sh.innerHTML = `<style>${UI_CSS}</style>
        <div id="ring"></div><div id="dbg"></div>
        <div id="hud" class="glass"><div class="hud-h"><span id="hud-t"></span><span id="hud-time"></span></div><div id="hud-track"><div id="hud-fill"></div></div></div>
        <div id="bar" class="glass"><div class="bar-title">MOM TV PLAYER CONTROLS</div><div class="bar-btns">${
          BAR_ACTIONS.map((a) => `<button class="abtn" type="button" data-action="${a.action}">${icon(a.icon)}<span>${a.label}</span></button>`).join('')
        }</div></div>
        <div id="exit"><div class="dlg" role="dialog" aria-modal="true"><div class="dlg-icon">${ICONS.tv}</div><h2>Exit to MOM TV Home?</h2><p>Do you want to leave this app and return to Home?</p>
          <div class="dlg-row"><button id="b-cancel" class="btn" type="button">${icon('close')}<span>Cancel</span></button><button id="b-exit" class="btn red" type="button">${icon('home')}<span>Exit to Home</span></button></div></div></div>
        <div id="cur"><svg width="28" height="28" viewBox="0 0 28 28" fill="none"><path d="M4 3L11.5 24L15.5 15.5L24 11.5L4 3Z" fill="#00f0ff" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/><circle cx="15.5" cy="15.5" r="2.5" fill="#fff"/></svg></div>`;
      sh.addEventListener('click', (e) => {
        const b = e.target.closest && e.target.closest('button');
        if (!b) return;
        const fn = UI_BUTTONS[b.id || 'act:' + b.dataset.action];
        if (fn) fn();
      });
      root.style.setProperty('--s', String(scale));
      parent.appendChild(root);
      return sh;
    }
    const $ = (id) => { ensure(); return sh ? sh.getElementById(id) : null; };
    /** Counter-scale the overlay against browser zoom so it always renders at a fixed on-screen size. */
    function setZoom(factor) {
      scale = clamp(OVERLAY_SIZE / (factor || 1), 0.4, 2);
      if (root) root.style.setProperty('--s', String(scale));
    }
    return { ensure, $, setZoom, get scale() { return scale; } };
  })();

  const HUD = (() => {
    let timer = null;
    function paint(text, iconName, video, ms) {
      const hud = UI.$('hud');
      if (!hud) return;
      const t = UI.$('hud-t');
      t.innerHTML = (iconName ? icon(iconName) : '') + '<span></span>';
      t.lastChild.textContent = text;
      const time = UI.$('hud-time'), track = UI.$('hud-track'), fill = UI.$('hud-fill');
      if (video && isFinite(video.duration) && video.duration > 0) {
        time.textContent = `${fmt(video.currentTime)} / ${fmt(video.duration)}`;
        fill.style.width = clamp((video.currentTime / video.duration) * 100, 0, 100) + '%';
        track.classList.add('on');
      } else {
        time.textContent = '';
        track.classList.remove('on');
      }
      hud.classList.add('on');
      clearTimeout(timer);
      timer = setTimeout(() => hud.classList.remove('on'), ms);
    }
    return { show: (t, i) => paint(t, i, null, 1500), progress: (v, t, i) => v && paint(t, i, v, 1800) };
  })();

  /* ==========================================================================
     5. SITE PROFILES (per-service player behaviour)
     seek:'keys' = dispatch ArrowLeft/Right (Netflix throws on direct currentTime seeks)
     ========================================================================== */
  const SITES = [
    {
      name: 'netflix', match: () => host().includes('netflix.com'),
      inPlayer: () => path().startsWith('/watch') || !!document.querySelector('.watch-video'),
      seek: 'keys', keyTarget: '.watch-video, .nf-player-container, [data-uia="video-canvas"]',
      back: '[data-uia="control-back"], [data-uia="nfplayer-exit"], .button-nfplayerBack',
      skip: '[data-uia="player-skip-intro"], [data-uia="player-skip-recap"], [data-uia="next-episode-seamless-button"]',
      exitTo: 'https://www.netflix.com/browse'
    },
    {
      name: 'hotstar', match: () => host().includes('hotstar.com'),
      inPlayer: () => /\/(watch|play)/.test(path()) || !!document.querySelector('.player-container, .shaka-video-container'),
      back: 'button[aria-label*="Back" i], [data-testid*="back-btn" i], .player-back-btn', skip: 'button[aria-label*="Skip" i]'
    },
    {
      name: 'prime', match: () => host().includes('primevideo.com') || (host().includes('amazon.') && path().includes('/video/')),
      inPlayer: () => path().includes('/watch') || !!document.querySelector('.atvwebplayersdk-player-container'),
      back: '.atvwebplayersdk-back-button, button[aria-label*="Back" i]', skip: '.atvwebplayersdk-skipelement-button'
    },
    {
      name: 'jiocinema', match: () => host().includes('jiocinema.com'),
      inPlayer: () => path().includes('/watch') || !!document.querySelector('.player-wrapper, .player-container'),
      back: 'button[aria-label*="Back" i], button[class*="back" i]'
    }
  ];
  const Sites = {
    current: () => SITES.find((s) => s.match()) || null,
    inPlayer: () => { const s = Sites.current(); return !!(s && s.inPlayer()); }
  };

  function pressKey(key, keyCode) {
    const s = Sites.current();
    const target = (s && s.keyTarget && document.querySelector(s.keyTarget)) || document.body || document.documentElement;
    if (!target || !target.dispatchEvent) return;
    const opts = { key, code: key, keyCode, which: keyCode, bubbles: true, cancelable: true };
    // Dispatch once on the target; the event bubbles to document itself (dispatching on both fires handlers twice).
    // FIX: keyEvent() carries a real keyCode/where legacy player handlers need it.
    target.dispatchEvent(keyEvent('keydown', opts));
    target.dispatchEvent(keyEvent('keyup', opts));
  }

  function findSkipButton() {
    const s = Sites.current();
    const b = s && s.skip && document.querySelector(s.skip);
    if (b && isVisible(b)) return b;
    if (!Sites.inPlayer() && !document.fullscreenElement) return null;
    for (const el of document.querySelectorAll('button, [role="button"]')) {
      if (/^\s*skip( intro| recap| ads?| credits)?\s*$/i.test(el.textContent || '') && isVisible(el)) return el;
    }
    return null;
  }

  /* ==========================================================================
     6. CARD / ELEMENT DISCOVERY
     ========================================================================== */
  const Discovery = (() => {
    let cache = null, cacheAt = 0, timer = null;

    const INTERACTIVE = 'a[href],button:not([disabled]),input:not([type="hidden"]):not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,' +
      '[role="button"]:not([aria-disabled="true"]),[role="link"],[role="tab"],[role="menuitem"],[role="option"],[role="checkbox"],[role="radio"],[role="switch"],[role="slider"],[role="searchbox"],' +
      '[tabindex]:not([tabindex="-1"]),[onclick],[contenteditable="true"]';
    const HINTS = 'article,[role="article"],[data-testid*="card" i],[data-testid*="tile" i],[data-testid*="poster" i],[data-testid*="thumb" i],[data-uia*="card" i],[data-card],' +
      '[class*="card" i],[class*="poster" i],[class*="tile" i],[class*="thumb" i],[class*="slider-item" i],[class*="tray-item" i],' +
      'ytd-rich-item-renderer,ytd-video-renderer,ytd-grid-video-renderer,ytd-compact-video-renderer,ytd-playlist-renderer';
    const SELECTOR = INTERACTIVE + ',' + HINTS;
    const JUNK = 'footer,[role="contentinfo"],.ad-container,.ad-banner,.advertisement,[id*="google_ads" i],[class*="google_ads" i],[aria-hidden="true"],[inert],' +
      'ytd-channel-name,#avatar-link,#guide-button,#voice-search-button,#notification-preference-button';
    const MODAL = '[aria-modal="true"],dialog[open],[role="dialog"],[role="alertdialog"],#onetrust-banner-sdk,#onetrust-consent-sdk,#CybotCookiebotDialog,' +
      '[id*="cookie" i][id*="banner" i],[class*="cookie" i][class*="banner" i],[class*="consent" i][class*="banner" i],[class*="cookie-notice" i]';

    function reset() { cache = null; cacheAt = 0; }
    function invalidate() { clearTimeout(timer); timer = setTimeout(reset, 120); }

    if (typeof MutationObserver !== 'undefined') {
      const attach = () => {
        const r = document.body || document.documentElement;
        if (r) try { new MutationObserver(invalidate).observe(r, { childList: true, subtree: true }); } catch (_) {}
      };
      if (document.body) attach(); else document.addEventListener('DOMContentLoaded', attach, { once: true });
    }
    window.addEventListener('scroll', invalidate, { capture: true, passive: true });
    window.addEventListener('resize', invalidate, { passive: true });

    /** Topmost visible modal / cookie banner: when present, navigation is trapped inside it. */
    function modalScope() {
      let found = null;
      for (const m of document.querySelectorAll(MODAL)) {
        const r = m.getBoundingClientRect();
        if (r.width < 150 || r.height < 40 || !isVisible(m) || !m.querySelector(INTERACTIVE)) continue;
        if (m.matches('dialog[open]') || /fixed|sticky|absolute/.test(getComputedStyle(m).position)) found = m;
      }
      return found;
    }

    function looksClickable(el) {
      return !!(el.querySelector('a[href],button,[role="button"],[role="link"]') || el.hasAttribute('onclick') || getComputedStyle(el).cursor === 'pointer');
    }

    function isJunk(el) {
      try { if (el.closest(JUNK)) return true; } catch (_) {}
      if (el.childElementCount <= 3) {
        const t = (el.textContent || '').trim();
        if (t.length > 0 && t.length < 60 && /privacy policy|terms of (service|use)|copyright|cookie policy|all rights reserved/i.test(t)) return true;
      }
      return false;
    }

    /** True when the element lives inside a horizontally scrolling row (carousel), so off-screen items are real targets. */
    function inHScroller(el) {
      for (let n = el.parentElement, d = 0; n && n !== document.body && d < 10; n = n.parentElement, d++) {
        if (n.scrollWidth > n.clientWidth + 30 && ['auto', 'scroll', 'hidden'].includes(getComputedStyle(n).overflowX)) return true;
      }
      return false;
    }

    function scan(force) {
      const now = performance.now();
      if (!force && cache && now - cacheAt < 500) {
        const ok = cache.filter((e) => e.isConnected);
        // FIX: keep the pruned list so detached nodes never linger in the cache between invalidations.
        if (ok.length) { cache = ok; return ok; }
      }
      const scope = modalScope();
      const vw = innerWidth, vh = innerHeight, found = [];
      for (const el of (scope || document).querySelectorAll(SELECTOR)) {
        const r = el.getBoundingClientRect();
        if (r.width < 16 || r.height < 16) continue;
        if (r.bottom < -vh * 0.5 || r.top > vh * 2 || r.right < -vw || r.left > vw * 2) continue; // cheap window before costly checks
        if ((r.right < 0 || r.left > vw) && !inHScroller(el)) continue; // off-canvas drawers are not carousel items
        if (el.matches(INTERACTIVE)) {
          if (r.width > vw * 0.9 && r.height > vh * 0.6 && !el.matches('a,button,input,select,textarea')) continue;
        } else if (r.width > vw * 0.6 || r.height > vh * 0.7 || !looksClickable(el)) continue;
        if (isJunk(el) || !isVisible(el)) continue;
        found.push(el);
      }
      // Collapse nested candidates: a card wins over the link/button inside it when they're similar in size.
      const set = new Set(found), out = [];
      for (const el of found) {
        const er = el.getBoundingClientRect();
        let dominated = false;
        for (let p = el.parentElement, d = 0; p && d < 8; p = p.parentElement, d++) {
          if (!set.has(p)) continue;
          const pr = p.getBoundingClientRect();
          if (pr.width <= er.width * 1.8 && pr.height <= er.height * 3) { dominated = true; break; }
        }
        if (!dominated) out.push(el);
      }
      cache = out; cacheAt = now;
      return out;
    }

    function actionTarget(el) {
      if (el.matches('a[href],button,input,select,textarea,summary,[role="button"]')) return el;
      const a = Array.from(el.querySelectorAll('a[href]')).find((x) => {
        const h = x.getAttribute('href');
        return h && !h.startsWith('javascript:') && !h.startsWith('#');
      });
      return a || el.querySelector('button:not([disabled]),[role="button"]') || el;
    }

    return { scan, reset, invalidate, modalScope, actionTarget };
  })();

  /* ==========================================================================
     7. TEXT ENTRY (physical keyboard or phone remote)
     ========================================================================== */
  const Text = (() => {
    let editing = false;

    function isField(el) {
      if (!el || el.nodeType !== 1) return false;
      if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.getAttribute('role') === 'searchbox') return true;
      if (el.tagName !== 'INPUT') return false;
      return ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes((el.getAttribute('type') || 'text').toLowerCase());
    }
    function field() {
      const a = document.activeElement;
      if (isField(a)) return a;
      const f = Nav.getFocused();
      return isField(f) ? f : null;
    }
    function setValue(el, v) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
      if (setter && setter.set) setter.set.call(el, v); else el.value = v; // native setter keeps React/Vue in sync
    }
    function start(el, quiet) {
      editing = true;
      try { el.focus(); } catch (_) {}
      if (!quiet) HUD.show('Type on keyboard or phone', 'tv');
    }
    function stop() { editing = false; }

    function insert(str) {
      const el = field();
      if (!el) return false;
      start(el, true);
      if (el.isContentEditable) { document.execCommand('insertText', false, str); return true; }
      let s = el.value.length, e = s;
      try { if (el.selectionStart != null) { s = el.selectionStart; e = el.selectionEnd; } } catch (_) {}
      setValue(el, el.value.slice(0, s) + str + el.value.slice(e));
      try { el.setSelectionRange(s + str.length, s + str.length); } catch (_) {}
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: str, inputType: 'insertText' }));
      return true;
    }
    function backspace() {
      const el = field();
      if (!el) return false;
      start(el, true);
      if (el.isContentEditable) { document.execCommand('delete'); return true; }
      let s = el.value.length, e = s;
      try { if (el.selectionStart != null) { s = el.selectionStart; e = el.selectionEnd; } } catch (_) {}
      if (s === e && s > 0) s -= 1;
      setValue(el, el.value.slice(0, s) + el.value.slice(e));
      try { el.setSelectionRange(s, s); } catch (_) {}
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
      return true;
    }
    function moveCaret(d) {
      const el = field();
      if (!el || el.isContentEditable) return;
      try { const p = clamp((el.selectionStart || 0) + d, 0, el.value.length); el.setSelectionRange(p, p); } catch (_) {}
    }
    function submit() {
      const el = field();
      if (!el) return false;
      const o = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
      // FIX: keyEvent() carries a real keyCode 13 for the many search boxes that test e.which.
      const proceed = el.dispatchEvent(keyEvent('keydown', o));
      el.dispatchEvent(keyEvent('keypress', o));
      el.dispatchEvent(keyEvent('keyup', o));
      // Synthetic Enter never triggers implicit form submission, so do it unless the page handled the key itself.
      if (proceed && el.form) { try { el.form.requestSubmit(); } catch (_) { try { el.form.submit(); } catch (__) {} } }
      return true;
    }
    return { get editing() { return editing; }, isField, start, stop, insert, backspace, moveCaret, submit };
  })();

  /* ==========================================================================
     8. ACTIVATION (one real click, not two)
     ========================================================================== */
  function pointerSeq(t, x, y) {
    if (x == null) { const r = t.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; }
    const base = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
    const ptr = { pointerId: 1, pointerType: 'mouse', isPrimary: true };
    // FIX: many players only enable click targets once hovered — send the natural pre-click hover
    // sequence first so hover-gated controls actually respond to activation.
    t.dispatchEvent(new PointerEvent('pointerover', { ...base, ...ptr, buttons: 0 }));
    t.dispatchEvent(new MouseEvent('mouseover', { ...base, buttons: 0 }));
    t.dispatchEvent(new PointerEvent('pointermove', { ...base, ...ptr, buttons: 0 }));
    t.dispatchEvent(new MouseEvent('mousemove', { ...base, buttons: 0 }));
    t.dispatchEvent(new PointerEvent('pointerdown', { ...base, ...ptr, button: 0, buttons: 1 }));
    t.dispatchEvent(new MouseEvent('mousedown', { ...base, button: 0, buttons: 1 }));
    t.dispatchEvent(new PointerEvent('pointerup', { ...base, ...ptr, button: 0, buttons: 0 }));
    t.dispatchEvent(new MouseEvent('mouseup', { ...base, button: 0, buttons: 0 }));
    // NOTE: the click itself is sent by the caller via .click() exactly once.
  }

  function openSelect(sel) {
    try { sel.showPicker(); return; } catch (_) {}
    if (!sel.options.length) return;
    sel.selectedIndex = (sel.selectedIndex + 1) % sel.options.length;
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    HUD.show(sel.options[sel.selectedIndex].text);
  }

  function activate(el) {
    const t = Discovery.actionTarget(el);
    if (Text.isField(t)) { Text.start(t); return true; }
    if (t.tagName === 'SELECT') { openSelect(t); return true; }
    if (t.tagName === 'INPUT' && t.type === 'range') return true;
    try { pointerSeq(t); t.click(); } catch (err) { console.warn('[MOM TV] activate failed', err); try { t.click(); } catch (_) {} }
    return true;
  }

  function emulateHover(el, on) {
    if (!el || !el.getBoundingClientRect) return;
    try {
      const r = el.getBoundingClientRect();
      const base = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, buttons: 0 };
      const ptr = { pointerType: 'mouse', isPrimary: true };
      if (on) {
        // FIX: real browsers fire mouseover/mouseenter too — React/jQuery hover menus listen for the
        // mouse* family, not just pointer events, so card previews and dropdowns now open correctly.
        el.dispatchEvent(new PointerEvent('pointerover', { ...base, ...ptr }));
        el.dispatchEvent(new PointerEvent('pointerenter', { ...base, ...ptr }));
        el.dispatchEvent(new MouseEvent('mouseover', base));
        el.dispatchEvent(new MouseEvent('mouseenter', base));
        el.dispatchEvent(new MouseEvent('mousemove', base));
      } else {
        // FIX: also fire the full "out" cycle (pointerout/mouseout) so hover menus close again.
        el.dispatchEvent(new PointerEvent('pointerout', { ...base, ...ptr }));
        el.dispatchEvent(new PointerEvent('pointerleave', { ...base, ...ptr }));
        el.dispatchEvent(new MouseEvent('mouseout', base));
        el.dispatchEvent(new MouseEvent('mouseleave', base));
      }
    } catch (_) {}
  }

  /* ==========================================================================
     9. SPATIAL NAVIGATION
     ========================================================================== */
  const Nav = (() => {
    let focused = null, lastRect = null, rafId = 0, glideTimer = null, hoverTimer = null, hovered = null, lastUrl = location.pathname + location.search;
    let moveToken = 0;                       // FIX: cancels stale edge() retries that could steal focus back
    let ringEl = null, drawn = null;         // PERF: cached ring node + dirty-check for style writes
    const trail = new WeakMap(); // el -> {dir, el}: pressing `dir` from el returns to the element we came from

    const ring = () => (ringEl && ringEl.isConnected ? ringEl : (ringEl = UI.$('ring')));

    function loop() {
      rafId = 0; // PERF: the loop now self-terminates when idle instead of spinning at 60fps forever
      const rEl = ring();
      if (!rEl) return;
      if (!focused) { rEl.style.opacity = '0'; drawn = null; return; }
      if (!focused.isConnected) { recover(); if (!rafId) rafId = requestAnimationFrame(loop); return; }
      const r = focused.getBoundingClientRect();
      if (!r.width || !r.height) { rEl.style.opacity = '0'; if (!rafId) rafId = requestAnimationFrame(loop); return; }
      lastRect = r;
      rEl.style.opacity = '1';
      const pad = 6 * UI.scale;
      const w = r.width + pad * 2, h = r.height + pad * 2, x = r.left - pad, y = r.top - pad;
      // PERF: skip redundant style writes when nothing moved (common while a dialog/HUD is up).
      if (!drawn || drawn.x !== x || drawn.y !== y || drawn.w !== w || drawn.h !== h) {
        drawn = { x, y, w, h };
        rEl.style.width = w + 'px';
        rEl.style.height = h + 'px';
        rEl.style.transform = `translate(${x}px,${y}px)`;
      }
      if (!rafId) rafId = requestAnimationFrame(loop);
    }

    /** The focused element was removed by a re-render: jump to whatever is nearest to where it was. */
    function recover() {
      const ref = lastRect;
      focused = null;
      if (!ref) return;
      const cx = ref.left + ref.width / 2, cy = ref.top + ref.height / 2;
      let best = null, bd = Infinity;
      for (const el of Discovery.scan(true)) {
        const r = el.getBoundingClientRect();
        const d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
        if (d < bd) { bd = d; best = el; }
      }
      if (best) setFocus(best, { silent: true, instant: true });
    }

    function reveal(el) {
      const r = el.getBoundingClientRect(), vh = innerHeight, vw = innerWidth;
      if (r.top < vh * 0.12 || r.bottom > vh * 0.88 || r.left < vw * 0.03 || r.right > vw * 0.97) {
        el.scrollIntoView({ block: r.height > vh * 0.8 ? 'start' : 'center', inline: 'center', behavior: 'smooth' });
      }
    }

    function unhover() {
      clearTimeout(hoverTimer);
      if (hovered) { emulateHover(hovered, false); hovered = null; }
    }
    /** Hover previews are only triggered once the user rests on an item, and never on nav bars:
     *  firing them on every step opened dropdowns / expanded cards that then covered the next target. */
    function scheduleHover(el) {
      clearTimeout(hoverTimer);
      if (el.closest('header,nav,[role="navigation"]') || Text.isField(el)) return;
      hoverTimer = setTimeout(() => { if (focused === el) { emulateHover(el, true); hovered = el; } }, 450);
    }

    function setFocus(el, opts) {
      opts = opts || {};
      moveToken++; // FIX: any focus change invalidates pending edge() retries
      unhover();
      if (focused && focused !== el) Text.stop();
      focused = el;
      drawn = null;
      if (!el) return;
      if (!rafId) rafId = requestAnimationFrame(loop);
      const rEl = ring();
      if (rEl && !opts.instant) {
        rEl.classList.add('glide');
        clearTimeout(glideTimer);
        glideTimer = setTimeout(() => rEl.classList.remove('glide'), 220);
      }
      try { el.focus({ preventScroll: true }); } catch (_) {}
      reveal(el);
      scheduleHover(el);
      if (!opts.silent) playSound('focus');
    }

    /** Sample several points: a hover popup can cover a neighbour's centre while its corners stay hittable. */
    function reachable(el, r) {
      let sampled = 0;
      for (const [fx, fy] of [[0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) {
        const x = r.left + r.width * fx, y = r.top + r.height * fy;
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue; // off-screen: cannot be tested
        sampled++;
        const t = document.elementFromPoint(x, y);
        if (!t || t === el || el.contains(t) || t.contains(el)) return true;
      }
      return sampled === 0;
    }

    const describe = (el) => el.tagName.toLowerCase() + ' "' + (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28) + '"';

    /**
     * Two-tier directional search.
     *  1) "band": candidates that share a row (left/right) or a column (up/down) with the current element; nearest wins.
     *     Right therefore always moves along the row and can never drop to the next one while a right-hand neighbour exists.
     *  2) "cone": only when the band is empty, candidates inside a ~60 degree cone (irregular layouts, sidebars).
     * Nothing else qualifies, so at the end of a row Right paginates / stays instead of jumping diagonally.
     */
    function pick(dir) {
      const from = focused, fr = from.getBoundingClientRect();
      const back = trail.get(from);
      if (back && back.dir === dir && back.el.isConnected && isVisible(back.el)) return back.el;

      const horiz = dir === 'left' || dir === 'right', fwd = dir === 'right' || dir === 'down';
      const axes = (r) => (horiz ? { s: r.left, e: r.right, cs: r.top, ce: r.bottom } : { s: r.top, e: r.bottom, cs: r.left, ce: r.right });
      const a = axes(fr), aC = (a.s + a.e) / 2, aCC = (a.cs + a.ce) / 2;
      const band = [], cone = [];

      for (const el of Discovery.scan()) {
        if (el === from || el.contains(from) || from.contains(el)) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const b = axes(r), bC = (b.s + b.e) / 2, bCC = (b.cs + b.ce) / 2;
        let gap;
        if (fwd) { if (bC <= aC + 1 || b.e <= a.e - 1) continue; gap = Math.max(0, b.s - a.e); }
        else { if (bC >= aC - 1 || b.s >= a.s + 1) continue; gap = Math.max(0, a.s - b.e); }
        const overlap = Math.min(a.ce, b.ce) - Math.max(a.cs, b.cs);
        const shared = Math.min(a.ce - a.cs, b.ce - b.cs);
        const crossCentre = Math.abs(bCC - aCC);
        if (overlap >= shared * 0.4) {
          band.push({ el, r, score: gap + crossCentre * 0.25 });
        } else {
          const main = Math.abs(bC - aC);
          if (crossCentre <= main * 1.7 + 40) cone.push({ el, r, score: gap + Math.max(0, -overlap) * 3 + crossCentre * 0.35 + main * 0.12 });
        }
      }

      const pool = band.length ? band : cone;
      pool.sort((x, y) => x.score - y.score);
      const top = pool.slice(0, 6);
      const hit = top.find((c) => reachable(c.el, c.r)) || top[0]; // an overlapping popup must never dead-end navigation
      if (Debug.on) console.log('[MomTV]', dir, describe(from), '->', hit ? describe(hit.el) : 'none', band.length ? '(row/column)' : '(cone)', top.length + ' candidates');
      return hit ? hit.el : null;
    }

    function paginate(dir) {
      const sel = dir === 'right'
        ? 'button[aria-label*="next" i],button[aria-label*="right" i],button[aria-label*="forward" i],[class*="chevron-right" i],[class*="arrow-right" i],[class*="next-button" i],[class*="slider-right" i],[data-testid*="next" i],[data-uia*="next" i],.next-btn,.slider-button-next'
        : 'button[aria-label*="prev" i],button[aria-label*="previous" i],button[aria-label*="left" i],[class*="chevron-left" i],[class*="arrow-left" i],[class*="prev-button" i],[class*="slider-left" i],[data-testid*="prev" i],[data-uia*="prev" i],.prev-btn,.slider-button-prev';
      for (let n = focused.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
        const btn = n.querySelector(sel);
        if (btn && isVisible(btn)) { btn.click(); return true; }
        if (n.scrollWidth > n.clientWidth + 30 && ['auto', 'scroll', 'hidden'].includes(getComputedStyle(n).overflowX)) {
          n.scrollBy({ left: Math.round(n.clientWidth * 0.75) * (dir === 'right' ? 1 : -1), behavior: 'smooth' });
          return true;
        }
      }
      return false;
    }

    /** No neighbour in that direction: paginate a carousel or scroll, then retry once new content is in. */
    function edge(dir) {
      playSound('focus');
      const tok = moveToken; // FIX: capture the generation — if focus moves meanwhile, drop the stale retry
      const retry = (ms) => setTimeout(() => {
        if (tok !== moveToken) return; // user navigated / route changed while we waited
        Discovery.reset();
        if (!focused) return;
        const n = pick(dir);
        if (n) { trail.set(n, { dir: OPP[dir], el: focused }); setFocus(n); }
      }, ms);
      if (dir === 'left' || dir === 'right') {
        if (paginate(dir)) { HUD.show(dir === 'right' ? 'More' : 'Previous'); retry(260); }
        return true;
      }
      const sp = scrollParent(focused);
      if (canScroll(sp, dir)) {
        sp.scrollBy({ top: Math.round(innerHeight * 0.55) * (dir === 'down' ? 1 : -1), behavior: 'smooth' });
        HUD.show(dir === 'down' ? 'Loading More...' : 'Scrolling Up', dir);
        retry(320);
      }
      return true;
    }

    function moveFocus(dir) {
      moveToken++; // FIX: a fresh user move cancels any retry still pending from the previous press
      if (!focused || !focused.isConnected) { autoFocus(); return !!focused; }
      if (focused.tagName === 'INPUT' && focused.type === 'range' && (dir === 'left' || dir === 'right')) {
        dir === 'left' ? focused.stepDown() : focused.stepUp();
        focused.dispatchEvent(new Event('input', { bubbles: true }));
        focused.dispatchEvent(new Event('change', { bubbles: true }));
        playSound('seek');
        return true;
      }
      const next = pick(dir);
      if (next) { trail.set(next, { dir: OPP[dir], el: focused }); setFocus(next); return true; }
      return edge(dir);
    }

    function autoFocus() {
      if (isNativeTV()) return false;
      if (focused && focused.isConnected) return true;
      let best = null, bs = Infinity;
      for (const el of Discovery.scan(true)) {
        const r = el.getBoundingClientRect();
        if (r.top < 0 || r.left < 0 || r.top >= innerHeight || r.left >= innerWidth) continue;
        const s = r.top * 1.5 + r.left + (el.closest('header,nav,[role="navigation"]') ? 5000 : 0); // prefer content over chrome
        if (s < bs) { bs = s; best = el; }
      }
      if (best) { setFocus(best, { silent: true }); return true; }
      return false;
    }

    /** SPAs render late: keep trying for ~8s until something focusable shows up. */
    function startAutoFocus() {
      if (isNativeTV()) return; // PERF: launcher / YouTube TV pages never use our focus ring — skip polling
      let tries = 0;
      const t = setInterval(() => { if (autoFocus() || ++tries > 16) clearInterval(t); }, 500);
    }

    function reset() { moveToken++; focused = null; lastRect = null; drawn = null; Text.stop(); Discovery.reset(); startAutoFocus(); }

    // SPA route change detection (only reset when the path really changed — some apps replaceState constantly).
    const onNav = () => {
      const u = location.pathname + location.search;
      if (u !== lastUrl) { lastUrl = u; reset(); }
    };
    // FIX: some sites freeze `history` — a failed wrap used to crash the whole engine, so guard it.
    ['pushState', 'replaceState'].forEach((fn) => {
      try {
        const orig = history[fn];
        history[fn] = function () { const r = orig.apply(this, arguments); setTimeout(onNav, 0); return r; };
      } catch (_) { /* history frozen by the page — popstate still works */ }
    });
    window.addEventListener('popstate', () => setTimeout(onNav, 0));

    return { moveFocus, setFocus, autoFocus, startAutoFocus, reset, getFocused: () => focused };
  })();

  /* ==========================================================================
     10. VIDEO CONTROL + PLAYER ACTION BAR
     ========================================================================== */
  const Bar = (() => {
    let visible = false, idx = 1, timer = null;
    const SPEEDS = [1, 1.25, 1.5, 2, 0.75];

    const bar = () => UI.$('bar');
    function paint() {
      const b = bar();
      if (b) b.querySelectorAll('.abtn').forEach((el, i) => el.classList.toggle('focus', i === idx));
    }
    function autoHide() { clearTimeout(timer); timer = setTimeout(hide, 6000); }
    function show() {
      const b = bar();
      if (!b) return;
      visible = true; paint(); b.classList.add('on'); playSound('focus'); autoHide();
    }
    function hide() {
      const b = bar();
      if (b) b.classList.remove('on');
      visible = false; clearTimeout(timer);
    }
    function setLabel(action, iconName, label) {
      const b = bar() && bar().querySelector(`[data-action="${action}"]`);
      if (!b) return;
      if (iconName) b.querySelector('.i').innerHTML = ICONS[iconName];
      if (label) b.querySelector('span:not(.i)').textContent = label;
    }
    function execute(action) {
      const v = Video.active();
      if (!v) return;
      autoHide();
      switch (action) {
        case 'rewind': Video.seek(v, -10); break;
        case 'forward': Video.seek(v, 10); break;
        case 'playpause': Video.toggle(v); break;
        case 'audio':
          v.muted = !v.muted;
          setLabel('audio', v.muted ? 'mute' : 'unmute', v.muted ? 'Muted' : 'Audio');
          HUD.show(v.muted ? 'Muted' : 'Unmuted', v.muted ? 'mute' : 'unmute');
          break;
        case 'subtitles': {
          const tr = v.textTracks && v.textTracks[0];
          if (tr) { tr.mode = tr.mode === 'showing' ? 'disabled' : 'showing'; HUD.show(tr.mode === 'showing' ? 'Subtitles ON' : 'Subtitles OFF', 'tv'); }
          else HUD.show('No Subtitles', 'tv');
          break;
        }
        case 'speed': {
          const next = SPEEDS[(SPEEDS.indexOf(v.playbackRate) + 1) % SPEEDS.length];
          v.playbackRate = next;
          setLabel('speed', null, next + 'x');
          HUD.show(`Speed ${next}x`, 'forward');
          break;
        }
        case 'fullscreen': Video.toggleFullscreen(v); break;
      }
      playSound('select');
    }
    function handleKey(k) {
      autoHide();
      if (k === 'left') { idx = Math.max(0, idx - 1); paint(); playSound('focus'); return true; }
      if (k === 'right') { idx = Math.min(BAR_ACTIONS.length - 1, idx + 1); paint(); playSound('focus'); return true; }
      if (k === 'ok') { execute(BAR_ACTIONS[idx].action); return true; }
      if (k === 'up' || k === 'back' || k === 'menu') { hide(); playSound('back'); return true; }
      if (k === 'down') return true;
      return false;
    }
    BAR_ACTIONS.forEach((a, i) => { UI_BUTTONS['act:' + a.action] = () => { idx = i; paint(); execute(a.action); }; });
    return { get visible() { return visible; }, show, hide, handleKey };
  })();

  const Video = (() => {
    const acc = { dir: 0, count: 0, at: 0 };
    let cached = null, cachedAt = 0, engaged = false;

    const accelSeconds = (n) => (n <= 1 ? 10 : n === 2 ? 20 : n === 3 ? 30 : n === 4 ? 60 : 60 + (n - 4) * 30);

    /** Largest / most relevant <video> on the page (fullscreen and playing ones are preferred). */
    function active() {
      const now = Date.now();
      if (cached && cached.isConnected && now - cachedAt < 200) return cached;
      const fs = document.fullscreenElement;
      let best = null, ba = -1;
      for (const v of document.querySelectorAll('video')) {
        const r = v.getBoundingClientRect();
        let a = r.width * r.height;
        if (fs && (fs === v || fs.contains(v))) a += 1e9;
        if (!v.paused) a *= 1.5;
        if (a > ba) { ba = a; best = v; }
      }
      cached = best; cachedAt = now;
      return best;
    }

    /** D-pad means "seek" only for a real player — not for autoplaying hero trailers on a browse page. */
    function inMode(v) {
      if (!v) return false;
      const fs = document.fullscreenElement;
      if (fs && (fs === v || fs.contains(v))) return true;
      if (Sites.inPlayer() || Bar.visible) return true;
      const r = v.getBoundingClientRect();
      if (r.width * r.height < innerWidth * innerHeight * 0.5) return false;
      if (v.loop || (v.muted && v.autoplay)) return false;
      return !v.paused || engaged;
    }

    function seek(v, delta) {
      const s = Sites.current();
      let label;
      if (s && s.seek === 'keys') { pressKey(delta < 0 ? 'ArrowLeft' : 'ArrowRight', delta < 0 ? 37 : 39); label = delta < 0 ? '-10s' : '+10s'; }
      else { v.currentTime = clamp(v.currentTime + delta, 0, isFinite(v.duration) ? v.duration : Infinity); label = (delta < 0 ? '-' : '+') + Math.abs(delta) + 's'; }
      HUD.progress(v, label, delta < 0 ? 'rewind' : 'forward');
      playSound('seek');
    }

    function toggle(v) {
      const willPlay = v.paused;
      if (willPlay) v.play().catch(noop); else v.pause();
      engaged = true;
      HUD.progress(v, willPlay ? 'Play' : 'Pause', willPlay ? 'play' : 'pause');
      playSound('select');
    }

    function toggleFullscreen(v) {
      if (document.fullscreenElement) { document.exitFullscreen().catch(noop); HUD.show('Windowed', 'windowed'); }
      else {
        const t = (v && v.parentElement) || v || document.documentElement;
        if (t.requestFullscreen) { t.requestFullscreen().catch(noop); HUD.show('Fullscreen', 'fullscreen'); }
      }
      playSound('select');
    }

    function volume(v, d) {
      v.muted = false;
      v.volume = clamp(v.volume + d, 0, 1);
      HUD.show(`Volume ${Math.round(v.volume * 100)}%`, v.volume === 0 ? 'mute' : 'unmute');
    }

    function handleKey(k, v) {
      // FIX: while the action bar is open it owns the navigation keys, but pure MEDIA keys
      // (play/pause/track keys) now pass through and still control the video — previously
      // they were swallowed by the bar and did nothing.
      if (Bar.visible && !MEDIA_KEYS.includes(k)) return Bar.handleKey(k);
      if (k === 'left' || k === 'right' || k === 'rewind' || k === 'forward') {
        const dir = k === 'left' || k === 'rewind' ? -1 : 1, now = Date.now();
        acc.count = acc.dir === dir && now - acc.at < 850 ? acc.count + 1 : 1;
        acc.dir = dir; acc.at = now;
        seek(v, dir * accelSeconds(acc.count)); // accelerates while the key keeps being pressed
        engaged = true;
        return true;
      }
      if (k === 'ok' || k === 'playpause') { toggle(v); return true; }
      if (k === 'play') { if (v.paused) toggle(v); return true; }
      if (k === 'pause') { if (!v.paused) toggle(v); return true; }
      if (k === 'down' || k === 'menu') { Bar.show(); return true; }
      if (k === 'up') {
        const skip = findSkipButton();
        if (skip) { skip.click(); HUD.show('Skipped', 'forward'); playSound('select'); return true; }
        return false; // let up fall through to normal navigation
      }
      return false;
    }

    return { active, inMode, handleKey, seek, toggle, toggleFullscreen, volume, disengage: () => { engaged = false; } };
  })();

  /* ==========================================================================
     11. EXIT DIALOG + BACK NAVIGATION
     ========================================================================== */
  const ExitDialog = (() => {
    let open = false, idx = 0, prev = null;
    const paint = () => {
      const c = UI.$('b-cancel'), e = UI.$('b-exit');
      if (c) c.classList.toggle('focus', idx === 0);
      if (e) e.classList.toggle('focus', idx === 1);
    };
    const goHome = () => { playSound('select'); location.href = HOME_URL; };
    function show() {
      if (isHomePage() || open) return;
      const el = UI.$('exit');
      if (!el) return;
      prev = Nav.getFocused(); open = true; idx = 0;
      el.classList.add('on'); paint(); playSound('dialog');
    }
    function hide() {
      const el = UI.$('exit');
      if (el) el.classList.remove('on');
      if (!open) return;
      open = false; playSound('back');
      if (prev && prev.isConnected) Nav.setFocus(prev, { silent: true, instant: true });
    }
    function handleKey(k) {
      if (k === 'left') { idx = 0; paint(); playSound('focus'); }
      else if (k === 'right') { idx = 1; paint(); playSound('focus'); }
      else if (k === 'ok') { idx === 1 ? goHome() : hide(); }
      else if (k === 'back') hide();
      return true; // swallow everything else so focus can't leak to the page
    }
    UI_BUTTONS['b-cancel'] = hide;
    UI_BUTTONS['b-exit'] = goHome;
    return { get isOpen() { return open; }, show, hide, handleKey };
  })();

  const BackNav = (() => {
    let lastPress = 0, presses = 0;

    const atRoot = () => ['/', '', '/browse', '/home', '/in', '/in/home', '/in/explore', '/tv'].includes(path()) && !location.search.includes('watch');

    function closeModal(scope) {
      const btn = scope.querySelector('[aria-label*="close" i],[aria-label*="dismiss" i],[data-dismiss],[data-testid*="close" i],button.close,.close');
      if (btn && isVisible(btn)) { btn.click(); return true; }
      if (/cookie|consent|onetrust/i.test(scope.id + ' ' + scope.className)) return false; // banners have no Escape
      const o = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
      // FIX: real keyCode (see keyEvent) plus the keyup half of the cycle — several frameworks
      // (and some modal libraries) only react to a full key press.
      [document.activeElement, scope].forEach((t) => {
        if (!t || !t.dispatchEvent) return;
        t.dispatchEvent(keyEvent('keydown', o));
        t.dispatchEvent(keyEvent('keyup', o));
      });
      return true;
    }
    function goBack() {
      playSound('back');
      if (ExitDialog.isOpen) { ExitDialog.hide(); return true; }
      if (Bar.visible) { Bar.hide(); return true; }
      if (Text.editing) { Text.stop(); return true; }

      const scope = Discovery.modalScope();
      if (scope && closeModal(scope)) return true;

      if (document.fullscreenElement) { document.exitFullscreen().catch(noop); HUD.show('Exit Fullscreen', 'windowed'); return true; }

      const v = Video.active();
      if (v && !v.paused && Video.inMode(v)) { v.pause(); HUD.show('Paused', 'pause'); Video.disengage(); return true; }

      const site = Sites.current();
      if (site && site.inPlayer()) {
        const b = site.back && document.querySelector(site.back);
        if (b) { b.click(); return true; }
        if (site.exitTo) { location.href = site.exitTo; return true; }
      }

      const now = Date.now();
      presses = now - lastPress < 1800 ? presses + 1 : 1;
      lastPress = now;
      if (atRoot() || presses >= 2 || history.length <= 1) { ExitDialog.show(); return true; }
      if (!isHomePage()) { history.back(); return true; }
      ExitDialog.show();
      return true;
    }
    return { goBack };
  })();

  /* ==========================================================================
     12. VIRTUAL CURSOR (Magic Trackpad mode)
     ========================================================================== */
  const Cursor = (() => {
    let x = Math.round(innerWidth / 2), y = Math.round(innerHeight / 2), timer = null;

    function render() {
      const c = UI.$('cur');
      if (!c) return;
      const sc = UI.scale;
      c.style.transform = `translate(${x - 4 * sc}px,${y - 3 * sc}px) scale(${sc})`;
      c.classList.add('on');
      clearTimeout(timer);
      timer = setTimeout(hide, 4000);
    }
    function hide() { const c = UI.$('cur'); if (c) c.classList.remove('on'); }
    const under = () => {
      const t = document.elementFromPoint(x, y);
      return t && t.tagName !== 'MOMTV-ROOT' ? t : null;
    };

    function set(nx, ny) { x = clamp(Math.round(nx), 0, innerWidth - 1); y = clamp(Math.round(ny), 0, innerHeight - 1); render(); }
    function moveBy(dx, dy) {
      set(x + dx, y + dy);
      if (y > innerHeight - 40 && dy > 0) window.scrollBy(0, 40);      // edge scrolling
      else if (y < 40 && dy < 0) window.scrollBy(0, -40);
      try {
        const t = under();
        if (t) {
          const base = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, buttons: 0 };
          t.dispatchEvent(new PointerEvent('pointermove', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
          t.dispatchEvent(new MouseEvent('mousemove', base));
        }
      } catch (_) {}
    }
    function click() {
      render();
      const c = UI.$('cur');
      if (c) { c.classList.add('click'); setTimeout(() => c.classList.remove('click'), 160); }
      playSound('select');
      try {
        const t = under();
        if (!t) return;
        if (Text.isField(t)) Text.start(t, true);
        pointerSeq(t, x, y);
        t.click();
      } catch (err) { console.warn('[MOM TV] cursor click failed', err); }
    }
    function scroll(dy) {
      const t = under();
      scrollParent(t || document.body).scrollBy({ top: dy });
    }
    return { set, moveBy, click, scroll, hide };
  })();

  /* ==========================================================================
     13. ENGINE — key normalisation and dispatch
     ========================================================================== */
  const ALIASES = {
    arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right',
    enter: 'ok', select: 'ok', space: 'ok', ' ': 'ok', escape: 'back', backspace: 'back', browserback: 'back',
    mediaplaypause: 'playpause', mediaplay: 'play', mediapause: 'pause', mediatrackprevious: 'rewind', mediatracknext: 'forward',
    audiovolumeup: 'volup', audiovolumedown: 'voldown', audiovolumemute: 'mute', contextmenu: 'menu', f: 'fullscreen', f12: 'devtools', f9: 'debug'
  };
  const normKey = (raw) => { const k = String(raw || '').toLowerCase(); return ALIASES[k] || k; };

  let lastHandledAt = 0;

  function handleKey(raw) {
    const k = normKey(raw);

    if (ExitDialog.isOpen) return ExitDialog.handleKey(k);
    if (isNativeTV()) return false; // launcher / Cobalt handle their own input

    if (DIRS.includes(k)) Cursor.hide();

    const now = Date.now();
    if (now - lastHandledAt < KEY_DEBOUNCE_MS) return true;
    lastHandledAt = now;

    if (Text.editing) {
      if (k === 'back') { Text.stop(); return true; }
      if (k === 'ok') { Text.submit(); Text.stop(); return true; }
      if (k === 'left' || k === 'right') { Text.moveCaret(k === 'left' ? -1 : 1); return true; }
      Text.stop(); // up/down leave the field and navigate
    }

    const v = Video.active();

    // FIX: the action bar keeps owning the remote even if its <video> was removed mid-playback
    // (previously the bar went dead because the video check gated it).
    if (Bar.visible && Bar.handleKey(k)) return true;

    if (k === 'volup' || k === 'voldown' || k === 'mute') {
      if (!v) return false;
      if (k === 'mute') { v.muted = !v.muted; HUD.show(v.muted ? 'Muted' : 'Unmuted', v.muted ? 'mute' : 'unmute'); }
      else Video.volume(v, k === 'volup' ? 0.1 : -0.1);
      return true;
    }

    if (v && (MEDIA_KEYS.includes(k) || Video.inMode(v)) && Video.handleKey(k, v)) return true;

    if (k === 'fullscreen') { Video.toggleFullscreen(v); return true; }
    if (k === 'zoomin' || k === 'zoomout') { Zoom.change(k === 'zoomin' ? 1 : -1); return true; }
    if (k === 'devtools') return toggleDevTools();
    if (k === 'debug') return Debug.toggle();

    if (DIRS.includes(k)) return Nav.moveFocus(k);

    if (k === 'ok') {
      if (!Nav.getFocused() || !Nav.getFocused().isConnected) Nav.autoFocus();
      const f = Nav.getFocused();
      if (!f) return false;
      playSound('select');
      return activate(f);
    }

    if (k === 'back') return BackNav.goBack();
    return false;
  }

  /* ---- zoom (relayed to background.js through bridge.js) ---- */
  let zoomHudPending = false;
  const Zoom = { change: (d) => { zoomHudPending = true; window.postMessage({ __momtv: 1, type: 'zoom', delta: d }, '*'); } };
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.__momtv_reply !== 1 || !d.factor) return;
    UI.setZoom(d.factor); // keeps the overlay a constant size whatever the page zoom is
    if (zoomHudPending) { zoomHudPending = false; HUD.show('Zoom ' + Math.round(d.factor * 100) + '%', 'fullscreen'); }
  });

  /* ---- devtools: opt-in only (localStorage 'momtv:debug' = '1'), loaded from the MOM TV server, never a public CDN ---- */
  function toggleDevTools() {
    try {
      if (localStorage.getItem('momtv:debug') !== '1') return false;
      if (window.eruda) {
        window.__erudaActive ? window.eruda.hide() : window.eruda.show();
        window.__erudaActive = !window.__erudaActive;
        return true;
      }
      const s = document.createElement('script');
      s.src = HOME_ORIGIN + '/static/eruda.min.js';
      s.onload = () => { try { window.eruda.init(); window.eruda.show(); window.__erudaActive = true; } catch (_) {} };
      (document.head || document.documentElement).appendChild(s);
      return true;
    } catch (_) { return false; }
  }

  /* ==========================================================================
     14. PHYSICAL KEYBOARD / SMART-TV REMOTE BRIDGE
     ========================================================================== */
  const KEY_CODES = { 461: 'back', 10009: 'back', 415: 'play', 19: 'pause', 412: 'rewind', 417: 'forward', 447: 'volup', 448: 'voldown', 449: 'mute' };

  function consume(e) { e.preventDefault(); e.stopImmediatePropagation(); }

  window.addEventListener('keydown', (e) => {
    if (!e.isTrusted) return; // ignore synthetic events (ours and the page's) — prevents feedback loops
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const key = e.key || '';
    const mapped = ALIASES[key.toLowerCase()] || KEY_CODES[e.keyCode];

    if (key === 'F12') { if (toggleDevTools()) consume(e); return; }

    if (isNativeTV()) return; // launcher / YouTube TV Cobalt handle their own input entirely

    const active = document.activeElement;

    if (Text.editing) {
      if (key === 'Escape' || key === 'ArrowUp' || key === 'ArrowDown') { consume(e); handleKey(mapped); }
      else if (key === 'Enter' && active && active.tagName !== 'TEXTAREA') setTimeout(Text.stop, 0);
      return; // everything else is real typing
    }

    // Typing into a field: printable keys / Backspace / Delete must reach the field, not the D-pad logic.
    if (Text.isField(active) && (key.length === 1 || key === 'Backspace' || key === 'Delete')) { Text.start(active, true); return; }

    if (!mapped) return;
    if (handleKey(mapped)) consume(e);
  }, true);

  /* ==========================================================================
     14b. NAV DEBUG OVERLAY — F9 or MomTV.debugNav(): draws every element the engine considers
     focusable (numbered) and logs each move with the tier that chose it.
     ========================================================================== */
  const Debug = (() => {
    let on = false, timer = null;
    function draw() {
      const box = UI.$('dbg');
      if (!box) return;
      box.innerHTML = '';
      const f = Nav.getFocused();
      Discovery.scan(true).forEach((el, i) => {
        const r = el.getBoundingClientRect(), d = document.createElement('div');
        d.className = 'dbg' + (el === f ? ' cur' : '');
        d.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
        d.textContent = i;
        box.appendChild(d);
      });
    }
    function toggle() {
      on = !on;
      clearInterval(timer);
      const box = UI.$('dbg');
      if (box) box.innerHTML = '';
      if (on) { draw(); timer = setInterval(draw, 500); }
      HUD.show(on ? 'Nav debug ON' : 'Nav debug OFF', 'tv');
      return true;
    }
    return { toggle, get on() { return on; } };
  })();

  /* ==========================================================================
     15. PUBLIC API
     ========================================================================== */
  const API = {
    handleKey,
    goBack: BackNav.goBack,
    isExitDialogOpen: () => ExitDialog.isOpen,
    showExitDialog: ExitDialog.show,
    hideExitDialog: ExitDialog.hide,
    // text entry for the phone remote
    typeText: Text.insert,
    backspace: Text.backspace,
    submitText: Text.submit,
    // video / HUD
    getActiveVideo: Video.active,
    showHUD: HUD.show,
    showVideoOSD: HUD.progress,
    showPlayerActionBar: Bar.show,
    hidePlayerActionBar: Bar.hide,
    playSound,
    // focus
    setFocus: Nav.setFocus,
    getFocusedElement: Nav.getFocused,
    getFocusableCards: () => Discovery.scan(true),
    invalidateCardsCache: Discovery.reset,
    executeCardAction: activate,
    emulateMouseHover: (el) => emulateHover(el, true),
    // trackpad mode
    moveCursor: Cursor.moveBy,
    setCursor: Cursor.set,
    clickCursor: Cursor.click,
    scrollBy: Cursor.scroll,
    // zoom
    zoomIn: () => Zoom.change(1),
    zoomOut: () => Zoom.change(-1),
    toggleDevTools,
    debugNav: Debug.toggle,
    dumpState() {
      const f = Nav.getFocused();
      const v = Video.active();
      return {
        videoMode: !!v && Video.inMode(v),
        focused: f ? (f.textContent || f.getAttribute('aria-label') || f.tagName).trim().slice(0, 50) : null,
        totalFocusable: Discovery.scan().length,
        site: (Sites.current() || {}).name || 'generic',
        modalTrapped: !!Discovery.modalScope(),
        editing: Text.editing,
        url: location.href
      };
    }
  };
  Object.defineProperty(window, 'MomTV', { value: Object.freeze(API), writable: false, configurable: false });

  /* ==========================================================================
     16. BOOT
     ========================================================================== */
  const boot = () => { UI.ensure(); Nav.startAutoFocus(); };
  if (document.readyState === 'complete') setTimeout(boot, 350);
  else window.addEventListener('load', () => setTimeout(boot, 350), { once: true });

  console.log('[MOM TV Companion 3.1] TV engine ready. window.MomTV is live.');
})();