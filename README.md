# 大富豪 — Private Card Salon v2

3〜6人で遊ぶ、完全3Dのオンライン大富豪です。通常大富豪に加えて、所有者だけが札の表面を見られない「ブラインド大富豪」、途中観戦、上がり後観戦に対応します。

このリポジトリは `docs/DAIFUGO_RULEBOOK.md` をルールの唯一の正本、`docs/FIREBASE_HANDOFF.md` をクラウド環境の正本として再構築されています。旧ルート `index.html` は移行完了まで稼働中の `rooms` collection を利用する旧版として保持し、新版は `apps/web` と `v2*` namespaceだけを利用します。

## 必要環境

- Node.js 22以上
- pnpm 11以上
- Firebase CLI（Emulatorまたはdeployを行う場合）
- Java 21以上（Firebase Emulator Suite）

## ローカル起動

```bash
pnpm install
cp .env.example apps/web/.env.local
pnpm dev
```

Firebase Emulatorを使う場合は、別ターミナルで次を実行します。

```bash
pnpm emulators
```

`VITE_USE_FIREBASE_EMULATORS=true` のときだけクライアントはEmulatorへ接続します。画面にも接続先が表示され、本番への誤接続を防ぎます。

## 品質確認

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm lint
pnpm format:check
pnpm --filter @daifugo/web test:e2e
pnpm --filter @daifugo/functions test:emulator
```

最後のSecurity Rules統合テストはFirestore/Realtime Database EmulatorとJava 21を起動できる環境で実行します。

Playwrightにはdesktop/mobileの3D・アクセシビリティsmokeに加え、DEV限定のfake authorityを使う複数browser context試験があります。3人対局、効果、観戦projection、stale revision、再接続token rotation、ブラインド成功／失格を検証し、テストbridgeがproduction bundleへ残らないことも確認します。

## 本番公開前の所有者設定

本番Functions/Rules/Hostingはまだdeployしていません。Firebase Consoleで匿名Authentication、Realtime Database、App Check site key、Authorized domain、region、Blaze課金とScheduler/APIを確認し、既存 `rooms` のRules差分を所有者が承認してから `docs/OPERATIONS.md` の順序で公開します。

## 構成

- `apps/web`: React、Vite、React Three Fiberによるクライアント
- `functions`: Cloud Functions for Firebase v2の権威コマンド
- `packages/rules`: FirebaseやDOMに依存しない純粋ルールエンジン
- `packages/avatar-schema`: バージョン付き3Dアバターschemaとmigration
- `packages/ui-tokens`: 色、間隔、モーション、品質設定
- `docs`: ルール、Firebase引き継ぎ、設計、運用、テスト対応表

## 重要な安全境界

- 旧 `rooms/{roomId}` を新版から更新・削除しません。
- 全カード実体とmembershipは `v2Rooms/{roomId}` の権威documentに置き、Admin SDKだけが読み書きします。
- クライアントが読む一覧は `v2RoomViews/{roomId}`、対局状態はUID別の `v2RoomViews/{roomId}/viewers/{uid}` 投影だけです。
- ブラインド札の所有者向け投影には `face`、スート、ランクを含めません。
- 乱数、合法性、順位、revision、タイマーはFunctionsが確定します。

詳しくは `docs/ARCHITECTURE.md`、`docs/DATA_MODEL.md`、`docs/OPERATIONS.md` を参照してください。
