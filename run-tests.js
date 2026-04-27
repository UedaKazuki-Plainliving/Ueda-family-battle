'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

// ---- HTMLからscriptブロックを抽出 ----
const html = fs.readFileSync(path.join(__dirname, 'street-brawler.html'), 'utf-8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) { console.error('script block not found'); process.exit(2); }
const gameCode = scriptMatch[1];

// ---- ブラウザAPIのモック ----
const noop = () => {};
const ctx2d = new Proxy({}, {
  get(_, p) {
    if (p === 'measureText') return () => ({ width: 0 });
    if (p === 'createLinearGradient') return () => ({ addColorStop: noop });
    return typeof {}[p] === 'number' ? 0 : noop;
  },
  set() { return true; }
});

let capturedHTML = '';

const mockDocument = {
  getElementById: () => ({ getContext: () => ctx2d, width: 800, height: 450 }),
  addEventListener: noop,
  createElement(tag) {
    if (tag !== 'div') return { style: {}, innerHTML: '' };
    return {
      style: { cssText: '' },
      get innerHTML() { return capturedHTML; },
      set innerHTML(v) { capturedHTML = v; }
    };
  },
  body: { appendChild: noop },
  querySelectorAll: () => []
};

const mockAudioCtx = {
  createOscillator() { return { connect: noop, type: '', frequency: { value: 0 }, start: noop, stop: noop }; },
  createGain()      { return { connect: noop, gain: { setValueAtTime: noop, exponentialRampToValueAtTime: noop } }; },
  destination: {},
  currentTime: 0
};

const sandbox = vm.createContext({
  document:  mockDocument,
  window:    { AudioContext: function(){ return mockAudioCtx; }, webkitAudioContext: function(){ return mockAudioCtx; } },
  AudioContext: function() { return mockAudioCtx; },
  webkitAudioContext: function() { return mockAudioCtx; },
  requestAnimationFrame: noop,
  cancelAnimationFrame:  noop,
  location:  { search: '?test', href: 'file:///test' },
  setTimeout: noop,
  clearTimeout: noop,
  console, Date, Math, JSON, Set, Map, Array, Object,
  parseInt, parseFloat, isNaN, isFinite,
  Promise, Error, TypeError
});

// ---- 実行 ----
try {
  vm.runInContext(gameCode, sandbox, { filename: 'street-brawler.html' });
} catch (e) {
  console.error('[vm error]', e.message);
  process.exit(2);
}

// ---- capturedHTMLから結果をパース ----
if (!capturedHTML) {
  console.error('テスト結果がキャプチャできませんでした');
  process.exit(2);
}

// <td>✓</td> or <td...>✗</td> → pass/fail
// <td...>テスト名</td> → name
// <td...>エラー</td> → err
const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;

const results = [];
let rowM;
while ((rowM = rowRe.exec(capturedHTML)) !== null) {
  const cells = [];
  let cm;
  const inner = rowM[1];
  // reset cellRe lastIndex
  cellRe.lastIndex = 0;
  while ((cells.length < 3) && (cm = cellRe.exec(inner)) !== null) {
    cells.push(cm[1].trim());
  }
  if (cells.length < 2) continue;
  const icon = cells[0];
  const name = cells[1];
  const err  = cells[2] || '';
  results.push({ pass: icon === '✓', name, err });
}

if (results.length === 0) {
  console.error('テストケースを解析できませんでした');
  process.exit(2);
}

// ---- 出力 ----
const W = 64;
console.log('='.repeat(W));
console.log('大乱闘 ウエダファミリー — Unit Test Results');
console.log('='.repeat(W));

let passed = 0, failed = 0;
for (const r of results) {
  if (r.pass) {
    console.log(`  \x1b[32m✓\x1b[0m  ${r.name}`);
    passed++;
  } else {
    console.log(`  \x1b[31m✗\x1b[0m  ${r.name}`);
    console.log(`       \x1b[31m→ ${r.err}\x1b[0m`);
    failed++;
  }
}

console.log('-'.repeat(W));
if (failed === 0) {
  console.log(`\x1b[32m  ALL PASSED: ${passed} / ${passed + failed} tests ✓\x1b[0m`);
} else {
  console.log(`\x1b[31m  FAILED: ${failed} failed, ${passed} passed / ${passed + failed} total\x1b[0m`);
}
console.log('='.repeat(W));

process.exit(failed > 0 ? 1 : 0);
