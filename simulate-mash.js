'use strict';
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
  },
  set() { return true; }
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

// 連打シミュレーション: masher(連打) vs normal CPU
const simCode = `
(function() {
  const ITERS = 300;
  const MAX_FRAMES = 60 * 99;
  const N = CHAR_LIST.length;
  const names = CHAR_LIST.map(d => d.name);

  // 連打CPUの入力: 常に前進しながらパンチ連打、ガードなし、必殺技なし
  function mashInput(me, opp) {
    const toward = opp.x > me.x;
    return {
      punch: true,
      kick: false,
      left: !toward,
      right: toward,
      up: false,
      down: false,
      block: false,
      special: false
    };
  }

  // 連打CPUがp1, 通常CPUがp2
  function runBattle(def1, def2) {
    projectiles.length = 0; wordProjs.length = 0;
    hurdleAttack = null; activeGorilla = null; activeDragon = null; activeBlackHole = null;
    phase = 'fight'; gameMode = 'cpu'; cpuDifficulty = 'normal';
    timerSec = 99; timerTick = 0;

    const f1 = new Fighter(200, true,  def1);
    const f2 = new Fighter(600, false, def2);
    p1 = f1; p2 = f2; fighters = [f1, f2];
    const ai2 = new CPU(f2, f1);

    for (let frame = 0; frame < MAX_FRAMES; frame++) {
      simMockNow = frame * 16;

      f1.update(f2, mashInput(f1, f2));
      f2.update(f1, ai2.update());

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
          const gt=activeGorilla.owner===f1?f2:f1;
          const ghb=activeGorilla.hitbox();
          if (ghb) { const hurt=gt.hurtbox(); const ghx=ghb.w<0?ghb.x+ghb.w:ghb.x,ghw=Math.abs(ghb.w); if(ghx<hurt.x+hurt.w&&ghx+ghw>hurt.x&&ghb.y<hurt.y+hurt.h&&ghb.y+ghb.h>hurt.y){if(gt.takeHit({dmg:12,stun:20,push:18,type:'special'},activeGorilla.dir)){activeGorilla.atkHit=true;}}}
        }
      }
      if (activeDragon)  activeDragon.update();
      if (activeBlackHole) activeBlackHole.update(f1, f2);
      checkCollision(f1, f2);
      checkCollision(f2, f1);

      const d1 = f1.hp <= 0 || f1.state === 'dead';
      const d2 = f2.hp <= 0 || f2.state === 'dead';
      if (d1 || d2) {
        if (!d1) return 0;
        if (!d2) return 1;
        return 2;
      }
    }
    return f1.hp >= f2.hp ? 0 : 1;
  }

  // 各キャラが「連打」で全キャラに勝てるか
  const mashWins = Array.from({length: N}, () => new Array(N).fill(0));
  for (let a = 0; a < N; a++) {
    for (let b = 0; b < N; b++) {
      if (a === b) continue;
      for (let k = 0; k < ITERS; k++) {
        const res = runBattle(CHAR_LIST[a], CHAR_LIST[b]);
        if (res === 0) mashWins[a][b]++;
      }
    }
  }

  simResults = JSON.stringify({ names, mashWins, ITERS });
})();
`;

process.stdout.write('連打シミュレーション中...');
vm.runInContext('Date = { now: () => simMockNow };', sandbox);
vm.runInContext(simCode, sandbox, { filename: 'sim-mash' });
console.log(' 完了\n');

const { names, mashWins, ITERS } = JSON.parse(sandbox.simResults);
const N = names.length;

console.log('='.repeat(70));
console.log('連打CPU(ガードなし/必殺なし) vs 通常CPU  勝率%  [各' + ITERS + '戦]');
console.log('='.repeat(70));
console.log('  連打側キャラ  │ ' + names.map(n => n.slice(0,5).padStart(6)).join('') + '  │ 平均');
console.log('-'.repeat(70));

const avgMash = [];
for (let a = 0; a < N; a++) {
  let total = 0, cnt = 0;
  const row = names.map((_, b) => {
    if (a === b) return ' ---'.padStart(6);
    const wr = Math.round(mashWins[a][b] / ITERS * 100);
    total += wr; cnt++;
    const color = wr >= 60 ? '\x1b[31m' : wr <= 35 ? '\x1b[32m' : '';
    return (color + (wr + '%').padStart(5) + '\x1b[0m').padStart(6 + (color ? 14 : 0));
  });
  const avg = Math.round(total / cnt);
  avgMash.push({ name: names[a], avg });
  const color = avg >= 60 ? '\x1b[31m' : avg <= 35 ? '\x1b[32m' : '';
  console.log('  ' + names[a].padEnd(10) + '  │' + row.join('') + '  │ ' + color + avg + '%\x1b[0m');
}

console.log('='.repeat(70));
console.log('\n凡例: \x1b[31m赤=連打が強すぎ(60%+)\x1b[0m  \x1b[32m緑=連打が効かない(35%以下)\x1b[0m\n');

console.log('--- 連打で60%以上勝てる危険なマッチアップ ---');
let found = false;
for (let a = 0; a < N; a++) {
  for (let b = 0; b < N; b++) {
    if (a === b) continue;
    const wr = Math.round(mashWins[a][b] / ITERS * 100);
    if (wr >= 60) {
      console.log(`  \x1b[31m${names[a]}(連打) vs ${names[b]}(通常): ${wr}%\x1b[0m`);
      found = true;
    }
  }
}
if (!found) console.log('  なし');

console.log('\n--- 連打平均勝率ランキング ---');
avgMash.sort((a, b) => b.avg - a.avg).forEach((c, i) => {
  const bar = '█'.repeat(Math.round(c.avg / 5));
  const color = c.avg >= 60 ? '\x1b[31m' : c.avg <= 35 ? '\x1b[32m' : '';
  console.log(`  ${i+1}. ${c.name.padEnd(10)} ${color}${c.avg}%\x1b[0m  ${bar}`);
});
