/**
 * MOM TV 2.0 — Automated Test Suite for tv-engine.js
 * Validates Universal Card Detection, Synthetic Hover/Click, Platform Adapters, and Virtual Cursor.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// 1. Mock DOM Environment
class MockClassList {
  constructor() {
    this.classes = new Set();
  }
  add(...names) {
    names.forEach(n => this.classes.add(n));
  }
  remove(...names) {
    names.forEach(n => this.classes.delete(n));
  }
  contains(name) {
    return this.classes.has(name);
  }
  toString() {
    return Array.from(this.classes).join(' ');
  }
}

class MockElement {
  constructor(tag, id = '', className = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.className = className;
    this.classList = new MockClassList();
    if (className) {
      className.split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c));
    }
    this.attributes = new Map();
    this.children = [];
    this.parentElement = null;
    this.style = {};
    this.nodeType = 1;
    this.innerText = '';
    this.innerHTML = '';
    this.rect = { left: 100, top: 200, width: 200, height: 120, right: 300, bottom: 320 };
    this.dispatchedEvents = [];
    this.clicked = 0;
    this.focused = false;
  }

  getAttribute(name) {
    if (name === 'class') return this.classList.toString() || this.className;
    if (name === 'id') return this.id;
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  setAttribute(name, val) {
    this.attributes.set(name, String(val));
    if (name === 'id') this.id = String(val);
    if (name === 'class') {
      this.className = String(val);
      this.classList = new MockClassList();
      String(val).split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c));
    }
  }

  hasAttribute(name) {
    if (name === 'class') return Boolean(this.classList.toString() || this.className);
    if (name === 'id') return Boolean(this.id);
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  appendChild(child) {
    if (child.parentElement) {
      child.parentElement.removeChild(child);
    }
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

  getBoundingClientRect() {
    return this.rect;
  }

  focus() {
    this.focused = true;
  }

  click() {
    this.clicked++;
  }

  dispatchEvent(evt) {
    this.dispatchedEvents.push(evt);
    return true;
  }

  contains(other) {
    if (other === this) return true;
    for (const c of this.children) {
      if (c.contains(other)) return true;
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

      // Handle attribute contains [attr*="val"]
      const attrMatch = part.match(/\[([a-zA-Z0-9_-]+)\*="([^"]+)"(?:\s*i)?\]/);
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
      const exactMatch = part.match(/\[([a-zA-Z0-9_-]+)="([^"]+)"\]/);
      if (exactMatch) {
        const attrName = exactMatch[1];
        const attrVal = exactMatch[2];
        if (this.getAttribute(attrName) === attrVal) return true;
      }

      // Handle attribute existence [attr]
      const hasMatch = part.match(/^\[([a-zA-Z0-9_-]+)\]$/);
      if (hasMatch) {
        if (this.hasAttribute(hasMatch[1])) return true;
      }
    }
    return false;
  }

  querySelectorAll(sel) {
    const results = [];
    const check = (node) => {
      for (const child of node.children) {
        if (child.matches(sel)) results.push(child);
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
}

class MockEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = Boolean(init.bubbles);
    this.cancelable = Boolean(init.cancelable);
    this.clientX = init.clientX || 0;
    this.clientY = init.clientY || 0;
    this.button = init.button || 0;
    this.buttons = init.buttons || 0;
    this.key = init.key || '';
    this.code = init.code || '';
    this.keyCode = init.keyCode || 0;
  }
}

// 2. Setup Globals
const mockDoc = new MockElement('html');
const mockHead = new MockElement('head');
const mockBody = new MockElement('body');
mockDoc.appendChild(mockHead);
mockDoc.appendChild(mockBody);

global.document = {
  documentElement: mockDoc,
  head: mockHead,
  body: mockBody,
  readyState: 'complete',
  createElement: (tag) => new MockElement(tag),
  getElementById: (id) => {
    const all = mockDoc.querySelectorAll(`#${id}`);
    return all.length > 0 ? all[0] : null;
  },
  querySelectorAll: (sel) => mockDoc.querySelectorAll(sel),
  querySelector: (sel) => mockDoc.querySelector(sel),
  addEventListener: () => {},
  removeEventListener: () => {},
  elementFromPoint: (x, y) => {
    // Return last added card or body
    const cards = mockBody.querySelectorAll('[data-tv-card="true"]');
    return cards.length > 0 ? cards[0] : mockBody;
  },
  fullscreenElement: null,
  exitFullscreen: async () => { global.document.fullscreenElement = null; }
};

global.window = {
  location: { hostname: 'hotstar.com', pathname: '/movies', href: 'https://hotstar.com/movies' },
  innerWidth: 1920,
  innerHeight: 1080,
  scrollX: 0,
  scrollY: 0,
  scrollBy: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: (evt) => {
    mockDoc.dispatchEvent(evt);
    return true;
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

global.PointerEvent = MockEvent;
global.MouseEvent = MockEvent;
global.KeyboardEvent = MockEvent;

console.log('🧪 [Test Suite] Loading tv-engine.js...');
const enginePath = fs.existsSync(path.join(__dirname, 'tv-engine.js'))
  ? path.join(__dirname, 'tv-engine.js')
  : path.join(__dirname, '..', 'tv-engine.js');
const engineCode = fs.readFileSync(enginePath, 'utf8');
eval(engineCode);

console.log('✅ [Test Suite] tv-engine.js successfully evaluated.');
assert.ok(global.window.MomTV, 'window.MomTV must be exposed');

// -----------------------------------------------------------------------------
// TEST 1: Universal Movie Card & Tray Detection
// -----------------------------------------------------------------------------
console.log('\n--- TEST 1: Universal Movie Card & Tray Detection ---');
// Create React / Hotstar / Netflix style cards
const card1 = new MockElement('div', 'react-card-1', 'card-container');
card1.setAttribute('data-testid', 'card-item-123');
card1.rect = { left: 50, top: 100, width: 220, height: 140, right: 270, bottom: 240 };
mockBody.appendChild(card1);

const card2 = new MockElement('div', 'netflix-card-2', 'title-card');
card2.rect = { left: 300, top: 100, width: 220, height: 140, right: 520, bottom: 240 };
mockBody.appendChild(card2);

const card3 = new MockElement('a', 'hotstar-link-3');
card3.setAttribute('href', '/movies/blockbuster-hit');
card3.rect = { left: 550, top: 100, width: 220, height: 140, right: 770, bottom: 240 };
mockBody.appendChild(card3);

// Junk items that should be rejected
const junkFooter = new MockElement('footer', 'site-footer');
junkFooter.rect = { left: 0, top: 800, width: 1920, height: 200, right: 1920, bottom: 1000 };
mockBody.appendChild(junkFooter);

const cookiePopup = new MockElement('div', 'cookie-consent-banner');
cookiePopup.setAttribute('id', 'onetrust-consent-sdk');
cookiePopup.rect = { left: 100, top: 100, width: 500, height: 200, right: 600, bottom: 300 };
mockBody.appendChild(cookiePopup);

const discovered = global.window.MomTV.getFocusableCards();
console.log(`Discovered ${discovered.length} focusable cards:`, discovered.map(c => c.id));

assert.ok(discovered.includes(card1), 'React testid card must be discovered');
assert.ok(discovered.includes(card2), 'Netflix title-card must be discovered');
assert.ok(discovered.includes(card3), 'Hotstar /movies/ link must be discovered');
assert.ok(!discovered.includes(junkFooter), 'Footer must be filtered out as junk');
assert.ok(!discovered.includes(cookiePopup), 'Cookie consent popup must be filtered out');

// Verify dynamic tagging
assert.strictEqual(card1.getAttribute('tabindex'), '0', 'card1 must have tabindex="0" assigned');
assert.strictEqual(card1.getAttribute('data-tv-card'), 'true', 'card1 must have data-tv-card="true" assigned');
assert.strictEqual(card2.getAttribute('data-tv-card'), 'true', 'card2 must have data-tv-card="true" assigned');
console.log('✅ TEST 1 PASSED: Universal Movie Card Detection & Tagging Verified.');

// -----------------------------------------------------------------------------
// TEST 2: Synthetic Mouse Hover Emulation
// -----------------------------------------------------------------------------
console.log('\n--- TEST 2: Synthetic Mouse Hover Emulation ---');
global.window.MomTV.setFocus(card1);

const hoverEvents = card1.dispatchedEvents.map(e => e.type);
console.log('Dispatched events on focus of card1:', hoverEvents);
assert.ok(hoverEvents.includes('pointerover'), 'Must dispatch pointerover');
assert.ok(hoverEvents.includes('pointerenter'), 'Must dispatch pointerenter');
assert.ok(hoverEvents.includes('mouseenter'), 'Must dispatch mouseenter');
assert.ok(hoverEvents.includes('mousemove'), 'Must dispatch mousemove');

// Verify coordinates at center of card1 (left: 50, top: 100, width: 220, height: 140 -> cx: 160, cy: 170)
const mouseMoveEvt = card1.dispatchedEvents.find(e => e.type === 'mousemove');
assert.strictEqual(mouseMoveEvt.clientX, 160, 'Hover clientX must match center');
assert.strictEqual(mouseMoveEvt.clientY, 170, 'Hover clientY must match center');
assert.strictEqual(mouseMoveEvt.buttons, 0, 'Hover buttons must be 0');

// Focus card2, verify card1 receives mouseleave
global.window.MomTV.setFocus(card2);
const card1Leave = card1.dispatchedEvents.map(e => e.type);
assert.ok(card1Leave.includes('mouseleave'), 'Must dispatch mouseleave on previous card');
console.log('✅ TEST 2 PASSED: Synthetic Mouse Hover Emulation Verified.');

// -----------------------------------------------------------------------------
// TEST 3: Full Synthetic Coordinate Click
// -----------------------------------------------------------------------------
console.log('\n--- TEST 3: Full Synthetic Coordinate Click ---');
// Put inner play button inside card2
const innerPlayBtn = new MockElement('button', 'inner-play-btn', 'play-button');
innerPlayBtn.rect = { left: 350, top: 140, width: 60, height: 35, right: 410, bottom: 175 };
card2.appendChild(innerPlayBtn);

global.window.MomTV.setFocus(card2);
card2.dispatchedEvents = [];
global.window.MomTV.handleKey('ok');

const clickEvents = card2.dispatchedEvents.map(e => e.type);
console.log('Dispatched events on OK press:', clickEvents);

// Sequence check: pointerdown -> mousedown -> pointerup -> mouseup -> click
assert.ok(clickEvents.includes('pointerdown'), 'Must dispatch pointerdown');
assert.ok(clickEvents.includes('mousedown'), 'Must dispatch mousedown');
assert.ok(clickEvents.includes('pointerup'), 'Must dispatch pointerup');
assert.ok(clickEvents.includes('mouseup'), 'Must dispatch mouseup');
assert.ok(clickEvents.includes('click'), 'Must dispatch click');

// Verify inner play button clicked
assert.ok(card2.clicked > 0, 'Card element .click() called');
assert.ok(innerPlayBtn.clicked > 0, 'Inner play-button .click() called');
console.log('✅ TEST 3 PASSED: Full Synthetic Coordinate Click Sequence Verified.');

// -----------------------------------------------------------------------------
// TEST 4: Platform-Specific Video Adapters
// -----------------------------------------------------------------------------
console.log('\n--- TEST 4: Platform-Specific Video Adapters ---');
const adapters = global.window.MomTV.PlatformAdapters;
assert.ok(adapters, 'PlatformAdapters must be exposed');

// A. Netflix Adapter
global.window.location.hostname = 'netflix.com';
global.window.location.pathname = '/watch/80123456';
assert.ok(adapters.isNetflixPlayerActive(), 'Netflix player must be active on /watch');

let dispatchedNetflixKeys = [];
mockDoc.dispatchEvent = (evt) => { dispatchedNetflixKeys.push(evt); return true; };

adapters.handleNetflixKey('space');
assert.ok(dispatchedNetflixKeys.some(e => e.key === ' ' && e.code === 'Space'), 'Netflix space key dispatched');

adapters.handleNetflixKey('left');
assert.ok(dispatchedNetflixKeys.some(e => e.key === 'ArrowLeft'), 'Netflix rewind ArrowLeft dispatched');

adapters.handleNetflixKey('right');
assert.ok(dispatchedNetflixKeys.some(e => e.key === 'ArrowRight'), 'Netflix forward ArrowRight dispatched');

// B. Hotstar / JioCinema / Prime Video Adapter with Video Element
global.window.location.hostname = 'hotstar.com';
const videoEl = new MockElement('video');
videoEl.paused = true;
videoEl.currentTime = 50;
videoEl.duration = 3600;
videoEl.play = async () => { videoEl.paused = false; };
videoEl.pause = () => { videoEl.paused = true; };
mockBody.appendChild(videoEl);

// Play toggle
adapters.handleHotstarKey('ok', videoEl);
assert.strictEqual(videoEl.paused, false, 'Hotstar video must start playing');

// Rewind 10s
adapters.handleHotstarKey('left', videoEl);
assert.strictEqual(videoEl.currentTime, 40, 'Hotstar video must rewind by 10s to 40');

// Forward 10s
adapters.handleHotstarKey('right', videoEl);
assert.strictEqual(videoEl.currentTime, 50, 'Hotstar video must forward by 10s to 50');

console.log('✅ TEST 4 PASSED: Platform-Specific Video Adapters Verified.');

// -----------------------------------------------------------------------------
// TEST 5: Virtual Mouse Cursor (Magic Trackpad Mode)
// -----------------------------------------------------------------------------
console.log('\n--- TEST 5: Virtual Mouse Cursor ---');
assert.ok(typeof global.window.MomTV.moveCursor === 'function', 'moveCursor must be exposed');
assert.ok(typeof global.window.MomTV.setCursor === 'function', 'setCursor must be exposed');
assert.ok(typeof global.window.MomTV.clickCursor === 'function', 'clickCursor must be exposed');

// Set cursor to (500, 300)
global.window.MomTV.setCursor(500, 300);
const cursorEl = mockDoc.querySelector('#momtv-virtual-cursor');
assert.ok(cursorEl, '#momtv-virtual-cursor element must exist in DOM');
assert.ok(cursorEl.classList.contains('visible'), 'Cursor must become visible');
assert.strictEqual(cursorEl.style.transform, 'translate(496px, 297px)', 'Cursor tip transform positioned');

// Move cursor by (+20, -50)
global.window.MomTV.moveCursor(20, -50);
assert.strictEqual(cursorEl.style.transform, 'translate(516px, 247px)', 'Cursor moved by delta');

// Click cursor
card1.clicked = 0;
global.window.MomTV.clickCursor();
assert.ok(card1.clicked > 0, 'clickCursor must successfully click element under point');

// D-pad mode hides cursor
global.window.MomTV.handleKey('up');
assert.ok(!cursorEl.classList.contains('visible'), 'D-pad navigation must hide virtual cursor');

console.log('✅ TEST 5 PASSED: Virtual Mouse Cursor Verified.');

console.log('\n🎉 ALL 5 TEST SUITES PASSED FLAWLESSLY! 🚀\n');
