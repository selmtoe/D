# Spark Plan Operations

## 結論

現行構成はFirebase `daifugo-8e039` をSparkのまま利用できます。Blaze、Cloud Functions v2、Cloud Run、Scheduler、Realtime Database、Firebase Hostingは不要です。GitHub Pagesがwebを配信し、FirebaseはAnonymous AuthとCloud Firestoreだけを担当します。

## Consoleで一度だけ行う設定

1. Firebase Consoleでproject `daifugo-8e039` を開く。
2. **Authentication → Sign-in method → Anonymous** を有効化する。
3. **Firestore Database** が未作成なら作成する。既存databaseがあればそのまま使う。regionは作成後に変更できないため、主な利用者に近い既存/選択regionを確認する。
4. **Authentication → Settings → Authorized domains** に `selmtoe.github.io` を追加する。
5. App Checkは任意。利用するならWeb appへreCAPTCHA v3を登録し、まずmetrics/monitoringだけで観察する。Firestore enforcementを先に有効にしない。

Realtime Databaseの作成やDatabase URLの控えは不要です。料金planをBlazeへ変更しないでください。

## ローカル確認

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm lint
pnpm format:check
pnpm --filter @daifugo/web test:e2e
```

Rules Emulatorを含める場合:

```bash
firebase emulators:exec --project daifugo-8e039 --only firestore \
  "pnpm --filter @daifugo/functions test:emulator"
```

## Firebase deploy

まず権限付きGoogle accountでCLIへloginし、対象を必ず確認します。

```bash
firebase use daifugo-8e039
firebase projects:list
firebase deploy --project daifugo-8e039 --only firestore:rules,firestore:indexes
```

このcommandはFunctions、RTDB、Hostingをdeployしません。`firebase.json` にもそれらのdeploy設定はありません。ただしRules変更は既存旧版にも影響するため、`rooms/{document=**}` の旧許可を維持していることをdiffで確認してから実行します。

## GitHub Pages deploy

1. GitHub repositoryのPages sourceがGitHub Actionsになっていることを確認。
2. `deploy v2 web to GitHub Pages` workflowを手動実行。
3. confirmationへ `deploy-v2` と入力。
4. `VITE_FIREBASE_APP_CHECK_SITE_KEY` secretは任意。未設定でもSpark/P2P buildは動く。
5. 公開URLで3 player roomを作り、join/start/play/pass/reload/leaveを確認。

## 通信表示

- `WebRTC`: DataChannelでゲームpacketを送受信中。通常状態。
- `Firebase`: P2Pが成立せずFirestore mailboxへfallback中。プレイ可能だがquota消費が増える。
- `offline`: coordinatorにもFirestoreにも届かない。

TURN serverを使わないため、学校・会社・一部mobile carrierなど厳しいNATでは`Firebase`表示になることがあります。

## Spark quota運用

無料枠を守るため、通常は同時に少数roomを使います。Firebase ConsoleのUsageでFirestore reads/writes/storageを確認してください。

- heartbeatは30秒。
- presence listenerはcoordinatorだけ。
- 典型的な4人roomのアイドル目安は約600 writes/時、約1,000 reads/時。
- Firestore fallback中は各command/viewが追加read/writeになる。
- 古い`signals` / `mailboxes`は受信時に削除しますが、宛先が二度とonlineにならないpacketは残り得る。

quotaが近づいた場合は新規room利用を止め、翌日のquota resetを待ちます。Blazeへ自動移行する処理はありません。

## 既知の制約

- coordinator tabが閉じると、後継選出まで最大約75秒止まる。
- 全員が同時に閉じたroomは自動進行しない。
- client clockをtimeoutとleaseに使うため、端末時計が大きくずれると復旧が遅れる。
- 完全snapshotは認証済みclientから読める。anti-cheatは保証しない。
- TURNなしのためWebRTCが常に成立するとは限らない。

## Rollback

webに問題があればGitHub Pagesを直前commitへ戻します。Firestore Rulesは直前に保存したrulesへ戻します。旧`rooms` dataと`functions/`は削除しません。Spark版roomは短期利用前提で、production migrationや長期保存を保証しません。
