/**
 * MOM TV LEANBACK COMPANION — CONTENT ENGINE (content.js)
 * Native Chromium Extension for Smart TV 10-Foot Experience
 * 
 * Features:
 * 1. 10-Foot TV Viewport Scaling: Auto 135% zoom on desktop streaming sites.
 * 2. Snap-To-Card Spatial Navigation: 2D Row-Clustered matrix navigation.
 * 3. Auto-Scroll to Center: Smoothly aligns active card at ~40% vertical viewport.
 * 4. Synthetic Hover Emulation: Pointerover & mousemove simulation for card previews.
 * 5. Smart TV Exit Confirmation Dialog: High-contrast modal on Back key.
 * 6. Video Player Remote Controller: 10s scrub, play/pause, and streaming adapters.
 * 7. Public window.MomTV Controller API.
 */

(function () {
  'use strict';

  if (window.__MOM_TV_EXTENSION_LOADED__ || window.__MOM_TV_ENGINE_LOADED__ || window.__MomTVLoaded || window.MomTV) {
    return;
  }
  window.__MomTVLoaded = true;
  window.__MOM_TV_EXTENSION_LOADED__ = true;
  window.__MOM_TV_ENGINE_LOADED__ = true;

  // Single-window enforcement for TV kiosk: intercept target="_blank"
  try {
    window.open = function (url) {
      if (url) {
        window.location.href = url;
      }
      return window;
    };

    document.addEventListener('click', function (e) {
      var anchor = e.target && e.target.closest ? e.target.closest('a') : null;
      if (anchor && (anchor.getAttribute('target') === '_blank' || anchor.target === '_blank')) {
        anchor.setAttribute('target', '_self');
        anchor.target = '_self';
      }
    }, true);

    document.addEventListener('submit', function (e) {
      var form = e.target;
      if (form && (form.getAttribute('target') === '_blank' || form.target === '_blank')) {
        form.setAttribute('target', '_self');
        form.target = '_self';
      }
    }, true);
  } catch (_) {}

  console.log('🚀 [MOM TV Companion 2.0] Initializing Native TV Extension Engine...');

  /* ==========================================================================
     0. INJECT SMART TV LEANBACK STYLES (IF NOT ALREADY PRESENT)
     ========================================================================== */
  const STYLE_ID = 'momtv-companion-styles';
  if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
/* 10-Foot TV Viewport Scaling */
html.momtv-10ft-scaled,
html[data-momtv-zoom="135"] {
  zoom: 1.35 !important;
}

/* Glowing 4px Neon Cyan Focus Box */
.momtv-card-focused,
.momtv-focused {
  outline: 4px solid #00f0ff !important;
  outline-offset: 4px !important;
  box-shadow: 0 0 25px rgba(0, 240, 255, 0.9) !important;
  transform: scale(1.05) !important;
  transition: transform 0.16s cubic-bezier(0.2, 0.9, 0.3, 1),
              outline 0.15s ease,
              box-shadow 0.16s ease !important;
  z-index: 999999 !important;
  position: relative !important;
}

/* Focus style for Search input elements */
.momtv-focused-input {
  outline: 4px solid #00f0ff !important;
  outline-offset: 3px !important;
  box-shadow: 0 0 25px rgba(0, 240, 255, 0.9) !important;
  background-color: rgba(12, 16, 24, 0.95) !important;
  color: #ffffff !important;
  z-index: 999999 !important;
}

[data-tv-card="true"] {
  outline: none;
}

/* Smart TV Exit Confirmation Dialog */
#momtv-exit-backdrop {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(4, 7, 15, 0.82);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  z-index: 2147483647;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.22s cubic-bezier(0.2, 0.9, 0.3, 1);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

#momtv-exit-backdrop.visible {
  opacity: 1;
  pointer-events: auto;
}

#momtv-exit-dialog {
  background: linear-gradient(145deg, rgba(20, 28, 46, 0.94), rgba(10, 14, 24, 0.97));
  border: 2px solid rgba(0, 240, 255, 0.5);
  border-radius: 28px;
  box-shadow: 0 35px 90px rgba(0, 0, 0, 0.95), 0 0 50px rgba(0, 240, 255, 0.3);
  padding: 44px 52px;
  max-width: 580px;
  width: 90%;
  text-align: center;
  transform: scale(0.92) translateY(12px);
  transition: transform 0.24s cubic-bezier(0.2, 0.9, 0.3, 1);
}

#momtv-exit-backdrop.visible #momtv-exit-dialog {
  transform: scale(1) translateY(0);
}

.momtv-exit-icon {
  font-size: 48px;
  margin-bottom: 16px;
  filter: drop-shadow(0 0 16px rgba(0, 240, 255, 0.6));
}

.momtv-exit-title {
  font-size: 28px;
  font-weight: 800;
  color: #ffffff;
  letter-spacing: 0.5px;
  margin: 0 0 14px 0;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.6);
}

.momtv-exit-subtitle {
  font-size: 18px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.75);
  line-height: 1.5;
  margin: 0 0 36px 0;
}

.momtv-exit-btn-row {
  display: flex;
  gap: 22px;
  justify-content: center;
  align-items: center;
}

.momtv-exit-btn {
  flex: 1;
  min-width: 170px;
  padding: 16px 28px;
  border-radius: 18px;
  font-size: 19px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  outline: none;
  user-select: none;
  transition: transform 0.16s cubic-bezier(0.2, 0.9, 0.3, 1),
              border-color 0.16s ease,
              background 0.16s ease,
              box-shadow 0.16s ease;
}

.momtv-btn-cancel {
  background: rgba(255, 255, 255, 0.08);
  border: 2px solid rgba(255, 255, 255, 0.2);
  color: #ffffff;
}

.momtv-btn-exit {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.38), rgba(185, 28, 28, 0.52));
  border: 2px solid rgba(239, 68, 68, 0.65);
  color: #ffffff;
}

.momtv-btn-cancel.active-focus {
  background: rgba(255, 255, 255, 0.22) !important;
  border: 3px solid #00f0ff !important;
  box-shadow: 0 0 30px rgba(0, 240, 255, 0.95), 0 0 15px rgba(255, 255, 255, 0.4) !important;
  transform: scale(1.08) !important;
}

.momtv-btn-exit.active-focus {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.72), rgba(220, 38, 38, 0.88)) !important;
  border: 3px solid #00f0ff !important;
  box-shadow: 0 0 35px rgba(0, 240, 255, 0.95), 0 0 25px rgba(239, 68, 68, 0.8) !important;
  transform: scale(1.08) !important;
}

.momtv-btn-icon {
  font-size: 20px;
}

/* TV OSD HUD Pill & Progress Seekbar */
#momtv-hud-pill {
  position: fixed;
  top: 10%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0.92);
  background: rgba(10, 14, 24, 0.94);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  color: #ffffff;
  border: 1.5px solid rgba(0, 240, 255, 0.65);
  border-radius: 20px;
  padding: 14px 28px;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.85), 0 0 35px rgba(0, 240, 255, 0.35);
  z-index: 2147483647;
  opacity: 0;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  transition: opacity 0.2s cubic-bezier(0.2, 0.9, 0.3, 1),
              transform 0.2s cubic-bezier(0.2, 0.9, 0.3, 1);
  min-width: 240px;
  text-align: center;
}

#momtv-hud-pill.visible {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
}

.momtv-osd-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.momtv-osd-time {
  font-size: 16px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  font-variant-numeric: tabular-nums;
}

.momtv-osd-track {
  width: 260px;
  height: 6px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 999px;
  overflow: hidden;
  margin-top: 4px;
  display: none;
}

.momtv-osd-track.active {
  display: block;
}

.momtv-osd-fill {
  height: 100%;
  background: #00f0ff;
  border-radius: 999px;
  box-shadow: 0 0 12px #00f0ff;
  transition: width 0.12s linear;
}

/* Floating Smart TV Player Action Bar */
#momtv-player-action-bar {
  position: fixed;
  bottom: 8%;
  left: 50%;
  transform: translateX(-50%) translateY(35px);
  background: rgba(10, 14, 24, 0.94);
  backdrop-filter: blur(28px);
  -webkit-backdrop-filter: blur(28px);
  border: 2px solid rgba(0, 240, 255, 0.5);
  border-radius: 24px;
  padding: 14px 26px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.9), 0 0 35px rgba(0, 240, 255, 0.3);
  z-index: 2147483647;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.22s cubic-bezier(0.2, 0.9, 0.3, 1),
              transform 0.22s cubic-bezier(0.2, 0.9, 0.3, 1);
  font-family: system-ui, -apple-system, sans-serif;
}

#momtv-player-action-bar.visible {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(-50%) translateY(0);
}

.momtv-bar-title {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: rgba(0, 240, 255, 0.85);
}

.momtv-bar-buttons {
  display: flex;
  align-items: center;
  gap: 12px;
}

.momtv-action-btn {
  background: rgba(255, 255, 255, 0.08);
  border: 1.5px solid rgba(255, 255, 255, 0.16);
  border-radius: 14px;
  padding: 10px 18px;
  color: #ffffff;
  font-size: 15px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  outline: none;
  user-select: none;
  transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}

.momtv-action-btn.active-focus {
  background: rgba(0, 240, 255, 0.28) !important;
  border-color: #00f0ff !important;
  box-shadow: 0 0 25px rgba(0, 240, 255, 0.95) !important;
  transform: scale(1.12) !important;
  color: #ffffff !important;
}

.momtv-action-btn .btn-icon {
  font-size: 18px;
}

.momtv-action-btn .btn-label {
  font-size: 14px;
  letter-spacing: 0.4px;
}

/* In-Browser Virtual Mouse Cursor for Magic Trackpad Mode */
#momtv-virtual-cursor {
  position: fixed;
  top: 0;
  left: 0;
  width: 28px;
  height: 28px;
  pointer-events: none !important;
  z-index: 2147483647;
  opacity: 0;
  transform: translate(-100px, -100px);
  transition: opacity 0.22s cubic-bezier(0.2, 0.9, 0.3, 1), transform 0.04s linear;
  filter: drop-shadow(0 0 8px rgba(0, 240, 255, 0.95)) drop-shadow(0 0 18px rgba(0, 240, 255, 0.65));
  will-change: transform, opacity;
}

#momtv-virtual-cursor.visible {
  opacity: 1;
}

#momtv-virtual-cursor.clicking {
  filter: drop-shadow(0 0 14px rgba(255, 255, 255, 1)) drop-shadow(0 0 28px rgba(0, 240, 255, 1));
  transform: scale(0.85) !important;
}
`;
    (document.head || document.documentElement).appendChild(style);
  }

  function isElementInDoc(el) {
    if (!el) return false;
    if (document.documentElement && typeof document.documentElement.contains === 'function') {
      return document.documentElement.contains(el);
    }
    if (typeof document.contains === 'function') {
      return document.contains(el);
    }
    return true;
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
    if (isInternalMomTVPage() || isYouTubeTVPage()) {
      return;
    }
    if (document.documentElement) {
      document.documentElement.classList.add('momtv-10ft-scaled');
      document.documentElement.setAttribute('data-momtv-zoom', '135');
    }
  }

  // Apply immediately and preserve across SPA page changes
  apply10FootScaling();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply10FootScaling);
  }

  // Single-window enforcement for TV kiosk
  window.open = function (url) {
    if (url) {
      window.location.href = url;
    }
    return window;
  };

  document.addEventListener('click', (e) => {
    const anchor = e.target.closest('a');
    if (anchor && anchor.getAttribute('target') === '_blank') {
      anchor.setAttribute('target', '_self');
    }
  }, true);

  /* ==========================================================================
     2. PROCEDURAL WEB AUDIO SOUND ENGINE
     ========================================================================== */
  let audioCtx = null;
  let masterGain = null;

  function initAudio() {
    if (!audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        audioCtx = new AudioCtx();
        if (typeof audioCtx.createGain === 'function') {
          masterGain = audioCtx.createGain();
          masterGain.gain.setValueAtTime(1.0, audioCtx.currentTime);
          masterGain.connect(audioCtx.destination);
        }
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  }

  function playSound(type) {
    try {
      initAudio();
      if (!audioCtx || audioCtx.state !== 'running') return;

      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(masterGain || audioCtx.destination);

      if (type === 'focus') {
        // Crisp, warm Smart TV click tap (Apple TV / Tizen style)
        osc.type = 'sine';
        osc.frequency.setValueAtTime(540, now);
        osc.frequency.exponentialRampToValueAtTime(420, now + 0.035);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
        osc.start(now);
        osc.stop(now + 0.035);
      } else if (type === 'select') {
        // Bright affirmative chime
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(640, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.start(now);
        osc.stop(now + 0.08);
      } else if (type === 'seek') {
        // Fast scrub blip
        osc.type = 'sine';
        osc.frequency.setValueAtTime(720, now);
        osc.frequency.exponentialRampToValueAtTime(580, now + 0.03);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
        osc.start(now);
        osc.stop(now + 0.03);
      } else if (type === 'back') {
        // Soft descending tone
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(320, now + 0.06);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        osc.start(now);
        osc.stop(now + 0.06);
      } else if (type === 'dialog') {
        // Attention-getting double chime
        osc.type = 'sine';
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(680, now + 0.09);
        gain.gain.setValueAtTime(0.14, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
        osc.start(now);
        osc.stop(now + 0.09);
      }
    } catch (_) {}
  }

  ['click', 'keydown', 'touchstart'].forEach((evt) => {
    window.addEventListener(evt, initAudio, { once: true, passive: true });
  });

  /* ==========================================================================
     3. SMART TV EXIT CONFIRMATION DIALOG
     ========================================================================== */
  let isExitDialogOpen = false;
  let activeExitDialogBtnIndex = 0; // 0 = Cancel, 1 = Exit to Home
  let lastFocusedElementBeforeDialog = null;

  function ensureExitDialogElements() {
    let backdrop = document.getElementById('momtv-exit-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'momtv-exit-backdrop';
      backdrop.className = 'momtv-internal';
      backdrop.innerHTML = `
        <div id="momtv-exit-dialog" role="dialog" aria-modal="true" aria-labelledby="momtv-dialog-title">
          <div class="momtv-exit-icon">📺</div>
          <h2 id="momtv-dialog-title" class="momtv-exit-title">Exit to MOM TV Home?</h2>
          <p class="momtv-exit-subtitle">Do you want to leave this app and return to Home?</p>
          <div class="momtv-exit-btn-row">
            <button id="momtv-btn-cancel" class="momtv-exit-btn momtv-btn-cancel" type="button">
              <span class="momtv-btn-icon">✖</span>
              <span>Cancel</span>
            </button>
            <button id="momtv-btn-exit" class="momtv-exit-btn momtv-btn-exit" type="button">
              <span class="momtv-btn-icon">🏠</span>
              <span>Exit to Home</span>
            </button>
          </div>
        </div>
      `;
      (document.body || document.documentElement).appendChild(backdrop);

      // Mouse/touch click listeners for remote trackpad
      const cancelBtn = backdrop.querySelector('#momtv-btn-cancel');
      const exitBtn = backdrop.querySelector('#momtv-btn-exit');

      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
          hideExitDialog();
        });
      }

      if (exitBtn) {
        exitBtn.addEventListener('click', () => {
          playSound('select');
          window.location.href = 'http://localhost:8765/tv';
        });
      }
    }
    return backdrop;
  }

  function updateExitDialogFocus() {
    const backdrop = ensureExitDialogElements();
    const cancelBtn = backdrop.querySelector('#momtv-btn-cancel');
    const exitBtn = backdrop.querySelector('#momtv-btn-exit');

    if (cancelBtn && exitBtn) {
      if (activeExitDialogBtnIndex === 0) {
        cancelBtn.classList.add('active-focus');
        exitBtn.classList.remove('active-focus');
        cancelBtn.focus({ preventScroll: true });
      } else {
        exitBtn.classList.add('active-focus');
        cancelBtn.classList.remove('active-focus');
        exitBtn.focus({ preventScroll: true });
      }
    }
  }

  function showExitDialog() {
    if (isInternalMomTVPage()) {
      // Don't show exit dialog when already on the launcher
      return;
    }
    const backdrop = ensureExitDialogElements();
    lastFocusedElementBeforeDialog = currentFocusedElement;
    isExitDialogOpen = true;
    activeExitDialogBtnIndex = 0; // Default to Cancel for safety
    backdrop.classList.add('visible');
    updateExitDialogFocus();
    playSound('dialog');
  }

  function hideExitDialog() {
    const backdrop = document.getElementById('momtv-exit-backdrop');
    if (backdrop) {
      backdrop.classList.remove('visible');
    }
    isExitDialogOpen = false;
    playSound('back');

    if (lastFocusedElementBeforeDialog && isElementInDoc(lastFocusedElementBeforeDialog)) {
      setFocus(lastFocusedElementBeforeDialog);
    }
  }

  function handleExitDialogKey(key) {
    const k = key.toLowerCase();

    if (['left', 'arrowleft'].includes(k)) {
      activeExitDialogBtnIndex = 0; // Cancel
      updateExitDialogFocus();
      playSound('focus');
      return true;
    }

    if (['right', 'arrowright'].includes(k)) {
      activeExitDialogBtnIndex = 1; // Exit to Home
      updateExitDialogFocus();
      playSound('focus');
      return true;
    }

    if (['enter', 'ok', 'select', 'space'].includes(k)) {
      if (activeExitDialogBtnIndex === 1) {
        // Exit to MOM TV Home
        playSound('select');
        window.location.href = 'http://localhost:8765/tv';
        return true;
      } else {
        // Cancel
        hideExitDialog();
        return true;
      }
    }

    if (['back', 'escape'].includes(k)) {
      hideExitDialog();
      return true;
    }

    if (['up', 'arrowup', 'down', 'arrowdown'].includes(k)) {
      // Keep focus inside dialog
      return true;
    }

    return true;
  }

  /* ==========================================================================
     4. TV OSD HUD CONTROLLER & ACTION BAR
     ========================================================================== */
  let hudTimeout = null;

  function ensureHUDElements() {
    let pill = document.getElementById('momtv-hud-pill');
    if (!pill) {
      pill = document.createElement('div');
      pill.id = 'momtv-hud-pill';
      pill.className = 'momtv-internal';
      pill.innerHTML = `
        <div class="momtv-osd-header">
          <span id="momtv-osd-action"></span>
          <span id="momtv-osd-time" class="momtv-osd-time"></span>
        </div>
        <div id="momtv-osd-track" class="momtv-osd-track">
          <div id="momtv-osd-fill" class="momtv-osd-fill"></div>
        </div>
      `;
      (document.body || document.documentElement).appendChild(pill);
    }
    return pill;
  }

  function formatTime(seconds) {
    if (isNaN(seconds) || !isFinite(seconds) || seconds < 0) return '00:00';
    const s = Math.floor(seconds % 60);
    const m = Math.floor((seconds / 60) % 60);
    const h = Math.floor(seconds / 3600);
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    if (h > 0) {
      return `${h}:${pad(m)}:${pad(s)}`;
    }
    return `${pad(m)}:${pad(s)}`;
  }

  function showHUD(text, icon = '') {
    const pill = ensureHUDElements();
    const actionEl = document.getElementById('momtv-osd-action');
    const timeEl = document.getElementById('momtv-osd-time');
    const trackEl = document.getElementById('momtv-osd-track');

    if (actionEl) actionEl.textContent = (icon ? icon + ' ' : '') + text;
    if (timeEl) timeEl.textContent = '';
    if (trackEl) trackEl.classList.remove('active');

    pill.classList.add('visible');
    if (hudTimeout) clearTimeout(hudTimeout);
    hudTimeout = setTimeout(() => {
      pill.classList.remove('visible');
    }, 1500);
  }

  function showVideoOSD(video, actionText) {
    if (!video) return;
    const pill = ensureHUDElements();
    const actionEl = document.getElementById('momtv-osd-action');
    const timeEl = document.getElementById('momtv-osd-time');
    const trackEl = document.getElementById('momtv-osd-track');
    const fillEl = document.getElementById('momtv-osd-fill');

    const curr = formatTime(video.currentTime);
    const dur = formatTime(video.duration);
    const pct = Math.min(100, Math.max(0, (video.currentTime / (video.duration || 1)) * 100));

    if (actionEl) actionEl.textContent = actionText;
    if (timeEl) timeEl.textContent = `[${curr} / ${dur}]`;
    if (fillEl) fillEl.style.width = `${pct}%`;
    if (trackEl) trackEl.classList.add('active');

    pill.classList.add('visible');
    if (hudTimeout) clearTimeout(hudTimeout);
    hudTimeout = setTimeout(() => {
      pill.classList.remove('visible');
    }, 1800);
  }

  // Floating Player Action Bar
  let actionBarTimeout = null;
  let activeActionBarIndex = 1;
  let isActionBarVisible = false;

  function ensurePlayerActionBar() {
    let bar = document.getElementById('momtv-player-action-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'momtv-player-action-bar';
      bar.className = 'momtv-internal';
      bar.innerHTML = `
        <div class="momtv-bar-title">MOM TV PLAYER CONTROLS</div>
        <div class="momtv-bar-buttons">
          <button class="momtv-action-btn" data-action="rewind">
            <span class="btn-icon">⏪</span>
            <span class="btn-label">-10s</span>
          </button>
          <button class="momtv-action-btn" data-action="playpause">
            <span class="btn-icon">⏯</span>
            <span class="btn-label">Play/Pause</span>
          </button>
          <button class="momtv-action-btn" data-action="forward">
            <span class="btn-icon">⏩</span>
            <span class="btn-label">+10s</span>
          </button>
          <button class="momtv-action-btn" data-action="audio">
            <span class="btn-icon">🔊</span>
            <span class="btn-label">Audio</span>
          </button>
          <button class="momtv-action-btn" data-action="fullscreen">
            <span class="btn-icon">⛶</span>
            <span class="btn-label">Fullscreen</span>
          </button>
        </div>
      `;
      (document.body || document.documentElement).appendChild(bar);

      const buttons = bar.querySelectorAll('.momtv-action-btn');
      buttons.forEach((btn, idx) => {
        btn.addEventListener('click', () => {
          activeActionBarIndex = idx;
          updateActionBarFocus();
          executeActionBarAction(btn.getAttribute('data-action'));
        });
      });
    }
    return bar;
  }

  function updateActionBarFocus() {
    const bar = ensurePlayerActionBar();
    const buttons = Array.from(bar.querySelectorAll('.momtv-action-btn'));
    buttons.forEach((btn, idx) => {
      if (idx === activeActionBarIndex) {
        btn.classList.add('active-focus');
      } else {
        btn.classList.remove('active-focus');
      }
    });
  }

  function showPlayerActionBar() {
    const bar = ensurePlayerActionBar();
    isActionBarVisible = true;
    updateActionBarFocus();
    bar.classList.add('visible');
    playSound('focus');
    resetActionBarTimeout();
  }

  function hidePlayerActionBar() {
    const bar = document.getElementById('momtv-player-action-bar');
    if (bar) {
      bar.classList.remove('visible');
    }
    isActionBarVisible = false;
    if (actionBarTimeout) {
      clearTimeout(actionBarTimeout);
      actionBarTimeout = null;
    }
  }

  function resetActionBarTimeout() {
    if (actionBarTimeout) clearTimeout(actionBarTimeout);
    actionBarTimeout = setTimeout(() => {
      hidePlayerActionBar();
    }, 6000);
  }

  function executeActionBarAction(action) {
    const video = getActiveVideo();
    if (!video) return;

    resetActionBarTimeout();

    switch (action) {
      case 'rewind':
        video.currentTime = Math.max(0, video.currentTime - 10);
        showVideoOSD(video, '⏪ -10s');
        playSound('seek');
        break;

      case 'forward': {
        const dur = video.duration || Infinity;
        video.currentTime = Math.min(dur, video.currentTime + 10);
        showVideoOSD(video, '⏩ +10s');
        playSound('seek');
        break;
      }

      case 'playpause':
        if (video.paused) {
          video.play().catch(() => {});
          showVideoOSD(video, '▶ Play');
        } else {
          video.pause();
          showVideoOSD(video, '⏸ Pause');
        }
        playSound('select');
        break;

      case 'audio': {
        video.muted = !video.muted;
        const btn = document.querySelector('.momtv-action-btn[data-action="audio"]');
        if (btn) {
          const icon = btn.querySelector('.btn-icon');
          const label = btn.querySelector('.btn-label');
          if (video.muted) {
            if (icon) icon.textContent = '🔇';
            if (label) label.textContent = 'Muted';
          } else {
            if (icon) icon.textContent = '🔊';
            if (label) label.textContent = 'Audio';
          }
        }
        showHUD(video.muted ? 'Muted' : 'Unmuted', video.muted ? '🔇' : '🔊');
        playSound('select');
        break;
      }

      case 'fullscreen':
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
          showHUD('Windowed', '⛶');
        } else {
          const target = video.parentElement || video;
          if (target.requestFullscreen) {
            target.requestFullscreen().catch(() => {});
          } else if (video.requestFullscreen) {
            video.requestFullscreen().catch(() => {});
          }
          showHUD('Fullscreen', '⛶');
        }
        playSound('select');
        break;
    }
  }

  /* ==========================================================================
     5. VIDEO PLAYER DETECTION & REMOTE CONTROLLER
     ========================================================================== */
  const seekAccumulator = {
    direction: 0,
    count: 0,
    lastTime: 0
  };

  function getAccumulatedSeekSeconds(pressCount) {
    if (pressCount <= 1) return 10;
    if (pressCount === 2) return 20;
    if (pressCount === 3) return 30;
    if (pressCount === 4) return 60;
    return 60 + (pressCount - 4) * 30;
  }

  function getActiveVideo() {
    const allVideos = Array.from(document.querySelectorAll('video'));
    if (!allVideos.length) return null;

    // 1. Actively playing video
    const playing = allVideos.find((v) => !v.paused && !v.ended && v.readyState > 1 && v.currentTime > 0);
    if (playing) return playing;

    // 2. Fullscreen video
    const fs = allVideos.find((v) => document.fullscreenElement === v || (document.fullscreenElement && document.fullscreenElement.contains(v)));
    if (fs) return fs;

    // 3. Largest visible video with reasonable dimensions
    const visibleVideos = allVideos.filter((v) => {
      const r = v.getBoundingClientRect();
      return r.width >= 120 && r.height >= 70;
    });

    if (visibleVideos.length > 0) {
      visibleVideos.sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return (rb.width * rb.height) - (ra.width * ra.height);
      });
      return visibleVideos[0];
    }

    return allVideos[0] || null;
  }

  let isVideoModeEngaged = false;
  let lastActiveVideo = null;

  function isVideoModeActive() {
    const v = getActiveVideo();
    if (!v) {
      isVideoModeEngaged = false;
      return false;
    }
    if (!v.paused || Boolean(document.fullscreenElement) || isActionBarVisible) {
      isVideoModeEngaged = true;
      lastActiveVideo = v;
      return true;
    }
    if (isVideoModeEngaged && v === lastActiveVideo) {
      return true;
    }
    return false;
  }

  // Platform-Specific Video Adapters
  const PlatformAdapters = {
    isNetflix: () => window.location.hostname.includes('netflix.com'),
    isNetflixPlayerActive: function () {
      return this.isNetflix() && (
        window.location.pathname.includes('/watch') ||
        Boolean(document.querySelector('.watch-video, .nf-player-container, [data-uia="video-canvas"]')) ||
        (Boolean(getActiveVideo()) && isVideoModeActive())
      );
    },
    handleNetflixKey: function (key) {
      const k = key.toLowerCase();
      function sendNetflixKey(keyStr, codeStr, keyCodeNum) {
        const target = (typeof document !== 'undefined' && document.querySelector && document.querySelector('.watch-video, .nf-player-container, [data-uia="video-canvas"], video')) || (typeof document !== 'undefined' && document.body) || null;
        const down = new KeyboardEvent('keydown', { key: keyStr, code: codeStr, keyCode: keyCodeNum, which: keyCodeNum, bubbles: true, cancelable: true });
        const up = new KeyboardEvent('keyup', { key: keyStr, code: codeStr, keyCode: keyCodeNum, which: keyCodeNum, bubbles: true, cancelable: true });
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
      if (['space', 'enter', 'ok', 'select', 'play', 'pause', 'playpause'].includes(k)) {
        sendNetflixKey(' ', 'Space', 32);
        showHUD('Play/Pause', '⏯');
        playSound('select');
        return true;
      }
      if (['left', 'rewind', 'arrowleft'].includes(k)) {
        sendNetflixKey('ArrowLeft', 'ArrowLeft', 37);
        showHUD('Rewind -10s', '⏪');
        playSound('seek');
        return true;
      }
      if (['right', 'forward', 'arrowright'].includes(k)) {
        sendNetflixKey('ArrowRight', 'ArrowRight', 39);
        showHUD('Forward +10s', '⏩');
        playSound('seek');
        return true;
      }
      if (['back', 'escape'].includes(k)) {
        const backBtn = document.querySelector('[data-uia="nfplayer-exit"], .button-nfplayerBack, button[aria-label*="Back" i]');
        if (backBtn) {
          backBtn.click();
          showHUD('Exit Player');
          playSound('back');
          return true;
        }
        sendNetflixKey('Escape', 'Escape', 27);
        if (window.location.pathname.includes('/watch')) {
          window.location.href = 'https://www.netflix.com/browse';
          return true;
        }
      }
      return false;
    },

    isHotstar: () => window.location.hostname.includes('hotstar.com'),
    isHotstarPlayerActive: function (v) {
      return this.isHotstar() && (
        window.location.pathname.includes('/watch') ||
        window.location.pathname.includes('/play') ||
        Boolean(document.querySelector('.player-container, .shaka-video-container')) ||
        (Boolean(v || getActiveVideo()) && isVideoModeActive())
      );
    },
    handleHotstarKey: function (key, video) {
      const k = key.toLowerCase();
      if (['enter', 'ok', 'select', 'space', 'play', 'pause', 'playpause'].includes(k)) {
        if (video) {
          if (video.paused) video.play().catch(() => {});
          else video.pause();
        }
        const playBtn = document.querySelector('button[aria-label*="Play" i], button[aria-label*="Pause" i], .play-btn, [data-testid*="play-pause-btn" i], .shaka-play-button');
        if (playBtn) playBtn.click();
        if (video) showVideoOSD(video, video.paused ? '⏸ Pause' : '▶ Play');
        playSound('select');
        return true;
      }
      if (['left', 'rewind', 'arrowleft'].includes(k)) {
        if (video) {
          video.currentTime = Math.max(0, video.currentTime - 10);
          showVideoOSD(video, '⏪ -10s');
        }
        const rewindBtn = document.querySelector('button[aria-label*="Rewind" i], button[aria-label*="backward" i], [data-testid*="rewind" i], .rewind-btn');
        if (rewindBtn) rewindBtn.click();
        playSound('seek');
        return true;
      }
      if (['right', 'forward', 'arrowright'].includes(k)) {
        if (video) {
          const dur = video.duration || Infinity;
          video.currentTime = Math.min(dur, video.currentTime + 10);
          showVideoOSD(video, '⏩ +10s');
        }
        const forwardBtn = document.querySelector('button[aria-label*="Forward" i], [data-testid*="forward" i], .forward-btn');
        if (forwardBtn) forwardBtn.click();
        playSound('seek');
        return true;
      }
      if (['back', 'escape'].includes(k)) {
        const backBtn = document.querySelector('button[aria-label*="Back" i], [data-testid*="back-btn" i], .player-back-btn');
        if (backBtn) {
          backBtn.click();
          playSound('back');
          return true;
        }
      }
      return false;
    },

    isPrime: () => window.location.hostname.includes('primevideo.com') || (window.location.hostname.includes('amazon.') && window.location.pathname.includes('/video/')),
    isPrimePlayerActive: function (v) {
      return this.isPrime() && (
        window.location.pathname.includes('/watch') ||
        Boolean(document.querySelector('.atvwebplayersdk-player-container')) ||
        (Boolean(v || getActiveVideo()) && isVideoModeActive())
      );
    },
    handlePrimeKey: function (key, video) {
      const k = key.toLowerCase();
      if (['enter', 'ok', 'select', 'space', 'play', 'pause', 'playpause'].includes(k)) {
        if (video) {
          if (video.paused) video.play().catch(() => {});
          else video.pause();
        }
        const playBtn = document.querySelector('.atvwebplayersdk-playpause-button, button[aria-label*="Play" i], button[aria-label*="Pause" i]');
        if (playBtn) playBtn.click();
        if (video) showVideoOSD(video, video.paused ? '⏸ Pause' : '▶ Play');
        playSound('select');
        return true;
      }
      if (['left', 'rewind', 'arrowleft'].includes(k)) {
        if (video) {
          video.currentTime = Math.max(0, video.currentTime - 10);
          showVideoOSD(video, '⏪ -10s');
        }
        const rewindBtn = document.querySelector('.atvwebplayersdk-rewind-button, button[aria-label*="10 seconds backward" i], .rewind-button');
        if (rewindBtn) rewindBtn.click();
        playSound('seek');
        return true;
      }
      if (['right', 'forward', 'arrowright'].includes(k)) {
        if (video) {
          const dur = video.duration || Infinity;
          video.currentTime = Math.min(dur, video.currentTime + 10);
          showVideoOSD(video, '⏩ +10s');
        }
        const forwardBtn = document.querySelector('.fast-forward-button, button[aria-label*="10 seconds forward" i]');
        if (forwardBtn) forwardBtn.click();
        playSound('seek');
        return true;
      }
      if (['back', 'escape'].includes(k)) {
        const backBtn = document.querySelector('.atvwebplayersdk-back-button, button[aria-label*="Back" i]');
        if (backBtn) {
          backBtn.click();
          playSound('back');
          return true;
        }
      }
      return false;
    },

    isJioCinema: () => window.location.hostname.includes('jiocinema.com'),
    isJioCinemaPlayerActive: function (v) {
      return this.isJioCinema() && (
        window.location.pathname.includes('/watch') ||
        Boolean(document.querySelector('.player-wrapper, .player-container')) ||
        (Boolean(v || getActiveVideo()) && isVideoModeActive())
      );
    },
    handleJioCinemaKey: function (key, video) {
      const k = key.toLowerCase();
      if (['enter', 'ok', 'select', 'space', 'play', 'pause', 'playpause'].includes(k)) {
        if (video) {
          if (video.paused) video.play().catch(() => {});
          else video.pause();
        }
        const playBtn = document.querySelector('button[class*="play" i], button[class*="pause" i], button[aria-label*="Play" i], [data-testid*="play-pause" i]');
        if (playBtn) playBtn.click();
        if (video) showVideoOSD(video, video.paused ? '⏸ Pause' : '▶ Play');
        playSound('select');
        return true;
      }
      if (['left', 'rewind', 'arrowleft'].includes(k)) {
        if (video) {
          video.currentTime = Math.max(0, video.currentTime - 10);
          showVideoOSD(video, '⏪ -10s');
        }
        const rewindBtn = document.querySelector('button[aria-label*="Rewind" i], button[class*="rewind" i], [data-testid*="rewind" i]');
        if (rewindBtn) rewindBtn.click();
        playSound('seek');
        return true;
      }
      if (['right', 'forward', 'arrowright'].includes(k)) {
        if (video) {
          const dur = video.duration || Infinity;
          video.currentTime = Math.min(dur, video.currentTime + 10);
          showVideoOSD(video, '⏩ +10s');
        }
        const forwardBtn = document.querySelector('button[aria-label*="Forward" i], button[class*="forward" i], [data-testid*="forward" i]');
        if (forwardBtn) forwardBtn.click();
        playSound('seek');
        return true;
      }
      if (['back', 'escape'].includes(k)) {
        const backBtn = document.querySelector('button[aria-label*="Back" i], button[class*="back" i]');
        if (backBtn) {
          backBtn.click();
          playSound('back');
          return true;
        }
      }
      return false;
    },

    dispatch: function (key, video) {
      const v = video || getActiveVideo();
      if (this.isNetflixPlayerActive()) return this.handleNetflixKey(key);
      if (this.isHotstarPlayerActive(v)) return this.handleHotstarKey(key, v);
      if (this.isPrimePlayerActive(v)) return this.handlePrimeKey(key, v);
      if (this.isJioCinemaPlayerActive(v)) return this.handleJioCinemaKey(key, v);
      return false;
    },

    handleBack: function () {
      if (this.isNetflixPlayerActive()) return this.handleNetflixKey('back');
      if (this.isHotstar()) {
        const backBtn = document.querySelector('button[aria-label*="Back" i], [data-testid*="back-btn" i], .player-back-btn');
        if (backBtn) { backBtn.click(); return true; }
      }
      if (this.isPrime()) {
        const backBtn = document.querySelector('.atvwebplayersdk-back-button, button[aria-label*="Back" i]');
        if (backBtn) { backBtn.click(); return true; }
      }
      if (this.isJioCinema()) {
        const backBtn = document.querySelector('button[aria-label*="Back" i], button[class*="back" i]');
        if (backBtn) { backBtn.click(); return true; }
      }
      return false;
    }
  };

  function handleVideoKey(key, video) {
    const k = key.toLowerCase();

    // 1. If Action Bar is open
    if (isActionBarVisible) {
      resetActionBarTimeout();

      if (['left', 'arrowleft'].includes(k)) {
        activeActionBarIndex = Math.max(0, activeActionBarIndex - 1);
        updateActionBarFocus();
        playSound('focus');
        return true;
      }

      if (['right', 'arrowright'].includes(k)) {
        const count = document.querySelectorAll('.momtv-action-btn').length || 5;
        activeActionBarIndex = Math.min(count - 1, activeActionBarIndex + 1);
        updateActionBarFocus();
        playSound('focus');
        return true;
      }

      if (['enter', 'ok', 'select', 'space'].includes(k)) {
        const bar = ensurePlayerActionBar();
        const buttons = bar.querySelectorAll('.momtv-action-btn');
        const activeBtn = buttons[activeActionBarIndex];
        if (activeBtn) {
          executeActionBarAction(activeBtn.getAttribute('data-action'));
        }
        return true;
      }

      if (['up', 'arrowup', 'back', 'escape'].includes(k)) {
        hidePlayerActionBar();
        playSound('back');
        return true;
      }

      if (['down', 'arrowdown'].includes(k)) {
        return true;
      }
    }

    // 2. Direct Video Player Controls
    // Rewind -10s
    if (['left', 'rewind', 'arrowleft'].includes(k)) {
      const now = Date.now();
      if (seekAccumulator.direction === -1 && (now - seekAccumulator.lastTime) < 850) {
        seekAccumulator.count++;
      } else {
        seekAccumulator.direction = -1;
        seekAccumulator.count = 1;
      }
      seekAccumulator.lastTime = now;

      const sec = getAccumulatedSeekSeconds(seekAccumulator.count);
      video.currentTime = Math.max(0, video.currentTime - sec);
      showVideoOSD(video, `⏪ -${sec}s`);
      playSound('seek');
      return true;
    }

    // Fast Forward +10s
    if (['right', 'forward', 'arrowright'].includes(k)) {
      const now = Date.now();
      if (seekAccumulator.direction === 1 && (now - seekAccumulator.lastTime) < 850) {
        seekAccumulator.count++;
      } else {
        seekAccumulator.direction = 1;
        seekAccumulator.count = 1;
      }
      seekAccumulator.lastTime = now;

      const sec = getAccumulatedSeekSeconds(seekAccumulator.count);
      const dur = video.duration || Infinity;
      video.currentTime = Math.min(dur, video.currentTime + sec);
      showVideoOSD(video, `⏩ +${sec}s`);
      playSound('seek');
      return true;
    }

    // Play / Pause Toggle
    if (['enter', 'ok', 'select', 'space', 'play', 'pause', 'playpause'].includes(k)) {
      if (video.paused) {
        video.play().catch(() => {});
        showVideoOSD(video, '▶ Play');
        isVideoModeEngaged = true;
        lastActiveVideo = video;
      } else {
        video.pause();
        showVideoOSD(video, '⏸ Pause');
        isVideoModeEngaged = true;
        lastActiveVideo = video;
      }
      playSound('select');
      return true;
    }

    // Down Arrow: Show Player Action Bar
    if (['down', 'arrowdown'].includes(k)) {
      showPlayerActionBar();
      return true;
    }

    // Up Arrow: Hide Action Bar
    if (['up', 'arrowup'].includes(k)) {
      if (isActionBarVisible) {
        hidePlayerActionBar();
        playSound('back');
        return true;
      }
      return false;
    }

    // Back / Escape: Exit Player or Fullscreen
    if (['back', 'escape'].includes(k)) {
      if (isActionBarVisible) {
        hidePlayerActionBar();
        playSound('back');
        return true;
      }
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
        showHUD('Exit Fullscreen');
        playSound('back');
        return true;
      }
      if (!video.paused) {
        video.pause();
        showHUD('Paused');
        isVideoModeEngaged = false;
        playSound('back');
        return true;
      }
      if (isVideoModeEngaged) {
        isVideoModeEngaged = false;
        showHUD('Exit Video Mode');
        playSound('back');
        return true;
      }
    }

    return false;
  }

  /* ==========================================================================
     6. DIRECT COMPONENT ACTION DISPATCH & TRUSTED EXECUTION
     ========================================================================== */
  function findActionTarget(el) {
    if (!el) return null;

    // 1. Direct anchor with valid href
    if (el.tagName === 'A' && (el.href || el.getAttribute('href'))) {
      return el;
    }

    // 2. Child anchor with valid href
    if (el.querySelectorAll) {
      const allAnchors = Array.from(el.querySelectorAll('a'));
      const validAnchor = allAnchors.find(a => {
        const h = a.href || a.getAttribute('href');
        return h && !h.startsWith('javascript:') && !h.startsWith('#');
      });
      if (validAnchor) return validAnchor;
    }

    // 3. Parent or ancestor anchor
    if (el.closest) {
      const parentA = el.closest('a[href]');
      if (parentA) return parentA;
    }

    // 4. Primary button or role="button"
    if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') {
      return el;
    }
    if (el.querySelector) {
      const innerBtn = el.querySelector('button, [role="button"]');
      if (innerBtn && !innerBtn.hasAttribute('disabled')) return innerBtn;
    }

    // 5. Input or searchbox
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.getAttribute('role') === 'searchbox') {
      return el;
    }

    return el;
  }

  function executeCardAction(el) {
    if (!el) return false;
    const target = findActionTarget(el) || el._momTvActionTarget || el;

    if (isSearchInput(target) || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      try { target.focus(); } catch (_) {}
      return true;
    }

    try {
      const rect = target.getBoundingClientRect();
      const clientX = Math.round(rect.left + rect.width / 2);
      const clientY = Math.round(rect.top + rect.height / 2);

      // Dispatch full physical event sequence
      const pointerDown = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true });
      const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0, buttons: 1 });
      const pointerUp = new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0, buttons: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true });
      const mouseUp = new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0, buttons: 0 });
      const clickEvt = new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0 });

      target.dispatchEvent(pointerDown);
      target.dispatchEvent(mouseDown);
      target.dispatchEvent(pointerUp);
      target.dispatchEvent(mouseUp);
      target.dispatchEvent(clickEvt);

      // If outer card container is distinct, also dispatch physical sequence and invoke .click() on container
      if (el !== target) {
        try {
          el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
          el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0, buttons: 1 }));
          el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0, buttons: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
          el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0, buttons: 0 }));
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0 }));
          el.click();
        } catch (_) {}
      }

      // Call .click() directly on the target
      try {
        target.click();
      } catch (_) {}

      // If target has a real navigation href, provide instant direct navigation fallback
      const rawHref = target.href || target.getAttribute('href');
      if (rawHref && !rawHref.startsWith('javascript:') && !rawHref.startsWith('#')) {
        try {
          const resolvedUrl = new URL(rawHref, window.location.href).href;
          setTimeout(() => {
            if (window.location.href !== resolvedUrl) {
              window.location.href = resolvedUrl;
            }
          }, 120);
        } catch (_) {}
      }

      return true;
    } catch (err) {
      console.warn('[MOM TV] Error executing card action:', err);
      try { target.click(); } catch (_) {}
      return true;
    }
  }

  // Deprecated compatibility wrappers
  function emulateCoordinateClick(el) {
    return executeCardAction(el);
  }

  function emulateMouseHover(el) {
    if (!el || !el.getBoundingClientRect) return;
    try {
      const rect = el.getBoundingClientRect();
      const clientX = Math.round(rect.left + rect.width / 2);
      const clientY = Math.round(rect.top + rect.height / 2);
      const init = { bubbles: true, cancelable: true, view: window, clientX, clientY, buttons: 0 };
      if (typeof PointerEvent !== 'undefined') {
        el.dispatchEvent(new PointerEvent('pointerover', { ...init, pointerType: 'mouse', isPrimary: true }));
        el.dispatchEvent(new PointerEvent('pointerenter', { ...init, pointerType: 'mouse', isPrimary: true }));
      }
      if (typeof MouseEvent !== 'undefined') {
        el.dispatchEvent(new MouseEvent('mouseenter', init));
        el.dispatchEvent(new MouseEvent('mousemove', init));
      }
    } catch (_) {}
  }

  function emulateMouseLeave(el) {
    if (!el || !el.getBoundingClientRect) return;
    try {
      const rect = el.getBoundingClientRect();
      const clientX = Math.round(rect.left + rect.width / 2);
      const clientY = Math.round(rect.top + rect.height / 2);
      const init = { bubbles: true, cancelable: true, view: window, clientX, clientY, buttons: 0 };
      if (typeof PointerEvent !== 'undefined') {
        el.dispatchEvent(new PointerEvent('pointerleave', { ...init, pointerType: 'mouse', isPrimary: true }));
      }
      if (typeof MouseEvent !== 'undefined') {
        el.dispatchEvent(new MouseEvent('mouseleave', init));
      }
    } catch (_) {}
  }

  /* ==========================================================================
     7. STRUCTURAL CARD-ONLY FILTERING & DISCOVERY
     ========================================================================== */
  let cachedFocusableCards = null;
  let lastCardsScanTime = 0;
  const CARDS_CACHE_TTL_MS = 600;

  let cachedHeaderItems = null;
  let lastHeaderScanTime = 0;
  const HEADER_CACHE_TTL_MS = 1000;

  function invalidateCardsCache() {
    cachedFocusableCards = null;
    lastCardsScanTime = 0;
    cachedHeaderItems = null;
    lastHeaderScanTime = 0;
  }

  // Auto-invalidate cache on dynamic DOM updates
  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    const observer = new MutationObserver(() => {
      invalidateCardsCache();
    });
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        if (document.body) observer.observe(document.body, { childList: true, subtree: true });
      });
    }
  }

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) < 0.08) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isJunkElement(el) {
    if (!el || el.nodeType !== 1) return true;

    // Internal MOM TV overlay elements
    if (el.closest('#momtv-exit-backdrop, #momtv-exit-dialog, #momtv-hud-pill, #momtv-player-action-bar, .momtv-internal')) {
      return true;
    }

    const JUNK_SELECTORS = [
      'footer',
      '[role="contentinfo"]',
      '#footer',
      '.footer',
      '.site-footer',
      '[id*="cookie" i]',
      '[class*="cookie" i]',
      '[id*="consent" i]',
      '[class*="consent" i]',
      '[aria-label*="cookie" i]',
      '[aria-label*="consent" i]',
      '.qc-cmp2-container',
      '#onetrust-consent-sdk',
      '.ad-container',
      '.ad-banner',
      '.advertisement',
      '[id*="google_ads" i]',
      '[class*="google_ads" i]',
      '[id*="advertisement" i]',
      'ytd-channel-name',
      '#avatar-link',
      'yt-icon',
      'ytd-menu-renderer',
      '#guide-button',
      '#voice-search-button',
      '#notification-preference-button',
      'script',
      'style',
      'noscript',
      'svg',
      'path',
      '[aria-hidden="true"]'
    ];

    try {
      if (el.matches && el.matches(JUNK_SELECTORS.join(','))) return true;
      if (el.closest && el.closest(JUNK_SELECTORS.join(','))) return true;
    } catch (_) {}

    const txt = (el.innerText || '').trim().toLowerCase();
    if (txt.length > 0 && txt.length < 60) {
      if (/privacy policy|terms of service|copyright|cookie policy|all rights reserved/i.test(txt)) {
        return true;
      }
    }

    return false;
  }

  function isInHeaderNav(el) {
    if (!el || !el.closest) return false;
    return Boolean(el.closest('header, nav, [role="navigation"], #masthead, .header-bar, .navbar, .nav-bar, #header'));
  }

  function isSearchInput(el) {
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      return ['text', 'search'].includes(t) || !el.hasAttribute('type');
    }
    return el.getAttribute('role') === 'searchbox';
  }

  function isPrimaryActionButton(el) {
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'button' || el.getAttribute('role') === 'button') {
      const rect = el.getBoundingClientRect();
      return rect.width >= 50 && rect.height >= 24;
    }
    return false;
  }

  function getFocusableCards(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedFocusableCards && (now - lastCardsScanTime < CARDS_CACHE_TTL_MS)) {
      const valid = cachedFocusableCards.filter(isElementInDoc);
      if (valid.length > 0) {
        return valid;
      }
    }

    const CARD_SELECTORS = [
      // Semantic card elements
      'article',
      '[role="article"]',

      // Data attributes & testids on streaming platforms (Hotstar, Prime, Netflix, JioCinema, Zee5)
      '[data-testid*="tray" i]',
      '[data-testid*="card" i]',
      '[data-testid*="item" i]',
      '[data-testid*="title" i]',
      '[data-testid*="poster" i]',
      '[data-testid*="thumb" i]',
      '[data-uia*="card" i]',
      '[data-card]',

      // Class patterns for movie/show card containers
      'div[class*="card" i]:not([class*="card-list" i]):not([class*="cards-grid" i])',
      'div[class*="poster" i]',
      'div[class*="tray-item" i]',
      'div[class*="slider-item" i]',
      'div[class*="tile" i]',
      'div[class*="thumb" i]',
      '.title-card',
      '.slider-item',
      '.app-card',
      '.video-card',
      '.movie-card',
      '.media-card',
      '.show-card',

      // Streaming media navigation links
      'a[href*="/watch"]',
      'a[href*="/title/"]',
      'a[href*="/movies/"]',
      'a[href*="/shows/"]',
      'a[href*="/series/"]',
      'a[href*="/play/"]',
      'a[href*="/video/"]',
      'a[href*="/detail/"]',

      // YouTube web items
      'ytd-rich-item-renderer',
      'ytd-video-renderer',
      'ytd-grid-video-renderer',
      'ytd-compact-video-renderer',
      'ytd-reel-item-renderer',
      'ytd-playlist-renderer',
      'ytd-thumbnail',

      // Standalone primary buttons outside header nav
      'button:not([disabled])',
      '[role="button"]',

      // Universal interactive web elements (Links, Controls, Tabs, Inputs)
      'a[href]',
      '[role="button"]:not([aria-disabled="true"])',
      '[role="link"]',
      '[role="tab"]',
      '[role="menuitem"]',
      '[role="checkbox"]',
      '[role="radio"]',
      'input:not([type="hidden"]):not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])'
    ];

    const rawElements = Array.from(document.querySelectorAll(CARD_SELECTORS.join(',')));
    const candidates = [];

    for (const el of rawElements) {
      if (isJunkElement(el)) continue;
      if (isInHeaderNav(el)) continue;
      if (!isVisible(el)) continue;

      const rect = el.getBoundingClientRect();
      const isCardGeom = rect.width >= 75 && rect.height >= 40;
      const isBtnGeom = isPrimaryActionButton(el) && rect.width >= 40 && rect.height >= 20;
      const tag = (el.tagName || '').toUpperCase();
      const isInteractiveTag = tag === 'A' || tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
      const isSmallInteractive = (isInteractiveTag || el.hasAttribute('tabindex')) && rect.width >= 16 && rect.height >= 16;

      if (!isCardGeom && !isBtnGeom && !isSmallInteractive) continue;

      el._momTvRect = rect;
      candidates.push(el);
    }

    // Smart Deduplication:
    // If elements are nested inside each other, keep the full visual card box and bind the primary action target
    const uniqueCards = [];
    for (let i = 0; i < candidates.length; i++) {
      const c1 = candidates[i];
      let dominatedByOther = false;

      for (let j = 0; j < candidates.length; j++) {
        if (i === j) continue;
        const c2 = candidates[j];

        if (c2.contains(c1)) {
          const r2 = c2._momTvRect || c2.getBoundingClientRect();
          const r1 = c1._momTvRect || c1.getBoundingClientRect();

          // If c2 is a broad row holding multiple items horizontally, c1 is the real individual card!
          if (r2.width > r1.width * 1.8) {
            continue;
          }

          // Otherwise c2 is the card container wrapping c1
          c2._momTvActionTarget = findActionTarget(c1) || c1;
          dominatedByOther = true;
          break;
        }
      }

      if (!dominatedByOther && !uniqueCards.includes(c1)) {
        if (!c1._momTvActionTarget) {
          c1._momTvActionTarget = findActionTarget(c1) || c1;
        }
        uniqueCards.push(c1);
      }
    }

    for (const card of uniqueCards) {
      if (!card.hasAttribute('tabindex') || card.getAttribute('tabindex') === '-1') {
        card.setAttribute('tabindex', '0');
      }
      card.setAttribute('data-tv-card', 'true');
    }

    cachedFocusableCards = uniqueCards;
    lastCardsScanTime = Date.now();
    return uniqueCards;
  }

  function getHeaderItems(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedHeaderItems && (now - lastHeaderScanTime < HEADER_CACHE_TTL_MS)) {
      const valid = cachedHeaderItems.filter(isElementInDoc);
      if (valid.length > 0) return valid;
    }

    const HEADER_SELECTORS = [
      'input[type="search"]',
      'input[type="text"]',
      'input:not([type])',
      '[role="searchbox"]',
      'header a[href]',
      'header button:not([disabled])',
      'nav a[href]',
      'nav button:not([disabled])',
      '[role="navigation"] a[href]',
      '[role="navigation"] button:not([disabled])',
      '#masthead a[href]',
      '#masthead button:not([disabled])'
    ];

    const raw = Array.from(document.querySelectorAll(HEADER_SELECTORS.join(',')));
    const valid = [];

    for (const el of raw) {
      if (isJunkElement(el)) continue;
      if (!isVisible(el)) continue;

      const rect = el.getBoundingClientRect();
      el._momTvRect = rect;
      if (isSearchInput(el)) {
        if (rect.width >= 60 && rect.height >= 24) valid.push(el);
      } else if (rect.width >= 45 && rect.height >= 24) {
        valid.push(el);
      }
    }

    valid.sort((a, b) => {
      const ra = a._momTvRect || a.getBoundingClientRect();
      const rb = b._momTvRect || b.getBoundingClientRect();
      return ra.left - rb.left;
    });

    cachedHeaderItems = valid;
    lastHeaderScanTime = Date.now();
    return valid;
  }

  /* ==========================================================================
     8. 2D ROW & COLUMN GRID MATRIX (SNAP-TO-CARD NAVIGATION)
     ========================================================================== */
  let currentFocusedElement = null;
  let isInHeaderMode = false;

  function buildCardGrid(providedCards) {
    const cards = providedCards || getFocusableCards();
    if (!cards.length) return [];

    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;

    const cardItems = cards.map((el) => {
      const rect = el._momTvRect || el.getBoundingClientRect();
      const top = rect.top + scrollY;
      const bottom = top + rect.height;
      const left = rect.left + scrollX;
      const right = left + rect.width;
      const centerX = left + rect.width / 2;
      const centerY = top + rect.height / 2;
      return { el, rect, top, bottom, left, right, centerX, centerY, width: rect.width, height: rect.height };
    });

    cardItems.sort((a, b) => (a.top !== b.top ? a.top - b.top : a.left - b.left));

    // Cluster cards into horizontal rows with 35px vertical tolerance
    const rows = [];
    for (const item of cardItems) {
      let matchedRow = null;

      for (const row of rows) {
        const midDiff = Math.abs(item.centerY - row.centerY);
        const overlap = Math.min(item.bottom, row.bottom) - Math.max(item.top, row.top);
        const minH = Math.min(item.height, row.avgHeight);

        if (midDiff <= 35 || overlap >= 0.35 * minH) {
          matchedRow = row;
          break;
        }
      }

      if (matchedRow) {
        matchedRow.cards.push(item);
        matchedRow.top = Math.min(matchedRow.top, item.top);
        matchedRow.bottom = Math.max(matchedRow.bottom, item.bottom);
        matchedRow.centerY = (matchedRow.top + matchedRow.bottom) / 2;
        matchedRow.avgHeight = (matchedRow.avgHeight * (matchedRow.cards.length - 1) + item.height) / matchedRow.cards.length;
      } else {
        rows.push({
          top: item.top,
          bottom: item.bottom,
          centerY: item.centerY,
          avgHeight: item.height,
          cards: [item]
        });
      }
    }

    rows.sort((a, b) => a.top - b.top);

    for (const r of rows) {
      r.cards.sort((a, b) => a.left - b.left);
    }

    return rows;
  }

  function findVerticalScrollContainer(el) {
    let node = el ? el.parentElement : null;
    while (node && node !== document.body && node !== document.documentElement) {
      if (node.scrollHeight > node.clientHeight + 40) {
        const style = window.getComputedStyle(node);
        const oy = style.overflowY;
        if (oy === 'auto' || oy === 'scroll') {
          return node;
        }
      }
      node = node.parentElement;
    }
    return window;
  }

  function tryPaginateCarousel(cardEl, direction) {
    if (!cardEl) return false;
    let node = cardEl.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      const chevronSelector = direction === 'right'
        ? [
            'button[aria-label*="next" i]',
            'button[aria-label*="right" i]',
            'button[aria-label*="forward" i]',
            '[class*="chevron-right" i]',
            '[class*="arrow-right" i]',
            '[class*="next-button" i]',
            '[class*="slider-right" i]',
            '[data-testid*="next" i]',
            '[data-uia*="next" i]',
            '.next-btn',
            '.slider-button-next'
          ].join(',')
        : [
            'button[aria-label*="prev" i]',
            'button[aria-label*="previous" i]',
            'button[aria-label*="left" i]',
            '[class*="chevron-left" i]',
            '[class*="arrow-left" i]',
            '[class*="prev-button" i]',
            '[class*="slider-left" i]',
            '[data-testid*="prev" i]',
            '[data-uia*="prev" i]',
            '.prev-btn',
            '.slider-button-prev'
          ].join(',');

      const btn = node.querySelector(chevronSelector);
      if (btn && isVisible(btn)) {
        btn.click();
        return true;
      }

      if (node.scrollWidth > node.clientWidth + 30) {
        const style = window.getComputedStyle(node);
        const ox = style.overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') {
          const delta = Math.round(node.clientWidth * 0.75) * (direction === 'right' ? 1 : -1);
          node.scrollBy({ left: delta, behavior: 'smooth' });
          return true;
        }
      }

      node = node.parentElement;
    }
    return false;
  }

  /**
   * Auto-Scroll to Center: Smoothly scrolls the focused card into vertical ~40%
   */
  function scrollIntoComfortZone(el) {
    if (!el) return;

    // 1. Vertical alignment to ~40% viewport height
    const rect = el.getBoundingClientRect();
    const targetY = window.innerHeight * 0.40;
    const diffY = (rect.top + rect.height / 2) - targetY;

    const scrollContainer = findVerticalScrollContainer(el);
    if (scrollContainer && scrollContainer !== window) {
      scrollContainer.scrollBy({ top: diffY, behavior: 'smooth' });
    } else if (Math.abs(diffY) > 20) {
      window.scrollBy({ top: diffY, behavior: 'smooth' });
    }

    // 2. Horizontal alignment for trays / carousels
    let parent = el.parentElement;
    while (parent && parent !== document.body && parent !== document.documentElement) {
      if (parent.scrollWidth > parent.clientWidth + 20) {
        const pStyle = window.getComputedStyle(parent);
        const ox = pStyle.overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') {
          const pRect = parent.getBoundingClientRect();
          const cardRelLeft = rect.left - pRect.left;
          const targetX = pRect.width * 0.22;
          const diffX = cardRelLeft - targetX;
          if (Math.abs(diffX) > 15) {
            parent.scrollBy({ left: diffX, behavior: 'smooth' });
          }
          break;
        }
      }
      parent = parent.parentElement;
    }
  }

  function setFocus(el) {
    if (currentFocusedElement && currentFocusedElement !== el) {
      currentFocusedElement.classList.remove('momtv-card-focused');
      currentFocusedElement.classList.remove('momtv-focused');
      currentFocusedElement.classList.remove('momtv-focused-input');
      emulateMouseLeave(currentFocusedElement);
    }

    currentFocusedElement = el;

    if (el) {
      isInHeaderMode = Boolean(isInHeaderNav(el));

      if (isSearchInput(el)) {
        el.classList.add('momtv-focused-input');
      } else {
        el.classList.add('momtv-card-focused');
        el.classList.add('momtv-focused');
      }

      try {
        el.focus({ preventScroll: true });
      } catch (_) {}

      // Auto-scroll to center (~40%)
      scrollIntoComfortZone(el);
      emulateMouseHover(el);
      playSound('focus');
    }
  }

  function findSpatialCandidate(currentEl, direction, providedCards) {
    if (!currentEl) return null;
    const curRect = currentEl._momTvRect || currentEl.getBoundingClientRect();
    const curCenterX = curRect.left + curRect.width / 2;
    const curCenterY = curRect.top + curRect.height / 2;

    const allCards = providedCards || getFocusableCards();
    const headerItems = getHeaderItems();
    const candidates = Array.from(new Set([...allCards, ...headerItems]));

    let bestCandidate = null;
    let minScore = Infinity;

    for (const el of candidates) {
      if (el === currentEl || !isVisible(el) || isJunkElement(el)) continue;
      const rect = el._momTvRect || el.getBoundingClientRect();
      const elCenterX = rect.left + rect.width / 2;
      const elCenterY = rect.top + rect.height / 2;

      let isValidDir = false;
      let primaryDist = 0;
      let secondaryDist = 0;
      let hasOverlap = false;

      if (direction === 'right') {
        if (rect.left >= curRect.right - 15 || elCenterX > curCenterX + 10) {
          isValidDir = true;
          primaryDist = Math.max(0, rect.left - curRect.right);
          secondaryDist = Math.abs(elCenterY - curCenterY);
          hasOverlap = (rect.top < curRect.bottom && rect.bottom > curRect.top);
        }
      } else if (direction === 'left') {
        if (rect.right <= curRect.left + 15 || elCenterX < curCenterX - 10) {
          isValidDir = true;
          primaryDist = Math.max(0, curRect.left - rect.right);
          secondaryDist = Math.abs(elCenterY - curCenterY);
          hasOverlap = (rect.top < curRect.bottom && rect.bottom > curRect.top);
        }
      } else if (direction === 'down') {
        if (rect.top >= curRect.bottom - 15 || elCenterY > curCenterY + 10) {
          isValidDir = true;
          primaryDist = Math.max(0, rect.top - curRect.bottom);
          secondaryDist = Math.abs(elCenterX - curCenterX);
          hasOverlap = (rect.left < curRect.right && rect.right > curRect.left);
        }
      } else if (direction === 'up') {
        if (rect.bottom <= curRect.top + 15 || elCenterY < curCenterY - 10) {
          isValidDir = true;
          primaryDist = Math.max(0, curRect.top - rect.bottom);
          secondaryDist = Math.abs(elCenterX - curCenterX);
          hasOverlap = (rect.left < curRect.right && rect.right > curRect.left);
        }
      }

      if (isValidDir) {
        const weight = (direction === 'left' || direction === 'right') ? 2.5 : 1.8;
        let score = Math.hypot(primaryDist, secondaryDist * weight);
        if (hasOverlap) {
          score *= 0.65;
        }
        if (score < minScore) {
          minScore = score;
          bestCandidate = el;
        }
      }
    }

    return bestCandidate;
  }

  function autoFocusFirstElement() {
    if (isYouTubeTVPage() || isInternalMomTVPage()) return;
    if (currentFocusedElement && isElementInDoc(currentFocusedElement)) return;
    const cards = getFocusableCards();
    if (cards.length > 0) {
      let best = cards[0];
      let minScore = Infinity;
      for (const c of cards) {
        const r = c._momTvRect || c.getBoundingClientRect();
        if (r.top >= 0 && r.left >= 0 && r.top < window.innerHeight && r.left < window.innerWidth) {
          const s = r.top * 1.5 + r.left;
          if (s < minScore) {
            minScore = s;
            best = c;
          }
        }
      }
      setFocus(best);
    } else {
      const headers = getHeaderItems();
      if (headers.length > 0) {
        setFocus(headers[0]);
      }
    }
  }

  // Attempt initial focus after dynamic page hydration
  if (typeof document !== 'undefined') {
    if (document.readyState === 'complete') {
      setTimeout(autoFocusFirstElement, 350);
    } else {
      window.addEventListener('load', () => setTimeout(autoFocusFirstElement, 350), { once: true });
    }
  }

  function moveFocus(direction) {
    // 0. Auto-Focus fallback if no element currently focused or detached from DOM
    if (!currentFocusedElement || !isElementInDoc(currentFocusedElement)) {
      autoFocusFirstElement();
      if (currentFocusedElement) return true;
      return false;
    }

    // A. Header Navigation Mode
    if (isInHeaderMode) {
      const headerItems = getHeaderItems();
      if (!headerItems.length) {
        isInHeaderMode = false;
      } else {
        let curIdx = headerItems.indexOf(currentFocusedElement);
        if (curIdx === -1) curIdx = 0;

        if (direction === 'left') {
          if (curIdx > 0) {
            setFocus(headerItems[curIdx - 1]);
            return true;
          }
          playSound('focus');
          return true;
        }

        if (direction === 'right') {
          if (curIdx < headerItems.length - 1) {
            setFocus(headerItems[curIdx + 1]);
            return true;
          }
          playSound('focus');
          return true;
        }

        if (direction === 'up') {
          playSound('focus');
          return true;
        }

        if (direction === 'down') {
          isInHeaderMode = false;
          const cards = getFocusableCards();
          const next = findSpatialCandidate(currentFocusedElement, 'down', cards);
          if (next) {
            setFocus(next);
            return true;
          }
          const grid = buildCardGrid(cards);
          if (grid.length > 0 && grid[0].cards.length > 0) {
            setFocus(grid[0].cards[0].el);
            return true;
          }
          return false;
        }
      }
    }

    // B. Standard Grid Step First (Preserves existing matrix navigation)
    const cards = getFocusableCards();
    const grid = buildCardGrid(cards);
    let currentRowIdx = -1;
    let currentColIdx = -1;

    if (currentFocusedElement && grid.length > 0) {
      for (let r = 0; r < grid.length; r++) {
        const cIdx = grid[r].cards.findIndex((c) => c.el === currentFocusedElement);
        if (cIdx !== -1) {
          currentRowIdx = r;
          currentColIdx = cIdx;
          break;
        }
      }
    }

    // If cleanly in row/column matrix, attempt adjacent move
    if (currentRowIdx !== -1 && currentColIdx !== -1) {
      const currentRow = grid[currentRowIdx];
      const currentCard = currentRow.cards[currentColIdx];

      if (direction === 'left' && currentColIdx > 0) {
        setFocus(currentRow.cards[currentColIdx - 1].el);
        return true;
      }
      if (direction === 'right' && currentColIdx < currentRow.cards.length - 1) {
        setFocus(currentRow.cards[currentColIdx + 1].el);
        return true;
      }
      if (direction === 'down' && currentRowIdx < grid.length - 1) {
        const nextRow = grid[currentRowIdx + 1];
        let bestCard = nextRow.cards[0].el;
        let minDiff = Infinity;
        for (const c of nextRow.cards) {
          const diff = Math.abs(c.centerX - currentCard.centerX);
          if (diff < minDiff) {
            minDiff = diff;
            bestCard = c.el;
          }
        }
        setFocus(bestCard);
        return true;
      }
      if (direction === 'up' && currentRowIdx > 0) {
        const prevRow = grid[currentRowIdx - 1];
        let bestCard = prevRow.cards[0].el;
        let minDiff = Infinity;
        for (const c of prevRow.cards) {
          const diff = Math.abs(c.centerX - currentCard.centerX);
          if (diff < minDiff) {
            minDiff = diff;
            bestCard = c.el;
          }
        }
        setFocus(bestCard);
        return true;
      }
      if (direction === 'up' && currentRowIdx === 0) {
        const headerItems = getHeaderItems();
        if (headerItems.length > 0) {
          isInHeaderMode = true;
          let bestHeader = headerItems[0];
          let minDiff = Infinity;
          for (const h of headerItems) {
            const r = h._momTvRect || h.getBoundingClientRect();
            const hCenterX = r.left + r.width / 2;
            const diff = Math.abs(hCenterX - currentCard.centerX);
            if (diff < minDiff) {
              minDiff = diff;
              bestHeader = h;
            }
          }
          setFocus(bestHeader);
          return true;
        }
      }
    }

    // C. 2D Spatial Vector Fallback (For irregular layouts, wrapped cards, sidebars, links)
    const spatialNext = findSpatialCandidate(currentFocusedElement, direction, cards);
    if (spatialNext) {
      isInHeaderMode = Boolean(isInHeaderNav(spatialNext));
      setFocus(spatialNext);
      return true;
    }

    // D. Boundary Actions (Carousel pagination or Page Scrolling)
    if (direction === 'right') {
      const paginated = tryPaginateCarousel(currentFocusedElement, 'right');
      if (paginated) {
        playSound('focus');
        showHUD('More', '►');
        invalidateCardsCache();
        setTimeout(() => {
          const next = findSpatialCandidate(currentFocusedElement, 'right');
          if (next) setFocus(next);
        }, 240);
        return true;
      }
      playSound('focus');
      return true;
    }

    if (direction === 'left') {
      const paginated = tryPaginateCarousel(currentFocusedElement, 'left');
      if (paginated) {
        playSound('focus');
        showHUD('Previous', '◄');
        invalidateCardsCache();
        setTimeout(() => {
          const next = findSpatialCandidate(currentFocusedElement, 'left');
          if (next) setFocus(next);
        }, 240);
        return true;
      }
      playSound('focus');
      return true;
    }

    if (direction === 'down') {
      const scrollContainer = findVerticalScrollContainer(currentFocusedElement);
      const shiftY = Math.round(window.innerHeight * 0.55);
      if (scrollContainer && scrollContainer !== window) {
        scrollContainer.scrollBy({ top: shiftY, behavior: 'smooth' });
      } else {
        window.scrollBy({ top: shiftY, behavior: 'smooth' });
      }
      playSound('focus');
      showHUD('Loading More...', '▼');
      invalidateCardsCache();
      setTimeout(() => {
        const next = findSpatialCandidate(currentFocusedElement, 'down');
        if (next) setFocus(next);
      }, 300);
      return true;
    }

    if (direction === 'up') {
      const scrollContainer = findVerticalScrollContainer(currentFocusedElement);
      const shiftY = Math.round(window.innerHeight * 0.55);
      if (scrollContainer && scrollContainer !== window) {
        scrollContainer.scrollBy({ top: -shiftY, behavior: 'smooth' });
      } else {
        window.scrollBy({ top: -shiftY, behavior: 'smooth' });
      }
      playSound('focus');
      showHUD('Scrolling Up', '▲');
      invalidateCardsCache();
      setTimeout(() => {
        const next = findSpatialCandidate(currentFocusedElement, 'up');
        if (next) setFocus(next);
      }, 300);
      return true;
    }

    return false;
  }

  /* ==========================================================================
     9. BACK NAVIGATION & EXIT DIALOG TRIGGER
     ========================================================================== */
  let lastBackPressTime = 0;
  let consecutiveBackCount = 0;

  function isAtAppRoot() {
    const path = (window.location.pathname || '').toLowerCase();
    const search = window.location.search || '';
    const rootPaths = ['/', '', '/browse', '/home', '/in', '/in/home', '/in/explore', '/tv'];
    if (rootPaths.includes(path) && !search.includes('watch')) {
      return true;
    }
    return false;
  }

  function goBack() {
    playSound('back');

    // 1. If Exit Dialog is open, close it
    if (isExitDialogOpen) {
      hideExitDialog();
      return true;
    }

    // 2. If Player Action Bar is visible, hide it
    if (isActionBarVisible) {
      hidePlayerActionBar();
      return true;
    }

    // 3. Platform adapter player exit (Netflix, Hotstar, Prime, JioCinema)
    if (PlatformAdapters.handleBack()) {
      return true;
    }

    // 4. Exit fullscreen
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      showHUD('Exit Fullscreen');
      return true;
    }

    // 5. Pause active video and exit video mode
    const video = getActiveVideo();
    if (video && !video.paused) {
      video.pause();
      showHUD('Paused');
      isVideoModeEngaged = false;
      return true;
    }

    // 6. Check for app root or rapid multiple back presses
    const now = Date.now();
    if (now - lastBackPressTime < 1800) {
      consecutiveBackCount++;
    } else {
      consecutiveBackCount = 1;
    }
    lastBackPressTime = now;

    // If at app root or user pressed Back multiple times or no previous history:
    // Display the Smart TV Exit Confirmation Dialog!
    if (isAtAppRoot() || consecutiveBackCount >= 2 || window.history.length <= 1) {
      showExitDialog();
      return true;
    }

    // Otherwise, navigate backward in browser history
    if (window.history.length > 1 && !isInternalMomTVPage()) {
      window.history.back();
      return true;
    }

    // Default fallback: show exit dialog
    showExitDialog();
    return true;
  }

  /* ==========================================================================
     9b. VIRTUAL MOUSE CURSOR CONTROLLER (MAGIC TRACKPAD MODE)
     ========================================================================== */
  let cursorX = Math.round(window.innerWidth / 2) || 960;
  let cursorY = Math.round(window.innerHeight / 2) || 540;
  let isCursorVisible = false;
  let cursorHideTimeout = null;
  let virtualCursorEl = null;

  function ensureVirtualCursor() {
    if (!virtualCursorEl || !document.getElementById('momtv-virtual-cursor')) {
      let existing = document.getElementById('momtv-virtual-cursor');
      if (existing) {
        virtualCursorEl = existing;
      } else {
        const cursor = document.createElement('div');
        cursor.id = 'momtv-virtual-cursor';
        cursor.className = 'momtv-internal';
        cursor.innerHTML = `
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 3L11.5 24L15.5 15.5L24 11.5L4 3Z" fill="#00f0ff" stroke="#FFFFFF" stroke-width="1.6" stroke-linejoin="round"/>
            <circle cx="15.5" cy="15.5" r="2.5" fill="#FFFFFF"/>
          </svg>
        `;
        (document.body || document.documentElement).appendChild(cursor);
        virtualCursorEl = cursor;
      }
    }
    return virtualCursorEl;
  }

  function renderCursor() {
    const cursor = ensureVirtualCursor();
    if (cursor) {
      cursor.style.transform = `translate(${cursorX - 4}px, ${cursorY - 3}px)`;
    }
  }

  function showCursor() {
    const cursor = ensureVirtualCursor();
    if (cursor) {
      cursor.classList.add('visible');
    }
    isCursorVisible = true;
    resetCursorTimeout();
  }

  function hideCursor() {
    if (virtualCursorEl) {
      virtualCursorEl.classList.remove('visible');
    }
    isCursorVisible = false;
    if (cursorHideTimeout) {
      clearTimeout(cursorHideTimeout);
      cursorHideTimeout = null;
    }
  }

  function resetCursorTimeout() {
    if (cursorHideTimeout) clearTimeout(cursorHideTimeout);
    cursorHideTimeout = setTimeout(() => {
      hideCursor();
    }, 4000);
  }

  function setCursor(x, y) {
    cursorX = Math.max(0, Math.min(window.innerWidth - 1, Math.round(x)));
    cursorY = Math.max(0, Math.min(window.innerHeight - 1, Math.round(y)));
    renderCursor();
    showCursor();
  }

  function moveCursor(dx, dy) {
    cursorX = Math.max(0, Math.min(window.innerWidth - 1, Math.round(cursorX + dx)));
    cursorY = Math.max(0, Math.min(window.innerHeight - 1, Math.round(cursorY + dy)));
    renderCursor();
    showCursor();

    try {
      const target = document.elementFromPoint(cursorX, cursorY);
      if (target && !target.closest('.momtv-internal, #momtv-virtual-cursor, #momtv-hud-pill, #momtv-player-action-bar, #momtv-exit-backdrop')) {
        target.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: cursorX,
          clientY: cursorY,
          buttons: 0,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true
        }));
        target.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: cursorX,
          clientY: cursorY,
          buttons: 0
        }));
      }
    } catch (_) {}
  }

  function clickCursor() {
    showCursor();
    const cursor = ensureVirtualCursor();
    if (cursor) {
      cursor.classList.add('clicking');
      setTimeout(() => {
        if (cursor) cursor.classList.remove('clicking');
      }, 160);
    }

    playSound('select');

    try {
      const target = document.elementFromPoint(cursorX, cursorY);
      if (target && !target.closest('#momtv-virtual-cursor, .momtv-internal')) {
        const clientX = cursorX;
        const clientY = cursorY;

        if (isSearchInput(target) || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
          try { target.focus(); } catch (_) {}
        }

        const downInit = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: clientX,
          clientY: clientY,
          button: 0,
          buttons: 1,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true
        };
        const upInit = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: clientX,
          clientY: clientY,
          button: 0,
          buttons: 0,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true
        };

        target.dispatchEvent(new PointerEvent('pointerdown', downInit));
        target.dispatchEvent(new MouseEvent('mousedown', downInit));
        target.dispatchEvent(new PointerEvent('pointerup', upInit));
        target.dispatchEvent(new MouseEvent('mouseup', upInit));
        target.dispatchEvent(new MouseEvent('click', upInit));

        try {
          target.click();
        } catch (_) {}

        const innerAction = target.querySelector('.play-button, [class*="play-btn" i], [class*="playButton" i], [data-testid*="play" i], [aria-label*="Play" i], button, a[href]');
        if (innerAction && innerAction !== target) {
          try { innerAction.click(); } catch (_) {}
        }
      }
    } catch (err) {
      console.warn('[MOM TV] Error in clickCursor:', err);
    }

    resetCursorTimeout();
  }

  /* ==========================================================================
     10. PUBLIC window.MomTV API
     ========================================================================== */
  let lastHandledTime = 0;
  let lastHandledKey = '';
  const ENGINE_DEBOUNCE_MS = 140;

  window.MomTV = {
    handleKey: function (keyName) {
      const k = (keyName || '').toLowerCase();
      const now = Date.now();

      initAudio();

      // If Exit Dialog is visible, handle dialog navigation exclusively
      if (isExitDialogOpen) {
        return handleExitDialogKey(k);
      }

      // YouTube TV Leanback compatibility (Cobalt handles keys natively)
      if (isYouTubeTVPage()) {
        if (k === 'back') {
          return goBack();
        }
        return false;
      }

      // MOM TV Launcher internal dashboard compatibility
      if (isInternalMomTVPage() || document.querySelector('.tv-shell')) {
        if (k === 'back') {
          return goBack();
        }
        return false;
      }

      // D-pad mode hides virtual cursor
      if (['up', 'down', 'left', 'right', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        hideCursor();
      }

      // Debounce protection
      if ((now - lastHandledTime) < ENGINE_DEBOUNCE_MS) {
        return true;
      }

      // Video Adapters (Netflix, Hotstar, Prime, JioCinema)
      const video = getActiveVideo();
      if (PlatformAdapters.dispatch(k, video)) {
        lastHandledTime = Date.now();
        lastHandledKey = k;
        return true;
      }

      // Generic Video Player Mode
      if (video && isVideoModeActive()) {
        if (handleVideoKey(k, video)) {
          lastHandledTime = Date.now();
          lastHandledKey = k;
          return true;
        }
      }

      // Fullscreen shortcut
      if (['f', 'fullscreen'].includes(k)) {
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
          showHUD('Windowed', '⛶');
        } else {
          const fsTarget = (video && video.parentElement) || video || document.documentElement;
          if (fsTarget && fsTarget.requestFullscreen) {
            fsTarget.requestFullscreen().catch(() => {});
            showHUD('Fullscreen', '⛶');
          }
        }
        playSound('select');
        lastHandledTime = Date.now();
        lastHandledKey = k;
        return true;
      }

      // Spatial Grid Navigation (◄, ►, ▲, ▼)
      if (['up', 'arrowup'].includes(k)) {
        const handled = moveFocus('up');
        if (handled) {
          lastHandledTime = Date.now();
          lastHandledKey = k;
        }
        return handled;
      }
      if (['down', 'arrowdown'].includes(k)) {
        const handled = moveFocus('down');
        if (handled) {
          lastHandledTime = Date.now();
          lastHandledKey = k;
        }
        return handled;
      }
      if (['left', 'arrowleft'].includes(k)) {
        const handled = moveFocus('left');
        if (handled) {
          lastHandledTime = Date.now();
          lastHandledKey = k;
        }
        return handled;
      }
      if (['right', 'arrowright'].includes(k)) {
        const handled = moveFocus('right');
        if (handled) {
          lastHandledTime = Date.now();
          lastHandledKey = k;
        }
        return handled;
      }

      // OK / Enter selection with direct action execution (link navigation or button click)
      if (['enter', 'ok', 'select'].includes(k)) {
        if (!currentFocusedElement || !isElementInDoc(currentFocusedElement)) {
          autoFocusFirstElement();
        }
        if (currentFocusedElement) {
          playSound('select');
          showHUD('Selected', '✓');
          const res = executeCardAction(currentFocusedElement);
          lastHandledTime = Date.now();
          lastHandledKey = k;
          return res;
        }
      }

      // Back key
      if (['back', 'escape'].includes(k)) {
        const res = goBack();
        if (res) {
          lastHandledTime = Date.now();
          lastHandledKey = k;
        }
        return res;
      }

      return false;
    },

    goBack: goBack,
    showExitDialog: showExitDialog,
    hideExitDialog: hideExitDialog,
    getActiveVideo: getActiveVideo,
    setFocus: setFocus,
    getFocusedElement: () => currentFocusedElement,
    showHUD: showHUD,
    showVideoOSD: showVideoOSD,
    showPlayerActionBar: showPlayerActionBar,
    hidePlayerActionBar: hidePlayerActionBar,
    playSound: playSound,
    buildCardGrid: buildCardGrid,
    getFocusableCards: getFocusableCards,
    invalidateCardsCache: invalidateCardsCache,
    executeCardAction: executeCardAction,
    emulateCoordinateClick: executeCardAction,
    emulateMouseHover: emulateMouseHover,
    moveCursor: moveCursor,
    setCursor: setCursor,
    clickCursor: clickCursor,
    PlatformAdapters: PlatformAdapters
  };

  /* ==========================================================================
     11. PHYSICAL KEYBOARD & AIR MOUSE INTERCEPTION
     ========================================================================== */
  let lastEngineKeyDownTime = 0;

  document.addEventListener('keydown', (e) => {
    const now = Date.now();
    const keyMap = {
      'ArrowUp': 'up',
      'ArrowDown': 'down',
      'ArrowLeft': 'left',
      'ArrowRight': 'right',
      'Enter': 'ok',
      ' ': 'ok',
      'Escape': 'back',
      'Backspace': 'back',
      'BrowserBack': 'back',
      'MediaPlayPause': 'playpause',
      'MediaPlay': 'play',
      'MediaPause': 'pause',
      'MediaTrackPrevious': 'rewind',
      'MediaTrackNext': 'forward'
    };

    const k = keyMap[e.key];
    if (!k) return;

    // Launcher native controller pass-through
    if (isInternalMomTVPage() || document.querySelector('.tv-shell')) {
      if (k === 'back' && window.MomTV.handleKey(k)) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }

    if ((now - lastHandledTime) < ENGINE_DEBOUNCE_MS) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if ((now - lastEngineKeyDownTime) < ENGINE_DEBOUNCE_MS) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Typing exception in text fields
    const active = document.activeElement;
    const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
    if (isTyping && ['ArrowLeft', 'ArrowRight'].includes(e.key) && !active.classList.contains('momtv-focused-input')) {
      return;
    }

    lastEngineKeyDownTime = now;
    const handled = window.MomTV.handleKey(k);
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  console.log('✅ [MOM TV Companion 2.0] Content script loaded successfully. window.MomTV ready.');
})();
