# Spark / P2P Architecture

## 方針

`docs/DAIFUGO_RULEBOOK.md` をゲームルールの正本としつつ、利用者の明示的な選択により「サーバーanti-cheat」より「Firebase Spark無料プラン」を優先します。

1. ホストのブラウザがroom coordinatorとなり、`@daifugo/rules` を実行する。
2. ゲームcommand、閲覧者別view、chat、演出cueはWebRTC DataChannelで運ぶ。
3. Firestoreは発見、signaling、presence、crash snapshotだけに限定する。
4. WebRTC不成立時だけ同じwire packetをFirestore mailboxで中継する。
5. UIへは閲覧者別projectionを送り、所有者のblind札を隠す。
6. 改造クライアントやFirestore直接閲覧によるcheatは防御対象外とする。

## 実行経路

```text
React / 3D UI
  │ command + clientActionId + expectedRevision
  ▼
SparkP2PSession
  │ WebRTC DataChannel（通常）
  │ Firestore mailbox（fallback）
  ▼
coordinator browser
  SparkAuthority → @daifugo/rules → viewer projection
  │
  ├─ WebRTCで各viewを返信
  └─ Firestoreへcrash snapshotを退避
```

Cloud Functions、Cloud Run、Realtime Database、Firebase Hostingは実行経路にありません。`firebase.json` にFunctions/RTDB/Hosting deploy設定を持たせません。

## Coordinator

部屋作成者のtabが最初のcoordinatorです。論理上のゲームhost（開始・設定・再戦権限）と、通信上のcoordinatorは別概念です。

- commandを直列queueで処理する。
- `clientActionId` を最大200件保持し、二重適用を避ける。
- `expectedRevision` と `gameId` が古いcommandを拒否する。
- ルール、効果、順位、60秒timeout、120秒切断失格を純粋rules packageで確定する。
- 30秒ごとにdirectory leaseを更新する。
- 75秒leaseが止まると、最古のonline memberがFirestore transactionでcoordinatorを引き継ぎ、snapshotから再開する。

coordinatorが閉じた直後は最大約75秒の停止があり得ます。全員が同時に閉じた場合は自動復旧できません。

## WebRTCとfallback

構成はhost-starです。各参加者はcoordinatorとDataChannelを1本作るため、6 player + spectatorでもfull meshになりません。公開STUNとして `stun:stun.l.google.com:19302` を利用します。

TURN serverは置きません。NATやネットワーク制限によりP2Pが成立しない場合はFirestore mailboxへ自動fallbackします。fallback中も対局はできますが、Firestoreのread/write quotaを多く消費し、遅延も増えます。画面の通信badgeで `WebRTC` / `Firebase` / `offline` を確認できます。

## Firestore使用量を抑える仕組み

- presence/directory heartbeatは30秒間隔。
- presence collectionを常時購読するのはcoordinatorだけ。
- ゲーム中のviewはFirestore documentへ毎回投影せずP2P送信。
- crash snapshotはstate mutation時だけ更新。
- public room listは新しいheartbeatの最大40件だけ購読。
- 公開ロビー購読開始/create/connect時に、対局・参加・チャット等の権威更新が30分ないroomを少数ずつopportunistic cleanupする。Cloud Functionsやscheduled jobは使わない。
- mailbox/signalingは10分でclient上無効扱い（定期cleanupは行わない）。

新規作成だけはRulesがsnapshotの書き込み元leaseを必要とするため `directory → snapshot` です。以後の通常mutationとcoordinator handoffは、復旧stateを先に確定する `snapshot → directory` です。stale cleanupも同様にsnapshotを先に削除し、snapshot不在を確認してからdirectoryを削除します。30分判定はclient時計を権限根拠にせず、Rulesの `request.time` と現在の `lastActivityAt` で再検証します。lease heartbeatは`lastActivityAt`を延長できず、snapshot revisionが進んだ時だけserver timestampへ更新できます。

典型的な4人部屋では、アイドル時の目安は約600 writes/時、約1,000 reads/時です。実値はtab数、fallback率、再接続、操作数で変わるため、Firebase Usageを確認してください。

## 閲覧者別projection

- 自分の通常札: faceあり
- 自分のblind札: ID/位置だけ
- 相手の通常札: 裏面
- 相手のblind札: faceとblind印あり
- spectator、上がり済み、失格者: 全faceあり

projectionは通常UIの情報漏洩を防ぎますが、完全snapshotはクラッシュ移譲のためFirestoreに置かれます。したがってSecurity Rulesをanti-cheat境界として説明しません。

## 旧構成

`functions/` と `v2Rooms` / `v2RoomViews` / `v2Events` Rulesは、以前のBlaze向け構成と旧版互換性のため残します。現行web clientはそれらを読み書きせず、Functionsをdeployしません。旧 `rooms` も削除しません。
