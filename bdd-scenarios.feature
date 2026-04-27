# language: ja
# BDD（振る舞い駆動開発）シナリオ — 大乱闘 ウエダファミリー
# 対象: ゲームロジック（Fighter クラス・ガードシステム・ダメージ計算・状態遷移）
# 対応レイヤー: ユニットテスト / 結合テスト

Feature: キャラクター定義と初期化
  ゲームに登場する5キャラクターは固有のパラメータを持ち、
  Fighter オブジェクトは正しい初期状態で生成される

  Scenario: いっちーはスピードタイプのパラメータを持つ
    Given キャラクター定義 "icchi" が存在する
    Then walkSpd は 6.5 である
    And punchDmg は 5 である
    And jumpVel は -21 である
    And punchIsProjectile は false である

  Scenario: おとうさんはパンチが飛び道具として発射される
    Given キャラクター定義 "otousan" が存在する
    Then punchIsProjectile は true である
    And punchDmg は 0 である
    And kickDmg は 10 である

  Scenario: ゆうりはパワータイプで攻撃力が高い
    Given キャラクター定義 "yuuri" が存在する
    Then punchDmg は 16 である
    And kickDmg は 24 である
    And jatkDmg は 27 である
    And walkSpd は 2.5 である

  Scenario: そよはジャンプ力と攻撃レンジに優れる
    Given キャラクター定義 "soyo" が存在する
    Then jumpVel は -24 である（全キャラ最高）
    And rangeBonus は 1.5 である（全キャラ最大）
    And walkSpd は 7.2 である

  Scenario: Fighter は正しい初期状態で生成される
    Given キャラクター "icchi" で Fighter を x=300 右向きで生成する
    Then hp は 100 である
    And maxHp は 100 である
    And state は "idle" である
    And onGround は true である
    And hitStun は 0 である
    And guardFlash は 0 である
    And guardMode は false である
    And specialGauge は 0 である
    And dir は 1 （右向き）である


Feature: ヒットボックスとハートボックス
  キャラクターの当たり判定は姿勢と攻撃状態に応じて正しく計算される

  Scenario: idle 状態では hitbox は null を返す
    Given キャラクター "icchi" の Fighter が idle 状態である
    When hitbox() を呼ぶ
    Then 結果は null である

  Scenario: パンチ発生フレームでは hitbox が返される
    Given キャラクター "icchi" の Fighter が punch 状態で st=punchS（2）である
    When hitbox() を呼ぶ
    Then hitbox は null ではない

  Scenario: パンチ発生前フレームでは hitbox は null である
    Given キャラクター "icchi" の Fighter が punch 状態で st=0 である
    When hitbox() を呼ぶ
    Then 結果は null である

  Scenario: しゃがみ状態のハートボックスは立ちより小さい
    Given キャラクター "icchi" の Fighter が生成されている
    When state を "crouch" に設定して hurtbox() を呼ぶ
    Then 高さ（h）は 82*scale（≒57.4）である
    And 幅（w）は 48*scale（≒33.6）である
    # 立ちの場合は 125*scale, 56*scale のため、しゃがみは低く狭い

  Scenario: キック発生フレームでは hitbox が返される
    Given キャラクター "icchi" の Fighter が kick 状態で st=kickS（5）である
    When hitbox() を呼ぶ
    Then hitbox は null ではない


Feature: ダメージ計算とヒット処理
  攻撃がヒットしたとき HP が正しく減少し、状態が遷移する

  Scenario: 通常攻撃がヒットするとダメージ分だけ HP が減少する
    Given キャラクター "icchi" の Fighter が hp=100 idle 状態である
    When takeHit({dmg:8, stun:16, push:0, type:"punch"}, fromDir=1) を呼ぶ
    Then hp は 92 である
    And state は "hurt" である
    And hitStun は 16 である

  Scenario: HP が 0 以下になると state が dead になる
    Given キャラクター "icchi" の Fighter が hp=5 である
    When takeHit({dmg:10, stun:16, push:0, type:"punch"}, fromDir=1) を呼ぶ
    Then hp は 0 である
    And state は "dead" である

  Scenario: dead 状態の Fighter にヒットしても false を返す
    Given キャラクター "icchi" の Fighter が state="dead" である
    When takeHit({dmg:8, stun:16, push:0, type:"punch"}, fromDir=1) を呼ぶ
    Then 戻り値は false である
    And hp は変化しない

  Scenario: hitStun 中の Fighter にヒットしても false を返す
    Given キャラクター "icchi" の Fighter が hitStun=10 の状態である
    When takeHit({dmg:8, stun:16, push:0, type:"punch"}, fromDir=1) を呼ぶ
    Then 戻り値は false である
    And hp は 100 のまま変化しない

  Scenario: ヒットを受けると specialGauge が増加する
    Given キャラクター "icchi" の Fighter が specialGauge=0 である
    When takeHit({dmg:5, stun:16, push:0, type:"punch"}, fromDir=1) を呼ぶ
    Then specialGauge は 0 より大きい（+8 の増加が期待される）


Feature: ガードシステム
  立ちガード（L キー）はパンチ/空中パンチを完全防御し、
  しゃがみガード（S+L キー）はキック/空中キックを完全防御する。
  ガードの種類と攻撃種別のミスマッチはダメージを受ける。

  Scenario: 立ちガード中はパンチをノーダメージで防げる
    Given 右向き Fighter が state="block" guardMode=true である
    When fromDir=-1（正面）で type="punch" の攻撃を受ける
    Then hp は 100 のまま変化しない
    And blockStun が設定される
    And guardFlash が設定される

  Scenario: 立ちガード中は空中パンチ（jatk）も防げる
    Given 右向き Fighter が state="block" guardMode=true である
    When fromDir=-1 で type="jatk" の攻撃を受ける
    Then hp は 100 のまま変化しない

  Scenario: 立ちガード中はキックを防げない
    Given 右向き Fighter が state="block" guardMode=true である
    When fromDir=-1 で type="kick" の攻撃を受ける
    Then hp は 100 未満に減少する
    And state は "hurt" になる

  Scenario: 立ちガード中は空中キック（jkick）を防げない
    Given 右向き Fighter が state="block" guardMode=true である
    When fromDir=-1 で type="jkick" の攻撃を受ける
    Then hp は 100 未満に減少する

  Scenario: しゃがみガード中はキックをノーダメージで防げる
    Given 右向き Fighter が state="crouch" guardMode=true である
    When fromDir=-1 で type="kick" の攻撃を受ける
    Then hp は 100 のまま変化しない

  Scenario: しゃがみガード中は空中キック（jkick）も防げる
    Given 右向き Fighter が state="crouch" guardMode=true である
    When fromDir=-1 で type="jkick" の攻撃を受ける
    Then hp は 100 のまま変化しない

  Scenario: しゃがみガード中はパンチを防げない
    Given 右向き Fighter が state="crouch" guardMode=true である
    When fromDir=-1 で type="punch" の攻撃を受ける
    Then hp は 100 未満に減少する

  Scenario: 背後からの攻撃はガードを貫通する
    Given 右向き（dir=1）Fighter が state="block" guardMode=true である
    When fromDir=1（背後方向）で type="punch" の攻撃を受ける
    Then facing は false となりガードが無効となる
    And hp は 100 未満に減少する

  Scenario: 必殺技は立ちガード中もダメージが軽減される（60%カット）
    Given 右向き Fighter が state="block" guardMode=true である
    When fromDir=-1 で type="special" dmg=28 の攻撃を受ける
    Then 実ダメージは floor(28*0.4)=11 となり hp は 89 である

  Scenario: ガード成立時に guardFlash がセットされる
    Given 右向き Fighter が state="block" guardMode=true である
    When fromDir=-1 で type="punch" の攻撃を受ける
    Then guardFlash は 0 より大きい値にセットされる


Feature: update による状態遷移とガードモード
  Fighter.update() の入力処理でガードモードと移動状態が正しく切り替わる

  Scenario: block 状態の Fighter は guardMode=true になる
    Given Fighter が state="block" で update() を入力なしで呼ぶ
    Then guardMode は true である

  Scenario: crouch 状態かつ block 入力ありで guardMode=true になる
    Given Fighter が state="crouch" で update() を block=true, down=true の入力で呼ぶ
    Then guardMode は true である

  Scenario: crouch 状態かつ block 入力なしで guardMode=false になる
    Given Fighter が state="crouch" で update() を down=true のみの入力で呼ぶ
    Then guardMode は false である

  Scenario: idle 状態では guardMode=false になる
    Given Fighter が state="idle" で update() を入力なしで呼ぶ
    Then guardMode は false である


Feature: 必殺技ゲージと必殺技発動
  必殺技ゲージが MAX（100）に到達したとき、スペースキーで必殺技が発動する

  Scenario: 必殺技ゲージが MAX のとき special 入力で発動できる
    Given Fighter の specialGauge=100（MAX）onGround=true state="idle" である
    When special=true の入力で update() を呼ぶ
    Then state は "special" になる
    And specialGauge は 0 にリセットされる

  Scenario: ゆうりの必殺技はドロップキックで空中突進する
    Given ゆうりの Fighter が specialGauge=100 onGround=true state="idle" である
    When special=true の入力で update() を呼ぶ
    Then state は "special" になる
    And onGround は false になる（空中突進開始）
    And specialVx は dir*14 の速度でセットされる

  Scenario: ゲージが MAX 未満では必殺技は発動しない
    Given Fighter の specialGauge=50（未満）state="idle" である
    When special=true の入力で update() を呼ぶ
    Then state は "idle" のまま変化しない


Feature: ラウンド管理とゲーム進行
  HP や時間に基づいてラウンドの勝敗が正しく判定され、
  2ラウンド先取で試合が終了してキャラ選択に戻る

  Scenario: 相手の HP が 0 になるとラウンド終了となる
    Given p1.hp=50, p2.hp=0 の状態である
    When ゲームループが次のフレームを処理する
    Then phase は "roundend" になる
    And wins[0] が 1 増加する
    And "いっちー WIN!" のフラッシュメッセージが表示される

  Scenario: タイムアップ時は残り HP が多い方が勝ちになる
    Given timerSec=0, p1.hp=60, p2.hp=40 の状態である
    When ゲームループがタイムアップを検出する
    Then p1wins は true であり wins[0] が増加する

  Scenario: タイムアップで HP が同値なら DRAW になる
    Given timerSec=0, p1.hp=50, p2.hp=50 の状態である
    When ゲームループがタイムアップを検出する
    Then p1wins は null であり "DRAW!" が表示される

  Scenario: 2ラウンド先取でキャラクター選択に戻る
    Given wins=[2,0]（p1 が 2 勝）の roundend 状態で endTimer が 0 になる
    When ゲームループが roundend を処理する
    Then phase は "charselect" になる
    And wins は [0,0] にリセットされる
    And roundNum は 1 にリセットされる
