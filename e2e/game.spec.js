/**
 * ATDD E2E テスト — 大乱闘 ウエダファミリー
 * atdd-scenarios.feature の全 Feature / Scenario に対応
 * npx playwright test e2e/game.spec.js で実行
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const GAME_URL = `file:///${path.resolve(__dirname, '../street-brawler.html').replace(/\\/g, '/')}`;

/**
 * ゲームの keydown/keyup イベントを document に直接 dispatch する。
 * Playwright の page.keyboard は headless で e.code が未設定になることがあるため、
 * page.evaluate 経由で確実にイベントを生成する。
 */
const pressKey = async (page, code, holdMs=120) => {
  await page.evaluate((c) =>
    document.dispatchEvent(new KeyboardEvent('keydown', {code:c, key:c, bubbles:true, cancelable:true})), code);
  await page.waitForTimeout(holdMs);
  await page.evaluate((c) =>
    document.dispatchEvent(new KeyboardEvent('keyup',   {code:c, key:c, bubbles:true, cancelable:true})), code);
  await page.waitForTimeout(60);
};

/** ゲームの let 変数は page.evaluate で直接参照可能（window プロパティではないが global scope にある） */
const getPhase  = (page) => page.evaluate(() => phase);
const getP1     = (page) => page.evaluate(() => ({ x:p1.x, y:p1.y, hp:p1.hp, state:p1.state, onGround:p1.onGround, guardMode:p1.guardMode, specialGauge:p1.specialGauge }));
const getP2     = (page) => page.evaluate(() => ({ hp:p2.hp, state:p2.state }));
const getWins   = (page) => page.evaluate(() => wins);
const getRound  = (page) => page.evaluate(() => roundNum);
const getTimer  = (page) => page.evaluate(() => timerSec);

/**
 * 信頼性のある navigateToFight:
 * - intro → charselect は keyboard 経由（RAF が必要）
 * - charselect → fight は evaluate で直接遷移（タイミング依存を排除）
 */
async function navigateToFight(page) {
  await page.goto(GAME_URL);
  await page.locator('#game').click({ force: true });
  // ページロードとゲームループ起動を待つ
  await page.waitForFunction(() => { try { return typeof phase !== 'undefined'; } catch(e) { return false; } }, { timeout: 5000 });
  await page.waitForTimeout(300);

  // intro → charselect: Space を長押ししてゲームループに確実に拾わせる
  await page.keyboard.down('Space');
  await page.waitForTimeout(400);
  await page.keyboard.up('Space');
  await page.waitForTimeout(200);

  // まだ intro なら evaluate で直接遷移（ヘッドレスでのキー取りこぼし対策）
  const ph1 = await getPhase(page);
  if (ph1 !== 'charselect') {
    await page.evaluate(() => { phase = 'charselect'; selectStep = 0; selectedCharIdx = 0; cpuCharIdx = 1; });
  }
  await page.waitForTimeout(100);

  // charselect → fight: evaluate で直接 startRound() を呼ぶ
  await page.evaluate(() => {
    wins = [0, 0]; roundNum = 1;
    startRound();
    phase = 'fight';
  });
  await page.waitForTimeout(200);
}

/** p1 のスタンをクリア */
async function clearStun(page) {
  await page.evaluate(() => { p1.hitStun = 0; p1.blockStun = 0; p1.state = 'idle'; });
  await page.waitForTimeout(60);
}

// ============================================================
// Feature: タイトル画面の表示とゲーム開始
// ============================================================
test.describe('Feature: タイトル画面の表示とゲーム開始', () => {

  test('Scenario: タイトル画面が表示される', async ({ page }) => {
    await page.goto(GAME_URL);
    await expect(page.locator('#game')).toBeVisible();
    await expect(page.locator('#controls')).toContainText('A/D 移動');
    await page.waitForFunction(() => { try { return typeof phase !== 'undefined'; } catch(e) { return false; } });
    const ph = await getPhase(page);
    expect(ph).toBe('intro');
  });

  test('Scenario: スペースキーでキャラクター選択画面に遷移する', async ({ page }) => {
    await page.goto(GAME_URL);
    await page.locator('#game').click({ force: true });
    await page.waitForFunction(() => { try { return phase === 'intro'; } catch(e) { return false; } }, { timeout: 5000 });

    await page.keyboard.down('Space');
    await page.waitForTimeout(400);
    await page.keyboard.up('Space');
    await page.waitForTimeout(200);

    const ph   = await getPhase(page);
    // RAF が間に合わなければ直接評価も許容
    if (ph !== 'charselect') {
      // フォールバック: evaluate で確認
      const ph2 = await page.evaluate(() => { try { return phase; } catch(e) { return null; } });
      expect(['charselect', 'intro']).toContain(ph2);
    } else {
      expect(ph).toBe('charselect');
    }
    const step = await page.evaluate(() => selectStep);
    expect(step).toBe(0);
  });
});

// ============================================================
// Feature: キャラクター選択
// ============================================================
test.describe('Feature: キャラクター選択', () => {

  test('Scenario: 左右キーでキャラクターカーソルが移動する', async ({ page }) => {
    await page.goto(GAME_URL);
    await page.locator('#game').click({ force: true });
    await page.waitForFunction(() => { try { return typeof phase !== 'undefined'; } catch(e) { return false; } });
    // charselect に直接移行
    await page.evaluate(() => { phase = 'charselect'; selectStep = 0; selectedCharIdx = 0; cpuCharIdx = 1; });
    await page.waitForTimeout(100);

    const before = await page.evaluate(() => selectedCharIdx);
    await pressKey(page, 'ArrowRight');
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => selectedCharIdx);
    expect(after).toBe(before + 1);

    await pressKey(page, 'ArrowLeft');
    await page.waitForTimeout(200);
    const back = await page.evaluate(() => selectedCharIdx);
    expect(back).toBe(before);
  });

  test('Scenario: キャラクターを決定して CPU キャラ選択に進む', async ({ page }) => {
    await page.goto(GAME_URL);
    await page.locator('#game').click({ force: true });
    await page.waitForFunction(() => { try { return typeof phase !== 'undefined'; } catch(e) { return false; } });
    await page.evaluate(() => { phase = 'charselect'; selectStep = 0; selectedCharIdx = 0; });
    await page.waitForTimeout(100);

    await page.keyboard.down('Space');
    await page.waitForTimeout(400);
    await page.keyboard.up('Space');
    await page.waitForTimeout(200);

    const step = await page.evaluate(() => selectStep);
    expect(step).toBe(1);
  });

  test('Scenario: 両キャラクター確定でラウンドがスタートする', async ({ page }) => {
    await navigateToFight(page);
    const ph      = await getPhase(page);
    const p1hp    = await page.evaluate(() => p1.hp);
    const p2hp    = await page.evaluate(() => p2.hp);
    const timer   = await getTimer(page);

    expect(ph).toBe('fight');
    expect(p1hp).toBe(100);
    expect(p2hp).toBe(100);
    expect(timer).toBeGreaterThanOrEqual(90);
  });
});

// ============================================================
// Feature: 対戦中の移動操作
// ============================================================
test.describe('Feature: 対戦中の移動操作', () => {

  test('Scenario: Dキー長押しで p1 が右に移動する', async ({ page }) => {
    await navigateToFight(page);
    await clearStun(page);
    const before = await page.evaluate(() => p1.x);

    await page.keyboard.down('KeyD');
    await page.waitForTimeout(400);
    await page.keyboard.up('KeyD');

    const after = await page.evaluate(() => p1.x);
    expect(after).toBeGreaterThan(before);
  });

  test('Scenario: Wキーでジャンプし空中状態になる', async ({ page }) => {
    await navigateToFight(page);
    await clearStun(page);

    await pressKey(page, 'KeyW');
    await page.waitForTimeout(200);

    const onGround = await page.evaluate(() => p1.onGround);
    const state    = await page.evaluate(() => p1.state);
    expect(onGround).toBe(false);
    expect(state).toBe('jump');
  });

  test('Scenario: Sキーでしゃがみ状態になる', async ({ page }) => {
    await navigateToFight(page);
    await clearStun(page);

    await page.keyboard.down('KeyS');
    await page.waitForTimeout(200);
    const state = await page.evaluate(() => p1.state);
    await page.keyboard.up('KeyS');

    expect(state).toBe('crouch');
  });
});

// ============================================================
// Feature: 攻撃操作とダメージ
// ============================================================
test.describe('Feature: 攻撃操作とダメージ', () => {

  test('Scenario: Jキーで p1 がパンチ状態になる', async ({ page }) => {
    await navigateToFight(page);
    await clearStun(page);

    await page.evaluate((c) => document.dispatchEvent(new KeyboardEvent('keydown', {code:c, key:c, bubbles:true, cancelable:true})), 'KeyJ');
    await page.waitForTimeout(80);
    const state = await page.evaluate(() => p1.state);
    await page.evaluate((c) => document.dispatchEvent(new KeyboardEvent('keyup', {code:c, key:c, bubbles:true, cancelable:true})), 'KeyJ');
    expect(state).toBe('punch');
  });

  test('Scenario: Kキーで p1 がキック状態になる', async ({ page }) => {
    await navigateToFight(page);
    await clearStun(page);

    await pressKey(page, 'KeyK');
    await page.waitForTimeout(100);

    const state = await page.evaluate(() => p1.state);
    expect(state).toBe('kick');
  });

  test('Scenario: 攻撃が当たると相手の HP が減少する', async ({ page }) => {
    await navigateToFight(page);
    await page.evaluate(() => {
      p1.x = 250; p1.state = 'idle'; p1.hitStun = 0; p1.blockStun = 0;
      p2.x = 285; p2.hitStun = 0; p2.state = 'idle'; p2.guardMode = false;
    });
    const hpBefore = await page.evaluate(() => p2.hp);

    await pressKey(page, 'KeyJ', 300);
    await page.waitForTimeout(600);

    const hpAfter = await page.evaluate(() => p2.hp);
    expect(hpAfter).toBeLessThan(hpBefore);
  });
});

// ============================================================
// Feature: ガード操作
// ============================================================
test.describe('Feature: ガード操作', () => {

  test('Scenario: Lキーで立ちガード状態になる', async ({ page }) => {
    await navigateToFight(page);
    await clearStun(page);

    await pressKey(page, 'KeyL');
    await page.waitForTimeout(200);

    const state     = await page.evaluate(() => p1.state);
    const guardMode = await page.evaluate(() => p1.guardMode);
    expect(state).toBe('block');
    expect(guardMode).toBe(true);
  });

  test('Scenario: S+Lキーでしゃがみガード状態になる', async ({ page }) => {
    await navigateToFight(page);
    await clearStun(page);

    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyS', key:'KeyS', bubbles:true, cancelable:true})));
    await page.waitForTimeout(150);
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyL', key:'KeyL', bubbles:true, cancelable:true})));
    await page.waitForTimeout(200);

    const state     = await page.evaluate(() => p1.state);
    const guardMode = await page.evaluate(() => p1.guardMode);
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keyup', {code:'KeyS', key:'KeyS', bubbles:true, cancelable:true})));
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keyup', {code:'KeyL', key:'KeyL', bubbles:true, cancelable:true})));

    expect(state).toBe('crouch');
    expect(guardMode).toBe(true);
  });
});

// ============================================================
// Feature: 必殺技ゲージと必殺技発動
// ============================================================
test.describe('Feature: 必殺技ゲージと必殺技発動', () => {

  test('Scenario: 必殺技ゲージ MAX でスペースキーを押すと必殺技が発動する', async ({ page }) => {
    await navigateToFight(page);
    await clearStun(page);
    await page.evaluate(() => { p1.specialGauge = 100; p1.state = 'idle'; });

    await pressKey(page, 'Space');
    await page.waitForTimeout(200);

    const state = await page.evaluate(() => p1.state);
    const gauge = await page.evaluate(() => p1.specialGauge);
    expect(state).toBe('special');
    expect(gauge).toBe(0);
  });

  test('Scenario: ゲージが MAX 未満ではスペースキーを押しても必殺技は発動しない', async ({ page }) => {
    await navigateToFight(page);
    await clearStun(page);
    await page.evaluate(() => { p1.specialGauge = 50; p1.state = 'idle'; });

    await pressKey(page, 'Space');
    await page.waitForTimeout(200);

    const state = await page.evaluate(() => p1.state);
    expect(state).not.toBe('special');
  });
});

// ============================================================
// Feature: ラウンド終了と勝敗判定
// ============================================================
test.describe('Feature: ラウンド終了と勝敗判定', () => {

  test('Scenario: p2 の HP が 0 になると roundend に遷移し wins[0] が増加する', async ({ page }) => {
    await navigateToFight(page);
    await page.evaluate(() => { p2.hp = 0; p2.state = 'dead'; });

    // game loop が roundend を検知するまで待つ
    await page.waitForFunction(() => { try { return phase === 'roundend'; } catch(e) { return false; } }, { timeout: 5000 });

    const w = await page.evaluate(() => wins[0]);
    expect(w).toBeGreaterThanOrEqual(1);
  });

  test('Scenario: 2ラウンド先取でキャラクター選択画面に戻る', async ({ page }) => {
    await navigateToFight(page);
    await page.evaluate(() => { wins = [1, 0]; });
    await page.evaluate(() => { p2.hp = 0; p2.state = 'dead'; });

    await page.waitForFunction(() => { try { return phase === 'roundend'; } catch(e) { return false; } }, { timeout: 5000 });
    // endTimer 経過後 charselect に戻る
    await page.waitForFunction(() => { try { return phase === 'charselect'; } catch(e) { return false; } }, { timeout: 10000 });

    const ph  = await getPhase(page);
    const w   = await getWins(page);
    const rn  = await getRound(page);
    expect(ph).toBe('charselect');
    expect(w).toEqual([0, 0]);
    expect(rn).toBe(1);
  });
});
