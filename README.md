# 大富豪 v2

3〜6人で遊ぶ完全3Dのオンライン大富豪です。通常大富豪に加え、所有者だけが札の表面を見られないブラインド大富豪、途中観戦、上がり後観戦に対応します。

現在の実行構成はFirebase **Spark無料プラン対応**です。Cloud Functions、Cloud Run、Realtime Database、Firebase Hostingを使いません。ホストのブラウザが純粋TypeScriptルールエンジンを実行し、参加者とはWebRTC DataChannelで通信します。Firestoreは公開部屋一覧、WebRTC signaling、presence、ホスト障害時snapshot、DataChannel不成立時のmailboxだけに使います。

> このfriends-only構成では、Firestoreの退避snapshotを認証済み利用者が読めます。UIでは手札を通常どおり隠しますが、改造クライアントへのanti-cheat境界ではありません。身内利用を前提にした、課金を避けるための明示的な設計変更です。

## 必要環境

- Node.js 22以上
- pnpm 11以上
- Firebase CLIとJava 21以上（Firestore Rules Emulatorまたはdeploy時だけ）

## ローカル起動

```bash
pnpm install
cp .env.example apps/web/.env.local
pnpm dev
```

Emulatorを使う場合は `.env.local` の `VITE_USE_FIREBASE_EMULATORS=true` にして、別ターミナルで `pnpm emulators` を実行します。本番接続時は画面上部に `Spark無料プラン対応 · WebRTC P2P` と表示されます。

## 品質確認

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm lint
pnpm format:check
pnpm --filter @daifugo/web test:e2e
```

Firestore Rules統合テストは次で実行します。

```bash
firebase emulators:exec --project daifugo-8e039 --only firestore \
  "pnpm --filter @daifugo/functions test:emulator"
```

`functions/` は以前のBlaze向け実装と回帰テストを参照用に保持していますが、`firebase.json` のdeploy対象ではなく、本番ゲームから呼ばれません。

## Firebase Consoleで必要なもの

1. Project `daifugo-8e039` のAuthenticationで「匿名」を有効化。
2. Firestore Databaseがなければ作成（Realtime Databaseは不要）。
3. Authorized domainsへ `selmtoe.github.io` を追加。
4. `firestore.rules` と `firestore.indexes.json` だけをdeploy。
5. App Checkは任意。使う場合はまずmonitoringで確認し、直接Firestore通信を遮断しないよう段階導入。

Blazeへの変更、Functions v2、Scheduler、RTDB、Database URLは不要です。詳しい手順は [docs/OPERATIONS.md](docs/OPERATIONS.md) にあります。

## 構成

- `apps/web`: React/Vite/R3F UI、P2P session、ブラウザ進行役
- `packages/rules`: FirebaseやDOMに依存しない純粋ルールエンジン
- `packages/avatar-schema`: バージョン付き3Dアバターschema
- `packages/ui-tokens`: 色、間隔、モーション、品質設定
- `functions`: 旧Blaze構成の保管・回帰テスト（deployしない）
- `docs`: ルール、Spark/P2P設計、運用、テスト対応表

旧ルート `index.html` と旧 `rooms` collectionは非破壊で保持します。新版が利用するnamespaceは `sparkRoomDirectory`、`sparkRoomSnapshots`、`sparkPresence`、`sparkSignals`、`sparkMailboxes` です。
