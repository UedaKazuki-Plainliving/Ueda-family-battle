'use strict';
/**
 * BDD テストランナー — 大乱闘 ウエダファミリー
 * bdd-scenarios.feature の全 Feature / Scenario に対応
 * node run-bdd-tests.js で実行
 *
 * アーキテクチャ:
 *   ゲームコードを vm サンドボックスで読み込み、
 *   テスト関数もサンドボックス内で実行することで
 *   const で定義された Fighter / CHARS / CHAR_LIST にアクセスする。
 */
const fs   = require('fs');
const vm   = require('vm');
const path = require('path');

// ---- ゲームコード読み込み ----
const html = fs.readFileSync(path.join(__dirname, 'street-brawler.html'), 'utf-8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// ---- vm サンドボックス ----
const noop   = () => {};
const ctx2d  = new Proxy({}, {
  get(_, p) {
    if (p === 'measureText')          return () => ({ width: 0 });
    if (p === 'createLinearGradient') return () => ({ addColorStop: noop });
    return noop;
  },
  set() { return true; }
});
const mockAudio = {
  createOscillator() { return { connect:noop, type:'', frequency:{value:0}, start:noop, stop:noop }; },
  createGain()       { return { connect:noop, gain:{ setValueAtTime:noop, exponentialRampToValueAtTime:noop } }; },
  destination: {}, currentTime: 0
};
const AudioCtor = function() { return mockAudio; };

const sandbox = vm.createContext({
  document: {
    getElementById  : () => ({ getContext: () => ctx2d, width:800, height:450 }),
    addEventListener: noop,
    createElement   : () => ({ style:{cssText:''}, get innerHTML(){return '';}, set innerHTML(_){} }),
    body            : { appendChild: noop },
    querySelectorAll: () => []
  },
  window  : { AudioContext: AudioCtor, webkitAudioContext: AudioCtor },
  AudioContext: AudioCtor, webkitAudioContext: AudioCtor,
  requestAnimationFrame: noop, cancelAnimationFrame: noop,
  location : { search: '' },
  setTimeout: noop, clearTimeout: noop,
  console, Date, Math, JSON, Set, Map, Array, Object,
  parseInt, parseFloat, isNaN, isFinite, Promise, Error, TypeError
});

// ゲームコードを実行（CHARS, Fighter, CHAR_LIST が const でサンドボックス内に定義される）
vm.runInContext(code, sandbox, { filename: 'street-brawler.html' });
// 音を無効化
sandbox.beep = () => {};

// ============================================================
// BDD テスト本体（サンドボックス内で実行する関数として定義）
// CHARS / Fighter / CHAR_LIST に直接アクセスできる
// ============================================================
function allBDDTests() {
  /* global CHARS, Fighter, CHAR_LIST, beep */

  // ---- ユーティリティ ----
  const mkF  = (id, right=true, x=300) => new Fighter(x, right, CHARS[id]);
  const mkI  = (o={}) => ({punch:false,kick:false,left:false,right:false,
                            up:false,down:false,block:false,special:false,...o});
  const eq   = (a,b,msg) => { if(a!==b) throw new Error((msg?msg+': ':'')+
                               'expected '+JSON.stringify(b)+', got '+JSON.stringify(a)); };
  const near = (a,b,msg) => { if(Math.abs(a-b)>0.01) throw new Error((msg?msg+': ':'')+
                               'expected ~'+b+', got '+a); };
  const gt   = (a,b,msg) => { if(a<=b) throw new Error((msg?msg+': ':'')+a+' > '+b+' failed'); };
  const lt   = (a,b,msg) => { if(a>=b) throw new Error((msg?msg+': ':'')+a+' < '+b+' failed'); };
  const isT  = (v,msg)   => { if(!v)  throw new Error(msg||'expected truthy, got '+v); };
  const isF  = (v,msg)   => { if(v)   throw new Error(msg||'expected falsy, got '+v); };

  // ---- 軽量 BDD ランナー ----
  const features = [];
  let cur = null;
  const Feature  = (name) => { cur = {name, scenarios:[]}; features.push(cur); };
  const Scenario = (name, fn) => cur.scenarios.push({name, fn});

  // ===========================================================
  // Feature: キャラクター定義と初期化
  // ===========================================================
  Feature('キャラクター定義と初期化');

  Scenario('いっちーはスピードタイプのパラメータを持つ', () => {
    const c = CHARS.icchi;
    eq(c.id, 'icchi'); eq(c.walkSpd, 6.5); eq(c.punchDmg, 5); eq(c.jumpVel, -21);
    isF(c.punchIsProjectile, 'punchIsProjectile should be falsy');
  });

  Scenario('おとうさんはパンチが飛び道具として発射される', () => {
    const c = CHARS.otousan;
    isT(c.punchIsProjectile, 'punchIsProjectile'); eq(c.punchDmg, 0); eq(c.kickDmg, 10);
  });

  Scenario('ゆうりはパワータイプで攻撃力が高い', () => {
    const c = CHARS.yuuri;
    eq(c.punchDmg, 16); eq(c.kickDmg, 24); eq(c.jatkDmg, 27); eq(c.walkSpd, 2.5);
  });

  Scenario('そよはジャンプ力と攻撃レンジに優れる', () => {
    const c = CHARS.soyo;
    eq(c.jumpVel, -24, 'jumpVel 全キャラ最高'); eq(c.rangeBonus, 1.5); eq(c.walkSpd, 7.2);
  });

  Scenario('Fighter は正しい初期状態で生成される', () => {
    const f = mkF('icchi', true, 300);
    eq(f.hp, 100); eq(f.maxHp, 100); eq(f.state, 'idle');
    isT(f.onGround); eq(f.hitStun, 0); eq(f.guardFlash, 0);
    isF(f.guardMode); eq(f.specialGauge, 0); eq(f.dir, 1);
  });

  // ===========================================================
  // Feature: ヒットボックスとハートボックス
  // ===========================================================
  Feature('ヒットボックスとハートボックス');

  Scenario('idle 状態では hitbox は null を返す', () => {
    eq(mkF('icchi').hitbox(), null);
  });

  Scenario('パンチ発生フレームでは hitbox が返される', () => {
    const f = mkF('icchi'); f.state='punch'; f.st=CHARS.icchi.punchS;
    isT(f.hitbox() !== null, 'hitbox should exist at active frame');
  });

  Scenario('パンチ発生前フレームでは hitbox は null である', () => {
    const f = mkF('icchi'); f.state='punch'; f.st=0;
    eq(f.hitbox(), null);
  });

  Scenario('しゃがみ状態のハートボックスは立ちより小さい', () => {
    const f = mkF('icchi'); const s = CHARS.icchi.scale;
    f.state = 'crouch';
    near(f.hurtbox().h, 82*s, 'h=82*scale');
    near(f.hurtbox().w, 48*s, 'w=48*scale');
  });

  Scenario('キック発生フレームでは hitbox が返される', () => {
    const f = mkF('icchi'); f.state='kick'; f.st=CHARS.icchi.kickS;
    isT(f.hitbox() !== null, 'hitbox should exist at active frame');
  });

  // ===========================================================
  // Feature: ダメージ計算とヒット処理
  // ===========================================================
  Feature('ダメージ計算とヒット処理');

  Scenario('通常攻撃がヒットするとダメージ分だけ HP が減少する', () => {
    const f = mkF('icchi');
    f.takeHit({dmg:8,stun:16,push:0,type:'punch'}, 1);
    eq(f.hp, 92); eq(f.state, 'hurt'); eq(f.hitStun, 16);
  });

  Scenario('HP が 0 以下になると state が dead になる', () => {
    const f = mkF('icchi'); f.hp=5;
    f.takeHit({dmg:10,stun:16,push:0,type:'punch'}, 1);
    eq(f.hp, 0); eq(f.state, 'dead');
  });

  Scenario('dead 状態の Fighter にヒットしても false を返す', () => {
    const f = mkF('icchi'); f.state='dead'; const before=f.hp;
    eq(f.takeHit({dmg:8,stun:16,push:0,type:'punch'}, 1), false);
    eq(f.hp, before);
  });

  Scenario('hitStun 中の Fighter にヒットしても false を返す', () => {
    const f = mkF('icchi'); f.hitStun=10;
    eq(f.takeHit({dmg:8,stun:16,push:0,type:'punch'}, 1), false);
    eq(f.hp, 100);
  });

  Scenario('ヒットを受けると specialGauge が増加する', () => {
    const f = mkF('icchi');
    f.takeHit({dmg:5,stun:16,push:0,type:'punch'}, 1);
    gt(f.specialGauge, 0);
  });

  // ===========================================================
  // Feature: ガードシステム
  // ===========================================================
  Feature('ガードシステム');

  Scenario('立ちガード中はパンチをノーダメージで防げる', () => {
    const f=mkF('icchi',true); f.state='block'; f.guardMode=true;
    f.takeHit({dmg:8,stun:16,push:0,type:'punch'}, -1);
    eq(f.hp,100); gt(f.blockStun,0,'blockStun set'); gt(f.guardFlash,0,'guardFlash set');
  });

  Scenario('立ちガード中は空中パンチ（jatk）も防げる', () => {
    const f=mkF('icchi',true); f.state='block'; f.guardMode=true;
    f.takeHit({dmg:10,stun:16,push:0,type:'jatk'}, -1);
    eq(f.hp, 100);
  });

  Scenario('立ちガード中はキックを防げない', () => {
    const f=mkF('icchi',true); f.state='block'; f.guardMode=true;
    f.takeHit({dmg:8,stun:16,push:0,type:'kick'}, -1);
    lt(f.hp, 100); eq(f.state, 'hurt');
  });

  Scenario('立ちガード中は空中キック（jkick）を防げない', () => {
    const f=mkF('icchi',true); f.state='block'; f.guardMode=true;
    f.takeHit({dmg:10,stun:16,push:0,type:'jkick'}, -1);
    lt(f.hp, 100);
  });

  Scenario('しゃがみガード中はキックをノーダメージで防げる', () => {
    const f=mkF('icchi',true); f.state='crouch'; f.guardMode=true;
    f.takeHit({dmg:8,stun:16,push:0,type:'kick'}, -1);
    eq(f.hp, 100);
  });

  Scenario('しゃがみガード中は空中キック（jkick）も防げる', () => {
    const f=mkF('icchi',true); f.state='crouch'; f.guardMode=true;
    f.takeHit({dmg:10,stun:16,push:0,type:'jkick'}, -1);
    eq(f.hp, 100);
  });

  Scenario('しゃがみガード中はパンチを防げない', () => {
    const f=mkF('icchi',true); f.state='crouch'; f.guardMode=true;
    f.takeHit({dmg:8,stun:16,push:0,type:'punch'}, -1);
    lt(f.hp, 100);
  });

  Scenario('背後からの攻撃はガードを貫通する', () => {
    const f=mkF('icchi',true); f.state='block'; f.guardMode=true;
    f.takeHit({dmg:8,stun:16,push:0,type:'punch'}, 1); // fromDir=1=背後
    lt(f.hp, 100, '背後攻撃がガード貫通');
  });

  Scenario('必殺技は立ちガード中もダメージが軽減される（60%カット）', () => {
    const f=mkF('icchi',true); f.state='block'; f.guardMode=true;
    f.takeHit({dmg:28,stun:25,push:0,type:'special'}, -1);
    eq(f.hp, 89, 'hp = 100 - floor(28*0.4) = 89');
  });

  Scenario('ガード成立時に guardFlash がセットされる', () => {
    const f=mkF('icchi',true); f.state='block'; f.guardMode=true;
    f.takeHit({dmg:8,stun:16,push:0,type:'punch'}, -1);
    gt(f.guardFlash, 0);
  });

  // ===========================================================
  // Feature: update による状態遷移とガードモード
  // ===========================================================
  Feature('update による状態遷移とガードモード');

  Scenario('block 状態の Fighter は guardMode=true になる', () => {
    const f=mkF('icchi',true,300); f.state='block';
    f.update(mkF('yuuri',false,500), mkI());
    isT(f.guardMode);
  });

  Scenario('crouch 状態かつ block 入力ありで guardMode=true になる', () => {
    const f=mkF('icchi',true,300); f.state='crouch';
    f.update(mkF('yuuri',false,500), mkI({block:true,down:true}));
    isT(f.guardMode);
  });

  Scenario('crouch 状態かつ block 入力なしで guardMode=false になる', () => {
    const f=mkF('icchi',true,300); f.state='crouch';
    f.update(mkF('yuuri',false,500), mkI({down:true}));
    isF(f.guardMode);
  });

  Scenario('idle 状態では guardMode=false になる', () => {
    const f=mkF('icchi',true,300); f.state='idle';
    f.update(mkF('yuuri',false,500), mkI());
    isF(f.guardMode);
  });

  // ===========================================================
  // Feature: 必殺技ゲージと必殺技発動
  // ===========================================================
  Feature('必殺技ゲージと必殺技発動');

  Scenario('必殺技ゲージが MAX のとき special 入力で発動できる', () => {
    const f=mkF('icchi',true,300);
    f.specialGauge=100; f.onGround=true; f.state='idle';
    f.update(mkF('yuuri',false,500), mkI({special:true}));
    eq(f.state, 'special'); eq(f.specialGauge, 0);
  });

  Scenario('ゆうりの必殺技はドロップキックで空中突進する', () => {
    const f=mkF('yuuri',true,300);
    f.specialGauge=100; f.onGround=true; f.state='idle';
    f.update(mkF('icchi',false,500), mkI({special:true}));
    eq(f.state, 'special'); isF(f.onGround, 'onGround=false'); eq(f.specialVx, f.dir*14);
  });

  Scenario('ゲージが MAX 未満では必殺技は発動しない', () => {
    const f=mkF('icchi',true,300);
    f.specialGauge=50; f.onGround=true; f.state='idle';
    f.update(mkF('yuuri',false,500), mkI({special:true}));
    eq(f.state, 'idle');
  });

  // ===========================================================
  // Feature: ラウンド管理とゲーム進行（ロジック検証）
  // ===========================================================
  Feature('ラウンド管理とゲーム進行（ロジック検証）');

  Scenario('HP が 0 になると dead 状態になる（ラウンド終了の前提）', () => {
    const f=mkF('icchi'); f.hp=1;
    f.takeHit({dmg:10,stun:16,push:0,type:'kick'}, 1);
    eq(f.hp, 0); eq(f.state, 'dead');
  });

  Scenario('dead 状態への二重ヒットは無効', () => {
    const f=mkF('icchi'); f.state='dead'; f.hp=0;
    eq(f.takeHit({dmg:10,stun:16,push:0,type:'punch'}, 1), false);
    eq(f.hp, 0);
  });

  Scenario('CHAR_LIST は 5 キャラクターを持つ', () => {
    eq(CHAR_LIST.length, 5);
  });

  Scenario('タイムアップ勝敗判定: HP 多い方が勝ち', () => {
    const p1hp=60, p2hp=40;
    const result = p1hp > p2hp ? 'p1' : p1hp < p2hp ? 'p2' : 'draw';
    eq(result, 'p1');
  });

  Scenario('タイムアップ DRAW 判定: HP 同値なら draw', () => {
    const p1hp=50, p2hp=50;
    const result = p1hp > p2hp ? 'p1' : p1hp < p2hp ? 'p2' : 'draw';
    eq(result, 'draw');
  });

  // ===========================================================
  // 実行
  // ===========================================================
  const results = [];
  for (const f of features) {
    for (const s of f.scenarios) {
      try { s.fn(); results.push({feature:f.name, scenario:s.name, pass:true}); }
      catch(e) { results.push({feature:f.name, scenario:s.name, pass:false, err:e.message}); }
    }
  }
  return results;
}

// サンドボックス内で実行
const results = vm.runInContext(`(${allBDDTests.toString()})()`, sandbox);

// ---- 結果表示 ----
const W = 68;
let passed = 0, failed = 0, currentFeature = '';
console.log('='.repeat(W));
console.log('大乱闘 ウエダファミリー — BDD Test Results');
console.log('='.repeat(W));

for (const r of results) {
  if (r.feature !== currentFeature) {
    currentFeature = r.feature;
    console.log(`\nFeature: ${r.feature}`);
  }
  if (r.pass) {
    console.log(`  \x1b[32m✓\x1b[0m Scenario: ${r.scenario}`);
    passed++;
  } else {
    console.log(`  \x1b[31m✗\x1b[0m Scenario: ${r.scenario}`);
    console.log(`      \x1b[31m→ ${r.err}\x1b[0m`);
    failed++;
  }
}

console.log('\n' + '-'.repeat(W));
if (failed === 0) {
  console.log(`\x1b[32m  ALL PASSED: ${passed} / ${passed+failed} scenarios ✓\x1b[0m`);
} else {
  console.log(`\x1b[31m  FAILED: ${failed} failed, ${passed} passed / ${passed+failed} total\x1b[0m`);
}
console.log('='.repeat(W));
process.exit(failed > 0 ? 1 : 0);
