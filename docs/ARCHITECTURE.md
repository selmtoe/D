# v2 Architecture

## 設計原則

1. `docs/DAIFUGO_RULEBOOK.md` だけをゲームルールの正本とする。
2. クライアントは意図を送信し、Cloud Functionsが結果を確定する。
3. 秘密を含む権威状態と、閲覧者別の公開状態を別documentへ分離する。
4. 3Dは表示層であり、物理・アニメーション完了を論理進行へ使わない。
5. 同じsnapshotから同じ3Dシーンを再構築できるようにする。
6. WebRTC停止時もFirebaseだけで全ゲームを完遂できるようにする。

## モジュール

```text
apps/web
  React screen state machine
  Firebase command/view adapter
  R3F salon, cards, avatars, cameras
  semantic DOM controls and live regions
       │ command (Auth UID, roomId, revision, actionId)
       ▼
functions
  callable validation and rate boundary
  Firestore transaction / idempotency
  authoritative rules transition
  per-viewer projection
       │ imports
       ▼
packages/rules
  immutable domain types
  play classification and legality
  effects, ordering, ranking, invariants
```

`packages/avatar-schema` はゲームに依存しない `AvatarProfileV1`、許可ID、数値範囲、migrationを提供します。`packages/ui-tokens` は3DとDOMの両方が利用するブランド・アクセシビリティtokenを提供します。

## 信頼境界

### 信頼しない入力

- UID以外のplayer識別子
- クライアントが申告する手番、役割、現在時刻、カード表面
- クライアントが計算した合法性、順位、効果結果
- clientActionIdの一意性だけに依存した重複排除
- WebRTCから届くゲーム状態

callableはApp Check、Auth、schema、role、gameId、revision、phase、turn、pending effect、所有権、対象数、期限を毎回検証します。action documentをtransaction内で作成し、既存actionなら保存済み結果を返します。

### 権威データ

全カード実体、shuffle情報、手札、membership、pending effect、順位は `v2Rooms/{roomId}` の権威documentに保存します。一般クライアントはFirestore Rulesによりdocument全体のread/writeを拒否され、Admin SDKだけが到達できます。公開一覧情報は秘密を含まない `v2RoomViews/{roomId}` へ別投影します。

### 閲覧者別投影

権威transitionと同じtransactionで、参加者UIDごとのprojectionを生成します。

- 所有者の通常札: faceあり
- 所有者のブラインド札: opaque card tokenと位置だけ
- 対戦相手の通常札: count/back tokenだけ
- 対戦相手のブラインド札: faceとblind印あり
- 観戦者・上がり済み・失格者: 全faceあり

projection serializerは型レベルでもblind faceを作れない判別共用体を返します。

## コマンド処理

```text
authenticate
  → validate schema / App Check
  → load membership and private state in transaction
  → reject stale gameId or revision
  → return stored result for duplicate actionId
  → execute pure rule transition
  → assert card conservation and phase invariants
  → increment revision
  → write authoritative room, public room view, viewer projections, audit event
  → return revision and caller-safe summary
```

通常のコマンドは `createRoom`、`joinRoomAsPlayer`、`joinRoomAsSpectator`、`leaveRoom`、`reconnectRoom`、`transferHost`、`updateRoomSettings`、`startGame`、`submitPlay`、`submitPass`、`declareJokerMimic`、`resolveSteal`、`resolveGive`、`resolveDiscard`、`resolveBomber`、`resolveCollect`、`changeSpectatorFocus`、`sendChat`、`startRematch` です。

## クライアント状態機械

```text
BOOT → AUTHENTICATING → ENTRANCE → SALON_LOBBY → ROOM_WAITING
                                                   ↓
FINISHED ← PLAYING_TURN ← DEALING ←──────────── START
              ↕
       AWAITING_FORCED_EFFECT
```

接続状態は画面状態と直交する `online | reconnecting | grace | offline` として保持します。revisionが現在値以下のsnapshotは描画へ適用しません。再接続では履歴アニメーションを再生せず、最新snapshotへ直接復元します。

## 3D表示

- テーブルはX/Z半径が同じCylinder/Torus geometryで構築し、非等方scaleを禁止する。
- カメラは45〜60mm相当、通常席・観戦席を減衰補間する。
- カードは共有geometry/material/texture atlasを使い、DOM listboxと同じselection stateを参照する。
- アバターはhead/body/hair/outfit/accessoryの実meshで構築し、2D billboardを人物本体として使わない。
- reduced motionではカメラを短時間遷移、配札を短縮し、低負荷ではDPR、shadow、avatar detailを落とす。
- WebGL context loss時はDOM操作を維持し、復旧後にsnapshotから再構築する。

## WebRTC

DataChannelはemote、cursor、focus hint、animation cueだけに限定します。カードface、手番、タイマー、乱数、結果は送らず、受信イベントはrevision付きFirebase snapshotがなければ確定演出に使いません。小規模roomでも観戦者との無制限meshを作らないため、初期版では参加プレイヤー間の上限付き接続とFirebase fallbackを採用します。

## 旧版との共存

旧 `rooms` collectionは移行期間中そのまま維持します。新版は `v2Rooms`、`v2RoomViews`、`v2Events`、`users`、`avatars`、`webrtcRooms` 以外へ書きません。Security Rules変更時は旧公開アプリのcreate/joinを回帰確認してから適用します。
