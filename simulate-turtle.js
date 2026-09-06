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

const simCode = `
(function() {
  const ITERS = 300;
  const MAX_FRAMES = 60 * 99;
  const N = CHAR_LIST.length;
  const names = CHAR_LIST.map(d => d.name);

  // しゃがみガードCPU: 常にしゃがみ+ブロック。ガードが崩れない限り攻撃しない
  function turtleInput(me, opp) {
    return {
      punch: false, kick: false,
      left: false, right: false,
      up: false, down: true,
      block: true, special: false
    };
  }

  // 連打+前進CPU (比較用: 攻め続ける)
  function mashInput(me, opp) {
    const toward = opp.x > me.x;
    return {
      punch: true, kick: false,
      left: !toward, right: toward,
      up: false, down: false,
      block: false, special: false
    };
  }

  function runBattle(def1, def2, inp1fn, inp2fn) {
    projectiles.length = 0; wordProjs.length = 0;
    hurdleAttack = null; activeGorilla = null; activeDragon = null; activeBlackHole = null;
    phase = 'fight'; gameMode = 'cpu'; cpuDifficulty = 'normal';
    timerSec = 99; timerTick = 0;

    const f1 = new Fighter(200, true,  def1);
    const f2 = new Fighter(600, false, def2);
    p1 = f1; p2 = f2; fighters = [f1, f2];
    const ai2 = new CPU(f2, f1);
    const ai1 = new CPU(f1, f2);

    for (let frame = 0; frame < MAX_FRAMES; frame++) {
      simMockNow = frame * 16;

      const i1 = inp1fn(f1, f2, ai1);
      const i2 = inp2fn(f2, f1, ai2);
      f1.update(f2, i1);
      f2.update(f1, i2);

      if (f1.specialFired) { f1.specialFired = false; spawnSpecialEffect(f1, f2); }
      if (f2.specialFired) { f2.specialFired = false; spawnSpecialEffect(f2, f1); }
      if (f1.punchFired && f1.def.punchIsProjectile) { f1.punchFired = false; f1.def.id==='kuppa'?spawnFire(f1):spawnBaseball(f1); }
      if (f2.punchFired && f2.def.punchIsProjectile) { f2.punchFired = false; f2.def.id==='kuppa'?spawnFire(f2):spawnBaseball(f2); }

      updateProjectiles(f1, f2);
      updateHurdles(f1, f2);
      updateWords(f1, f2);
      if (activeGorilla) activeGorilla.update();
      if (activeDragon)  activeDragon.update();
      if (activeBlackHole) activeBlackHole.update(f1, f2);
      checkCollision(f1, f2);
      checkCollision(f2, f1);

      const d1 = f1.hp <= 0 || f1.state === 'dead';
      const d2 = f2.hp <= 0 || f2.state === 'dead';
      if (d1 || d2) {
        if (!d1) return 0; // p2 died, p1 wins
        if (!d2) return 1; // p1 died, p2 wins
        return 2; // draw
      }
    }
    // time up: higher HP wins
    return f1.hp >= f2.hp ? 0 : 1;
  }

  // --- Test 1: turtle(しゃがみガード守り) vs normal CPU ---
  const turtleWins = Array.from({length: N}, () => new Array(N).fill(0));
  const turtleHpLeft = Array.from({length: N}, () => new Array(N).fill(0));
  const normalHpLeft = Array.from({length: N}, () => new Array(N).fill(0));

  for (let a = 0; a < N; a++) {
    for (let b = 0; b < N; b++) {
      if (a === b) continue;
      for (let k = 0; k < ITERS; k++) {
        const res = runBattle(
          CHAR_LIST[a], CHAR_LIST[b],
          (me,opp,ai) => turtleInput(me, opp),
          (me,opp,ai) => ai.update()
        );
        if (res === 0) turtleWins[a][b]++;
      }
    }
  }

  // --- Test 2: mash vs turtle (連打がしゃがみガードに有効か?) ---
  // turtle is p2, mash is p1
  const mashVsTurtleWins = Array.from({length: N}, () => new Array(N).fill(0));
  for (let a = 0; a < N; a++) {
    for (let b = 0; b < N; b++) {
      if (a === b) continue;
      for (let k = 0; k < ITERS; k++) {
        const res = runBattle(
          CHAR_LIST[a], CHAR_LIST[b],
          (me,opp,ai) => mashInput(me, opp),
          (me,opp,ai) => turtleInput(me, opp)
        );
        if (res === 0) mashVsTurtleWins[a][b]++;
      }
    }
  }

  simResults = JSON.stringify({ names, turtleWins, mashVsTurtleWins, ITERS });
})();
`;

process.stdout.write('しゃがみガードシミュレーション中...');
vm.runInContext('Date = { now: () => simMockNow };', sandbox);
vm.runInContext(simCode, sandbox, { filename: 'sim-turtle' });
console.log(' 完了\n');

const { names, turtleWins, mashVsTurtleWins, ITERS } = JSON.parse(sandbox.simResults);
const N = names.length;

// --- 結果1: turtle vs normal ---
console.log('='.repeat(72));
console.log('【守り専用(しゃがみガード) vs 通常CPU】 勝率% [各' + ITERS + '戦]');
console.log('  守り側が高い → しゃがみガードが強すぎる問題あり');
console.log('='.repeat(72));

const turtleAvg = [];
for (let a = 0; a < N; a++) {
  let total = 0, cnt = 0;
  const row = names.map((_, b) => {
    if (a === b) return '---'.padStart(6);
    const wr = Math.round(turtleWins[a][b] / ITERS * 100);
    total += wr; cnt++;
    const color = wr >= 50 ? '\x1b[31m' : wr <= 30 ? '\x1b[32m' : '';
    return (color + (wr + '%').padStart(5) + '\x1b[0m').padStart(6 + (color ? 14 : 0));
  });
  const avg = Math.round(total / cnt);
  turtleAvg.push({ name: names[a], avg });
  const ac = avg >= 50 ? '\x1b[31m' : avg <= 30 ? '\x1b[32m' : '';
  console.log('  ' + names[a].padEnd(11) + '│' + row.join('') + ' │ ' + ac + avg + '%\x1b[0m');
}

console.log('='.repeat(72));
console.log('\nしゃがみガード勝率ランキング:');
[...turtleAvg].sort((a,b)=>b.avg-a.avg).forEach((c,i)=>{
  const color = c.avg >= 50 ? '\x1b[31m' : c.avg <= 30 ? '\x1b[32m' : '';
  console.log(`  ${i+1}. ${c.name.padEnd(10)} ${color}${c.avg}%\x1b[0m`);
});

// --- 結果2: mash vs turtle ---
console.log('\n' + '='.repeat(72));
console.log('【連打 vs しゃがみガード守り】 勝率% (連打側の勝率)');
console.log('  低いほど → 連打ではしゃがみガードを崩せない問題あり');
console.log('='.repeat(72));

const mvtAvg = [];
for (let a = 0; a < N; a++) {
  let total = 0, cnt = 0;
  const row = names.map((_, b) => {
    if (a === b) return '---'.padStart(6);
    const wr = Math.round(mashVsTurtleWins[a][b] / ITERS * 100);
    total += wr; cnt++;
    const color = wr <= 40 ? '\x1b[31m' : wr >= 70 ? '\x1b[32m' : '';
    return (color + (wr + '%').padStart(5) + '\x1b[0m').padStart(6 + (color ? 14 : 0));
  });
  const avg = Math.round(total / cnt);
  mvtAvg.push({ name: names[a], avg });
  const ac = avg <= 40 ? '\x1b[31m' : avg >= 70 ? '\x1b[32m' : '';
  console.log('  連打:' + names[a].padEnd(9) + '│' + row.join('') + ' │ ' + ac + avg + '%\x1b[0m');
}
console.log('='.repeat(72));
console.log('凡例: \x1b[31m赤=連打で勝てない(しゃがみガードが強い)\x1b[0m  \x1b[32m緑=連打が有効\x1b[0m\n');
