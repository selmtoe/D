# Firebase完全引継ぎ資料

> **2026-08-20 implementation override:** 利用者の明示指示により、現行webはCloud Functions/RTDBを使わないSpark + WebRTC P2P構成へ変更した。以下は元のクラウド引き継ぎ記録として保持する。現在の実装・deploy手順は `ARCHITECTURE.md`、`DATA_MODEL.md`、`OPERATIONS.md` を優先する。

版: 1.0.0

確認日: 2026-08-20

対象リポジトリ: https://github.com/selmtoe/D

現在の公開アプリ: https://selmtoe.github.io/D/

## 1. 目的

この文書は、現在の大富豪アプリが実際に接続しているFirebaseプロジェクトを、再構築担当者が新規プロジェクトへ差し替えず、そのまま再利用するための引継ぎ資料である。

Firebase Web Appの設定値はブラウザへ配信される公開識別情報であり、サービスアカウント秘密鍵ではない。セキュリティはAPI keyの秘匿ではなく、Firebase Authentication、App Check、Security Rules、権威バックエンドで確保する。

## 2. 現在のFirebaseプロジェクト

| 項目 | 値 |
|---|---|
| Project ID | daifugo-8e039 |
| Project number / Messaging sender ID | 979025215319 |
| Auth domain | daifugo-8e039.firebaseapp.com |
| Storage bucket | daifugo-8e039.firebasestorage.app |
| Web App ID | 1:979025215319:web:1bf381daf1eb647760c812 |
| Measurement ID | G-KSQ8LRN4ZE |
| Firestore database ID | コード上は明示なし。SDK既定の (default) を使用 |
| Firebase Console | https://console.firebase.google.com/project/daifugo-8e039/overview |
| Firestore Console | https://console.firebase.google.com/project/daifugo-8e039/firestore |
| Authentication Console | https://console.firebase.google.com/project/daifugo-8e039/authentication |
| Google Cloud Console | https://console.cloud.google.com/home/dashboard?project=daifugo-8e039 |
| Firestore REST base | https://firestore.googleapis.com/v1/projects/daifugo-8e039/databases/(default)/documents |

## 3. そのまま使えるWeb設定

現在の index.html に入っている設定値である。

~~~js
export const firebaseConfig = {
  apiKey: "AIzaSyD1YdTMESZi-ynMzS_p_hdtr1znBI64RmM",
  authDomain: "daifugo-8e039.firebaseapp.com",
  projectId: "daifugo-8e039",
  storageBucket: "daifugo-8e039.firebasestorage.app",
  messagingSenderId: "979025215319",
  appId: "1:979025215319:web:1bf381daf1eb647760c812",
  measurementId: "G-KSQ8LRN4ZE"
};
~~~

現在と同じ接続先を使うだけなら次で初期化できる。

~~~ts
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

export const firebaseApp = initializeApp(firebaseConfig);
export const firestore = getFirestore(firebaseApp);
~~~

## 4. Vite用環境変数

再構築版では環境切替のため.envへ移す。

~~~dotenv
VITE_FIREBASE_API_KEY=AIzaSyD1YdTMESZi-ynMzS_p_hdtr1znBI64RmM
VITE_FIREBASE_AUTH_DOMAIN=daifugo-8e039.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=daifugo-8e039
VITE_FIREBASE_STORAGE_BUCKET=daifugo-8e039.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=979025215319
VITE_FIREBASE_APP_ID=1:979025215319:web:1bf381daf1eb647760c812
VITE_FIREBASE_MEASUREMENT_ID=G-KSQ8LRN4ZE
~~~

~~~ts
export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};
~~~

stagingと本番を分けるまでは、上記を本番接続値として使う。新しいFirebaseプロジェクトを勝手に作成しない。

## 5. 現在のFirebase SDK

現行はGoogle CDNのFirebase JavaScript SDK 10.12.2をES Modulesとして読み込んでいる。

~~~js
import { initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  runTransaction,
  collection,
  query,
  where,
  orderBy,
  getDocs,
  limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
~~~

再構築版はnpmの現行安定版へ移行してよい。ただし同じ daifugo-8e039 へ接続し、Emulatorと本番を明示的に切り替える。

## 6. 現在使用中のFirebase機能

現行コードで実際に使っているのはCloud Firestoreだけである。

- setDoc: 部屋作成
- getDoc: 部屋存在と最新状態
- onSnapshot: 部屋ドキュメントのリアルタイム購読
- runTransaction: 入室、退出、開始、提出、パス、全特殊効果、チャット
- serverTimestamp: 部屋作成時刻
- getDocsとquery: 公開部屋一覧
- transaction.delete: 最後の参加者が退出した部屋の削除

全ゲーム状態を一個の部屋ドキュメントへ保存し、その全体を全参加者が購読している。

## 7. 現在使っていないFirebase機能

設定値が存在していても、次は現行コードで使っていない。

- Firebase Authentication
- Firebase Realtime Database
- Cloud Functions for Firebase
- Firebase Storage
- Firebase Analytics
- Firebase App Check
- Firebase Hosting
- Cloud Messaging
- Remote Config
- WebRTCシグナリング
- Presence / heartbeat
- TTL自動削除

Measurement IDとStorage bucketは設定に含まれるが、AnalyticsとStorageのSDKは初期化していない。

再構築版では同じproject上でAuthentication、Functions、App Check、必要ならRealtime Databaseを追加する。既存Firestoreだけを別projectへ切り離さない。

## 8. 現在のFirestoreパス

確認できるcollectionは一つだけである。

~~~text
rooms/{ROOM_ID}
~~~

- ROOM_IDは英大文字と数字からなる5文字
- subcollectionは使っていない
- 全player、hand、log、field、discard、pending effectを同じdocumentへ格納
- Room IDはclientのMath.randomで生成
- Player IDもclientのMath.randomで生成
- Firebase Auth UIDは未使用

## 9. roomsドキュメント

### 9.1 トップレベル

| field | type | 意味 |
|---|---|---|
| id | string | 5文字ROOM_ID |
| blindCount | number | 0、または1～10 |
| players | Player[] | 全参加player |
| gameState | string | waiting、playing、finished |
| field | Card[] | 現在の場 |
| discardPile | Card[] | 捨て札 |
| roundPile | Card[] | 現在trickの過去札 |
| lastPlayed | object | player IDまたはnullとcards |
| turnPlayerId | stringまたはnull | 現在手番 |
| passCount | number | 連続pass数 |
| isRevolution | boolean | 革命 |
| isJBackActive | boolean | Jバック |
| turnDirection | number | 1または-1 |
| shibariSuits | string[] | 縛りsuit |
| createdAt | Firestore Timestamp | serverTimestamp |
| pendingActions | PendingAction[] | 強制効果queue |
| log | LogEntry[] | 公開log兼chat。最大300件 |

schemaVersionは現在ない。

### 9.2 Player

~~~ts
type LegacyPlayer = {
  id: string;
  name: string;
  avatar: LegacyAvatarProfile;
  isHost: boolean;
  hand: LegacyCard[];
  order: number;
  rank: number | null;
  isDisqualified?: boolean;
  privateEvent?: LegacyPrivateEvent;
};
~~~

- idは8文字程度のrandom string。Auth UIDではない
- nameは最大12文字
- orderは待機中-1、開始後はダイヤ3所有者から1
- rankは現役中null
- privateEventも同じroom documentに入るため、Firestore上は全購読者が読める

### 9.3 Card

~~~ts
type LegacyCard = {
  uid: string;
  suit: "spade" | "heart" | "diamond" | "club" | "joker";
  number: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 15;
  isBlind?: boolean;
  mimics?: {
    suit: "spade" | "heart" | "diamond" | "club";
    number: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;
  };
};
~~~

- Jokerはsuit joker、number 15
- 通常uidはspade-3形式
- Joker uidはjoker-1とjoker-2
- isBlindは手札中だけ
- mimicsはJoker擬態
- 現行cleanCardはsuit、number、uidだけを残すため、場の擬態情報が失われる。これは仕様ではなく修正対象

### 9.4 PendingAction

| type | 意味 |
|---|---|
| steal_select_player | A奪い |
| pass_select_player | 7渡し。通常passではない |
| discard_select_cards | 10捨て |
| bomber_select_rank | Qボンバー |
| collect_select_cards | K回収 |
| eight_cut | 階段8切り |
| auto_clear_field | 自動場流し |

~~~ts
type LegacyPendingAction = {
  type: string;
  actorId: string;
  count?: number;
};
~~~

### 9.5 LogEntry

~~~ts
type LegacyLogEntry = {
  timestamp: number;
  message: string;
  isChat?: boolean;
  effect?: {
    card: string;
    name: string;
  };
};
~~~

### 9.6 PrivateEvent

現在のtypeはsteal_success、stolen、receive_cardsである。

~~~ts
type LegacyPrivateEvent = {
  id: number;
  type: "steal_success" | "stolen" | "receive_cards";
  actor?: string;
  target?: string;
  cards: LegacyCard[];
};
~~~

名前はprivateでも、単一room document内なので実際にはprivateではない。新版では閲覧者別viewへ移す。

## 10. 現在のアバターデータ

現行2D avatarはPlayer.avatarへ直接保存する。

~~~ts
type LegacyAvatarProfile = {
  name: string;
  skin: string;
  face: string;
  hair: string;
  hairColor: string;
  eyes: string;
  eyeColor: string;
  brows: string;
  nose: string;
  mouth: string;
  marks: string;
  accessory: string;
  outfit: string;
  outfitColor: string;
  background: string;
  strokes: Array<{
    color: string;
    size: number;
    points: Array<{ x: number; y: number }>;
  }>;
};
~~~

現行serializer上限:

- strokes最大24本
- 1 stroke最大120点
- pointはx/y object。ネスト配列ではない
- x/yは0～512、小数1桁
- brush sizeは1～40

再構築版は完全3D avatarへ変更して自由描画を廃止する。legacy room表示期間だけ、LegacyAvatarProfileから既定3D avatarへ変換するfallbackを持つ。新3D profileはversion付き別schemaにする。

## 11. 公開部屋一覧query

~~~ts
query(
  collection(db, "rooms"),
  where("gameState", "==", "waiting"),
  orderBy("createdAt", "desc"),
  limit(20)
);
~~~

取得後、client側で作成から24時間以内だけを残している。

必要なindex候補:

~~~json
{
  "indexes": [
    {
      "collectionGroup": "rooms",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "gameState",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "createdAt",
          "order": "DESCENDING"
        }
      ]
    }
  ],
  "fieldOverrides": []
}
~~~

このindexが本番に既存かはrepoだけでは確認できない。Firebase Consoleまたは権限付きCLIで確認する。

新版ではheartbeatとstatusもserver側で絞り込み、古い部屋を取得後にclientだけで除外しない。

## 12. 現行の読み書きフロー

### 部屋作成

rooms/{5文字ID}をsetDocし、host 1人、waiting、blindCount 0で作る。

### Player参加

transactionで次を検証する。

- roomが存在
- 同名playerがいない
- 6人未満
- gameStateがwaiting

players array末尾へ追加する。

### リアルタイム購読

全員がonSnapshotでroom document全体を購読する。

### 設定

待機中hostだけがtransactionでblindCountを0～10へ更新する。

### Game開始

host browserがtransaction内で54枚を生成・shuffleし、players、hands、turn、全状態をroomへ書く。

### 提出・pass・effect

すべてbrowserからFirestore transactionを直接実行する。Functionsは介在しない。

### Chat

playersに自分のlegacy player IDがあれば、room.logへ追加する。

### 退出

playersから削除する。最後の一人ならroom documentを削除する。

## 13. 現行方式の制約

同じprojectへ接続できることと、現行方式が安全なことは別である。

- Firebase Authなし
- Player IDがclient生成
- 全handとblind実体が全clientへ配信
- clientがrule stateを直接write
- room documentが巨大
- Security Rulesがrepoにない
- App Checkなし
- Presenceと再接続IDなし
- Functions権威判定なし
- schema versionなし
- idempotencyとrevisionなし
- privateEventが実際にはprivateでない
- audit logとchatが同じarray
- 24時間除外がclientだけ
- 自由描画strokeをroomごとに複製

再構築担当は接続先projectを再利用するが、この構造まで維持してはならない。

## 14. 同じprojectを安全に再利用する

### 原則

- Project ID daifugo-8e039を維持
- 稼働中の旧roomsを破壊しない
- 新旧をnamespaceで分離
- 新版rulesを旧版へ無検証適用しない
- 新版完成まで旧GitHub Pagesを止めない

### 推奨namespace

- v2Rooms: 新room
- v2RoomViews: player／spectator別view
- v2Events: audit event
- users: Auth UID単位profile
- avatars: 3D avatar profile
- webrtcRooms: signaling
- presence: RTDB presence

Firestoreの実階層はdocumentとcollectionが交互になるようDATA_MODEL.mdで確定する。

### 段階移行

1. 同じprojectで匿名Authenticationを有効化。
2. GitHub Pages継続時はAuthorized domainsへselmtoe.github.ioを登録。
3. 新版をv2 namespaceへ接続。
4. Functionsと閲覧者別viewをEmulatorで完成。
5. 新版専用Rulesをcollection単位で追加。
6. 旧rooms accessを維持したままstaging test。
7. 新版の本番smoke test。
8. frontend切替後、旧roomsをread onlyまたは期限削除。
9. 移行期間後にlegacy rulesとdataを整理。

## 15. CLIと管理権限

repoには次が存在しない。

- .firebaserc
- firebase.json
- firestore.rules
- firestore.indexes.json
- storage.rules
- Functions source
- Firebase Hosting設定
- Emulator設定
- service account JSON

確認環境にはFirebase CLIも未installだった。

Web設定だけでclient接続はできるが、Rules、Functions、Indexes、Authをdeployするには、project daifugo-8e039へアクセスできるGoogle accountでloginする必要がある。

必要権限:

- Firebase project閲覧
- Firestore Rules／Indexes閲覧・deploy
- Cloud Functions deploy
- Authentication provider設定
- App Check設定
- 必要ならRealtime Database作成とRules
- Hosting使用時はHosting deploy

service account秘密鍵をchatやGitで渡してはならない。localはFirebase CLI対話login、CIはGitHub OIDC／Workload Identity Federationまたは安全なCI secretを使う。

## 16. repoから確定できない管理情報

次は公開Web設定から確定できない。

- Firestore database region
- 現在のSecurity Rules本文
- 現在のComposite Index一覧
- Billing plan
- Google Cloud IAM member
- Web AppのConsole表示名
- API key制限
- Authorized domains
- App Check状態
- Functions既定region
- Firebase Hosting site ID
- Realtime Database instance有無
- Analytics property実使用

project ownerのConsoleまたは権限付きCLIで確認し、推測値を捏造しない。

## 17. 再構築担当の接続確認

1. Project IDがdaifugo-8e039であることを確認。
2. 同projectの匿名Authへlogin。
3. Emulator中は本番へ誤接続していないと画面表示。
4. 本番既存roomsはread onlyで確認し、勝手に削除しない。
5. 新版test dataはv2 namespaceまたはstaging projectへ作る。
6. 本番smoke roomは正確なroomId指定で削除。
7. Rules変更前後に旧公開アプリの作成・参加が壊れないか確認。
8. Functionsに課金planが必要なら課金変更前に所有者へ説明。
9. GitHub Pages継続時はAuthorized domain、CORS、callable originを確認。
10. local、CI、本番のProject IDをlogへ明示し誤deployを防止。

## 18. 再構築版で追加する設定ファイル

~~~text
.firebaserc
firebase.json
firestore.rules
firestore.indexes.json
storage.rules
database.rules.json
functions/
.env.example
docs/FIREBASE_HANDOFF.md
docs/DATA_MODEL.md
docs/OPERATIONS.md
~~~

.firebasercのdefault projectはdaifugo-8e039とする。

~~~json
{
  "projects": {
    "default": "daifugo-8e039"
  }
}
~~~

実Rulesはルールブックと閲覧者別viewを実装後に作る。現行rules不明のまま「現在のrules」と称するfileを捏造しない。

## 19. Firebase引継ぎ完了条件

再構築担当は次を報告する。

- 接続Project ID
- Web App ID
- Auth provider
- Firestore database IDとregion
- deployed Rules version
- deployed Indexes
- Functions名とregion
- App Check状態
- Authorized domains
- HostingまたはGitHub Pages URL
- 本番smoke roomの作成、参加、観戦、削除結果
- 旧roomsとの互換性
- 課金への影響
- commit IDとdeploy日時

この一覧が揃うまでFirebase引継ぎ完了と報告しない。
