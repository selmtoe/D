# 実験用AI学習パイプライン

このパイプラインは、既存の決定論的bot対局QAログを教師データにして、小型の候補採点NNをGPUでオフライン学習します。検証済みcheckpointはWeb用JSONへ書き出され、実験扱いのCPU席で実際に推論します。

## 境界

- 合法手の列挙とルール判定は、引き続きTypeScriptの既存rules/authorityが担当します。
- NNは「本人に見える観測」と「合法手候補」を受け、候補ごとにスコアを返します。
- 教師の`selected`は正解インデックスの特定だけに使います。`selectionReason`、適用後状態、authority結果、監査タグ、人間向けcandidate labelは入力特徴に含めません。
- train/validation/testはdecision単位ではなくmatch/seed単位で分割するため、同じ対局の局面が複数splitへ混ざりません。testは最良epochの選択には使いません。

これは現行ヒューリスティックbotの模倣学習です。初回モデルは「強いAIの完成版」ではなく、GPU学習・評価・再現性の土台です。次段階では自己対戦データ、探索（MCTS等）、モデル対ヒューリスティックの対戦評価を追加します。

## 教師ログ生成

リポジトリルートで次を実行します。

```powershell
pnpm --filter @daifugo/web exec vitest run src/test/qaBotEvidence.test.ts
```

生成物は`artifacts/qa/bot-match-evidence.json`です。大きいためgit管理外ですが、生成テストとseedはリポジトリに入っています。

## 検証だけ行う

```powershell
pnpm ai:dry-run
```

ログのスキーマ、特徴量、選択候補の一意性、match分割を検査し、`artifacts/ai/runs/<run>/metrics.json`を出します。学習とcheckpoint保存は行いません。

CPUの短いsmoke run:

```powershell
pnpm ai:smoke
```

同名runが既にある場合は、安全のため失敗します。意図して置き換える場合だけ末尾へ`-- --overwrite`を追加してください。

## RTX 5060 Laptop GPUで学習

```powershell
python tools/ai/train.py `
  --device cuda `
  --epochs 40 `
  --batch-size 128 `
  --validation-fraction 0.2 `
  --test-fraction 0.2 `
  --run-name rtx5060-imitation-v2
```

`--device cuda`指定時にCUDAが使えない、検証tensorやmodelがCUDA上にない場合は失敗します。外部モデルやデータのダウンロードはありません。

runディレクトリには以下を保存します。

- `metrics.json`: GPU名、PyTorch/CUDA版、CUDA検証結果、学習時間、dataset SHA-256、match/seed分割、baseline、epoch別指標
- `policy.pt`: 最良validation accuracy時点の`state_dict`と特徴量・モデルmetadata

metricsにはcheckpointのSHA-256と、候補が1つしかない強制判断を分離した多候補局面の指標も記録します。GPU実験の結果と次の判断は`docs/AI_EXPERIMENT_V2.md`にまとめています。

`policy.pt`はローカルで生成したものだけを読み込んでください。PyTorch checkpointは信頼できない第三者ファイルを読み込む用途には使いません。

## Web用モデルを書き出す

```powershell
python tools/ai/export_web.py `
  artifacts/ai/runs/rtx5060-imitation-v2/policy.pt `
  apps/web/src/ai/cpu-policy-v2.json `
  --sha256 43ea62ac3fbd4c8583cc2c2517a45eb903f2bf5dbbf82e6b03f641565f0b5c64
```

書き出し時は`weights_only=True`の安全ローダー、特徴schema、tensor形状、全値の有限性、checkpoint SHA-256を検証します。ブラウザ側は同じLinear・LayerNorm・SiLUをTypeScriptで再現し、起動時にmetadataと全tensor長を再検査します。Web推論はGPUを必須にしない軽量CPU推論で、GPUは学習に使います。

## テスト

```powershell
python -m unittest discover -s tools/ai/tests -v
python -m compileall -q tools/ai
```

Web側の`cpuPlayer.test.ts`はPyTorchの参照logitとの数値一致、合法候補だけからのNN選択、CPUを含む対局の終局とrules invariantを検査します。

入力特徴は固定長の観測特徴と候補特徴です。候補数は局面ごとに異なるため、batch内でpaddingし、mask後のgrouped cross entropyで各decisionの候補集合内だけを比較します。
