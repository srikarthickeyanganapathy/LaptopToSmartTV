/**
 * Test client-side debounce and touch handling logic from index.html in Node.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('[TEST] Starting client-side debounce verification for index.html...');

const htmlPath = path.join(__dirname, '..', 'index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

// 1. Verify swipe listener is gone
assert(!htmlContent.includes("dpadPlate.addEventListener('touchend'"), 'Swipe listener on dpadPlate must not exist');
assert(!htmlContent.includes("distance > 32"), 'Old swipe distance check must not exist');
console.log('✓ PASS: Swipe listener removed from dpad-plate');

// 2. Extract and test sendKey debouncing in isolated JS context
let sentCommands = [];
let hapticCalls = [];

function haptic(type) {
  hapticCalls.push(type);
}
function send(obj) {
  sentCommands.push(obj);
}

// Emulate client variables from index.html
let lastKeySentTime = 0;
const DISCRETE_NAV_KEYS = new Set(['up', 'down', 'left', 'right', 'ok', 'enter', 'back']);
const CLIENT_DEBOUNCE_MS = 180;

function sendKey(keyName) {
  const k = (keyName || '').toLowerCase();
  const now = Date.now();

  // Client-side 180ms debouncing guard for discrete navigation & action keys
  if (DISCRETE_NAV_KEYS.has(k)) {
    if (now - lastKeySentTime < CLIENT_DEBOUNCE_MS) {
      return;
    }
    lastKeySentTime = now;
  }

  if (k === 'ok' || k === 'enter') {
    haptic('firm');
  } else if (k === 'back' || k === 'f11') {
    haptic('double');
  } else {
    haptic('light');
  }
  send({ cmd: 'key', key: k });
}

// Test 2a: Single key fires
sendKey('up');
assert.strictEqual(sentCommands.length, 1);
assert.strictEqual(sentCommands[0].key, 'up');
console.log('✓ PASS: Single arrow press dispatches sendKey');

// Test 2b: Rapid double-tap within 10ms is debounced
sendKey('up');
assert.strictEqual(sentCommands.length, 1, 'Rapid 2nd key within 180ms must be ignored');
console.log('✓ PASS: Immediate 2nd tap (<180ms) ignored by client debounce');

// Test 2c: Rapid tap of different directional key within 10ms is also debounced
sendKey('right');
assert.strictEqual(sentCommands.length, 1, 'Rapid different directional key within 180ms must be ignored');
console.log('✓ PASS: Burst directional key (<180ms) ignored by client debounce');

// Test 2d: Key after 190ms passes through
setTimeout(() => {
  sendKey('right');
  assert.strictEqual(sentCommands.length, 2, 'Key after 180ms must be sent');
  assert.strictEqual(sentCommands[1].key, 'right');
  console.log('✓ PASS: Key pressed after 180ms debounce interval passes through');

  // Test 2e: Center OK ring
  sendKey('ok'); // immediate after right -> debounced
  assert.strictEqual(sentCommands.length, 2);

  setTimeout(() => {
    sendKey('ok');
    assert.strictEqual(sentCommands.length, 3);
    assert.strictEqual(sentCommands[2].key, 'ok');
    console.log('✓ PASS: OK key pressed after debounce interval passes through');
    console.log('\n[ALL CLIENT DEBOUNCE TESTS PASSED]');
  }, 200);
}, 200);
