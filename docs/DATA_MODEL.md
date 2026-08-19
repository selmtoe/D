# v2 Data Model

## IDと版

- `RoomId`: 判別しやすい英大文字・数字5文字。サーバー生成。
- `PlayerId`: ルールエンジン内のplayer識別子。v2初期版ではFunctionsが認証済みAuth UIDへサーバー側で結び付け、公開一覧には配信しない。
- `CardId`: 1ゲーム中だけ意味を持つ暗号学的乱数ID。カードfaceを推測できる接頭辞を持たない。
- `gameId`: 再戦ごとにサーバー生成。
- `trickId`: 場流れごとにサーバー生成。
- `clientActionId`: クライアント生成UUID。UIDと組にしてidempotency keyに使う。
- `revision`: roomの権威transitionごとに1増える整数。

## Firestore

```text
v2Rooms/{roomId}                         authoritative room/membership/state (Admin only)
v2RoomViews/{roomId}                     public lobby projection
v2RoomViews/{roomId}/viewers/{uid}       viewer-specific projection
v2Events/{roomId}/actions/{actionId}     idempotency record (Admin only)
v2Events/{roomId}/audit/{eventId}        redacted append-only audit event (Admin only)
users/{uid}                              preferences and active room pointer
avatars/{uid}                            AvatarProfileV1
webrtcRooms/{roomId}/signals/{signalId}  short-lived non-authoritative signaling
webrtcRooms/{roomId}/cues/{cueId}        short-lived presentation-only fallback
```

`v2Rooms/{roomId}` は手札とUIDを含む完全な権威状態なので、Security Rulesで全クライアントのread/writeを拒否します。一覧表示に必要な `status`、`mode`、`blindCount`、人数、host表示、`heartbeatAt`、`expiresAt` だけを `v2RoomViews/{roomId}` に投影します。クライアントの一覧queryは `v2Rooms` を参照しません。

## 権威状態

```ts
type RoomDocument = {
  schemaVersion: 2;
  roomId: RoomId;
  status: "waiting" | "playing" | "finished" | "frozen";
  revision: number;
  gameId: string | null;
  hostUid: string;
  settings: { mode: "normal" | "blind"; blindCount: number };
  members: Record<string, RoomMember>;
  game: GameState | null;
  cardTokens: Record<CardId, string>;
  pendingMimic: PendingMimic | null;
  publicChat: PublicChatEntry[];
  publicEvents: PublicEventEntry[];
  turnDeadlineAt: Timestamp | null;
  nextDeadlineAt: Timestamp | null;
  expiresAt: Timestamp;
};

type GameState = {
  id: string;
  version: number;
  phase: "playing" | "finished";
  mode: "normal" | "blind";
  blindCount: number;
  players: PlayerState[];
  deck: Card[];
  pile: PlayedGroup | null;
  trickHistory: PlayedGroup[];
  discard: Card[];
  lastPlayerId: PlayerId | null;
  turnPlayerId: PlayerId | null;
  direction: 1 | -1;
  revolution: boolean;
  jackBack: boolean;
  binding: Suit[];
  pendingEffect: PendingEffect | null;
  effectBatch: EffectBatch | null;
};
```

`Card` は推測不能な `id`、`suit | null`、`rank | JOKER` を持ち、`PlayerState.hand` の各entryが `card` と `blind` を保持します。クライアントへはこの形を直接配信せず、投影時にgame単位のランダム `cardTokens` へ置換します。

## PendingEffect

効果は順序付きqueueです。

```ts
type PendingEffect =
  | { type: "recover"; actorId: PlayerId; count: number }
  | { type: "steal"; actorId: PlayerId; count: number }
  | { type: "give"; actorId: PlayerId; count: number }
  | { type: "discard"; actorId: PlayerId; count: number }
  | { type: "bomb"; actorId: PlayerId; count: number };
```

`effectBatch` が順序付きqueueを保持します。階段はK回収を先頭、Jバックと革命を状態transition、その後のランクを実効強さ順、8切りを末尾の自動flushとして組み立てます。viewer投影ではUI契約に合わせ `recover → collect`、`bomb → bomber` と命名します。

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

`HiddenCard` の型には `suit`、`rank` を定義しません。自分のブラインド札は選択可能なopaque token、相手の通常札はrevisionと位置から作る非相関back tokenを使います。A奪いactorにだけ対象選択中のopaque tokenを一時投影します。移動したblind cardは権威stateで `blind: false` に更新してから投影します。

## RTDB presence

```text
v2Presence/{roomId}/{uid}
  online: boolean
  connectionId: string
  lastChanged: ServerValue.TIMESTAMP
```

Firestoreの論理membershipが正本です。RTDB presenceは接続表示と120秒猶予開始の入力に限定し、`onDisconnect` だけで失格を確定しません。scheduled functionまたはtaskが権威stateの期限を再検証して失格を確定します。

## TTL

- authoritative room / public room projection: `expiresAt`
- action records: ゲーム終了後の保持期限
- WebRTC signals: 数分
- presence: 切断後の短期cleanup
- audit event: 運用方針に従うがカードfaceと個人情報を保存しない

TTL削除は遅延し得るため、公開一覧queryは `status`、`heartbeatAt`、`createdAt >= 24時間前` も検証します。
