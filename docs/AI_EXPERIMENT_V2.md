# AI実験 v2 結果・意見書

## 結論

RTX 5060 Laptop GPUで学習した候補採点NNを、実験扱いのCPU席へ接続した。既存TypeScriptエンジンが合法手を列挙し、NNは本人に見える観測と各候補だけから採点する。NNが直接ルールやカードIDを生成する方式ではないため、誤った推論結果がそのまま不正な手になることはない。

現時点のNNは教師botの「先頭候補」baselineをまだ下回る。ただしユーザーが実際のAI利用を希望したため、任意のCPU席として採用した。待機室などユーザー向け画面では単に「CPU」と表示し、「NN実験」などの開発用ラベルは今後も表示しない。推論・候補生成が例外になった場合だけ合法候補による安全フォールバックへ移る。

## v2構成

- 教師データ: `qaBotEvidence.test.ts`が生成した24対局・1559判断
- 分割: train 14対局・1108判断、validation 5対局・192判断、独立test 5対局・259判断
- 漏洩防止: match IDとseedのsplit間重複はいずれも0
- 特徴量: state 111次元、action 59次元
- モデル: state/actionを別々に符号化して結合する44,833 parameterの小型MLP
- 損失: 可変候補数をmaskした判断単位のgrouped cross entropy
- 乱数seed: `20260827`
- 外部モデル・外部データのダウンロード: なし

入力には`selected`、`selectionReason`、適用後状態、authority結果、監査タグ、人間向けcandidate labelを入れていない。UUIDやplayer IDも値そのものは学習せず、カード属性と相対席へ変換している。

## GPU実行結果

40 epochを完走し、validation指標で選んだ15 epoch目を保存した。独立testはその後に一度だけ評価した。

| 項目                      |                               結果 |
| ------------------------- | ---------------------------------: |
| GPU                       | NVIDIA GeForce RTX 5060 Laptop GPU |
| PyTorch / CUDA            |                2.11.0+cu128 / 12.8 |
| Compute capability        |                               12.0 |
| CUDA検証tensor            |                       使用確認済み |
| 最大GPU割当               |                   87,859,200 bytes |
| 学習・評価時間            |                            13.99秒 |
| train accuracy            |                             87.00% |
| validation accuracy       |                             78.65% |
| 独立test accuracy         |                             81.85% |
| 独立test top-3 accuracy   |                             95.75% |
| 多候補test accuracy       |                             58.41% |
| 多候補test top-3 accuracy |                             90.27% |

ローカルcheckpointは`artifacts/ai/runs/rtx5060-imitation-v2/policy.pt`。SHA-256は`43ea62ac3fbd4c8583cc2c2517a45eb903f2bf5dbbf82e6b03f641565f0b5c64`。ブラウザ配信用重みは`apps/web/src/ai/cpu-policy-v2.json`へ同じSHAを埋め込んでいる。

## 評価上の注意

test判断の56.37%は候補が1つだけで、どの方式でも正解する。多候補局面ではNNが58.41%だった一方、「ログに並んだ先頭候補を常に選ぶ」baselineは76.99%だった。現行教師botが候補生成順へ強く依存しているためで、候補番号をNN入力へ追加して見かけの精度だけを上げる対応はしていない。

この精度は「強い大富豪AI」を意味しない。今回のCPU席は、GPU学習済みNNを実ゲームで安全に試し、今後の自己対戦データを得るための実験機能である。

## 次の提案

1. 教師が選ぶ前に合法候補順をランダム化するか、rolloutで全候補を再ラベルし、順番バイアスを除く。
2. 実験CPU同士の自己対戦から勝率・平均順位・反則率・思考時間を未使用seedで測る。
3. 短い探索または複数rolloutの候補価値をsoft targetとして学習する。
4. 学習済み方策と現行教師の対戦リーグを作り、独立seedで安定して上回ることを昇格条件にする。
5. その後、自己対戦RLや価値ネットワークを追加する。

NNを使う方式自体は適切であり、v2でGPU学習からGitHub Pages上の実推論まで一周つながった。次の品質向上点はモデル規模より教師データと対戦評価である。
