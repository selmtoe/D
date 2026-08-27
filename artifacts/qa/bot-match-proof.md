# 大富豪 bot実対局QA — 短い証拠

実`SparkAuthority.handleCommand`と`@daifugo/rules`を通した決定論的対局の抜粋です。完全履歴はgit管理外の`bot-match-evidence.json` / `.md`へ同じテストから再生成できます。

再実行: `pnpm --filter @daifugo/web exec vitest run src/test/qaBotEvidence.test.ts`

## 統計

```json
{
  "matches": 24,
  "completed": 24,
  "stalled": 0,
  "commands": 1559,
  "accepted": 1559,
  "rejected": 0,
  "plays": 685,
  "passes": 622,
  "effectResolutions": 252,
  "stealResolutions": 58,
  "blindAttempts": 46,
  "blindDisqualifications": 42,
  "jokerSubmissions": 41,
  "jokerMimicDeclarations": 0,
  "finishes": 66,
  "invariantFailures": 0
}
```

## 対局一覧

| match | 人数 | mode | 完了 | command | rejected | 効果 | A奪い | blind | Joker |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| normal-3p-seed-3101 | 3 | normal | yes | 94 | 0 | 19 | 4 | 0 | 2 |
| blind-3p-seed-3102 | 3 | blind | yes | 7 | 0 | 1 | 0 | 2 | 1 |
| normal-3p-seed-3103 | 3 | normal | yes | 102 | 0 | 20 | 4 | 0 | 2 |
| blind-3p-seed-3104 | 3 | blind | yes | 7 | 0 | 1 | 1 | 2 | 1 |
| normal-3p-seed-3105 | 3 | normal | yes | 95 | 0 | 20 | 6 | 0 | 2 |
| blind-3p-seed-3106 | 3 | blind | yes | 7 | 0 | 1 | 0 | 2 | 1 |
| normal-4p-seed-3201 | 4 | normal | yes | 114 | 0 | 21 | 5 | 0 | 3 |
| blind-4p-seed-3202 | 4 | blind | yes | 9 | 0 | 0 | 0 | 3 | 1 |
| normal-4p-seed-3203 | 4 | normal | yes | 119 | 0 | 19 | 4 | 0 | 2 |
| blind-4p-seed-3204 | 4 | blind | yes | 10 | 0 | 2 | 1 | 3 | 2 |
| normal-4p-seed-3205 | 4 | normal | yes | 121 | 0 | 21 | 5 | 0 | 2 |
| blind-4p-seed-3206 | 4 | blind | yes | 12 | 0 | 3 | 1 | 3 | 1 |
| normal-5p-seed-3301 | 5 | normal | yes | 111 | 0 | 18 | 4 | 0 | 3 |
| blind-5p-seed-3302 | 5 | blind | yes | 7 | 0 | 0 | 0 | 4 | 1 |
| normal-5p-seed-3303 | 5 | normal | yes | 133 | 0 | 20 | 5 | 0 | 3 |
| blind-5p-seed-3304 | 5 | blind | yes | 14 | 0 | 3 | 0 | 6 | 1 |
| normal-5p-seed-3305 | 5 | normal | yes | 122 | 0 | 18 | 4 | 0 | 2 |
| blind-5p-seed-3306 | 5 | blind | yes | 10 | 0 | 2 | 1 | 4 | 1 |
| normal-6p-seed-3401 | 6 | normal | yes | 136 | 0 | 18 | 4 | 0 | 3 |
| blind-6p-seed-3402 | 6 | blind | yes | 12 | 0 | 2 | 1 | 5 | 1 |
| normal-6p-seed-3403 | 6 | normal | yes | 147 | 0 | 20 | 4 | 0 | 3 |
| blind-6p-seed-3404 | 6 | blind | yes | 12 | 0 | 1 | 0 | 6 | 0 |
| normal-6p-seed-3405 | 6 | normal | yes | 148 | 0 | 21 | 4 | 0 | 2 |
| blind-6p-seed-3406 | 6 | blind | yes | 10 | 0 | 1 | 0 | 6 | 1 |

## 代表判断

### 通常play: normal-3p-seed-3101 / #1 / bot-1

- 観測: field=[], hand={"count":18,"visible":["JOKER(p2p-0-00000000-0000-4000-8000-000000000001-card-01)","diamond-4(p2p-0-00000000-0000-4000-8000-000000000001-card-04)","club-K(p2p-0-00000000-0000-4000-8000-000000000001-card-07)","club-7(p2p-0-00000000-0000-4000-8000-000000000001-card-10)","diamond-8(p2p-0-00000000-0000-4000-8000-000000000001-card-13)","club-4(p2p-0-00000000-0000-4000-8000-000000000001-card-16)","club-Q(p2p-0-00000000-0000-4000-8000-000000000001-card-19)","JOKER(p2p-0-00000000-0000-4000-8000-000000000001-card-22)","diamond-10(p2p-0-00000000-0000-4000-8000-000000000001-card-25)","club-9(p2p-0-00000000-0000-4000-8000-000000000001-card-28)","spade-7(p2p-0-00000000-0000-4000-8000-000000000001-card-31)","spade-5(p2p-0-00000000-0000-4000-8000-000000000001-card-34)","club-A(p2p-0-00000000-0000-4000-8000-000000000001-card-37)","club-3(p2p-0-00000000-0000-4000-8000-000000000001-card-40)","heart-J(p2p-0-00000000-0000-4000-8000-000000000001-card-43)","diamond-3(p2p-0-00000000-0000-4000-8000-000000000001-card-46)","heart-6(p2p-0-00000000-0000-4000-8000-000000000001-card-49)","club-6(p2p-0-00000000-0000-4000-8000-000000000001-card-52)"],"hiddenPositions":[]}, flags={"revolution":false,"jackBack":false,"direction":1,"suitLock":[]}
- 合法候補: diamond-3(p2p-0-00000000-0000-4000-8000-000000000001-card-46) / visible-group:club-3(p2p-0-00000000-0000-4000-8000-000000000001-card-40)+diamond-3(p2p-0-00000000-0000-4000-8000-000000000001-card-46)
- 選択理由: 場が空なので、特殊効果またはJokerを実地検証できる合法候補を優先した。
- 送信command: `{"name":"submitPlay","payload":{"roomId":"Q0000","gameId":"p2p-0-00000000-0000-4000-8000-000000000001","expectedRevision":4,"cardIds":["p2p-0-00000000-0000-4000-8000-000000000001-card-46"],"mimics":[],"blindConfirmed":false,"clientActionId":"normal-3p-seed-3101-action-0001"}}`
- authority結果: `{"ok":true,"response":{}}`
- event: `{"publicLog":[{"id":"game-4-0-1700000002000","atMs":1700000002000,"text":"Bot 1が1枚出しました","kind":"play"}],"ruleLog":[]}`
- 適用確認: `{"revisionBefore":4,"revisionAfter":5,"gameVersionBefore":0,"gameVersionAfter":1,"actionRecorded":true,"invariantValid":true,"actorHandBefore":18,"actorHandAfter":17,"actorStatusBefore":"active","actorStatusAfter":"active","pileCardIdsBefore":[],"pileCardIdsAfter":["p2p-0-00000000-0000-4000-8000-000000000001-card-46"],"pendingJokerMimicAfter":false}`

### A奪い: normal-3p-seed-3101 / #10 / bot-1

- 観測: field=["club-A(p2p-0-00000000-0000-4000-8000-000000000001-card-37)"], hand={"count":14,"visible":["diamond-4(p2p-0-00000000-0000-4000-8000-000000000001-card-04)","club-K(p2p-0-00000000-0000-4000-8000-000000000001-card-07)","club-7(p2p-0-00000000-0000-4000-8000-000000000001-card-10)","diamond-8(p2p-0-00000000-0000-4000-8000-000000000001-card-13)","club-4(p2p-0-00000000-0000-4000-8000-000000000001-card-16)","club-Q(p2p-0-00000000-0000-4000-8000-000000000001-card-19)","JOKER(p2p-0-00000000-0000-4000-8000-000000000001-card-22)","diamond-10(p2p-0-00000000-0000-4000-8000-000000000001-card-25)","club-9(p2p-0-00000000-0000-4000-8000-000000000001-card-28)","spade-7(p2p-0-00000000-0000-4000-8000-000000000001-card-31)","spade-5(p2p-0-00000000-0000-4000-8000-000000000001-card-34)","heart-J(p2p-0-00000000-0000-4000-8000-000000000001-card-43)","heart-6(p2p-0-00000000-0000-4000-8000-000000000001-card-49)","club-6(p2p-0-00000000-0000-4000-8000-000000000001-card-52)"],"hiddenPositions":[]}, flags={"revolution":false,"jackBack":false,"direction":1,"suitLock":[]}
- 合法候補: A奪い:bot-3/p2p-0-00000000-0000-4000-8000-000000000001-card-08
- 選択理由: stealのrequiredCount=1を満たす観測可能な対象を先頭から選んだ。
- 送信command: `{"name":"resolveSteal","payload":{"roomId":"Q0000","gameId":"p2p-0-00000000-0000-4000-8000-000000000001","expectedRevision":13,"selections":[{"targetUid":"bot-3","cardId":"p2p-0-00000000-0000-4000-8000-000000000001-card-08"}],"clientActionId":"normal-3p-seed-3101-action-0010"}}`
- authority結果: `{"ok":true,"response":{}}`
- event: `{"publicLog":[{"id":"effect-resolved-normal-3p-seed-3101-action-0010-0","atMs":1700000011000,"text":"Bot 1がA奪いでBot 3からカードを1枚奪いました","kind":"effect","notice":{"kind":"steal","actorId":"bot-1","targetId":"bot-3","cardCount":1}}],"ruleLog":[]}`
- 適用確認: `{"revisionBefore":13,"revisionAfter":14,"gameVersionBefore":9,"gameVersionAfter":10,"actionRecorded":true,"invariantValid":true,"actorHandBefore":14,"actorHandAfter":15,"actorStatusBefore":"active","actorStatusAfter":"active","pileCardIdsBefore":["p2p-0-00000000-0000-4000-8000-000000000001-card-37"],"pileCardIdsAfter":["p2p-0-00000000-0000-4000-8000-000000000001-card-37"],"pendingJokerMimicAfter":false}`

### blind authority判定: blind-3p-seed-3102 / #6 / bot-2

- 観測: field=["JOKER(p2p-0-00000000-0000-4000-8000-000000000002-card-09)"], hand={"count":16,"visible":["club-7(p2p-0-00000000-0000-4000-8000-000000000002-card-04)","heart-K(p2p-0-00000000-0000-4000-8000-000000000002-card-07)","club-K(p2p-0-00000000-0000-4000-8000-000000000002-card-10)","heart-8(p2p-0-00000000-0000-4000-8000-000000000002-card-13)","club-9(p2p-0-00000000-0000-4000-8000-000000000002-card-22)","heart-Q(p2p-0-00000000-0000-4000-8000-000000000002-card-25)","diamond-A(p2p-0-00000000-0000-4000-8000-000000000002-card-28)","spade-8(p2p-0-00000000-0000-4000-8000-000000000002-card-34)","diamond-K(p2p-0-00000000-0000-4000-8000-000000000002-card-37)","spade-2(p2p-0-00000000-0000-4000-8000-000000000002-card-43)","heart-10(p2p-0-00000000-0000-4000-8000-000000000002-card-46)","diamond-9(p2p-0-00000000-0000-4000-8000-000000000002-card-49)","club-6(p2p-0-00000000-0000-4000-8000-000000000002-card-52)"],"hiddenPositions":["p2p-0-00000000-0000-4000-8000-000000000002-card-40","p2p-0-00000000-0000-4000-8000-000000000002-card-19","p2p-0-00000000-0000-4000-8000-000000000002-card-31"]}, flags={"revolution":false,"jackBack":false,"direction":1,"suitLock":[]}
- 合法候補: blind-single:p2p-0-00000000-0000-4000-8000-000000000002-card-40 / blind-single:p2p-0-00000000-0000-4000-8000-000000000002-card-19 / blind-single:p2p-0-00000000-0000-4000-8000-000000000002-card-31 / pass:場に札があるため合法
- 選択理由: 表向き合法手がないためblind位置を選び、不可逆確認付きでauthority判定へ送る。
- 送信command: `{"name":"submitPlay","payload":{"roomId":"Q0001","gameId":"p2p-0-00000000-0000-4000-8000-000000000002","expectedRevision":10,"cardIds":["p2p-0-00000000-0000-4000-8000-000000000002-card-40"],"mimics":[],"blindConfirmed":true,"clientActionId":"blind-3p-seed-3102-action-0006"}}`
- authority結果: `{"ok":true,"response":{}}`
- event: `{"publicLog":[{"id":"game-10-0-1700001007000","atMs":1700001007000,"text":"Bot 2が失格になりました","kind":"system"}],"ruleLog":[{"id":"log-1","type":"disqualified","playerIds":["bot-2"],"detail":"reserved bottom rank 3"}]}`
- 適用確認: `{"revisionBefore":10,"revisionAfter":11,"gameVersionBefore":5,"gameVersionAfter":6,"actionRecorded":true,"invariantValid":true,"actorHandBefore":16,"actorHandAfter":0,"actorStatusBefore":"active","actorStatusAfter":"disqualified","pileCardIdsBefore":["p2p-0-00000000-0000-4000-8000-000000000002-card-09"],"pileCardIdsAfter":["p2p-0-00000000-0000-4000-8000-000000000002-card-09"],"pendingJokerMimicAfter":false}`

