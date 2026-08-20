# Spark / P2P Data Model

## IDと版

- `roomId`: 読みやすい英大文字・数字5文字。作成者browserが生成。
- `uid`: Firebase Anonymous Auth UID。
- `peerId`: UID + tab固有UUID。WebRTCとmailboxの宛先。
- `gameId`: 再戦ごとにbrowser coordinatorが生成。
- `clientActionId`: browser生成UUID。重複操作の抑止に使う。
- `revision`: room mutationごとに増える整数。

## Firestore

```text
sparkRoomDirectory/{roomId}                 public room list + coordinator lease
sparkRoomSnapshots/{roomId}                 complete crash-recovery snapshot
sparkPresence/{roomId}/members/{uid}        30-second presence heartbeat
sparkSignals/{roomId}/items/{messageId}     WebRTC offer/answer/ICE
sparkMailboxes/{roomId}/items/{messageId}   DataChannel fallback packet
```

### `sparkRoomDirectory`

公開一覧に必要なhost、人数、mode、phaseと、coordinator UID/peer ID、`heartbeatAt` / `heartbeatAtMs`、`lastActivityAt`、`authorityRevision` を持ちます。coordinator本人だけが通常更新できます。heartbeat停止から75秒後は、後継coordinatorがleaseを取得できます。

`lastActivityAt` はserver timestampであり、30分stale cleanupの権限時刻です。`authorityRevision`がsnapshot revisionまで進む権威mutation時だけ更新でき、30秒lease heartbeatでは変わりません。clientのms値は表示・候補検索用で、削除権限には使いません。新規roomはdirectory leaseを作ってからsnapshotを保存します。通常更新とcleanupはsnapshotを先に処理し、Rulesはsnapshotが残るdirectory削除とsnapshot不在directoryのheartbeat復活を拒否します。旧documentに`lastActivityAt`がなければserver `heartbeatAt`をfallbackにします。

### `sparkRoomSnapshots`

`SparkRoomSnapshot` の完全な複製です。members、全hand、deck、pile、pending effect、ranking、chat、適用済みaction IDを含みます。coordinator crash時に別tabが引き継ぐため、匿名認証済み利用者にはreadを許可します。

これはfriends-onlyの復旧データであり、秘密保管場所ではありません。改造クライアントが読むことを防がない代わりに、通常UIへは常に閲覧者別`RoomView`だけを送ります。

### `sparkPresence`

```ts
type Presence = {
  uid: string;
  peerId: string;
  online: boolean;
  role: "player" | "spectator";
  name: string;
  lastSeenMs: number;
};
```

各UIDは自分のdocumentだけを書けます。coordinatorだけがcollectionを常時購読し、切断表示と120秒失格猶予に使います。game stateはpresence documentへ入れません。

### signaling / mailbox

共通fieldは `senderUid`、`senderPeerId`、`targetUid`、`targetPeerId`、`kind`、JSON文字列`payload`、`createdAtMs`、`expiresAtMs` です。RulesはAuth UIDとsender UIDを結び付け、payload sizeを制限します。

Firestore TTL policyやscheduled cleanupはSpark構成で必須にしません。受信側は10分を過ぎたpacketを無視します。古いpacketは必要に応じてConsoleから手動削除できます。

## Browser snapshot

```ts
type SparkRoomSnapshot = {
  schemaVersion: 1;
  roomId: string;
  revision: number;
  generation: number;
  status: "waiting" | "playing" | "finished";
  coordinatorUid: string;
  hostUid: string;
  settings: { mode: "normal" | "blind"; blindCount: number };
  members: Record<string, SparkMember>;
  game?: GameState;
  pendingMimic?: SparkPendingMimic;
  turnDeadlineMs?: number;
  chat: ChatEntry[];
  socialLog: LogEntry[];
  appliedRoomActionIds: string[];
  appliedRoomActionResults?: Record<string, Record<string, unknown>>;
};
```

適用済みaction IDとそのresponseは直近200件を保持し、同じ`clientActionId`のretryへ初回と同じresponseを返します。旧snapshotとの互換性のためresponse mapはoptionalです。

`GameState` と `GameCommand` は `packages/rules` の型が正本です。ルールtransition後に全閲覧者へ`RoomView`を再投影します。

coordinatorの明示退出では、退出mutationを旧leaseでsnapshotへ保存してからdirectoryを後継へ切り替えます。この短い移行中だけsnapshotの`coordinatorUid`は旧lease所有者を示し、後継browserが取得直後に自分へ更新します。

## 閲覧者向けcard

```ts
type VisibleCard = {
  id: string;
  visibility: "face";
  suit?: Suit;
  rank?: Rank;
  joker?: "monochrome" | "crimson";
  blind: boolean;
};

type HiddenCard = {
  id: string;
  visibility: "hidden";
  blind: boolean;
};
```

`HiddenCard` にはsuit/rankを定義しません。owner blindはhidden、相手の通常handは裏面、相手のblindとspectator viewはfaceありです。

## 旧namespace

`rooms`、`v2Rooms`、`v2RoomViews`、`v2Events`、`webrtcRooms` は移行前構成です。現行web clientは利用しませんが、既存公開版と以前のbackend testを壊さないため削除しません。
