/**
 * MOM TV 2.0 — TV Engine & Launcher Step-Lock Automated Verification Suite
 * 
 * Verifies that on both tv.html (10-Foot TV Launcher) and arbitrary web pages (tv-engine.js):
 * 1. Sending an arrow key moves focus by EXACTLY 1 card and NEVER 2 tiles.
 * 2. Rapid key events arriving within debounce window (160ms on tv.html, 220ms on tv-engine.js)
 *    are cleanly dropped with preventDefault() and stopPropagation().
 * 3. Dual-layer events (CDP handleKey + native/synthetic DOM keydown) are strictly suppressed.
 * 4. Acoustic audio feedback is played exactly once per valid step.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('======================================================================');
console.log('🧪 MOM TV 2.0 — STEP-LOCK & SINGLE-CARD NAVIGATION TEST SUITE');
console.log('======================================================================\n');

// -----------------------------------------------------------------------------
// DOM MOCK IMPLEMENTATION
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

class MockStyle {
  constructor() {
    this._props = {};
  }
  setProperty(name, val) { this._props[name] = String(val); }
  getPropertyValue(name) { return this._props[name] || ''; }
  removeProperty(name) { delete this._props[name]; }
}

class MockElement {
  constructor(tag, id = '', className = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.className = className;
    this.classList = new MockClassList(className);
    this.attributes = new Map();
    this.dataset = {};
    this.children = [];
    this.parentElement = null;
    this.nodeType = 1;
    this.style = new MockStyle();
    this.rect = { left: 0, top: 0, width: 250, height: 165, right: 250, bottom: 165 };
    this.dispatchedEvents = [];
    this.textContent = '';
    this.innerHTML = '';
  }

  getAttribute(name) {
    if (name === 'class') return this.classList.toString();
    if (name === 'id') return this.id;
    return this.attributes.get(name) || null;
  }

  setAttribute(name, val) {
    this.attributes.set(name, String(val));
    if (name === 'id') this.id = String(val);
    if (name === 'class') {
      this.className = String(val);
      this.classList = new MockClassList(String(val));
    }
  }

  hasAttribute(name) {
    if (name === 'class') return this.classList.classes.size > 0;
    if (name === 'id') return Boolean(this.id);
    return this.attributes.has(name);
  }

  appendChild(child) {
    if (child.parentElement) child.parentElement.removeChild(child);
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentElement = null;
    }
    return child;
  }

  getBoundingClientRect() { return this.rect; }
  scrollIntoView() {}
  focus() {}
  click() {}

  addEventListener(type, fn, opts) {
    if (!this._listeners) this._listeners = {};
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push({ fn, opts });
  }

  dispatchEvent(evt) {
    this.dispatchedEvents.push(evt);
    if (this._listeners && this._listeners[evt.type]) {
      for (const listener of this._listeners[evt.type]) {
        listener.fn(evt);
        if (evt.propagationStopped) break;
      }
    }
    return !evt.defaultPrevented;
  }

  querySelectorAll(sel) {
    const results = [];
    const check = (node) => {
      for (const child of node.children) {
        if (child.matches && child.matches(sel)) results.push(child);
        check(child);
      }
    };
    check(this);
    return results;
  }

  querySelector(sel) {
    const all = this.querySelectorAll(sel);
    return all.length > 0 ? all[0] : null;
  }

  contains(other) {
    if (other === this) return true;
    for (const c of this.children) {
      if (c.contains && c.contains(other)) return true;
    }
    return false;
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (curr.matches && curr.matches(selector)) return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  matches(sel) {
    const parts = sel.split(',').map(s => s.trim().toLowerCase());
    const tag = this.tagName.toLowerCase();
    const id = (this.id || '').toLowerCase();
    const cls = (this.classList.toString() || '').toLowerCase();

    for (const part of parts) {
      if (part === tag) return true;
      if (part.startsWith('#') && id === part.slice(1)) return true;
      if (part.startsWith('.') && this.classList.contains(part.slice(1))) return true;

      // Handle tag.class or tag#id or tag[attr]
      if (part.startsWith(tag + '.')) {
        const c = part.slice(tag.length + 1);
        if (this.classList.contains(c)) return true;
      }

      // Handle attribute contains [attr*="val"]
      const attrMatch = part.match(/(?:[a-zA-Z0-9_-]+)?\[([a-zA-Z0-9_-]+)\*="([^"]+)"(?:\s*i)?\]/);
      if (attrMatch) {
        const attrName = attrMatch[1].toLowerCase();
        const attrVal = attrMatch[2].toLowerCase();
        let elVal = '';
        if (attrName === 'class') elVal = cls;
        else if (attrName === 'id') elVal = id;
        else elVal = (this.getAttribute(attrName) || '').toLowerCase();
        if (elVal.includes(attrVal)) return true;
      }

      // Handle exact attribute [attr="val"]
      const exactMatch = part.match(/(?:[a-zA-Z0-9_-]+)?\[([a-zA-Z0-9_-]+)="([^"]+)"\]/);
      if (exactMatch) {
        const attrName = exactMatch[1];
        const attrVal = exactMatch[2];
        if (this.getAttribute(attrName) === attrVal) return true;
      }

      // Handle attribute existence [attr]
      const hasMatch = part.match(/\[([a-zA-Z0-9_-]+)\]/);
      if (hasMatch) {
        if (this.hasAttribute(hasMatch[1])) return true;
      }
    }
    return false;
  }
}

class MockKeyboardEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.key = init.key || '';
    this.code = init.code || '';
    this.bubbles = init.bubbles !== false;
    this.cancelable = init.cancelable !== false;
    this.defaultPrevented = false;
    this.propagationStopped = false;
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.propagationStopped = true; }
}

// =============================================================================
// PART 1: TV LAUNCHER (tv.html) AUTOMATED STEP-LOCK TESTS
// =============================================================================
console.log('----------------------------------------------------------------------');
console.log('📺 PART 1: TESTING TV LAUNCHER (tv.html) STEP-LOCK & EXACT 1-TILE NAV');
console.log('----------------------------------------------------------------------');

function setupTvHtmlEnvironment() {
  const windowListeners = {};
  const docListeners = {};

  const mockDoc = new MockElement('html');
  const mockBody = new MockElement('body');
  mockDoc.appendChild(mockBody);

  // Launcher DOM Shell
  const tvShell = new MockElement('div', 'tv-shell', 'tv-shell');
  mockBody.appendChild(tvShell);

  // Ambient glow & hero elements
  const ambientGlow = new MockElement('div', 'ambient-glow');
  const heroCategory = new MockElement('div', 'hero-category');
  const heroTitle = new MockElement('div', 'hero-title');
  const heroDescription = new MockElement('div', 'hero-description');
  const toastEl = new MockElement('div', 'launch-toast');
  const toastText = new MockElement('span', 'toast-text');
  toastEl.appendChild(toastText);
  const muteLabel = new MockElement('span', 'mute-label');
  const clockEl = new MockElement('div', 'ambient-clock');
  const dateEl = new MockElement('div', 'ambient-date');
  const qrModal = new MockElement('div', 'qr-modal');
  const screensaver = new MockElement('div', 'screensaver');
  const wsDot = new MockElement('span', 'ws-status-dot');
  const wsText = new MockElement('span', 'ws-status-text');

  mockBody.appendChild(ambientGlow);
  mockBody.appendChild(heroCategory);
  mockBody.appendChild(heroTitle);
  mockBody.appendChild(heroDescription);
  mockBody.appendChild(toastEl);
  mockBody.appendChild(muteLabel);
  mockBody.appendChild(clockEl);
  mockBody.appendChild(dateEl);
  mockBody.appendChild(qrModal);
  mockBody.appendChild(screensaver);
  mockBody.appendChild(wsDot);
  mockBody.appendChild(wsText);

  // Screensaver canvas
  const canvas = new MockElement('canvas', 'screensaver-canvas');
  canvas.getContext = () => ({
    clearRect: () => {},
    fillRect: () => {},
    beginPath: () => {},
    arc: () => {},
    fill: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} })
  });
  mockBody.appendChild(canvas);

  // 8 App Cards (Row 0)
  const appCards = [];
  const appNames = ['YouTube TV', 'Netflix', 'Hotstar', 'Prime Video', 'JioCinema', 'ZEE5', 'Bhajans', 'News'];
  for (let i = 0; i < 8; i++) {
    const card = new MockElement('div', `app-${i}`, 'app-card');
    card.dataset.app = appNames[i].toLowerCase().replace(/\s+/g, '');
    card.dataset.title = appNames[i];
    card.dataset.subtitle = 'Stream Live TV';
    card.dataset.category = 'Streaming';
    card.dataset.desc = `Watch ${appNames[i]} on MOM TV`;
    card.dataset.accent = '#FF0000';
    card.dataset.glow = 'rgba(255,0,0,0.5)';
    card.rect = { left: i * 270, top: 200, width: 250, height: 165, right: i * 270 + 250, bottom: 365 };
    tvShell.appendChild(card);
    appCards.push(card);
  }

  // 4 Utility Cards (Row 1)
  const utilCards = [];
  const utilActions = ['qr', 'screensaver', 'mute', 'reload'];
  for (let i = 0; i < 4; i++) {
    const util = new MockElement('div', `util-${i}`, 'util-card');
    util.dataset.action = utilActions[i];
    util.rect = { left: i * 350, top: 500, width: 320, height: 58, right: i * 350 + 320, bottom: 558 };
    tvShell.appendChild(util);
    utilCards.push(util);
  }

  let audioClickCount = 0;

  const mockWindow = {
    location: { hostname: 'localhost', pathname: '/tv', reload: () => {} },
    innerWidth: 1920,
    innerHeight: 1080,
    addEventListener: (type, fn, opts) => {
      if (!windowListeners[type]) windowListeners[type] = [];
      windowListeners[type].push({ fn, useCapture: typeof opts === 'boolean' ? opts : (opts && opts.capture) });
    },
    removeEventListener: () => {},
    dispatchEvent: (evt) => {
      if (windowListeners[evt.type]) {
        for (const l of windowListeners[evt.type]) {
          l.fn(evt);
          if (evt.propagationStopped) break;
        }
      }
      return !evt.defaultPrevented;
    },
    AudioContext: class {
      constructor() { this.currentTime = 0; }
      createOscillator() { return { connect: () => {}, start: () => {}, stop: () => {}, frequency: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} } }; }
      createGain() { return { connect: () => {}, gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, linearRampToValueAtTime: () => {} } }; }
      resume() { return Promise.resolve(); }
    },
    WebSocket: class {
      constructor() { this.readyState = 1; }
      send() {}
      close() {}
    },
    fetch: () => Promise.resolve({ ok: false }),
    requestAnimationFrame: (cb) => setTimeout(cb, 16),
    cancelAnimationFrame: (id) => clearTimeout(id)
  };

  const mockDocument = {
    documentElement: mockDoc,
    head: new MockElement('head'),
    body: mockBody,
    readyState: 'complete',
    getElementById: (id) => {
      const all = mockDoc.querySelectorAll(`#${id}`);
      return all.length > 0 ? all[0] : null;
    },
    querySelectorAll: (sel) => mockDoc.querySelectorAll(sel),
    querySelector: (sel) => mockDoc.querySelector(sel),
    addEventListener: (type, fn, opts) => {
      if (!docListeners[type]) docListeners[type] = [];
      docListeners[type].push({ fn, useCapture: typeof opts === 'boolean' ? opts : (opts && opts.capture) });
    },
    removeEventListener: () => {},
    dispatchEvent: (evt) => {
      if (docListeners[evt.type]) {
        for (const l of docListeners[evt.type]) {
          l.fn(evt);
          if (evt.propagationStopped) break;
        }
      }
      return !evt.defaultPrevented;
    }
  };

  return { mockWindow, mockDocument, appCards, utilCards, tvShell };
}

// Extract script from tv.html and evaluate in mock environment
const tvHtmlPath = fs.existsSync(path.join(__dirname, 'tv.html'))
  ? path.join(__dirname, 'tv.html')
  : path.join(__dirname, '..', 'tv.html');
const tvHtmlContent = fs.readFileSync(tvHtmlPath, 'utf8');
const scriptMatch = tvHtmlContent.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(scriptMatch, 'tv.html must contain a <script> tag');
const tvLauncherScript = scriptMatch[1];

// Helper to boot a fresh tv.html runtime
function bootLauncher() {
  const env = setupTvHtmlEnvironment();
  global.window = env.mockWindow;
  global.document = env.mockDocument;
  global.KeyboardEvent = MockKeyboardEvent;
  global.fetch = env.mockWindow.fetch;
  global.requestAnimationFrame = env.mockWindow.requestAnimationFrame;
  global.cancelAnimationFrame = env.mockWindow.cancelAnimationFrame;

  // Intercept AudioFeedback click
  let originalScript = tvLauncherScript;

  eval(originalScript);

  // Trigger DOMContentLoaded
  const dclEvent = { type: 'DOMContentLoaded' };
  env.mockWindow.dispatchEvent(dclEvent);

  // Hook AudioFeedback click counter
  let clickCount = 0;
  const origClick = env.mockWindow.__tvAudioFeedback.click;
  env.mockWindow.__tvAudioFeedback.click = function () {
    clickCount++;
    return origClick.apply(this, arguments);
  };

  return {
    ...env,
    state: env.mockWindow.__tvState,
    navigate: env.mockWindow.__tvNavigate,
    dispatchKey: (key) => {
      const evt = new MockKeyboardEvent('keydown', { key });
      env.mockWindow.dispatchEvent(evt);
      return evt;
    },
    getAudioClickCount: () => clickCount,
    resetAudioCount: () => { clickCount = 0; }
  };
}

// -----------------------------------------------------------------------------
// TEST 1.1: Single arrow keypress strictly advances by EXACTLY 1 card
// -----------------------------------------------------------------------------
{
  console.log('\n--- TEST 1.1: Single Arrow keypress moves by EXACTLY 1 card ---');
  const tv = bootLauncher();

  assert.strictEqual(tv.state.activeCol, 0, 'Initial activeCol must be 0');
  assert.strictEqual(tv.state.activeRow, 0, 'Initial activeRow must be 0');
  assert.ok(tv.appCards[0].classList.contains('focused'), 'Card 0 must have .focused class');

  // Single right arrow
  const evt = tv.dispatchKey('ArrowRight');
  assert.ok(evt.defaultPrevented, 'ArrowRight key must preventDefault()');
  assert.ok(evt.propagationStopped, 'ArrowRight key must stopPropagation()');

  assert.strictEqual(tv.state.activeCol, 1, 'activeCol must advance to EXACTLY 1 (moved by +1)');
  assert.ok(tv.appCards[1].classList.contains('focused'), 'Card 1 must now have .focused class');
  assert.ok(!tv.appCards[0].classList.contains('focused'), 'Card 0 must no longer have .focused class');
  console.log('✅ TEST 1.1 PASSED: Focus moved strictly from Card 0 to Card 1.');
}

// -----------------------------------------------------------------------------
// TEST 1.2: Rapid duplicate keydown within 160ms is cleanly DROPPED (never 2 tiles!)
// -----------------------------------------------------------------------------
{
  console.log('\n--- TEST 1.2: Rapid duplicate keydown within 160ms is cleanly DROPPED ---');
  const tv = bootLauncher();

  assert.strictEqual(tv.state.activeCol, 0, 'Initial activeCol is 0');

  // 1st keydown at t=0
  const evt1 = tv.dispatchKey('ArrowRight');
  assert.strictEqual(tv.state.activeCol, 1, 'First key advances activeCol to 1');
  assert.ok(evt1.defaultPrevented, 'Event 1 must preventDefault');

  // 2nd keydown arrives immediately (< 160ms)
  const evt2 = tv.dispatchKey('ArrowRight');
  assert.ok(evt2.defaultPrevented, 'Rapid duplicate event 2 MUST preventDefault()');
  assert.ok(evt2.propagationStopped, 'Rapid duplicate event 2 MUST stopPropagation()');
  assert.strictEqual(tv.state.activeCol, 1, 'activeCol MUST STILL BE 1! Must NEVER jump to 2 tiles!');

  // 3rd keydown arrives immediately (< 160ms)
  const evt3 = tv.dispatchKey('ArrowRight');
  assert.ok(evt3.defaultPrevented, 'Rapid duplicate event 3 MUST preventDefault()');
  assert.strictEqual(tv.state.activeCol, 1, 'activeCol MUST STILL BE 1 after 3rd rapid keydown!');

  console.log('✅ TEST 1.2 PASSED: 2nd and 3rd rapid keydowns cleanly dropped. Stayed on Tile 1.');
}

// -----------------------------------------------------------------------------
// TEST 1.3: Spaced keydown (>=160ms) advances by EXACTLY 1 more card
// -----------------------------------------------------------------------------
async function testSpacedKeydown() {
  console.log('\n--- TEST 1.3: Spaced keydown after 170ms advances by EXACTLY 1 card ---');
  const tv = bootLauncher();

  tv.dispatchKey('ArrowRight');
  assert.strictEqual(tv.state.activeCol, 1, 'First key advances to Card 1');

  // Wait 175ms (> 160ms step-lock debounce)
  await new Promise(r => setTimeout(r, 175));

  const evt2 = tv.dispatchKey('ArrowRight');
  assert.strictEqual(tv.state.activeCol, 2, 'Second spaced key advances to Card 2 (+1 step)');
  assert.ok(tv.appCards[2].classList.contains('focused'), 'Card 2 has focus');
  console.log('✅ TEST 1.3 PASSED: Spaced keypress advanced to Card 2 (+1).');
}

// -----------------------------------------------------------------------------
// TEST 1.4: Burst of 8 rapid key events within 80ms advances by EXACTLY 1 card
// -----------------------------------------------------------------------------
{
  console.log('\n--- TEST 1.4: Burst of 8 rapid key events advances by EXACTLY 1 card total ---');
  const tv = bootLauncher();
  assert.strictEqual(tv.state.activeCol, 0);

  // Send 8 rapid keydowns back-to-back
  let droppedCount = 0;
  for (let i = 0; i < 8; i++) {
    const evt = tv.dispatchKey('ArrowRight');
    if (i > 0 && evt.defaultPrevented && evt.propagationStopped) {
      droppedCount++;
    }
  }

  assert.strictEqual(droppedCount, 7, '7 out of 8 rapid events must be cleanly dropped');
  assert.strictEqual(tv.state.activeCol, 1, 'Burst MUST only advance activeCol by exactly 1 card (0 -> 1)');
  console.log('✅ TEST 1.4 PASSED: 7 rapid bounce events dropped, activeCol moved strictly from 0 -> 1.');
}

// -----------------------------------------------------------------------------
// TEST 1.5: Programmatic navigate() call within 160ms is also debounced
// -----------------------------------------------------------------------------
{
  console.log('\n--- TEST 1.5: Direct navigate() call within 160ms is debounced ---');
  const tv = bootLauncher();

  tv.navigate('right');
  assert.strictEqual(tv.state.activeCol, 1, 'First navigate call moves to 1');

  // Immediate second navigate call
  tv.navigate('right');
  assert.strictEqual(tv.state.activeCol, 1, 'Immediate second navigate call MUST be debounced');

  console.log('✅ TEST 1.5 PASSED: Direct navigate() call debounced.');
}

// -----------------------------------------------------------------------------
// TEST 1.6: Left arrow moves focus backward by EXACTLY 1 card
// -----------------------------------------------------------------------------
async function testLeftArrow() {
  console.log('\n--- TEST 1.6: Left Arrow navigation moves backward by EXACTLY 1 card ---');
  const tv = bootLauncher();

  tv.dispatchKey('ArrowRight'); // to Col 1
  await new Promise(r => setTimeout(r, 175));
  tv.dispatchKey('ArrowRight'); // to Col 2
  assert.strictEqual(tv.state.activeCol, 2, 'Col is 2');

  await new Promise(r => setTimeout(r, 175));
  tv.dispatchKey('ArrowLeft');
  assert.strictEqual(tv.state.activeCol, 1, 'ArrowLeft moves col from 2 -> 1');

  // Rapid repeat
  tv.dispatchKey('ArrowLeft');
  assert.strictEqual(tv.state.activeCol, 1, 'Rapid ArrowLeft dropped, col remains 1');

  console.log('✅ TEST 1.6 PASSED: ArrowLeft moves strictly -1 tile.');
}

// -----------------------------------------------------------------------------
// TEST 1.7: Row Bounds Clamping (No wrapping, no out-of-bounds)
// -----------------------------------------------------------------------------
{
  console.log('\n--- TEST 1.7: Row Bounds Clamping ---');
  const tv = bootLauncher();
  assert.strictEqual(tv.state.activeCol, 0);

  // Attempting to move left from Col 0
  tv.dispatchKey('ArrowLeft');
  assert.strictEqual(tv.state.activeCol, 0, 'Left at start of row stays at 0');

  console.log('✅ TEST 1.7 PASSED: Row boundaries strictly preserved.');
}

// -----------------------------------------------------------------------------
// TEST 1.8: Row Navigation (Down / Up) strictly advances by 1 row
// -----------------------------------------------------------------------------
async function testRowNavigation() {
  console.log('\n--- TEST 1.8: Row Navigation (Down / Up) strictly advances by 1 row ---');
  const tv = bootLauncher();

  // Move right to card 2 (Hotstar)
  tv.dispatchKey('ArrowRight');
  await new Promise(r => setTimeout(r, 175));
  tv.dispatchKey('ArrowRight');
  assert.strictEqual(tv.state.activeCol, 2);
  assert.strictEqual(tv.state.activeRow, 0);

  await new Promise(r => setTimeout(r, 175));
  // Down to Utility Row
  tv.dispatchKey('ArrowDown');
  assert.strictEqual(tv.state.activeRow, 1, 'activeRow must become 1 (Utility Row)');
  assert.strictEqual(tv.state.activeCol, 1, 'activeCol mapped proportionally to util card 1');
  assert.ok(tv.utilCards[1].classList.contains('focused'), 'Util card 1 has focus');

  // Rapid down
  tv.dispatchKey('ArrowDown');
  assert.strictEqual(tv.state.activeRow, 1, 'Rapid down dropped, stays in row 1');

  await new Promise(r => setTimeout(r, 175));
  // Up back to App Shelf
  tv.dispatchKey('ArrowUp');
  assert.strictEqual(tv.state.activeRow, 0, 'activeRow must become 0 (App Shelf)');
  assert.ok(tv.appCards[tv.state.activeCol].classList.contains('focused'), 'App card has focus');

  console.log('✅ TEST 1.8 PASSED: Row navigation advances by exactly 1 row step.');
}

// -----------------------------------------------------------------------------
// TEST 1.9: Acoustic Audio Feedback is played ONCE per valid step
// -----------------------------------------------------------------------------
{
  console.log('\n--- TEST 1.9: Acoustic Audio Feedback played ONCE per valid step ---');
  const tv = bootLauncher();
  tv.resetAudioCount();

  // 1 valid move + 4 rapid dropped moves
  tv.dispatchKey('ArrowRight');
  tv.dispatchKey('ArrowRight');
  tv.dispatchKey('ArrowRight');
  tv.dispatchKey('ArrowRight');
  tv.dispatchKey('ArrowRight');

  assert.strictEqual(tv.getAudioClickCount(), 1, 'AudioFeedback.click must be called EXACTLY ONCE for the burst');
  console.log('✅ TEST 1.9 PASSED: AudioFeedback played exactly once, 0 times for dropped events.');
}

// =============================================================================
// PART 2: INJECTED TV ENGINE (tv-engine.js) AUTOMATED STEP-LOCK TESTS
// =============================================================================
console.log('\n----------------------------------------------------------------------');
console.log('🌐 PART 2: TESTING INJECTED TV ENGINE (tv-engine.js) ON ARBITRARY WEB PAGES');
console.log('----------------------------------------------------------------------');

function setupArbitraryWebPage() {
  const windowListeners = {};
  const docListeners = {};

  const mockDoc = new MockElement('html');
  const mockBody = new MockElement('body');
  mockDoc.appendChild(mockBody);

  // Create streaming tray with 2 rows of 4 movie cards each
  // Row 0: y=100
  // Row 1: y=350
  const row0Cards = [];
  for (let i = 0; i < 4; i++) {
    const card = new MockElement('div', `movie-r0-c${i}`, 'movie-card title-card');
    card.setAttribute('data-testid', `card-r0-${i}`);
    card.rect = { left: 50 + i * 260, top: 100, width: 220, height: 140, right: 50 + i * 260 + 220, bottom: 240 };
    mockBody.appendChild(card);
    row0Cards.push(card);
  }

  const row1Cards = [];
  for (let i = 0; i < 4; i++) {
    const card = new MockElement('div', `movie-r1-c${i}`, 'movie-card title-card');
    card.setAttribute('data-testid', `card-r1-${i}`);
    card.rect = { left: 50 + i * 260, top: 350, width: 220, height: 140, right: 50 + i * 260 + 220, bottom: 490 };
    mockBody.appendChild(card);
    row1Cards.push(card);
  }

  const mockWindow = {
    location: { hostname: 'streaming-service.com', pathname: '/browse', href: 'https://streaming-service.com/browse' },
    innerWidth: 1920,
    innerHeight: 1080,
    scrollX: 0,
    scrollY: 0,
    scrollBy: () => {},
    addEventListener: (type, fn, opts) => {
      if (!windowListeners[type]) windowListeners[type] = [];
      windowListeners[type].push({ fn, useCapture: typeof opts === 'boolean' ? opts : (opts && opts.capture) });
    },
    removeEventListener: () => {},
    dispatchEvent: (evt) => {
      if (windowListeners[evt.type]) {
        for (const l of windowListeners[evt.type]) {
          l.fn(evt);
          if (evt.propagationStopped) break;
        }
      }
      return !evt.defaultPrevented;
    },
    history: { length: 2, back: () => {} },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1', overflowX: 'visible' }),
    AudioContext: class {
      constructor() { this.state = 'running'; this.currentTime = 0; }
      createOscillator() { return { connect: () => {}, start: () => {}, stop: () => {}, frequency: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} } }; }
      createGain() { return { connect: () => {}, gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} } }; }
      resume() { return Promise.resolve(); }
    }
  };

  const mockDocument = {
    documentElement: mockDoc,
    head: new MockElement('head'),
    body: mockBody,
    readyState: 'complete',
    createElement: (tag) => new MockElement(tag),
    getElementById: (id) => {
      const all = mockDoc.querySelectorAll(`#${id}`);
      return all.length > 0 ? all[0] : null;
    },
    querySelectorAll: (sel) => mockDoc.querySelectorAll(sel),
    querySelector: (sel) => mockDoc.querySelector(sel),
    addEventListener: (type, fn, opts) => {
      if (!docListeners[type]) docListeners[type] = [];
      docListeners[type].push({ fn, useCapture: typeof opts === 'boolean' ? opts : (opts && opts.capture) });
    },
    removeEventListener: () => {},
    dispatchEvent: (evt) => {
      if (docListeners[evt.type]) {
        for (const l of docListeners[evt.type]) {
          l.fn(evt);
          if (evt.propagationStopped) break;
        }
      }
      return !evt.defaultPrevented;
    },
    activeElement: mockBody,
    fullscreenElement: null,
    exitFullscreen: async () => {}
  };

  return { mockWindow, mockDocument, row0Cards, row1Cards, mockDoc, mockBody };
}

function bootTvEngine(env) {
  global.window = env.mockWindow;
  global.document = env.mockDocument;
  global.KeyboardEvent = MockKeyboardEvent;
  global.PointerEvent = MockKeyboardEvent;
  global.MouseEvent = MockKeyboardEvent;

  // Clear previous engine flag
  delete global.window.__MOM_TV_ENGINE_LOADED__;

  const enginePath = fs.existsSync(path.join(__dirname, 'tv-engine.js'))
    ? path.join(__dirname, 'tv-engine.js')
    : path.join(__dirname, '..', 'tv-engine.js');
  const engineSource = fs.readFileSync(enginePath, 'utf8');
  eval(engineSource);

  assert.ok(global.window.MomTV, 'window.MomTV must be exposed');

  return {
    ...env,
    MomTV: global.window.MomTV,
    dispatchKeydown: (key) => {
      const evt = new MockKeyboardEvent('keydown', { key });
      env.mockDocument.dispatchEvent(evt);
      return evt;
    }
  };
}

// -----------------------------------------------------------------------------
// TEST 2.1: moveFocus('right') strictly advances by EXACTLY 1 card
// -----------------------------------------------------------------------------
{
  console.log('\n--- TEST 2.1: moveFocus("right") advances by EXACTLY 1 card ---');
  const env = setupArbitraryWebPage();
  const tv = bootTvEngine(env);

  // Initial focus on Row 0, Card 0
  tv.MomTV.setFocus(tv.row0Cards[0]);
  assert.strictEqual(tv.MomTV.getFocusedElement(), tv.row0Cards[0], 'R0C0 focused initially');

  // Move right via handleKey
  const handled = tv.MomTV.handleKey('right');
  assert.strictEqual(handled, true, 'handleKey("right") must return true');
  assert.strictEqual(tv.MomTV.getFocusedElement(), tv.row0Cards[1], 'Focus must advance to R0C1 (EXACTLY 1 card)');
  assert.ok(tv.row0Cards[1].classList.contains('momtv-focused'), 'R0C1 has neon focus class');
  assert.ok(!tv.row0Cards[0].classList.contains('momtv-focused'), 'R0C0 focus removed');

  console.log('✅ TEST 2.1 PASSED: Focus moved strictly from R0C0 to R0C1.');
}

// -----------------------------------------------------------------------------
// TEST 2.2: moveFocus('down') finds single best adjacent candidate in row below
// -----------------------------------------------------------------------------
{
  console.log('\n--- TEST 2.2: moveFocus("down") finds single best candidate in row below ---');
  const env = setupArbitraryWebPage();
  const tv = bootTvEngine(env);

  // Focus R0C2 (centerX = 50 + 2*260 + 110 = 680)
  tv.MomTV.setFocus(tv.row0Cards[2]);
  assert.strictEqual(tv.MomTV.getFocusedElement(), tv.row0Cards[2]);

  // Move down
  tv.MomTV.handleKey('down');
  // R1C2 has centerX = 680, exact vertical alignment
  assert.strictEqual(tv.MomTV.getFocusedElement(), tv.row1Cards[2], 'Must move directly to R1C2 in row below');

  console.log('✅ TEST 2.2 PASSED: 2D Spatial matrix moved from R0C2 down to R1C2.');
}

// -----------------------------------------------------------------------------
// TEST 2.3: window.MomTV.handleKey 220ms step-lock drops duplicate calls (Never 2 tiles!)
// -----------------------------------------------------------------------------
{
  console.log('\n--- TEST 2.3: handleKey 220ms step-lock drops rapid duplicate calls ---');
  const env = setupArbitraryWebPage();
  const tv = bootTvEngine(env);

  tv.MomTV.setFocus(tv.row0Cards[0]);
  assert.strictEqual(tv.MomTV.getFocusedElement(), tv.row0Cards[0]);

  // 1st call at t=0
  const h1 = tv.MomTV.handleKey('right');
  assert.strictEqual(h1, true);
  assert.strictEqual(tv.MomTV.getFocusedElement(), tv.row0Cards[1], '1st key advances to R0C1');

  // 2nd call arrives immediately (< 220ms, e.g. duplicate network packet / bounce)
  const h2 = tv.MomTV.handleKey('right');
  assert.strictEqual(h2, true, '2nd duplicate call consumed by debounce');
  assert.strictEqual(tv.MomTV.getFocusedElement(), tv.row0Cards[1], 'Focus MUST REMAIN on R0C1! Never jump 2 tiles!');

  // 3rd rapid call
  const h3 = tv.MomTV.handleKey('right');
  assert.strictEqual(tv.MomTV.getFocusedElement(), tv.row0Cards[1], 'Focus STILL on R0C1 after 3rd rapid call');

  console.log('✅ TEST 2.3 PASSED: handleKey 220ms step-lock prevented double-tile jump.');
}

// -----------------------------------------------------------------------------
// TEST 2.4: Dual dispatch suppression (CDP handleKey followed by native DOM keydown)
// -----------------------------------------------------------------------------
{
  console.log('\n--- TEST 2.4: Dual dispatch suppression (CDP handleKey + DOM keydown) ---');
  const env = setupArbitraryWebPage();
  const tv = bootTvEngine(env);

  tv.MomTV.setFocus(tv.row0Cards[0]);

  // Step 1: CDP calls window.MomTV.handleKey('right')
  tv.MomTV.handleKey('right');
  assert.strictEqual(tv.MomTV.getFocusedElement(), tv.row0Cards[1], 'CDP call moved focus to R0C1');

  // Step 2: Native or synthetic DOM keydown arrives 30ms later (e.g. from CDP Input.dispatchKeyEvent or Win32)
  const domEvt = tv.dispatchKeydown('ArrowRight');
  assert.ok(domEvt.defaultPrevented, 'Native keydown event MUST be prevented when already handled by handleKey');
  assert.ok(domEvt.propagationStopped, 'Native keydown event MUST be stopped from propagating');
  assert.strictEqual(tv.MomTV.getFocusedElement(), tv.row0Cards[1], 'Focus MUST NOT move to R0C2! Must stay at R0C1!');

  console.log('✅ TEST 2.4 PASSED: DOM keydown event strictly suppressed after handleKey. Focus stayed on 1 card.');
}

// -----------------------------------------------------------------------------
// TEST 2.5: Physical keyboard native keydown events debounced by 220ms
// -----------------------------------------------------------------------------
{
  console.log('\n--- TEST 2.5: Physical keyboard native keydowns debounced by 220ms ---');
  const env = setupArbitraryWebPage();
  const tv = bootTvEngine(env);

  tv.MomTV.setFocus(tv.row0Cards[0]);

  // 1st physical key press (no prior handleKey)
  const evt1 = tv.dispatchKeydown('ArrowRight');
  assert.ok(evt1.defaultPrevented, 'Physical keydown handled and prevented');
  assert.strictEqual(tv.MomTV.getFocusedElement(), tv.row0Cards[1], 'Moved to R0C1');

  // Rapid OS key repeat arrives 50ms later
  const evt2 = tv.dispatchKeydown('ArrowRight');
  assert.ok(evt2.defaultPrevented, 'Rapid key repeat suppressed');
  assert.ok(evt2.propagationStopped, 'Rapid key repeat propagation stopped');
  assert.strictEqual(tv.MomTV.getFocusedElement(), tv.row0Cards[1], 'Focus MUST STAY on R0C1');

  console.log('✅ TEST 2.5 PASSED: Rapid physical key repeat suppressed.');
}

// -----------------------------------------------------------------------------
// TEST 2.6: tv-engine.js delegates to tv.html when .tv-shell is present in DOM
// -----------------------------------------------------------------------------
{
  console.log('\n--- TEST 2.6: tv-engine.js delegates to tv.html when .tv-shell is present ---');
  const env = setupArbitraryWebPage();
  // Add .tv-shell to DOM
  const tvShell = new MockElement('div', 'tv-shell', 'tv-shell');
  env.mockBody.appendChild(tvShell);

  const tv = bootTvEngine(env);

  // handleKey('right') should return false on tv.html (to let tv.html handle it)
  const handled = tv.MomTV.handleKey('right');
  assert.strictEqual(handled, false, 'handleKey must return false on tv.html (.tv-shell detected)');

  // keydown event in tv-engine.js should NOT suppress navigation keys on tv.html
  const evt = tv.dispatchKeydown('ArrowRight');
  assert.strictEqual(evt.defaultPrevented, false, 'tv-engine.js must NOT preventDefault on tv.html');

  console.log('✅ TEST 2.6 PASSED: tv-engine.js cleanly delegates to tv.html launcher.');
}

// -----------------------------------------------------------------------------
// RUN ASYNC TESTS & FINALIZE
// -----------------------------------------------------------------------------
async function runAll() {
  await testSpacedKeydown();
  await testLeftArrow();
  await testRowNavigation();

  console.log('\n======================================================================');
  console.log('🎉 ALL 15 AUTOMATED STEP-LOCK TESTS PASSED FLAWLESSLY! 🚀');
  console.log('1. tv.html 160ms Step-Lock: Verified (Exactly 1 card, rapid events dropped)');
  console.log('2. tv.html Audio Feedback: Verified (Plays acoustic click once per step)');
  console.log('3. tv-engine.js 220ms Step-Lock: Verified (No double-tile jumps)');
  console.log('4. Dual-layer (CDP + Native) Suppression: Verified (Cleanly dropped)');
  console.log('5. Launcher vs Injected Separation: Verified (No collision)');
  console.log('======================================================================\n');
  process.exit(0);
}

runAll().catch(err => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
