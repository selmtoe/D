# Operations

## Environment identity

本番の正しいFirebase識別子は次です。

- Project ID: `daifugo-8e039`
- Web App ID: `1:979025215319:web:1bf381daf1eb647760c812`
- Firestore database ID: `(default)`

Functions region、Firestore region、billing plan、IAM、Authorized domains、App Checkの本番状態はリポジトリから確定できません。Consoleまたは権限付きFirebase CLIで確認するまで値を推測してdeployしません。

## Local development

1. `.env.example` を `apps/web/.env.local` へコピーする。
2. `VITE_USE_FIREBASE_EMULATORS=true` を設定する。
3. `firebase emulators:start` を起動する。
4. Emulator UIとクライアントの接続先表示で本番未接続を確認する。
5. `pnpm dev` を起動する。

Emulator import/exportを利用する場合も、secretや本番dumpをrepositoryへcommitしません。

## Pre-deploy gate

- `pnpm install --frozen-lockfile`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- Emulator integration test
- Playwright multi-context E2E
- axeとvisual regression
- client build内のFirebase Project ID/Web App IDを確認
- old `rooms` へwriteする新版codeがないことを`rg`で確認
- service account JSON、token、private keyがgit対象外であることを確認

## Firebase owner checklist

deploy前にproject ownerが次を確認・記録します。

- 匿名Authenticationを有効化
- GitHub Pages利用時に`selmtoe.github.io`をAuthorized domainsへ追加
- billing planとFunctions v2利用可否
- Firestore/Functionsのregion
- App Check providerとenforcement開始手順
- 現行Security Rules、indexes、旧アプリの必要権限
- Realtime Database instanceの有無とregion
- deployするGoogle accountのIAM

課金plan変更、RTDB作成、本番Functions/Rules deploy、Security Rulesの公開範囲変更は影響を説明し、所有者が承認した後に実行します。

## Safe deployment order

1. 現行rules/indexesをCLIで保存して差分確認する。
2. 新版用indexesを追加する。既存indexを削除しない。
3. 新版collection単位のSecurity Rulesを追加し、旧 `rooms` 条件を保持する。
4. Functionsをdeployし、health/logでprojectとregionを確認する。
5. App Checkをmonitor modeで確認してから段階的にenforceする。
6. web clientをpreview URLへdeployする。
7. 3 player + spectatorの本番smoke roomを作成する。
8. create/join/start/play/pass/spectate/reconnect/leaveを確認する。
9. smoke roomIdを指定して削除し、削除結果を確認する。
10. 旧公開URLで旧room create/joinが壊れていないことを確認する。
11. trafficまたは公開URLを新版へ切り替える。

GitHub Pagesを切り替える場合は、上記1〜10の所有者確認後に `deploy v2 web to GitHub Pages` workflowを手動実行し、確認欄へ `deploy-v2` と入力します。このworkflowは自動実行されず、旧root版を置き換えるためpreview smoke前には使いません。

## Observability

構造化logは `roomId`、`gameId`、`actionId`、`revision`、command、latency、result codeを含めます。カードface、名前、chat本文、Auth tokenは含めません。

計測対象はcreate成功率、join失敗理由、再接続率、平均turn時間、timeout数、WebRTC fallback率、projection失敗、invariant違反です。不変条件違反時はroomを`frozen`にし、以後のrule commandを拒否しつつowner向け復旧IDを残します。

## Incident response

- 二重適用: roomを凍結し、action recordとrevision列を調査する。
- blind漏洩疑い: 対象projection生成を停止し、view document、Functions log、build artifactを保存する。ゲームを続行しない。
- stuck effect: deadlineとactor membershipを再検証し、server既定解決を実行する。
- old app regression: 新版rules/functionsだけを安全な前版へ戻し、旧 `rooms` dataを変更しない。
- client rollback: PWA asset versionとservice workerを同時に戻す。

## Production smoke record

deploy担当は日時、commit、Functions名/region、Rules release、Indexes、App Check状態、Authorized domains、smoke roomId、作成/参加/観戦/削除結果、旧版互換性、課金影響を記録します。未確認項目を「完了」と記載しません。
