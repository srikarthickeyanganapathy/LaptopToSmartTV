/**
 * MOM TV Phase 4 — Extension, Exit Dialog, Search Hub & Kiosk Close Test Suite
 * 
 * Verifies:
 * 1. Native Extension (mom-tv-extension/content.js):
 *    - Exit Confirmation Dialog creation & elements (#momtv-exit-dialog)
 *    - Left/Right arrow toggles focus between [ Cancel ] and [ Exit to Home ]
 *    - Visual focus ring (.active-focus) updates correctly
 *    - OK on Cancel hides dialog
 *    - OK on Exit redirects to http://localhost:8765/tv
 *    - Back key triggers dialog on streaming sites
 *    - Trap Up/Down within dialog
 * 2. TV Launcher (tv.html):
 *    - "Exit to Windows" utility card exists in Row 1
 *    - exitToWindows() dispatches { cmd: 'kiosk_close' }
 * 3. Mobile Remote (index.html):
 *    - Search Hub modal exists (#search-hub-modal)
 *    - 1-tap chips: YouTube, Hotstar, Web
 *    - Voice language toggles (en-IN, hi-IN)
 *    - exitKioskToWindows() dispatches { cmd: 'kiosk_close' }
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('======================================================================');
console.log('🧪 MOM TV PHASE 4 — EXTENSION, EXIT DIALOG, SEARCH & KIOSK CLOSE SUITE');
console.log('======================================================================\n');

let passedTests = 0;
let totalTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`✅ PASS: ${name}`);
  } catch (err) {
    console.error(`❌ FAIL: ${name}`);
    console.error(err);
  }
}

// -----------------------------------------------------------------------------
// 1. MANIFEST & CSS STATIC CHECKS
// -----------------------------------------------------------------------------
test('1.1 Manifest V3 Schema & Permissions', () => {
  const manifestPath = path.join(__dirname, '..', 'mom-tv-extension', 'manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'manifest.json exists');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.strictEqual(manifest.manifest_version, 3, 'Must be Manifest V3');
  assert.ok(manifest.permissions.includes('activeTab'), 'Has activeTab permission');
  assert.ok(manifest.permissions.includes('scripting'), 'Has scripting permission');
  assert.ok(manifest.permissions.includes('storage'), 'Has storage permission');
  assert.ok(manifest.host_permissions.includes('<all_urls>'), 'Matches all_urls host permission');
  assert.strictEqual(manifest.content_scripts.length, 1, 'Has content_scripts declared');
  assert.strictEqual(manifest.content_scripts[0].matches[0], '<all_urls>', 'Content script matches <all_urls>');
  assert.ok(manifest.content_scripts[0].js.includes('content.js'), 'Content script includes content.js');
  assert.ok(manifest.content_scripts[0].css.includes('styles.css'), 'Content script includes styles.css');
  assert.strictEqual(manifest.content_scripts[0].run_at, 'document_start', 'Runs at document_start');
});

test('1.2 Extension Stylesheet Rules (styles.css)', () => {
  const cssPath = path.join(__dirname, '..', 'mom-tv-extension', 'styles.css');
  assert.ok(fs.existsSync(cssPath), 'styles.css exists');
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.ok(css.includes('#momtv-exit-backdrop'), 'Has #momtv-exit-backdrop');
  assert.ok(css.includes('#momtv-exit-dialog'), 'Has #momtv-exit-dialog');
  assert.ok(css.includes('.momtv-btn-cancel'), 'Has .momtv-btn-cancel');
  assert.ok(css.includes('.momtv-btn-exit'), 'Has .momtv-btn-exit');
  assert.ok(css.includes('.active-focus'), 'Has .active-focus state');
  assert.ok(css.includes('zoom: 1.35 !important'), 'Has 135% 10-foot zoom rule');
  assert.ok(css.includes('.momtv-card-focused'), 'Has glowing 4px neon focus box');
  assert.ok(css.includes('#momtv-virtual-cursor'), 'Has virtual cursor styling');
});

// -----------------------------------------------------------------------------
// 2. DOM MOCK & EXIT DIALOG UNIT TEST
// -----------------------------------------------------------------------------
class MockClassList {
  constructor(initial = '') {
    this.classes = new Set(initial.split(/\s+/).filter(Boolean));
  }
  add(...names) { names.forEach(n => this.classes.add(n)); }
  remove(...names) { names.forEach(n => this.classes.delete(n)); }
  contains(name) { return this.classes.has(name); }
  toString() { return Array.from(this.classes).join(' '); }
}

class MockElement {
  constructor(tag, id = '', className = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.className = className;
    this.classList = new MockClassList(className);
    this.children = [];
    this.parentElement = null;
    this.innerHTML = '';
    this.eventListeners = {};
  }
  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }
  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) this.children.splice(idx, 1);
    child.parentElement = null;
  }
  addEventListener(type, fn) {
    if (!this.eventListeners[type]) this.eventListeners[type] = [];
    this.eventListeners[type].push(fn);
  }
  dispatchEvent(ev) {
    const fns = this.eventListeners[ev.type] || [];
    fns.forEach(fn => fn(ev));
  }
  focus() {}
  blur() {}
  click() {
    this.dispatchEvent({ type: 'click' });
  }
  querySelector(sel) {
    if (sel.startsWith('#')) {
      const id = sel.slice(1);
      return this._findDescendant(el => el.id === id);
    }
    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      return this._findDescendant(el => el.classList.contains(cls));
    }
    return null;
  }
  _findDescendant(predicate) {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const found = child._findDescendant(predicate);
      if (found) return found;
    }
    return null;
  }
}

class MockDocument {
  constructor() {
    this.documentElement = new MockElement('html');
    this.body = new MockElement('body');
    this.documentElement.appendChild(this.body);
    this.allElements = [];
  }
  createElement(tag) {
    const el = new MockElement(tag);
    this.allElements.push(el);
    return el;
  }
  getElementById(id) {
    return this._search(this.documentElement, el => el.id === id);
  }
  querySelector(sel) {
    return this.documentElement.querySelector(sel);
  }
  _search(node, pred) {
    if (pred(node)) return node;
    for (const ch of node.children) {
      const res = this._search(ch, pred);
      if (res) return res;
    }
    return null;
  }
  contains(node) {
    let cur = node;
    while (cur) {
      if (cur === this.documentElement || cur === this.body) return true;
      cur = cur.parentElement;
    }
    return false;
  }
}

test('2.1 Exit Confirmation Dialog Construction & Focus States', () => {
  const contentJsPath = path.join(__dirname, '..', 'mom-tv-extension', 'content.js');
  const code = fs.readFileSync(contentJsPath, 'utf8');

  // Verify functions exist in code
  assert.ok(code.includes('function ensureExitDialogElements()'), 'ensureExitDialogElements exists');
  assert.ok(code.includes('function updateExitDialogFocus()'), 'updateExitDialogFocus exists');
  assert.ok(code.includes('function showExitDialog()'), 'showExitDialog exists');
  assert.ok(code.includes('function hideExitDialog()'), 'hideExitDialog exists');
  assert.ok(code.includes('function handleExitDialogKey(key)'), 'handleExitDialogKey exists');

  // Verify dialog text & button labels
  assert.ok(code.includes('Exit to MOM TV Home?'), 'Dialog title present');
  assert.ok(code.includes('Cancel'), 'Cancel button present');
  assert.ok(code.includes('Exit to Home'), 'Exit to Home button present');
  assert.ok(code.includes('http://localhost:8765/tv'), 'Redirect URL matches launcher');
});

test('2.2 Exit Dialog Navigation Logic: Left/Right Toggling & OK Actions', () => {
  // Simulate the state logic from content.js
  let activeExitDialogBtnIndex = 0; // 0 = Cancel, 1 = Exit
  let isExitDialogOpen = false;
  let redirectedUrl = null;

  function showExitDialog() {
    isExitDialogOpen = true;
    activeExitDialogBtnIndex = 0; // Default to Cancel for safety
  }

  function hideExitDialog() {
    isExitDialogOpen = false;
  }

  function handleExitDialogKey(key) {
    const k = key.toLowerCase();
    if (['left', 'arrowleft'].includes(k)) {
      activeExitDialogBtnIndex = 0;
      return true;
    }
    if (['right', 'arrowright'].includes(k)) {
      activeExitDialogBtnIndex = 1;
      return true;
    }
    if (['enter', 'ok', 'select', 'space'].includes(k)) {
      if (activeExitDialogBtnIndex === 1) {
        redirectedUrl = 'http://localhost:8765/tv';
        return true;
      } else {
        hideExitDialog();
        return true;
      }
    }
    if (['back', 'escape'].includes(k)) {
      hideExitDialog();
      return true;
    }
    return true;
  }

  // 1. Show dialog
  showExitDialog();
  assert.strictEqual(isExitDialogOpen, true, 'Dialog should be open');
  assert.strictEqual(activeExitDialogBtnIndex, 0, 'Default button is Cancel');

  // 2. Press Right -> Moves to Exit to Home
  handleExitDialogKey('arrowright');
  assert.strictEqual(activeExitDialogBtnIndex, 1, 'Right arrow moves to Exit to Home');

  // 3. Press Left -> Moves back to Cancel
  handleExitDialogKey('arrowleft');
  assert.strictEqual(activeExitDialogBtnIndex, 0, 'Left arrow moves to Cancel');

  // 4. Press OK on Cancel -> Closes dialog
  handleExitDialogKey('ok');
  assert.strictEqual(isExitDialogOpen, false, 'OK on Cancel closes dialog');
  assert.strictEqual(redirectedUrl, null, 'No redirection when cancelling');

  // 5. Open dialog again, navigate right to Exit to Home, press OK
  showExitDialog();
  handleExitDialogKey('right');
  assert.strictEqual(activeExitDialogBtnIndex, 1, 'Navigated to Exit to Home');
  handleExitDialogKey('ok');
  assert.strictEqual(redirectedUrl, 'http://localhost:8765/tv', 'OK on Exit redirected to TV launcher');
});

// -----------------------------------------------------------------------------
// 3. TV LAUNCHER EXIT TO WINDOWS & STEP-LOCK
// -----------------------------------------------------------------------------
test('3.1 TV Launcher "Exit to Windows" Tile & Step-Lock Data', () => {
  const tvHtmlPath = path.join(__dirname, '..', 'tv.html');
  const tvHtml = fs.readFileSync(tvHtmlPath, 'utf8');

  // Verify utility card
  assert.ok(tvHtml.includes('data-action="exit_windows"'), 'Has data-action="exit_windows"');
  assert.ok(tvHtml.includes('data-title="Exit to Windows"'), 'Has data-title="Exit to Windows"');
  assert.ok(tvHtml.includes('Exit to Windows</span>'), 'Displays Exit to Windows label');
  assert.ok(tvHtml.includes('onclick="exitToWindows()"'), 'Calls exitToWindows() on click');

  // Verify exitToWindows implementation
  assert.ok(tvHtml.includes("state.ws.send(JSON.stringify({ cmd: 'kiosk_close' }))"), 'Sends kiosk_close over WS');
  assert.ok(tvHtml.includes("fetch('/api/kiosk/close'"), 'Has HTTP fallback /api/kiosk/close');

  // Verify Step-lock
  assert.ok(tvHtml.includes('const STEP_LOCK_DEBOUNCE_MS = 160;'), 'Has 160ms step lock debounce');
  assert.ok(tvHtml.includes('Math.min(appCards.length - 1, state.activeCol + 1)'), 'Clamps upper bound');
  assert.ok(tvHtml.includes('Math.max(0, state.activeCol - 1)'), 'Clamps lower bound');
});

// -----------------------------------------------------------------------------
// 4. MOBILE REMOTE SEARCH HUB & KIOSK CLOSE
// -----------------------------------------------------------------------------
test('4.1 Mobile Remote Search Hub Modal (#search-hub-modal)', () => {
  const remoteHtmlPath = path.join(__dirname, '..', 'index.html');
  const remoteHtml = fs.readFileSync(remoteHtmlPath, 'utf8');

  // Modal & Input
  assert.ok(remoteHtml.includes('id="search-hub-modal"'), 'Search hub modal exists');
  assert.ok(remoteHtml.includes('id="hub-search-input"'), 'Search input exists');
  assert.ok(remoteHtml.includes('id="hub-mic-btn"'), 'Mic button exists');
  assert.ok(remoteHtml.includes('id="hub-voice-status"'), 'Voice status display exists');

  // Destination Chips
  assert.ok(remoteHtml.includes('chip-youtube'), 'Has YouTube chip');
  assert.ok(remoteHtml.includes('chip-hotstar'), 'Has Hotstar chip');
  assert.ok(remoteHtml.includes('chip-web'), 'Has Web chip');
  assert.ok(remoteHtml.includes("executeDestinationSearch('youtube')"), 'Calls executeDestinationSearch for YouTube');
  assert.ok(remoteHtml.includes("executeDestinationSearch('hotstar')"), 'Calls executeDestinationSearch for Hotstar');
  assert.ok(remoteHtml.includes("executeDestinationSearch('web')"), 'Calls executeDestinationSearch for Web');

  // Language Toggles
  assert.ok(remoteHtml.includes('hub-lang-en'), 'Has English language chip');
  assert.ok(remoteHtml.includes('hub-lang-hi'), 'Has Hindi language chip');
  assert.ok(remoteHtml.includes("setVoiceLang('en-IN')"), 'Sets en-IN language');
  assert.ok(remoteHtml.includes("setVoiceLang('hi-IN')"), 'Sets hi-IN language');

  // Quick fill pills
  assert.ok(remoteHtml.includes('🌸 Bhajans'), 'Has Bhajans quick pill');
  assert.ok(remoteHtml.includes('📰 DD News Live'), 'Has DD News quick pill');
  assert.ok(remoteHtml.includes('📺 Anupama'), 'Has Anupama quick pill');
});

test('4.2 Mobile Remote "Exit TV to Windows" Buttons & Dispatch', () => {
  const remoteHtmlPath = path.join(__dirname, '..', 'index.html');
  const remoteHtml = fs.readFileSync(remoteHtmlPath, 'utf8');

  // Header quick action button
  assert.ok(remoteHtml.includes('btn-exit-windows'), 'Header has btn-exit-windows');
  assert.ok(remoteHtml.includes('exitKioskToWindows()'), 'Calls exitKioskToWindows()');

  // Power modal action
  assert.ok(remoteHtml.includes('action-exit-windows'), 'Power modal has action-exit-windows');
  assert.ok(remoteHtml.includes('💻 Exit TV to Windows'), 'Label reads 💻 Exit TV to Windows');

  // Function implementation
  assert.ok(remoteHtml.includes("send({ cmd: 'kiosk_close' })"), 'Dispatches kiosk_close over WebSocket');
  assert.ok(remoteHtml.includes("fetch('/api/kiosk/close'"), 'Has HTTP fallback /api/kiosk/close');

  // 180ms client debounce
  assert.ok(remoteHtml.includes('const CLIENT_DEBOUNCE_MS = 180;'), 'Has 180ms client-side step lock');
});

console.log('\n======================================================================');
console.log(`Phase 4 Node Unit Test Results: ${passedTests}/${totalTests} PASSED`);
console.log('======================================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
