# Test Matrix

## ルール単体

| Rulebook | 重点ケース                                               |
| -------- | -------------------------------------------------------- |
| 2〜4     | 3〜6人、54枚一意、ダイヤ3開始、blindダイヤ3              |
| 3        | 通常・革命・Jバック・XOR・素Joker常時最強                |
| 5〜6     | 組、階段、擬態、同数拒否、スペード3返し、Jokerペア       |
| 7        | 縛り発生、全縛り充足、毎回再計算、拡張、解除、例外       |
| 8        | パス後再参加、最終出し手上がり後、一周場流れ、空場例外   |
| 9        | 1/3枚の4反転、2/4枚非反転、Jバック、革命返し             |
| 10       | A、5、6、7、8、9、10、Q、Kの不足・複数対象・0枚          |
| 11〜12   | K→J→革命→実効強さ順→8、複合階段                          |
| 13       | 禁止上がり、効果後判定、同時順位、最下位側失格順位       |
| 14       | blind枚数、全投影、成功/失敗、擬態、属性解除、情報漏洩   |
| 15〜17   | 観戦権限、上がり後観戦、timeout、再接続、退出、再戦      |
| 18       | card conservation、idempotency、revision、pending effect |

## Browser authority / P2P integration

- 3/4/5/6人の配札数とCardIdの一意性
- coordinator queueで競合submitの片方だけが成功すること
- 同一UID/actionIdの再送が同じ結果を返すこと
- stale gameId/revision、異なるturn、effect中の通常操作を拒否すること
- host以外の設定/開始、spectatorのルール操作を拒否すること
- player/spectator/finished playerのP2P projection差分
- own blind projectionのserialized JSONにface/suit/rankが存在しないこと
- 60秒turn timeoutと120秒disconnect grace
- host移譲、効果actor切断の既定解決、active 1人以下の終了
- public listのheartbeat/24時間filter
- 75秒coordinator lease移譲とsnapshot復元
- DataChannel不成立時のFirestore mailbox fallback
- Security Rulesがdirectory lease、presence所有者、signal/mailbox senderを検証すること

Spark friends-only版では完全snapshotのclient readを許可するため、Firestoreをanti-cheat/private-state境界として試験しません。

## E2E

Playwrightはdesktop ChromiumとPixel 7相当で入口3D、横overflow、ルール／アバターダイアログのfocus・Escape復帰、catalog表示をCI実行します。desktopの複数contextでは、本番buildから除外されるDEV限定のfake authorityを使い、3人参加、配札、複数手番、A奪い、観戦者別projection、stale revision、再接続token rotation、blind成功／失格を自動検証します。実FirebaseのEmulator／preview環境では、次の全項目を公開前gateとして再確認します。

1. 3contextでcreate、ID join、start、play、pass、finish、leave。
2. 6contextで満員、最後のplayer slotまでscroll、start。
3. 公開一覧からplayer/spectator参加。
4. 対局途中の外部spectatorが全focusを切替し、全handを見る。
5. 上がったplayerが自動spectator UIへ移る。
6. blind成功、blind失敗即失格、blindダイヤ3。
7. reloadと120秒未満の同席復帰、120秒超過の失格。
8. double tap、同じactionId、stale tabを拒否。
9. keyboardだけでhand選択、play/pass、effect解決。
10. owner blind card名がDOM、aria-label、network-safe viewへ出ない。

## Visual / accessibility

対象viewportは390×844、480×844、768×1024、1280×720、1440×900、横向きphoneです。

- entrance、lobby、public list、6人waiting、normal game、blind game、effect、spectator、result、avatar editorをcapture
- handの90%以上がviewport内、play/passとの交差なし
- spectator focusとhandの交差なし
- waiting list末尾とstart buttonの交差なし
- room action labelが縦書きにならない
- focus trap、Escape、focus return、background scroll lock
- axe重大違反0、visible focus、44px target、AA contrast
- prefers-reduced-motionとlow-performance mode

## 完了gate

`typecheck`、unit、Firestore Rules Emulator、E2E、visual snapshots、production buildの順に実行します。本番smokeはproject ownerがAnonymous Auth、Firestore Rules/Indexes、Authorized domainを確認した後だけ行います。Blaze、Functions、RTDB、App Check enforcementは公開の必須条件ではありません。
