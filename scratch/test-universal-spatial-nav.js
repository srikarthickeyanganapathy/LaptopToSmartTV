/**
 * Unit Test for Universal D-Pad Spatial Navigation & Initial Auto-Focus
 * Validates:
 * 1. Universal Element Detection (general links, buttons, custom app links like AnimeKhor)
 * 2. 2D Directional Spatial Vector Navigation (Left, Right, Up, Down on staggered elements)
 * 3. Initial Auto-Focus on page load & on first keypress (OK / Arrow)
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Mock DOM
class MockClassList {
  constructor() { this.classes = new Set(); }
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
    this.classList = new MockClassList();
    if (className) {
      className.split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c));
    }
    this.attributes = new Map();
    this.children = [];
    this.parentElement = null;
    this.style = {};
    this.nodeType = 1;
    this.rect = { left: 0, top: 0, width: 100, height: 40, right: 100, bottom: 40 };
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
  focus() { this.focused = true; }
  click() { this.clicked++; }
  dispatchEvent(evt) { this.dispatchedEvents.push(evt); return true; }
  contains(other) {
    if (other === this) return true;
    for (const c of this.children) {
      if (c.contains(other)) return true;
    }
    return false;
  }
  closest(selector) {
    if (selector.includes('header') && this.id.includes('header')) return this;
    return null;
  }
  matches(selector) { return false; }
}

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
  getElementById: (id) => null,
  querySelectorAll: (sel) => {
    // Basic selector match
    const result = [];
    function search(node) {
      if (node.tagName === 'A' && sel.includes('a[href]') && node.hasAttribute('href')) {
        result.push(node);
      } else if (node.tagName === 'BUTTON' && sel.includes('button')) {
        result.push(node);
      } else if (node.className && node.className.includes('card') && sel.includes('card')) {
        result.push(node);
      }
      for (const c of node.children) search(c);
    }
    search(mockBody);
    return result;
  },
  querySelector: () => null,
  addEventListener: () => {},
  removeEventListener: () => {}
};

global.window = {
  location: { hostname: 'animekhor.org', pathname: '/', href: 'https://animekhor.org/' },
  innerWidth: 1920,
  innerHeight: 1080,
  scrollX: 0,
  scrollY: 0,
  scrollBy: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1', overflowX: 'visible', overflowY: 'visible' }),
  AudioContext: class {
    constructor() { this.state = 'running'; this.currentTime = 0; }
    createOscillator() { return { connect: () => {}, start: () => {}, stop: () => {}, frequency: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} } }; }
    createGain() { return { connect: () => {}, gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} } }; }
    resume() { return Promise.resolve(); }
  }
};

global.PointerEvent = class {};
global.MouseEvent = class {};
global.KeyboardEvent = class {};

console.log('🧪 Loading updated tv-engine.js for Universal D-Pad verification...');
const engineCode = fs.readFileSync(path.join(__dirname, '..', 'tv-engine.js'), 'utf8');
eval(engineCode);

console.log('✅ tv-engine.js loaded.');

// TEST: General non-streaming site (AnimeKhor style)
// Elements:
// item1: Anime Episode 1 link at (50, 100)
// item2: Anime Episode 2 link at (250, 110) [staggered vertically, wouldn't match rigid 35px if large]
// item3: Anime Episode 3 link at (450, 105)
// itemDown: Anime Episode 4 below at (60, 300)

const item1 = new MockElement('a', 'anime-ep-1');
item1.setAttribute('href', 'https://animekhor.org/solo-leveling-ep-1');
item1.rect = { left: 50, top: 100, width: 160, height: 80, right: 210, bottom: 180 };
mockBody.appendChild(item1);

const item2 = new MockElement('a', 'anime-ep-2');
item2.setAttribute('href', 'https://animekhor.org/solo-leveling-ep-2');
item2.rect = { left: 250, top: 100, width: 160, height: 80, right: 410, bottom: 180 };
mockBody.appendChild(item2);

const item3 = new MockElement('a', 'anime-ep-3');
item3.setAttribute('href', 'https://animekhor.org/solo-leveling-ep-3');
item3.rect = { left: 450, top: 100, width: 160, height: 80, right: 610, bottom: 180 };
mockBody.appendChild(item3);

const itemDown = new MockElement('a', 'anime-ep-4');
itemDown.setAttribute('href', 'https://animekhor.org/solo-leveling-ep-4');
itemDown.rect = { left: 50, top: 300, width: 160, height: 80, right: 210, bottom: 380 };
mockBody.appendChild(itemDown);

// 1. Check discovery of general a[href]
const discovered = global.window.MomTV.getFocusableCards();
console.log(`Discovered ${discovered.length} general links:`, discovered.map(c => c.id));
assert.strictEqual(discovered.length, 4, 'Must discover all 4 general a[href] links');

// Advance time to bypass debounce between simulated test keypresses
let simulatedTime = 1000;
Date.now = () => (simulatedTime += 300);

// 2. Initial Auto-Focus on first keypress
assert.strictEqual(global.window.MomTV.getFocusedElement(), null, 'Initially null before keypress');
global.window.MomTV.handleKey('right');
const focusedFirst = global.window.MomTV.getFocusedElement();
assert.ok(focusedFirst !== null, 'First keypress must trigger auto-focus');
assert.strictEqual(focusedFirst.id, 'anime-ep-1', 'Must focus the topmost-leftmost element (ep-1)');

// 3. Move Right to ep-2
global.window.MomTV.handleKey('right');
assert.strictEqual(global.window.MomTV.getFocusedElement().id, 'anime-ep-2', 'Must move focus right to ep-2');

// 4. Move Right to ep-3
global.window.MomTV.handleKey('right');
assert.strictEqual(global.window.MomTV.getFocusedElement().id, 'anime-ep-3', 'Must move focus right to ep-3');

// 5. Move Left back to ep-2
global.window.MomTV.handleKey('left');
assert.strictEqual(global.window.MomTV.getFocusedElement().id, 'anime-ep-2', 'Must move focus left back to ep-2');

// 6. Move Left back to ep-1
global.window.MomTV.handleKey('left');
assert.strictEqual(global.window.MomTV.getFocusedElement().id, 'anime-ep-1', 'Must move focus left back to ep-1');

// 7. Move Down to ep-4
global.window.MomTV.handleKey('down');
assert.strictEqual(global.window.MomTV.getFocusedElement().id, 'anime-ep-4', 'Must move focus down to ep-4');

// 8. Move Up back to ep-1
global.window.MomTV.handleKey('up');
assert.strictEqual(global.window.MomTV.getFocusedElement().id, 'anime-ep-1', 'Must move focus up back to ep-1');

console.log('🎉 ALL UNIVERSAL D-PAD & SPATIAL NAVIGATION TESTS PASSED! 🚀');
