# Legacy Read-only Audit

監査対象はルート `index.html`、`styles/daifugo-luxe.css`、`src/avatar-studio.js`、`service-worker.js`、`manifest.json` です。旧版を変更せず、新版設計の入力としてだけ確認しました。

## 維持する意図

- ブランド名「大富豪」の静かな高級感
- 深い夜色、ウォールナット、真鍮、濃緑フェルトの方向性
- Three.jsのACES tone mapping、円形Cylinder table、厚みのあるBox card
- 5文字room ID、12文字player名、公開room一覧
- 3〜6人、特殊効果の表示、keyboard操作の導線
- 既存Firebase Project IDとWeb App ID

これらはコードをコピーせず、型、component、material tokenとして再構成します。

## 廃止する実装

### 巨大な単一HTML

旧 `index.html` はmarkup、CSS、Firebase通信、ルール、3D scene、effect UIを一つの約225KB fileへ集約しています。新版はscreen、network、3D、rules package、Functionsへ分割します。

### クライアント権威

旧版はbrowserが `rooms/{roomId}` に対して `runTransaction` を実行し、shuffle、hand、turn、effect、rankを直接更新します。新版はcallableへ意図だけを送り、Admin SDKとpure rules transitionだけが権威stateを更新します。

### 全情報を含む単一room document

旧版は全player hand、blind実体、private event、logを同じdocumentで全員へ配信します。新版はprivate authoritative stateとUID別projectionに分離し、owner blind faceをserializerから除外します。

### 擬態情報の欠落

旧clean処理はJokerの`mimics`を場へ保持できません。新版はplayed cardのeffective faceとしてtrick終了まで保持します。

### 2D avatarと自由描画

旧 `avatar-studio.js` はSVG faceとCanvas strokesを作り、Three.js sceneではSpriteへ描画します。これは正本の「実3D mesh」「自由描画なし」に反するため、新版へ変換しません。移行表示が必要な場合だけ既定3D profileへfallbackします。

### Canvas単独操作

旧canvasに`role=application`とkey handlerはありますが、全card/effectを意味的DOMだけでも操作できる完全な代替ではありません。新版はR3F meshとDOM listbox/buttonが同じstoreを共有します。

### Presence・再接続・idempotency不足

旧player IDは`Math.random`で、Auth、revision、action ID、heartbeat、120秒graceがありません。新版は匿名Auth UID、server revision、transaction内action record、RTDB presenceを用います。

### Service workerの旧asset固定

旧service workerはroot assetとquery付きv7 fileを固定cacheします。新版はVite build manifestとPWA pluginでasset versionを一体管理し、旧cacheとの混在を避けます。

## 移行方針

- 新版が本番smokeを通るまでroot旧版と`rooms`を残す。
- 新版は`v2*` namespaceだけに書く。
- GitHub Pages切替時にroot公開物を`apps/web/dist`へ変更する。
- 旧roomを自動migrationしない。進行中gameを新版へ引き継がない。
- 旧2D avatarは新規保存しない。legacy表示では安全な既定3D avatarを割り当てる。
