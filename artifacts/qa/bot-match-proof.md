# 大富豪 bot実対局QA — 短い証拠

実`SparkAuthority.handleCommand`と`@daifugo/rules`を通した決定論的対局の抜粋です。完全履歴はgit管理外の`bot-match-evidence.json` / `.md`へ同じテストから再生成できます。

再実行: `pnpm ai:selfplay`

## 統計

```json
{
  "matches": 24,
  "completed": 23,
  "stalled": 1,
  "commands": 2030,
  "accepted": 2030,
  "rejected": 0,
  "plays": 775,
  "passes": 928,
  "effectResolutions": 327,
  "stealResolutions": 61,
  "blindAttempts": 68,
  "blindDisqualifications": 1,
  "jokerSubmissions": 67,
  "jokerMimicDeclarations": 0,
  "finishes": 104,
  "invariantFailures": 0
}
```

## 対局一覧

| match | 人数 | mode | 完了 | command | rejected | 効果 | A奪い | blind | Joker |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| normal-3p-seed-31001 | 3 | normal | yes | 68 | 0 | 15 | 3 | 0 | 3 |
| blind-4p-seed-31018 | 4 | blind | yes | 67 | 0 | 13 | 3 | 0 | 3 |
| normal-5p-seed-31035 | 5 | normal | yes | 94 | 0 | 16 | 3 | 0 | 3 |
| blind-6p-seed-31052 | 6 | blind | yes | 114 | 0 | 15 | 0 | 6 | 2 |
| normal-3p-seed-31069 | 3 | normal | yes | 60 | 0 | 16 | 2 | 0 | 3 |
| blind-4p-seed-31086 | 4 | blind | yes | 80 | 0 | 11 | 3 | 4 | 4 |
| normal-5p-seed-31103 | 5 | normal | yes | 71 | 0 | 16 | 3 | 0 | 4 |
| blind-6p-seed-31120 | 6 | blind | yes | 131 | 0 | 17 | 4 | 11 | 4 |
| normal-3p-seed-31137 | 3 | normal | yes | 49 | 0 | 10 | 2 | 0 | 3 |
| blind-4p-seed-31154 | 4 | blind | yes | 77 | 0 | 11 | 3 | 7 | 2 |
| normal-5p-seed-31171 | 5 | normal | yes | 88 | 0 | 11 | 1 | 0 | 2 |
| blind-6p-seed-31188 | 6 | blind | yes | 123 | 0 | 14 | 3 | 2 | 4 |
| normal-3p-seed-31205 | 3 | normal | yes | 41 | 0 | 10 | 2 | 0 | 2 |
| blind-4p-seed-31222 | 4 | blind | yes | 72 | 0 | 12 | 2 | 2 | 2 |
| normal-5p-seed-31239 | 5 | normal | yes | 94 | 0 | 13 | 4 | 0 | 2 |
| blind-6p-seed-31256 | 6 | blind | yes | 151 | 0 | 16 | 5 | 7 | 1 |
| normal-3p-seed-31273 | 3 | normal | yes | 50 | 0 | 11 | 2 | 0 | 3 |
| blind-4p-seed-31290 | 4 | blind | yes | 66 | 0 | 14 | 3 | 4 | 3 |
| normal-5p-seed-31307 | 5 | normal | yes | 87 | 0 | 14 | 1 | 0 | 3 |
| blind-6p-seed-31324 | 6 | blind | no | 135 | 0 | 13 | 1 | 18 | 3 |
| normal-3p-seed-31341 | 3 | normal | yes | 46 | 0 | 12 | 1 | 0 | 2 |
| blind-4p-seed-31358 | 4 | blind | yes | 87 | 0 | 15 | 3 | 1 | 3 |
| normal-5p-seed-31375 | 5 | normal | yes | 78 | 0 | 14 | 3 | 0 | 3 |
| blind-6p-seed-31392 | 6 | blind | yes | 101 | 0 | 18 | 4 | 6 | 3 |

## 代表判断

### 通常play: normal-3p-seed-31001 / #1 / bot-2

- 観測: field=[], hand={"count":18,"visible":["spade-8(p2p-0-00000000-0000-4000-8000-000000000001-card-03)","spade-5(p2p-0-00000000-0000-4000-8000-000000000001-card-06)","spade-J(p2p-0-00000000-0000-4000-8000-000000000001-card-09)","spade-10(p2p-0-00000000-0000-4000-8000-000000000001-card-12)","spade-K(p2p-0-00000000-0000-4000-8000-000000000001-card-15)","club-9(p2p-0-00000000-0000-4000-8000-000000000001-card-18)","diamond-10(p2p-0-00000000-0000-4000-8000-000000000001-card-21)","heart-4(p2p-0-00000000-0000-4000-8000-000000000001-card-24)","heart-K(p2p-0-00000000-0000-4000-8000-000000000001-card-27)","club-4(p2p-0-00000000-0000-4000-8000-000000000001-card-30)","heart-8(p2p-0-00000000-0000-4000-8000-000000000001-card-33)","heart-J(p2p-0-00000000-0000-4000-8000-000000000001-card-36)","club-10(p2p-0-00000000-0000-4000-8000-000000000001-card-39)","club-3(p2p-0-00000000-0000-4000-8000-000000000001-card-42)","diamond-8(p2p-0-00000000-0000-4000-8000-000000000001-card-45)","diamond-3(p2p-0-00000000-0000-4000-8000-000000000001-card-48)","diamond-Q(p2p-0-00000000-0000-4000-8000-000000000001-card-51)","heart-Q(p2p-0-00000000-0000-4000-8000-000000000001-card-54)"],"hiddenPositions":[]}, flags={"revolution":false,"jackBack":false,"direction":1,"suitLock":[]}
- 合法候補: submitPlay:p2p-0-00000000-0000-4000-8000-000000000001-card-48 / submitPlay:p2p-0-00000000-0000-4000-8000-000000000001-card-42,p2p-0-00000000-0000-4000-8000-000000000001-card-48
- 選択理由: 公開情報だけの戦術評価に探索を混ぜ、終局順位で重み付けする自己対局方策。
- 送信command: `{"name":"submitPlay","payload":{"roomId":"Q0000","gameId":"p2p-0-00000000-0000-4000-8000-000000000001","expectedRevision":4,"cardIds":["p2p-0-00000000-0000-4000-8000-000000000001-card-42","p2p-0-00000000-0000-4000-8000-000000000001-card-48"],"mimics":[],"blindConfirmed":false,"clientActionId":"normal-3p-seed-31001-action-0001"}}`
- authority結果: `{"ok":true,"response":{}}`
- event: `{"publicLog":[{"id":"game-4-0-1700000002000","atMs":1700000002000,"text":"Bot 2が2枚出しました","kind":"play"}],"ruleLog":[]}`
- 適用確認: `{"revisionBefore":4,"revisionAfter":5,"gameVersionBefore":0,"gameVersionAfter":1,"actionRecorded":true,"invariantValid":true,"actorHandBefore":18,"actorHandAfter":16,"actorStatusBefore":"active","actorStatusAfter":"active","pileCardIdsBefore":[],"pileCardIdsAfter":["p2p-0-00000000-0000-4000-8000-000000000001-card-42","p2p-0-00000000-0000-4000-8000-000000000001-card-48"],"pendingJokerMimicAfter":false}`

### A奪い: normal-3p-seed-31001 / #7 / bot-1

- 観測: field=["club-Q(p2p-0-00000000-0000-4000-8000-000000000001-card-02)","club-K(p2p-0-00000000-0000-4000-8000-000000000001-card-29)","club-2(p2p-0-00000000-0000-4000-8000-000000000001-card-35)","JOKER(p2p-0-00000000-0000-4000-8000-000000000001-card-05)"], hand={"count":13,"visible":["diamond-9(p2p-0-00000000-0000-4000-8000-000000000001-card-08)","heart-6(p2p-0-00000000-0000-4000-8000-000000000001-card-11)","spade-A(p2p-0-00000000-0000-4000-8000-000000000001-card-14)","spade-2(p2p-0-00000000-0000-4000-8000-000000000001-card-17)","heart-5(p2p-0-00000000-0000-4000-8000-000000000001-card-20)","diamond-4(p2p-0-00000000-0000-4000-8000-000000000001-card-23)","diamond-K(p2p-0-00000000-0000-4000-8000-000000000001-card-26)","club-5(p2p-0-00000000-0000-4000-8000-000000000001-card-38)","spade-9(p2p-0-00000000-0000-4000-8000-000000000001-card-41)","heart-A(p2p-0-00000000-0000-4000-8000-000000000001-card-44)","spade-3(p2p-0-00000000-0000-4000-8000-000000000001-card-47)","heart-9(p2p-0-00000000-0000-4000-8000-000000000001-card-50)","JOKER(p2p-0-00000000-0000-4000-8000-000000000001-card-32)"],"hiddenPositions":[]}, flags={"revolution":true,"jackBack":false,"direction":1,"suitLock":[]}
- 合法候補: resolveSteal:{"selections":[{"targetUid":"bot-2","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-03"}]} / resolveSteal:{"selections":[{"targetUid":"bot-2","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-06"}]} / resolveSteal:{"selections":[{"targetUid":"bot-2","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-09"}]} / resolveSteal:{"selections":[{"targetUid":"bot-2","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-12"}]} / resolveSteal:{"selections":[{"targetUid":"bot-2","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-15"}]} / resolveSteal:{"selections":[{"targetUid":"bot-2","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-18"}]} / resolveSteal:{"selections":[{"targetUid":"bot-2","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-21"}]} / resolveSteal:{"selections":[{"targetUid":"bot-2","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-24"}]} / resolveSteal:{"selections":[{"targetUid":"bot-2","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-27"}]} / resolveSteal:{"selections":[{"targetUid":"bot-2","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-30"}]} / resolveSteal:{"selections":[{"targetUid":"bot-2","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-33"}]} / resolveSteal:{"selections":[{"targetUid":"bot-2","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-36"}]} / resolveSteal:{"selections":[{"targetUid":"bot-2","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-39"}]} / resolveSteal:{"selections":[{"targetUid":"bot-2","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-45"}]} / resolveSteal:{"selections":[{"targetUid":"bot-2","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-51"}]} / resolveSteal:{"selections":[{"targetUid":"bot-2","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-54"}]} / resolveSteal:{"selections":[{"targetUid":"bot-2","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-22"}]} / resolveSteal:{"selections":[{"targetUid":"bot-2","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-34"}]} / resolveSteal:{"selections":[{"targetUid":"bot-3","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-01"}]} / resolveSteal:{"selections":[{"targetUid":"bot-3","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-04"}]} / resolveSteal:{"selections":[{"targetUid":"bot-3","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-07"}]} / resolveSteal:{"selections":[{"targetUid":"bot-3","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-10"}]} / resolveSteal:{"selections":[{"targetUid":"bot-3","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-13"}]} / resolveSteal:{"selections":[{"targetUid":"bot-3","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-16"}]} / resolveSteal:{"selections":[{"targetUid":"bot-3","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-19"}]} / resolveSteal:{"selections":[{"targetUid":"bot-3","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-25"}]} / resolveSteal:{"selections":[{"targetUid":"bot-3","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-28"}]} / resolveSteal:{"selections":[{"targetUid":"bot-3","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-37"}]} / resolveSteal:{"selections":[{"targetUid":"bot-3","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-40"}]} / resolveSteal:{"selections":[{"targetUid":"bot-3","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-43"}]} / resolveSteal:{"selections":[{"targetUid":"bot-3","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-46"}]} / resolveSteal:{"selections":[{"targetUid":"bot-3","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-49"}]}
- 選択理由: 公開情報だけの戦術評価に探索を混ぜ、終局順位で重み付けする自己対局方策。
- 送信command: `{"name":"resolveSteal","payload":{"roomId":"Q0000","gameId":"p2p-0-00000000-0000-4000-8000-000000000001","expectedRevision":10,"selections":[{"targetUid":"bot-3","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-01"}],"clientActionId":"normal-3p-seed-31001-action-0007"}}`
- authority結果: `{"ok":true,"response":{}}`
- event: `{"publicLog":[{"id":"game-10-0-1700000008000","atMs":1700000008000,"text":"Bot 1がbombを処理しています","kind":"effect"},{"id":"effect-resolved-normal-3p-seed-31001-action-0007-0","atMs":1700000008000,"text":"Bot 1がA奪いでBot 3からカードを1枚奪いました","kind":"effect","notice":{"kind":"steal","actorId":"bot-1","targetId":"bot-3","cardCount":1}}],"ruleLog":[]}`
- 適用確認: `{"revisionBefore":10,"revisionAfter":11,"gameVersionBefore":6,"gameVersionAfter":7,"actionRecorded":true,"invariantValid":true,"actorHandBefore":13,"actorHandAfter":14,"actorStatusBefore":"active","actorStatusAfter":"active","pileCardIdsBefore":["p2p-0-00000000-0000-4000-8000-000000000001-card-02","p2p-0-00000000-0000-4000-8000-000000000001-card-29","p2p-0-00000000-0000-4000-8000-000000000001-card-35","p2p-0-00000000-0000-4000-8000-000000000001-card-05"],"pileCardIdsAfter":["p2p-0-00000000-0000-4000-8000-000000000001-card-02","p2p-0-00000000-0000-4000-8000-000000000001-card-29","p2p-0-00000000-0000-4000-8000-000000000001-card-35","p2p-0-00000000-0000-4000-8000-000000000001-card-05"],"pendingEffectAfter":"bomb","pendingJokerMimicAfter":false}`

### blind authority判定: blind-6p-seed-31052 / #2 / bot-1

- 観測: field=["diamond-3(p2p-0-00000000-0000-4000-8000-000000000004-card-22)"], hand={"count":9,"visible":["heart-K(p2p-0-00000000-0000-4000-8000-000000000004-card-05)","spade-2(p2p-0-00000000-0000-4000-8000-000000000004-card-11)","spade-7(p2p-0-00000000-0000-4000-8000-000000000004-card-17)","heart-3(p2p-0-00000000-0000-4000-8000-000000000004-card-29)","spade-6(p2p-0-00000000-0000-4000-8000-000000000004-card-41)","diamond-K(p2p-0-00000000-0000-4000-8000-000000000004-card-47)","diamond-5(p2p-0-00000000-0000-4000-8000-000000000004-card-53)"],"hiddenPositions":["p2p-0-00000000-0000-4000-8000-000000000004-card-35","p2p-0-00000000-0000-4000-8000-000000000004-card-23"]}, flags={"revolution":false,"jackBack":false,"direction":1,"suitLock":[]}
- 合法候補: submitPlay:p2p-0-00000000-0000-4000-8000-000000000004-card-53 / submitPlay:p2p-0-00000000-0000-4000-8000-000000000004-card-41 / submitPlay:p2p-0-00000000-0000-4000-8000-000000000004-card-17 / submitPlay:p2p-0-00000000-0000-4000-8000-000000000004-card-05 / submitPlay:p2p-0-00000000-0000-4000-8000-000000000004-card-47 / submitPlay:p2p-0-00000000-0000-4000-8000-000000000004-card-11 / submitPlay:p2p-0-00000000-0000-4000-8000-000000000004-card-35 / submitPlay:p2p-0-00000000-0000-4000-8000-000000000004-card-23 / submitPass:{}
- 選択理由: 公開情報だけの戦術評価に探索を混ぜ、終局順位で重み付けする自己対局方策。
- 送信command: `{"name":"submitPlay","payload":{"roomId":"Q0003","gameId":"p2p-0-00000000-0000-4000-8000-000000000004","expectedRevision":9,"cardIds":["p2p-0-00000000-0000-4000-8000-000000000004-card-23"],"mimics":[],"blindConfirmed":true,"clientActionId":"blind-6p-seed-31052-action-0002"}}`
- authority結果: `{"ok":true,"response":{}}`
- event: `{"publicLog":[{"id":"game-9-0-1700003003000","atMs":1700003003000,"text":"Bot 1が1枚出しました","kind":"play"}],"ruleLog":[]}`
- 適用確認: `{"revisionBefore":9,"revisionAfter":10,"gameVersionBefore":1,"gameVersionAfter":2,"actionRecorded":true,"invariantValid":true,"actorHandBefore":9,"actorHandAfter":8,"actorStatusBefore":"active","actorStatusAfter":"active","pileCardIdsBefore":["p2p-0-00000000-0000-4000-8000-000000000004-card-22"],"pileCardIdsAfter":["p2p-0-00000000-0000-4000-8000-000000000004-card-23"],"pendingJokerMimicAfter":false}`

