# language: ja
# ATDD（受け入れテスト駆動開発）シナリオ — 大乱闘 ウエダファミリー
# 対象: ブラウザ E2E テスト（Playwright）
# 実装想定:
#   - page.goto('street-brawler.html') でページを開く
#   - page.keyboard.press() / page.keyboard.down() でキー入力
#   - page.evaluate() で JavaScript の内部状態（phase, p1.hp, etc.）を取得
#   - expect(canvas).toBeVisible() などで描画を確認

Feature: タイトル画面の表示とゲーム開始
  プレイヤーがゲームを開くとタイトルが表示され、
  スペースキーでキャラクター選択画面に遷移できる

  Scenario: タイトル画面が表示される
    Given ブラウザで "street-brawler.html" を開く
    Then id="game" の canvas 要素が表示されている
    And id="controls" の div に "A/D 移動" のテキストが含まれている
    And page.evaluate で `phase` を評価すると "intro" が返る

  Scenario: スペースキーでキャラクター選択画面に遷移する
    Given ブラウザで "street-brawler.html" を開き phase="intro" の状態である
    When "Space" キーを押す
    Then page.evaluate で `phase` を評価すると "charselect" が返る
    And page.evaluate で `selectStep` を評価すると 0 が返る


Feature: キャラクター選択
  プレイヤーは矢印キー（またはA/Dキー）でキャラクターを選択し、
  スペースキーで確定して対戦相手を選べる

  Scenario: 左右キーでキャラクターカーソルが移動する
    Given phase="charselect" selectStep=0 の状態である
    And page.evaluate で `selectedCharIdx` を評価すると 0 が返る
    When "ArrowRight" キーを押す
    Then page.evaluate で `selectedCharIdx` を評価すると 1 が返る
    When "ArrowLeft" キーを押す
    Then page.evaluate で `selectedCharIdx` を評価すると 0 が返る

  Scenario: キャラクターを決定して CPU キャラ選択に進む
    Given phase="charselect" selectStep=0 selectedCharIdx=0 の状態である
    When "Space" キーを押す
    Then page.evaluate で `selectStep` を評価すると 1 が返る
    And page.evaluate で `cpuCharIdx` を評価すると 1 が返る（自動で隣に設定される）

  Scenario: 両キャラクター確定でラウンドがスタートする
    Given phase="charselect" selectStep=0 の状態である
    When "Space" キーを押して自分のキャラを確定する（selectStep=0 → 1）
    And "Space" キーを押して CPU キャラを確定する（selectStep=1 → countdown）
    Then page.evaluate で `phase` を 2000ms 後に評価すると "fight" が返る
    And page.evaluate で `p1` を評価すると hp=100 state="idle" の Fighter である
    And page.evaluate で `p2` を評価すると hp=100 state="idle" の Fighter である
    And page.evaluate で `timerSec` を評価すると 99 が返る


Feature: 対戦中の移動操作
  プレイヤーはA/Dキーで移動でき、Wキーでジャンプ、Sキーでしゃがめる

  Scenario: Dキー長押しで p1 が右に移動する
    Given phase="fight" で p1 が x=200 idle 状態である
    When "KeyD" キーを 200ms 長押しする
    Then page.evaluate で `p1.x` を評価すると 200 より大きい値が返る
    And page.evaluate で `p1.state` を評価すると "walk" が返る

  Scenario: Wキーでジャンプし空中状態になる
    Given phase="fight" で p1 が onGround=true の状態である
    When "KeyW" キーを押す
    Then page.evaluate で `p1.onGround` を 100ms 後に評価すると false が返る
    And page.evaluate で `p1.state` を評価すると "jump" が返る
    And page.evaluate で `p1.vy` を評価すると 0 未満の負値が返る

  Scenario: Sキーでしゃがみ状態になる
    Given phase="fight" で p1 が idle 状態である
    When "KeyS" キーを押し続ける
    Then page.evaluate で `p1.state` を評価すると "crouch" が返る


Feature: 攻撃操作とダメージ
  プレイヤーがJキー（パンチ）またはKキー（キック）を押すと
  攻撃アニメーションが開始し、ヒット時に相手の HP が減少する

  Scenario: Jキーで p1 がパンチ状態になる
    Given phase="fight" で p1 が idle onGround=true の状態である
    When "KeyJ" キーを押す
    Then page.evaluate で `p1.state` を評価すると "punch" が返る

  Scenario: Kキーで p1 がキック状態になる
    Given phase="fight" で p1 が idle onGround=true の状態である
    When "KeyK" キーを押す
    Then page.evaluate で `p1.state` を評価すると "kick" が返る

  Scenario: 攻撃が当たると相手の HP が減少する
    Given phase="fight" で p1 と p2 が隣接した位置（x 差が 52 未満）にいる
    And p2.hp は 100 である
    When "KeyJ" キーを押してパンチを発生させる（punchS フレーム以上待つ）
    Then page.evaluate で `p2.hp` を 500ms 後に評価すると 100 未満の値が返る


Feature: ガード操作
  プレイヤーはLキーで立ちガード、S+Lキーでしゃがみガードができ、
  ガード成立時にエフェクトが表示される

  Scenario: Lキーで立ちガード状態になる
    Given phase="fight" で p1 が idle onGround=true blockStun=0 の状態である
    When "KeyL" キーを押す
    Then page.evaluate で `p1.state` を評価すると "block" が返る
    And page.evaluate で `p1.guardMode` を評価すると true が返る

  Scenario: S+Lキーでしゃがみガード状態になる
    Given phase="fight" で p1 が onGround=true blockStun=0 の状態である
    When "KeyS" と "KeyL" を同時押しする
    Then page.evaluate で `p1.state` を評価すると "crouch" が返る
    And page.evaluate で `p1.guardMode` を評価すると true が返る


Feature: 必殺技ゲージと必殺技発動
  必殺技ゲージが MAX（100）に達したとき、スペースキーで必殺技が発動する

  Scenario: 必殺技ゲージ MAX でスペースキーを押すと必殺技が発動する
    Given phase="fight" で p1 の specialGauge を JavaScript 注入で 100 に設定する
    And p1 が onGround=true idle 状態である
    When "Space" キーを押す
    Then page.evaluate で `p1.state` を評価すると "special" が返る
    And page.evaluate で `p1.specialGauge` を評価すると 0 が返る

  Scenario: ゲージが MAX 未満ではスペースキーを押しても必殺技は発動しない
    Given phase="fight" で p1 の specialGauge=50 の状態である
    And p1 が onGround=true idle 状態である
    When "Space" キーを押す
    Then page.evaluate で `p1.state` を評価すると "special" ではない（"idle" のまま）


Feature: ラウンド終了と勝敗判定
  どちらかの HP が 0 になるか、タイムアップになったとき
  勝敗判定が行われ、ラウンドメッセージが表示される

  Scenario: p2 の HP が 0 になると p1 の WIN メッセージが表示される
    Given phase="fight" で p2.hp を JavaScript 注入で 1 に設定する
    When p1 の攻撃が p2 にヒットして p2.hp が 0 以下になる
    Then page.evaluate で `phase` を評価すると "roundend" が返る
    And page.evaluate で `wins[0]` を評価すると 1 が返る
    And page.evaluate で `flash.msg` を評価すると p1 のキャラ名を含む文字列が返る

  Scenario: 2ラウンド先取でキャラクター選択画面に戻る
    Given wins=[1,0] の状態で p1 が 2 ラウンド目を勝利する（wins[0]=2 になる）
    When roundend の endTimer が 0 になる
    Then page.evaluate で `phase` を評価すると "charselect" が返る
    And page.evaluate で `wins` を評価すると [0,0] が返る
    And page.evaluate で `roundNum` を評価すると 1 が返る
