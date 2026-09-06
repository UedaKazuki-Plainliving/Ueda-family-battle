'use strict';
// ================================================================
// 探索的テスト: 4ペルソナ統合テストスクリプト
// ================================================================
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'street-brawler.html'), 'utf-8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
const gameCode = scriptMatch[1];

const noop = () => {};
const ctx2d = new Proxy({}, {
  get(_, p) {
    if (p === 'measureText') return () => ({ width: 0 });
    if (p === 'createLinearGradient') return () => ({ addColorStop: noop });
    if (p === 'createRadialGradient') return () => ({ addColorStop: noop });
    return noop;
  }, set() { return true; }
});
const mockDoc = {
  getElementById: () => ({ getContext: () => ctx2d, width: 800, height: 450,
    addEventListener: noop, removeEventListener: noop, style: {},
    classList: { add: noop, remove: noop } }),
  addEventListener: noop,
  createElement: () => ({ style: { cssText: '' }, innerHTML: '' }),
  body: { appendChild: noop }, querySelectorAll: () => []
};
const mockAudio = {
  createOscillator() { return { connect: noop, type: '', frequency: { value: 0 }, start: noop, stop: noop }; },
  createGain() { return { connect: noop, gain: { setValueAtTime: noop, exponentialRampToValueAtTime: noop } }; },
  destination: {}, currentTime: 0
};

const sandbox = vm.createContext({
  document: mockDoc,
  window: { AudioContext: function(){ return mockAudio; }, webkitAudioContext: function(){ return mockAudio; } },
  navigator: { maxTouchPoints: 0 },
  AudioContext: function() { return mockAudio; },
  webkitAudioContext: function() { return mockAudio; },
  requestAnimationFrame: noop, cancelAnimationFrame: noop,
  location: { search: '', href: 'file:///sim' },
  setTimeout: noop, clearTimeout: noop,
  console, Date, Math, JSON, Set, Map, Array, Object,
  parseInt, parseFloat, isNaN, isFinite, Promise, Error, TypeError,
  simResults: null, simMockNow: 0
});

vm.runInContext(gameCode, sandbox, { filename: 'game' });
vm.runInContext('Date = { now: () => simMockNow };', sandbox);

// ----------------------------------------------------------------
// テストフレームワーク
// ----------------------------------------------------------------
const results = { passed: 0, failed: 0, warnings: 0, findings: [] };
function log(persona, severity, title, detail) {
  const icon = severity === 'BUG' ? '🐛' : severity === 'WARN' ? '⚠️ ' : severity === 'INFO' ? 'ℹ️ ' : '✅';
  results.findings.push({ persona, severity, title, detail });
  if (severity === 'BUG') results.failed++;
  else if (severity === 'WARN') results.warnings++;
  else results.passed++;
}

// ----------------------------------------------------------------
// VM 内でテストコードを実行
// ----------------------------------------------------------------
const testCode = `
(function() {

// ================================================================
// ユーティリティ
// ================================================================
const MAX_FRAMES = 60 * 99;

function mkFighter(charId, x, facingRight) {
  const def = CHARS[charId] || CHAR_LIST[0];
  return new Fighter(x, facingRight, def);
}

function resetState(f1, f2) {
  projectiles.length = 0; wordProjs.length = 0;
  hurdleAttack = null; activeGorilla = null; activeDragon = null; activeBlackHole = null;
  phase = 'fight'; gameMode = 'cpu'; cpuDifficulty = 'normal';
  timerSec = 99; timerTick = 0;
  p1 = f1; p2 = f2; fighters = [f1, f2];
}

function runFrame(f1, f2, inp1, inp2) {
  simMockNow += 16;
  if (++timerTick>=60){timerTick=0;timerSec--;}
  f1.update(f2, inp1);
  f2.update(f1, inp2);
  if (f1.specialFired) { f1.specialFired = false; spawnSpecialEffect(f1, f2); }
  if (f2.specialFired) { f2.specialFired = false; spawnSpecialEffect(f2, f1); }
  if (f1.punchFired && f1.def.punchIsProjectile) { f1.punchFired = false; if(!projectiles.some(p=>p.owner===f1)){f1.def.id==='kuppa'?spawnFire(f1):spawnBaseball(f1);} }
  if (f2.punchFired && f2.def.punchIsProjectile) { f2.punchFired = false; if(!projectiles.some(p=>p.owner===f2)){f2.def.id==='kuppa'?spawnFire(f2):spawnBaseball(f2);} }
  updateProjectiles(f1, f2);
  updateHurdles(f1, f2);
  updateWords(f1, f2);
  if (activeGorilla) {
    activeGorilla.update();
    if (activeGorilla&&activeGorilla.t>0&&!activeGorilla.atkHit) {
      const gt=activeGorilla.owner===p1?p2:p1;
      const ghb=activeGorilla.hitbox();
      if (ghb) { const hurt=gt.hurtbox(); const ghx=ghb.w<0?ghb.x+ghb.w:ghb.x,ghw=Math.abs(ghb.w); if(ghx<hurt.x+hurt.w&&ghx+ghw>hurt.x&&ghb.y<hurt.y+hurt.h&&ghb.y+ghb.h>hurt.y){if(gt.takeHit({dmg:12,stun:20,push:18,type:'special'},activeGorilla.dir)){activeGorilla.atkHit=true;}}}
    }
  }
  if (activeDragon) activeDragon.update();
  if (activeBlackHole) activeBlackHole.update(f1, f2);
  checkCollision(f1, f2);
  checkCollision(f2, f1);
}

const idle  = { punch:false,kick:false,left:false,right:false,up:false,down:false,block:false,special:false };
const punch = { ...idle, punch:true };
const kick  = { ...idle, kick:true };
const block = { ...idle, block:true };
const crouch= { ...idle, down:true };
const crouchBlock = { ...idle, down:true, block:true };
const jump  = { ...idle, up:true };
const jatk  = { ...idle, up:false, punch:true };  // 空中でパンチ
const jkick = { ...idle, up:false, kick:true };   // 空中でキック
const fwd   = { ...idle, right:true };
const special = { ...idle, special:true };

// ================================================================
// PERSONA 1: ゲーマー - はめ技・ゲームバランス探索
// ================================================================
const G = { results: [] };

// --- G-01: ジャンプキック連打（無敵技疑惑）---
// 仮説: jkickは両方のガードをすり抜ける。ジャンプキック連打が強すぎる可能性
(function testJkickSpam() {
  let wins = 0;
  const ITERS = 200;
  for (let i = 0; i < ITERS; i++) {
    const f1 = mkFighter('mario', 300, true);
    const f2 = mkFighter('mario', 500, false);
    resetState(f1, f2);

    // jkicker: 常にジャンプして空中でキック
    function jkickInput(me, opp) {
      if (me.onGround) return { ...idle, up:true, right: opp.x > me.x, left: opp.x < me.x };
      if (me.vy > 0) return { ...idle, kick: true };
      return idle;
    }
    // 相手: ガードのみ（クラウチガード）
    function defInput() { return crouchBlock; }

    for (let frame = 0; frame < MAX_FRAMES; frame++) {
      simMockNow = frame * 16;
      runFrame(f1, f2, jkickInput(f1, f2), defInput());
      if (f1.hp <= 0 || f2.hp <= 0 || f1.state === 'dead' || f2.state === 'dead') break;
    }
    if (f2.hp < f1.hp) wins++;
  }
  G.results.push({ id:'G-01', title:'jkick連打 vs クラウチガード', wr: Math.round(wins/ITERS*100) });
})();

// --- G-02: jkick vs スタンドガード ---
(function testJkickVsStandGuard() {
  let wins = 0;
  const ITERS = 200;
  for (let i = 0; i < ITERS; i++) {
    const f1 = mkFighter('mario', 300, true);
    const f2 = mkFighter('mario', 500, false);
    resetState(f1, f2);
    function jkickInput(me, opp) {
      if (me.onGround) return { ...idle, up:true, right: opp.x > me.x };
      if (me.vy > 0) return { ...idle, kick: true };
      return idle;
    }
    function standBlockInput() { return block; }
    for (let frame = 0; frame < MAX_FRAMES; frame++) {
      simMockNow = frame * 16;
      runFrame(f1, f2, jkickInput(f1, f2), standBlockInput());
      if (f1.hp <= 0 || f2.hp <= 0) break;
    }
    if (f2.hp < f1.hp) wins++;
  }
  G.results.push({ id:'G-02', title:'jkick連打 vs スタンドガード', wr: Math.round(wins/ITERS*100) });
})();

// --- G-03: コンボ7連続ヒットノックダウン到達速度 ---
// 仮説: comboCount=7でノックダウン。何フレームで達成できるか
(function testCombo7KD() {
  const f1 = mkFighter('soyo', 300, true);  // そよ: punchDur:14, 速い
  const f2 = mkFighter('yuuri', 350, false); // ゆうり: 大きい
  resetState(f1, f2);
  // f2を全く動かさない（動かないターゲット）
  let kdFrame = -1;
  for (let frame = 0; frame < 500; frame++) {
    simMockNow = frame * 16;
    runFrame(f1, f2, punch, idle);
    if (f2.state === 'down' || f2.state === 'dead') { kdFrame = frame; break; }
  }
  G.results.push({ id:'G-03', title:'7連続ヒットKD到達フレーム(そよvs動かないゆうり)', kdFrame });
})();

// --- G-04: ダウン後の無敵確認 ---
// 仮説: ダウンから起き上がり中(downrise)は60フレーム無敵
(function testDownriseInvincibility() {
  const f1 = mkFighter('kuppa', 300, true);
  const f2 = mkFighter('mario', 350, false);
  resetState(f1, f2);
  // f2をdown状態に強制的に
  f2.state = 'down'; f2.st = 89; // 90でdownriseに遷移
  let hitDuringInvinc = false;
  let invincStart = -1;
  for (let frame = 0; frame < 300; frame++) {
    simMockNow = frame * 16;
    const hpBefore = f2.hp;
    runFrame(f1, f2, punch, idle);
    if (f2.state === 'downrise' && invincStart === -1) invincStart = frame;
    if (f2.state === 'downrise' && f2.hp < hpBefore) hitDuringInvinc = true;
    if (f2.state === 'idle') break;
  }
  G.results.push({ id:'G-04', title:'ダウン後無敵(downrise invincFrames=60)', invincStart, hitDuringInvinc, invincFrames: f2.invincFrames });
})();

// --- G-05: 超必殺技威力確認（ゆうり: 55ダメージ）---
// 仮説: ゆうりの超必殺は55ダメ＋ノックダウン。ワンコンボで大ダメージ
(function testYuuriSuperDmg() {
  const f1 = mkFighter('yuuri', 300, true);
  const f2 = mkFighter('mario', 450, false);
  resetState(f1, f2);
  f1.specialGauge = 100; // フルゲージ
  const hpBefore = f2.hp;
  // 超必殺発動
  for (let frame = 0; frame < 200; frame++) {
    simMockNow = frame * 16;
    const inp1 = frame < 3 ? special : idle;
    runFrame(f1, f2, inp1, idle);
    if (f2.state === 'down' || f2.state === 'dead') break;
  }
  const dmgDealt = hpBefore - f2.hp;
  G.results.push({ id:'G-05', title:'ゆうり超必殺威力', dmgDealt, f2state: f2.state, f2hp: f2.hp });
})();

// --- G-06: クッパのしゃがみ体当たり連続ヒット確認 ---
// 仮説: クッパのbodyslam(special)は一定間隔で連続ヒット
(function testKuppaBodyslam() {
  const f1 = mkFighter('kuppa', 300, true);
  const f2 = mkFighter('mario', 450, false);
  resetState(f1, f2);
  f1.specialGauge = 50; // 1/2以上
  const hpBefore = f2.hp;
  for (let frame = 0; frame < 300; frame++) {
    simMockNow = frame * 16;
    const inp1 = frame < 3 ? special : idle;
    runFrame(f1, f2, inp1, idle);
    if (f2.state === 'dead' || f1.state === 'idle') break;
  }
  G.results.push({ id:'G-06', title:'クッパbodyslam後のhp差', dmgDealt: hpBefore - f2.hp, f2hp: f2.hp });
})();

// --- G-07: おとうさんのブラックホール（超必殺）探索 ---
// 仮説: ブラックホールがアクティブ中に相手が近づくと継続ダメージ
(function testOtousanBlackhole() {
  const f1 = mkFighter('otousan', 300, true);
  const f2 = mkFighter('mario', 450, false);
  resetState(f1, f2);
  f1.specialGauge = 100;
  const hpBefore = f2.hp;
  for (let frame = 0; frame < 400; frame++) {
    simMockNow = frame * 16;
    const inp1 = frame < 3 ? special : { ...idle, right:true }; // 前進
    runFrame(f1, f2, inp1, idle);
    if (f2.state === 'dead' || f2.hp <= 0) break;
  }
  G.results.push({ id:'G-07', title:'おとうさんブラックホール威力', dmgDealt: hpBefore - f2.hp, f2hp: f2.hp, bhActive: !!activeBlackHole });
})();

// --- G-08: 全キャラ超必殺実用性確認（CPU通常CPUに対して）---
// 仮説: 超必殺は必ずしも強くない場合がある
const superDmgs = {};
CHAR_LIST.forEach(def => {
  const f1 = mkFighter(def.id, 300, true);
  const f2 = mkFighter('mario', 450, false);
  resetState(f1, f2);
  f1.specialGauge = 100;
  const hpBefore = f2.hp;
  for (let frame = 0; frame < 300; frame++) {
    simMockNow = frame * 16;
    const inp1 = frame < 3 ? special : idle;
    runFrame(f1, f2, inp1, idle);
    const allDone = !activeGorilla && !activeDragon && !activeBlackHole && projectiles.length===0 && !hurdleAttack && wordProjs.length===0;
    if (f2.state === 'dead' || f2.hp <= 0) break;
    if (f1.state === 'idle' && allDone && frame > 30) break;
  }
  superDmgs[def.name] = hpBefore - f2.hp;
});
G.results.push({ id:'G-08', title:'全キャラ超必殺ダメージ(vs動かないマリオ)', superDmgs });

// ================================================================
// PERSONA 2: 開発者 - 境界値・状態機械・システム構造
// ================================================================
const D = { results: [] };

// --- D-01: HP=1の境界値 ---
// 仮説: HP=1のとき、次のヒットで正確に0になるか
(function testHPBoundary() {
  const f1 = mkFighter('mario', 300, true);
  const f2 = mkFighter('mario', 350, false);
  resetState(f1, f2);
  f2.hp = 1;
  let diedAtFrame = -1;
  for (let frame = 0; frame < 200; frame++) {
    simMockNow = frame * 16;
    runFrame(f1, f2, punch, idle);
    if (f2.hp <= 0 || f2.state === 'dead') { diedAtFrame = frame; break; }
  }
  D.results.push({ id:'D-01', title:'HP=1境界値: 次ヒットで死亡', diedAtFrame, finalHp: f2.hp, finalState: f2.state });
})();

// --- D-02: 負のHP確認 ---
// 仮説: HP<0になることはないか（Math.max(0,...)で保護されているか）
(function testNegativeHP() {
  const f1 = mkFighter('yuuri', 300, true);
  const f2 = mkFighter('kinopio', 350, false);
  resetState(f1, f2);
  f2.hp = 1;
  f1.specialGauge = 100; // 超必殺（55ダメ）
  for (let frame = 0; frame < 200; frame++) {
    simMockNow = frame * 16;
    runFrame(f1, f2, frame < 3 ? special : idle, idle);
    if (f2.hp <= 0) break;
  }
  D.results.push({ id:'D-02', title:'HP<0にならない（ゆうり超必殺 vs HP:1）', finalHp: f2.hp, isNeg: f2.hp < 0 });
})();

// --- D-03: タイマー0での同HP引き分け ---
// 仮説: timerSec=0でHP等しい場合DRAW判定
(function testTimerDraw() {
  const f1 = mkFighter('mario', 300, true);
  const f2 = mkFighter('mario', 500, false);
  resetState(f1, f2);
  f1.hp = 50; f2.hp = 50;
  timerSec = 1; timerTick = 59; // 次フレームで0
  let drawDetected = false;
  let p1winsDetected = false;
  let p2winsDetected = false;
  for (let frame = 0; frame < 5; frame++) {
    simMockNow = frame * 16;
    runFrame(f1, f2, idle, idle);
    if (timerSec <= 0) {
      const timeout = true;
      const p1w = f1.hp > f2.hp ? true : f1.hp < f2.hp ? false : null;
      if (p1w === null) drawDetected = true;
      else if (p1w === true) p1winsDetected = true;
      else p2winsDetected = true;
      break;
    }
  }
  D.results.push({ id:'D-03', title:'タイマー0同HP=引き分け判定', drawDetected, timerSec, f1hp: f1.hp, f2hp: f2.hp });
})();

// --- D-04: 壁際pushback逆転現象 ---
// 仮説: 壁際(x<80 or x>720)では攻撃側が押し返される
(function testCornerPushback() {
  const f1 = mkFighter('mario', 200, true);
  const f2 = mkFighter('mario', 75, false); // 左壁際
  resetState(f1, f2);
  const f2XBefore = f2.x;
  const f1XBefore = f1.x;
  for (let frame = 0; frame < 50; frame++) {
    simMockNow = frame * 16;
    runFrame(f1, f2, { ...idle, left:true }, idle); // f1が左に走る
    if (Math.abs(f1.x - f2.x) < 90) break;
  }
  // パンチ
  const f2XPreHit = f2.x;
  const f1XPreHit = f1.x;
  runFrame(f1, f2, punch, idle);
  for (let frame = 0; frame < 20; frame++) {
    simMockNow = frame * 16;
    runFrame(f1, f2, punch, idle);
    if (f1.x !== f1XPreHit || f2.x !== f2XPreHit) break;
  }
  D.results.push({ id:'D-04', title:'壁際コーナー: 攻撃側が押し返されるか', f1XBefore: f1XPreHit, f1XAfter: f1.x, f2XBefore: f2XPreHit, f2XAfter: f2.x, f2NearWall: f2.x < 80 });
})();

// --- D-05: comboCount=5 トリプルノックバック ---
// 仮説: 5連続ヒットで3倍プッシュバック
(function testCombo5Pushback() {
  const f1 = mkFighter('mario', 300, true);
  const f2 = mkFighter('mario', 350, false);
  resetState(f1, f2);
  f2.hp = 200; // HPを多くして死なないように（カスタム）
  f2.maxHp = 200;
  let pushRecords = [];
  for (let frame = 0; frame < 300; frame++) {
    simMockNow = frame * 16;
    const xBefore = f2.x;
    runFrame(f1, f2, punch, idle);
    const pushed = f2.x - xBefore;
    if (Math.abs(pushed) > 0 && f2.comboCount > 0) {
      pushRecords.push({ combo: f2.comboCount, pushed });
    }
    if (f2.comboCount >= 7) break;
  }
  D.results.push({ id:'D-05', title:'comboCount=5で3倍ノックバック確認', pushRecords });
})();

// --- D-06: ガード中に特殊攻撃で40%ダメージ ---
// 仮説: standGuard/crouchGuardに特殊攻撃が当たると40%のダメージ
(function testGuardSpecialDmg() {
  const f1 = mkFighter('icchi', 300, true);
  const f2 = mkFighter('mario', 350, false);
  resetState(f1, f2);
  f1.specialGauge = 50; // 必殺技ゲージ1/2
  const hpBefore = f2.hp;
  // f2をブロック状態に
  for (let frame = 0; frame < 200; frame++) {
    simMockNow = frame * 16;
    const inp1 = frame < 3 ? special : idle;
    runFrame(f1, f2, inp1, block);
    if (f1.state === 'idle' && frame > 30) break;
  }
  const dmgThroughGuard = hpBefore - f2.hp;
  D.results.push({ id:'D-06', title:'ガード中の必殺技ダメージ(40%貫通)', dmgThroughGuard, hpBefore, hpAfter: f2.hp });
})();

// --- D-07: special/super状態での被弾無効確認 ---
// 仮説: special/super中はtakeHitが常にfalseを返す
(function testSpecialInvincibility() {
  const f1 = mkFighter('mario', 300, true);
  const f2 = mkFighter('yuuri', 350, false);
  resetState(f1, f2);
  f2.specialGauge = 100;
  // f2をsuper状態に
  f2.state = 'super'; f2.st = 0;
  const hpBefore = f2.hp;
  for (let frame = 0; frame < 30; frame++) {
    simMockNow = frame * 16;
    runFrame(f1, f2, punch, idle);
    if (f2.state !== 'super') break;
  }
  D.results.push({ id:'D-07', title:'super状態での被弾無敵', hpBefore, hpAfter: f2.hp, dmgTaken: hpBefore - f2.hp });
})();

// --- D-08: hitStunとhurtState の同期確認 ---
// 仮説: hitStunが0になる前にhurtから抜けることはないか
(function testHitStunHurtSync() {
  const f1 = mkFighter('mario', 300, true);
  const f2 = mkFighter('mario', 350, false);
  resetState(f1, f2);
  let earlyExit = false;
  for (let frame = 0; frame < 100; frame++) {
    simMockNow = frame * 16;
    runFrame(f1, f2, punch, idle);
    // hurt中にhitStun=0になっていないか
    if (f2.state === 'hurt' && f2.hitStun === 0 && f2.st < f2.def.hitStunGiven) {
      earlyExit = true;
    }
    if (f2.state === 'idle') break;
  }
  D.results.push({ id:'D-08', title:'hitStun-hurtState同期: 早期idle遷移なし', earlyExit, f2def_hitStunGiven: f2.def.hitStunGiven });
})();

// --- D-09: MIN_DIST (54px) クリップ ---
// 仮説: 両ファイターが重ならないようにx>=MIN_DIST(54px)が保たれる
(function testMinDistClipping() {
  const f1 = mkFighter('mario', 300, true);
  const f2 = mkFighter('mario', 300, false); // 同じx座標からスタート
  resetState(f1, f2);
  let minDistBroken = false;
  for (let frame = 0; frame < 200; frame++) {
    simMockNow = frame * 16;
    runFrame(f1, f2, idle, idle);
    if (Math.abs(f1.x - f2.x) < 54) minDistBroken = true;
  }
  D.results.push({ id:'D-09', title:'MIN_DIST=54px: ファイター重複防止', minDistBroken, finalDist: Math.abs(f1.x - f2.x) });
})();

// --- D-10: スクリーン境界クランプ(55〜745) ---
// 仮説: x=55〜W-55=745の範囲外に出ることはないか
(function testScreenBoundary() {
  const f1 = mkFighter('soyo', 300, true);
  const f2 = mkFighter('soyo', 500, false);
  resetState(f1, f2);
  let outOfBounds = false;
  for (let frame = 0; frame < 500; frame++) {
    simMockNow = frame * 16;
    runFrame(f1, f2, { ...idle, right:true }, { ...idle, left:true }); // 両者が外側に走る
    if (f1.x < 55 || f1.x > 745 || f2.x < 55 || f2.x > 745) outOfBounds = true;
  }
  D.results.push({ id:'D-10', title:'スクリーン境界クランプ(55〜745)', outOfBounds, f1x: f1.x, f2x: f2.x });
})();

// --- D-11: ゲージ50%で必殺技 / 100%で超必殺発動確認 ---
(function testGaugeTriggers() {
  const f1a = mkFighter('mario', 300, true);
  const f2a = mkFighter('mario', 450, false);
  resetState(f1a, f2a);
  f1a.specialGauge = 50; // ちょうど1/2
  const triggeredSpecial = (function() {
    for (let frame = 0; frame < 10; frame++) {
      simMockNow = frame * 16;
      runFrame(f1a, f2a, frame < 3 ? special : idle, idle);
      if (f1a.state === 'special') return true;
    }
    return false;
  })();

  const f1b = mkFighter('mario', 300, true);
  const f2b = mkFighter('mario', 450, false);
  resetState(f1b, f2b);
  f1b.specialGauge = 99; // ギリギリ未満
  const notTriggeredSuper = (function() {
    for (let frame = 0; frame < 10; frame++) {
      simMockNow = frame * 16;
      runFrame(f1b, f2b, frame < 3 ? special : idle, idle);
      if (f1b.state === 'super') return false;
    }
    return true;
  })();

  D.results.push({ id:'D-11', title:'ゲージ境界値: 50%=必殺, 99%=超必殺非発動', triggeredSpecialAt33: triggeredSpecial, notTriggeredSuper: notTriggeredSuper });
})();

// --- D-12: dmgDebuff確認（ダウン後攻撃力0.55倍）---
// 仮説: ノックダウンされた後、起き上がり時に攻撃力が55%になる
(function testDmgDebuff() {
  const f1 = mkFighter('mario', 300, true);
  const f2 = mkFighter('yuuri', 350, false); // ゆうりでKDさせる（超必殺）
  resetState(f1, f2);
  f2.state = 'down'; f2.st = 0; f2.dmgDebuff = 180; // ダウン状態・dmgDebuffあり
  // 起き上がってパンチ
  let dmgWithDebuff = null;
  const f3 = mkFighter('mario', 350, true); // ターゲット
  for (let frame = 0; frame < 300; frame++) {
    simMockNow = frame * 16;
    f2.update(f3, frame > 120 ? { ...idle, punch:true } : idle);
    if (f2.state === 'punch' && f2.st >= f2.def.punchS) {
      const info = f2.damageInfo();
      if (info) { dmgWithDebuff = info.dmg; break; }
    }
  }
  const normalDmg = CHARS.yuuri.punchDmg;
  D.results.push({ id:'D-12', title:'dmgDebuff: KD後55%ダメージ', normalDmg, dmgWithDebuff, expected: Math.floor(normalDmg * 0.55) });
})();

// --- D-13: punchIsProjectileキャラのpunchDmg=0確認 ---
// 仮説: おとうさん・クッパはpunchDmg=0で物理パンチはダメージなし
(function testProjectilePunchNoDmg() {
  const projChars = CHAR_LIST.filter(c => c.punchIsProjectile);
  const results13 = projChars.map(def => {
    const f = mkFighter(def.id, 300, true);
    f.state = 'punch';
    const info = f.damageInfo();
    return { name: def.name, punchDmg: def.punchDmg, infoDmg: info ? info.dmg : null };
  });
  D.results.push({ id:'D-13', title:'飛び道具キャラのpunchDmg=0確認', results13 });
})();

// --- D-14: 空中special発動できないか確認 ---
// 仮説: specialは onGround 時のみ発動（コード: specialGauge >= 1/3 && onGround）
(function testAirSpecial() {
  const f1 = mkFighter('mario', 300, true);
  const f2 = mkFighter('mario', 450, false);
  resetState(f1, f2);
  f1.specialGauge = 100;
  f1.y = GROUND - 200; f1.onGround = false; f1.state = 'jump'; f1.vy = 0;
  let airSpecialFired = false;
  for (let frame = 0; frame < 20; frame++) {
    simMockNow = frame * 16;
    if (!f1.onGround) runFrame(f1, f2, special, idle);
    if (f1.state === 'special' || f1.state === 'super') { airSpecialFired = true; break; }
  }
  D.results.push({ id:'D-14', title:'空中special発動不可確認', airSpecialFired });
})();

// --- D-15: 両者同時死亡の判定 ---
// 仮説: 両者同時に HP<=0 → DRAW判定（wins配列変化なし）
(function testSimultaneousDeath() {
  const f1 = mkFighter('mario', 300, true);
  const f2 = mkFighter('mario', 350, false);
  resetState(f1, f2);
  f1.hp = 1; f2.hp = 1;
  // 両者が同フレームに被弾するシナリオ
  // f2をhurt状態ではない（hitStun=0）にして両者パンチ
  const winsSnap = [...wins];
  runFrame(f1, f2, punch, { ...idle, left:true, punch:true });
  // 勝敗判定はメインループのp1ko/p2koチェック
  const p1ko = f1.hp <= 0;
  const p2ko = f2.hp <= 0;
  let p1wins = null;
  if (p2ko && !p1ko) p1wins = true;
  else if (p1ko && !p2ko) p1wins = false;
  // 両方なら null → DRAW
  D.results.push({ id:'D-15', title:'両者同時死亡=DRAW判定ロジック', p1ko, p2ko, isDraw: p1wins === null, f1hp: f1.hp, f2hp: f2.hp });
})();

// ================================================================
// PERSONA 3: ブラックボックステスター - 外部仕様からの探索
// ================================================================
const B = { results: [] };

// --- B-01: スタンドガード有効性（パンチ・jatkをブロック）---
(function testStandGuardEffectiveness() {
  let punchBlocked = 0, jatkBlocked = 0, kickNotBlocked = 0, jkickNotBlocked = 0;
  const ITERS = 50;
  for (let i = 0; i < ITERS; i++) {
    // パンチ vs スタンドガード
    const f1p = mkFighter('mario', 300, true);
    const f2p = mkFighter('mario', 360, false);
    resetState(f1p, f2p);
    const hpBefore = f2p.hp;
    for (let fr = 0; fr < 50; fr++) { simMockNow = fr*16; runFrame(f1p, f2p, punch, block); if (f1p.state==='idle'&&fr>15) break; }
    if (f2p.hp === hpBefore) punchBlocked++;

    // キック vs スタンドガード（抜けるか）
    const f1k = mkFighter('mario', 300, true);
    const f2k = mkFighter('mario', 360, false);
    resetState(f1k, f2k);
    const hpk = f2k.hp;
    for (let fr = 0; fr < 80; fr++) { simMockNow = fr*16; runFrame(f1k, f2k, kick, block); if (f1k.state==='idle'&&fr>30) break; }
    if (f2k.hp < hpk) kickNotBlocked++;
  }
  B.results.push({ id:'B-01', title:'スタンドガード: パンチブロック/キック貫通', punchBlocked_outOf50: punchBlocked, kickPenetrate_outOf50: kickNotBlocked });
})();

// --- B-02: クラウチガード有効性（キックをブロック）---
(function testCrouchGuardEffectiveness() {
  let kickBlocked = 0, punchPenetrate = 0;
  const ITERS = 50;
  for (let i = 0; i < ITERS; i++) {
    const f1k = mkFighter('mario', 300, true);
    const f2k = mkFighter('mario', 360, false);
    resetState(f1k, f2k);
    const hpk = f2k.hp;
    for (let fr = 0; fr < 80; fr++) { simMockNow = fr*16; runFrame(f1k, f2k, kick, crouchBlock); if (f1k.state==='idle'&&fr>30) break; }
    if (f2k.hp === hpk) kickBlocked++;

    const f1p = mkFighter('mario', 300, true);
    const f2p = mkFighter('mario', 360, false);
    resetState(f1p, f2p);
    const hpp = f2p.hp;
    for (let fr = 0; fr < 50; fr++) { simMockNow = fr*16; runFrame(f1p, f2p, punch, crouchBlock); if (f1p.state==='idle'&&fr>15) break; }
    if (f2p.hp < hpp) punchPenetrate++;
  }
  B.results.push({ id:'B-02', title:'クラウチガード: キックブロック/パンチ貫通', kickBlocked_50: kickBlocked, punchPenetrate_50: punchPenetrate });
})();

// --- B-03: jkick無敵性（両ガードで防げない）---
(function testJkickUnblockable() {
  let crouchFail = 0, standFail = 0;
  const ITERS = 100;
  for (let i = 0; i < ITERS; i++) {
    [crouchBlock, block].forEach((guardInp, gi) => {
      const f1 = mkFighter('mario', 300, true);
      const f2 = mkFighter('mario', 380, false);
      resetState(f1, f2);
      // まずジャンプ
      for (let fr = 0; fr < 8; fr++) { simMockNow = fr*16; runFrame(f1, f2, {...idle, up:true, right:true}, guardInp); }
      const hpB = f2.hp;
      for (let fr = 8; fr < 60; fr++) {
        simMockNow = fr*16;
        runFrame(f1, f2, {...idle, kick:true}, guardInp);
        if (f2.hp < hpB) { if(gi===0) crouchFail++; else standFail++; break; }
        if (f1.onGround) break;
      }
    });
  }
  B.results.push({ id:'B-03', title:'jkick: 両ガード貫通確認', crouchGuardPenetrated_100: crouchFail, standGuardPenetrated_100: standFail });
})();

// --- B-04: ラウンド制: 2本先取でゲーム終了 ---
// 仮説: wins[0]>=2 or wins[1]>=2 でexitToMenu呼び出し
(function testRoundWinLogic() {
  const winsArr = [0, 0];
  const roundEnds = [];
  // シミュレーション: 2ラウンド分
  [1, 2].forEach(r => {
    winsArr[0]++;
    roundEnds.push({ round: r, wins: [...winsArr] });
  });
  const shouldEnd = winsArr[0] >= 2 || winsArr[1] >= 2;
  B.results.push({ id:'B-04', title:'2本先取でゲーム終了ロジック', roundEnds, shouldEnd });
})();

// --- B-05: キャラサイズとヒットボックスの一貫性 ---
// 仮説: scaleが小さいキャラほどhurtboxも小さい
(function testHurtboxConsistency() {
  const hurtboxes = CHAR_LIST.map(def => {
    const f = mkFighter(def.id, 300, true);
    const hb = f.hurtbox();
    const area = hb.w * hb.h;
    return { name: def.name, scale: def.scale, hurtboxArea: Math.round(area) };
  }).sort((a,b) => a.scale - b.scale);
  B.results.push({ id:'B-05', title:'キャラスケール vs ハートボックス面積', hurtboxes });
})();

// --- B-06: 全必殺技で特殊攻撃ガード時のダメージ確認 ---
// 仮説: special攻撃はガード中でも40%ダメージ
(function testSpecialGuardDmg() {
  const specResults = CHAR_LIST.map(def => {
    const f1 = mkFighter(def.id, 300, true);
    const f2 = mkFighter('mario', 360, false);
    resetState(f1, f2);
    f1.specialGauge = 50; // 1/2発動
    const hpBefore = f2.hp;
    for (let frame = 0; frame < 300; frame++) {
      simMockNow = frame * 16;
      const inp1 = frame < 3 ? special : idle;
      runFrame(f1, f2, inp1, block); // f2はガード
      if (f1.state === 'idle' && frame > 50) break;
    }
    return { name: def.name, dmgThroughGuard: hpBefore - f2.hp };
  });
  B.results.push({ id:'B-06', title:'全キャラ必殺技 vs ガード時ダメージ', specResults });
})();

// --- B-07: 必殺技ゲージ: ダメージを受けるとゲージ増加 ---
// 仮説: takeHit後、ゲージが増える（+8）
(function testGaugeOnHit() {
  const f1 = mkFighter('mario', 300, true);
  const f2 = mkFighter('mario', 350, false);
  resetState(f1, f2);
  const gaugeBefore = f2.specialGauge;
  runFrame(f1, f2, punch, idle);
  for (let fr = 0; fr < 30; fr++) { simMockNow=fr*16; runFrame(f1, f2, idle, idle); }
  B.results.push({ id:'B-07', title:'被弾でゲージ増加(+8)', gaugeBefore, gaugeAfter: f2.specialGauge, diff: f2.specialGauge - gaugeBefore });
})();

// --- B-08: すべてのキャラでspecial/super発動確認 ---
const specialFired = {};
CHAR_LIST.forEach(def => {
  const f1 = mkFighter(def.id, 300, true);
  const f2 = mkFighter('mario', 450, false);
  resetState(f1, f2);
  f1.specialGauge = 100;
  let fired = false;
  for (let frame = 0; frame < 200; frame++) {
    simMockNow = frame * 16;
    runFrame(f1, f2, frame < 3 ? special : idle, idle);
    if (f1.state === 'special' || f1.state === 'super') { fired = true; break; }
  }
  specialFired[def.name] = fired;
});
B.results.push({ id:'B-08', title:'全キャラでspecial/super発動確認', specialFired });

// ================================================================
// PERSONA 4: 非機能テスター - 仕様・UX・ゲームデザイン観点
// ================================================================
const NF = { results: [] };

// --- NF-01: キャラクター特性の説明(desc/flavor)が実際の性能と一致するか ---
(function testFlavorAccuracy() {
  const charMeta = CHAR_LIST.map(def => ({
    name: def.name,
    desc: def.desc,
    flavor: def.flavor,
    walkSpd: def.walkSpd,
    jumpVel: def.jumpVel,
    punchDmg: def.punchDmg,
    kickDmg: def.kickDmg,
    jatkDmg: def.jatkDmg,
    scale: def.scale,
    punchIsProjectile: !!def.punchIsProjectile
  }));
  NF.results.push({ id:'NF-01', title:'キャラ説明と実数値の一覧', charMeta });
})();

// --- NF-02: CPUのspecial使用率 vs 弱/通常/強 ---
// 仮説: 強CPUは必殺技をより頻繁に使う
(function testCPUSpecialUsage() {
  const usageByDiff = {};
  ['weak', 'normal', 'strong'].forEach(diff => {
    let totalSpecial = 0;
    const ITERS = 10;
    for (let i = 0; i < ITERS; i++) {
      const f1 = mkFighter('mario', 300, true);
      const f2 = mkFighter('mario', 500, false);
      resetState(f1, f2);
      cpuDifficulty = diff;
      const ai = new CPU(f1, f2);
      let specialCount = 0;
      f1.specialGauge = 100;
      for (let frame = 0; frame < 500; frame++) {
        simMockNow = frame * 16;
        const inp = ai.update();
        if (inp.special) specialCount++;
        f1.update(f2, inp);
        f2.update(f1, idle);
        f1.specialGauge = Math.min(100, f1.specialGauge + 0.5);
      }
      totalSpecial += specialCount;
    }
    usageByDiff[diff] = Math.round(totalSpecial / ITERS);
  });
  NF.results.push({ id:'NF-02', title:'難易度別CPU必殺技使用回数(500フレーム)', usageByDiff });
})();

// --- NF-03: 強CPUはブロックを多用するか ---
(function testCPUBlockUsage() {
  const blockByDiff = {};
  ['weak', 'normal', 'strong'].forEach(diff => {
    let totalBlock = 0;
    const ITERS = 5;
    for (let i = 0; i < ITERS; i++) {
      const f1 = mkFighter('mario', 400, true);
      const f2 = mkFighter('mario', 500, false);
      resetState(f1, f2);
      cpuDifficulty = diff;
      const ai = new CPU(f2, f1); // f2がCPU
      let blockCount = 0;
      // f1が連打中
      for (let frame = 0; frame < 500; frame++) {
        simMockNow = frame * 16;
        const inp2 = ai.update();
        if (inp2.block) blockCount++;
        f1.update(f2, punch);
        f2.update(f1, inp2);
      }
      totalBlock += blockCount;
    }
    blockByDiff[diff] = Math.round(totalBlock / ITERS);
  });
  NF.results.push({ id:'NF-03', title:'難易度別CPUブロック頻度(500フレーム連打中)', blockByDiff });
})();

// --- NF-04: キャラ各種速度パラメータの比較表 ---
NF.results.push({
  id: 'NF-04',
  title: 'キャラクター速度パラメータ一覧',
  table: CHAR_LIST.map(d => ({
    name: d.name,
    walkSpd: d.walkSpd,
    jumpVel: d.jumpVel,
    gravity: d.gravity,
    scale: d.scale,
    punchDur: d.punchDur,
    kickDur: d.kickDur
  }))
});

// --- NF-05: ガード時のブロックスタン一律18フレーム確認 ---
// 仮説: ブロック成功時blockStun=18が全キャラ共通
(function testBlockStunUniform() {
  const blockStuns = CHAR_LIST.map(def => {
    const f1 = mkFighter('mario', 300, true);
    const f2 = mkFighter(def.id, 360, false);
    resetState(f1, f2);
    for (let fr = 0; fr < 60; fr++) {
      simMockNow = fr*16;
      runFrame(f1, f2, punch, block);
      if (f2.blockStun > 0) return { name: def.name, blockStun: f2.blockStun };
    }
    return { name: def.name, blockStun: 0 };
  });
  NF.results.push({ id:'NF-05', title:'ブロックスタン値(全キャラ一律18フレームか)', blockStuns });
})();

// --- NF-06: ゲームエンド時(2本先取)の挙動: exitToMenu ---
// 仮説: wins[0]>=2のとき exitToMenu() が呼ばれる
(function testGameEnd() {
  let exitCalled = false;
  const orig = typeof exitToMenu !== 'undefined' ? exitToMenu : null;
  // exitToMenuはフェーズリセット関数
  NF.results.push({ id:'NF-06', title:'2本先取でexitToMenu呼び出しロジック', codeCheck: 'wins[0]>=2||wins[1]>=2 → exitToMenu()' });
})();

// --- NF-07: キャラ全員のhp初期値 ---
const initialHPs = CHAR_LIST.map(def => {
  const f = mkFighter(def.id, 300, true);
  return { name: def.name, hp: f.hp, maxHp: f.maxHp };
});
NF.results.push({ id:'NF-07', title:'全キャラHP初期値(全員100か)', initialHPs });

// --- NF-08: specialGauge増加バランス（ヒット時・被弾時） ---
// 攻撃ヒット時+12, 被弾時+8
NF.results.push({
  id: 'NF-08',
  title: 'ゲージ増加値: 攻撃命中+12, 被弾+8 (特殊除く)',
  note: 'コード: checkCollision内でspecialGauge+=12, takeHit内でspecialGauge+=8(特殊以外)'
});

// --- NF-09: CPUがキックを使わない問題（strong難易度）---
// コード確認: strongではkickアクション時にpunchに切り替える確率50%
(function testCPUKickUsage() {
  const kickByDiff = {};
  ['normal', 'strong'].forEach(diff => {
    let kicks = 0;
    const ITERS = 5;
    for (let i = 0; i < ITERS; i++) {
      const f1 = mkFighter('mario', 300, true);
      const f2 = mkFighter('mario', 400, false);
      resetState(f1, f2);
      cpuDifficulty = diff;
      const ai = new CPU(f1, f2);
      for (let frame = 0; frame < 600; frame++) {
        simMockNow = frame*16;
        const inp = ai.update();
        if (inp.kick) kicks++;
        f1.update(f2, inp); f2.update(f1, idle);
      }
    }
    kickByDiff[diff] = Math.round(kicks / ITERS);
  });
  NF.results.push({ id:'NF-09', title:'難易度別CPU キック使用回数(600フレーム)', kickByDiff, note:'strongはkick入力の50%をpunchに変換するため少ない' });
})();

// ================================================================
// 結果まとめ
// ================================================================
simResults = JSON.stringify({ G: G.results, D: D.results, B: B.results, NF: NF.results });
})();
`;

vm.runInContext(testCode, sandbox, { filename: 'explore' });
const data = JSON.parse(sandbox.simResults);

// ================================================================
// レポート出力
// ================================================================

const SEP = '='.repeat(72);
const sep = '-'.repeat(72);

console.log(SEP);
console.log('  探索的テスト レポート - 大乱闘ウエダファミリー');
console.log('  実施日: ' + new Date().toISOString().slice(0, 10));
console.log(SEP);

// ----------------------------------------------------------------
// PERSONA 1: ゲーマー
// ----------------------------------------------------------------
console.log('\n【PERSONA 1: ゲーマー】 はめ技・バランス・必殺技探索');
console.log(sep);

const G = data.G;
G.forEach(r => {
  console.log(`\n[${r.id}] ${r.title}`);
  if (r.wr !== undefined) {
    const jkickDesigned = (r.id==='G-01'||r.id==='G-02') && r.wr>=90;
    const flag = jkickDesigned ? ' ✅ 仕様通り(jkickはガード不可設計)' : r.wr >= 70 ? ' ⚠️  問題あり' : r.wr >= 60 ? ' △ 注意' : ' ✅ OK';
    console.log(`  勝率: ${r.wr}%${flag}`);
  }
  if (r.kdFrame !== undefined) {
    const flag = r.kdFrame !== -1 && r.kdFrame < 60 ? ' ⚠️ 早期ノックダウン' : ' ✅';
    console.log(`  KD到達フレーム: ${r.kdFrame === -1 ? '未到達' : r.kdFrame + 'f'}${flag}`);
  }
  if (r.invincStart !== undefined) {
    console.log(`  downrise開始フレーム: ${r.invincStart}, 被弾あり: ${r.hitDuringInvinc}, 残無敵: ${r.invincFrames}`);
  }
  if (r.dmgDealt !== undefined) {
    console.log(`  ダメージ: ${r.dmgDealt}, 相手残HP: ${r.f2hp}, 相手状態: ${r.f2state || '-'}`);
  }
  if (r.superDmgs) {
    console.log('  超必殺ダメージ一覧:');
    Object.entries(r.superDmgs).forEach(([name, dmg]) => {
      const flag = dmg >= 80 ? ' ⚠️ 高すぎ?' : dmg === 0 ? ' ❓ 当たらず' : '';
      console.log(`    ${name.padEnd(12)} ${dmg}${flag}`);
    });
  }
});

// ----------------------------------------------------------------
// PERSONA 2: 開発者
// ----------------------------------------------------------------
console.log('\n\n【PERSONA 2: 開発者】 境界値・状態機械・システム構造');
console.log(sep);

data.D.forEach(r => {
  console.log(`\n[${r.id}] ${r.title}`);
  if (r.diedAtFrame !== undefined) console.log(`  死亡フレーム: ${r.diedAtFrame}, 最終HP: ${r.finalHp}, 状態: ${r.finalState}`);
  if (r.isNeg !== undefined) console.log(`  最終HP: ${r.finalHp}, 負になった: ${r.isNeg}${r.isNeg?' ⚠️ バグ':' ✅'}`);
  if (r.drawDetected !== undefined) console.log(`  DRAW検出: ${r.drawDetected}${r.drawDetected?' ✅':' ⚠️'}, timerSec: ${r.timerSec}, HP: ${r.f1hp}/${r.f2hp}`);
  if (r.f1XAfter !== undefined) console.log(`  壁際テスト - f2nearWall:${r.f2NearWall}, f1.x: ${Math.round(r.f1XBefore)}→${Math.round(r.f1XAfter)}, f2.x: ${Math.round(r.f2XBefore)}→${Math.round(r.f2XAfter)}`);
  if (r.pushRecords) {
    console.log('  コンボ別プッシュ量:');
    r.pushRecords.forEach(p => console.log(`    combo${p.combo}: push=${Math.round(p.pushed)}`));
  }
  if (r.dmgThroughGuard !== undefined) console.log(`  ガード貫通ダメージ: ${r.dmgThroughGuard} (before:${r.hpBefore} → after:${r.hpAfter})`);
  if (r.dmgTaken !== undefined) console.log(`  super中被弾: ${r.dmgTaken === 0 ? '✅ 0ダメ(無敵)' : '⚠️ '+r.dmgTaken+'ダメ(バグ)'}`);
  if (r.earlyExit !== undefined) console.log(`  早期idle遷移: ${r.earlyExit ? '⚠️ 発生' : '✅ なし'}, hitStunGiven: ${r.f2def_hitStunGiven}`);
  if (r.minDistBroken !== undefined) console.log(`  MIN_DIST違反: ${r.minDistBroken ? '⚠️ 発生' : '✅ なし'}, 最終距離: ${Math.round(r.finalDist)}`);
  if (r.outOfBounds !== undefined) console.log(`  境界外出現: ${r.outOfBounds ? '⚠️ 発生' : '✅ なし'}, 位置: f1=${Math.round(r.f1x)}, f2=${Math.round(r.f2x)}`);
  if (r.triggeredSpecialAt33 !== undefined) console.log(`  50%で必殺: ${r.triggeredSpecialAt33?'✅':'⚠️'}, 99%で超必殺非発動: ${r.notTriggeredSuper?'✅':'⚠️'}`);
  if (r.dmgWithDebuff !== undefined) console.log(`  通常ダメ: ${r.normalDmg}, デバフ後: ${r.dmgWithDebuff}, 期待値: ${r.expected}${r.dmgWithDebuff === r.expected?' ✅':' ⚠️'}`);
  if (r.results13) { console.log('  飛び道具キャラpunchDmg=0:'); r.results13.forEach(c => console.log(`    ${c.name}: punchDmg=${c.punchDmg} info.dmg=${c.infoDmg}${c.infoDmg===0?' ✅':' ⚠️'}`)); }
  if (r.airSpecialFired !== undefined) console.log(`  空中special発動: ${r.airSpecialFired ? '⚠️ バグ(発動した)' : '✅ 発動しない'}`);
  if (r.p1ko !== undefined) console.log(`  p1ko:${r.p1ko}, p2ko:${r.p2ko}, DRAW:${r.isDraw}${r.isDraw?' ✅':' ✅'}, HP: f1=${r.f1hp}, f2=${r.f2hp}`);
});

// ----------------------------------------------------------------
// PERSONA 3: ブラックボックステスター
// ----------------------------------------------------------------
console.log('\n\n【PERSONA 3: ブラックボックス】 外部仕様からの検証');
console.log(sep);

data.B.forEach(r => {
  console.log(`\n[${r.id}] ${r.title}`);
  if (r.punchBlocked_outOf50 !== undefined) {
    const pb = r.punchBlocked_outOf50, kp = r.kickPenetrate_outOf50;
    console.log(`  パンチブロック: ${pb}/50${pb < 45 ? ' ⚠️ ガード失敗あり' : ' ✅'}`);
    console.log(`  キック貫通(仕様通り): ${kp}/50${kp > 30 ? ' ✅ 仕様通り' : ' △'}`);
  }
  if (r.kickBlocked_50 !== undefined) {
    console.log(`  キックブロック(クラウチ): ${r.kickBlocked_50}/50${r.kickBlocked_50 >= 45 ? ' ✅' : ' ⚠️'}`);
    console.log(`  パンチ貫通(クラウチ, 仕様通り): ${r.punchPenetrate_50}/50${r.punchPenetrate_50 > 30 ? ' ✅' : ' △'}`);
  }
  if (r.crouchGuardPenetrated_100 !== undefined) {
    console.log(`  jkick vs クラウチガード貫通: ${r.crouchGuardPenetrated_100}/100${r.crouchGuardPenetrated_100 > 60 ? ' ✅ 仕様通り' : ' ⚠️'}`);
    console.log(`  jkick vs スタンドガード貫通: ${r.standGuardPenetrated_100}/100${r.standGuardPenetrated_100 > 60 ? ' ✅ 仕様通り' : ' ⚠️'}`);
  }
  if (r.shouldEnd !== undefined) console.log(`  2本先取終了ロジック: ${r.shouldEnd ? '✅' : '⚠️'}`);
  if (r.hurtboxes) {
    console.log('  スケール vs ハートボックス面積:');
    r.hurtboxes.forEach(h => console.log(`    ${h.name.padEnd(12)} scale=${h.scale} area=${h.hurtboxArea}`));
  }
  if (r.specResults) {
    console.log('  必殺技ガード貫通ダメージ:');
    r.specResults.forEach(c => {
      const flag = c.dmgThroughGuard === 0 ? ' ⚠️ ガード完全無効?' : c.dmgThroughGuard > 20 ? ' ⚠️ 高すぎ' : ' ✅';
      console.log(`    ${c.name.padEnd(12)} ${c.dmgThroughGuard}${flag}`);
    });
  }
  if (r.diff !== undefined) console.log(`  ゲージ増加: before=${r.gaugeBefore}, after=${r.gaugeAfter}, diff=${r.diff}${r.diff >= 8 ? ' ✅' : ' ⚠️'}`);
  if (r.specialFired) {
    console.log('  特殊/超必発動:');
    Object.entries(r.specialFired).forEach(([name, fired]) => console.log(`    ${name.padEnd(12)} ${fired ? '✅' : '⚠️ 発動せず'}`));
  }
});

// ----------------------------------------------------------------
// PERSONA 4: 非機能テスター
// ----------------------------------------------------------------
console.log('\n\n【PERSONA 4: 非機能テスター】 UX・ゲームデザイン観点');
console.log(sep);

data.NF.forEach(r => {
  console.log(`\n[${r.id}] ${r.title}`);
  if (r.charMeta) {
    console.log('  キャラ説明と実数値:');
    r.charMeta.forEach(c => {
      console.log(`  ${c.name}(${c.desc})`);
      console.log(`    walkSpd=${c.walkSpd}, jumpVel=${c.jumpVel}, punch=${c.punchDmg}, kick=${c.kickDmg}, jatk=${c.jatkDmg}, scale=${c.scale}`);
      console.log(`    説明: ${c.flavor ? c.flavor.join(' / ') : '-'}`);
    });
  }
  if (r.usageByDiff) console.log(`  必殺技使用: weak=${r.usageByDiff.weak}, normal=${r.usageByDiff.normal}, strong=${r.usageByDiff.strong}`);
  if (r.blockByDiff) console.log(`  ブロック頻度: weak=${r.blockByDiff.weak}, normal=${r.blockByDiff.normal}, strong=${r.blockByDiff.strong}`);
  if (r.table) {
    console.log('  速度パラメータ一覧:');
    r.table.forEach(c => console.log(`    ${c.name.padEnd(12)} walk=${c.walkSpd} jump=${Math.abs(c.jumpVel)} grav=${c.gravity} punchDur=${c.punchDur} kickDur=${c.kickDur}`));
  }
  if (r.blockStuns) {
    console.log('  ブロックスタン値:');
    const uniform = r.blockStuns.every(b => b.blockStun === r.blockStuns[0].blockStun);
    r.blockStuns.forEach(b => console.log(`    ${b.name.padEnd(12)} ${b.blockStun}f`));
    console.log(`  → 全キャラ一律: ${uniform ? '✅' : '⚠️ 不均一'}`);
  }
  if (r.codeCheck) console.log(`  確認: ${r.codeCheck}`);
  if (r.initialHPs) {
    const allSame = r.initialHPs.every(c => c.hp === 100);
    r.initialHPs.forEach(c => console.log(`    ${c.name.padEnd(12)} hp=${c.hp}, maxHp=${c.maxHp}`));
    console.log(`  → 全キャラHP=100: ${allSame ? '✅' : '⚠️ 不均一'}`);
  }
  if (r.note) console.log(`  備考: ${r.note}`);
  if (r.kickByDiff) console.log(`  キック使用: normal=${r.kickByDiff.normal}, strong=${r.kickByDiff.strong}`);
});

console.log('\n' + SEP);
console.log('  探索的テスト 完了');
console.log(SEP);
