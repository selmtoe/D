# 実験用AI学習パイプライン

このパイプラインは、決定論的な自己対局ログを教師データにして、小型の候補採点NNをGPUでオフライン学習します。探索を混ぜた各プレイヤーの判断を終局順位で重み付けし、検証済みcheckpointをWeb用JSONへ書き出します。

## 境界

- 合法手の列挙とルール判定は、引き続きTypeScriptの既存rules/authorityが担当します。
- NNは「本人に見える観測」と「合法手候補」を受け、候補ごとにスコアを返します。
- `selected`は候補インデックスの特定、`sampleWeight`は終局順位による損失重みだけに使います。`selectionReason`、適用後状態、authority結果、監査タグ、人間向けcandidate labelは入力特徴に含めません。
- train/validation/testはdecision単位ではなくmatch/seed単位で分割するため、同じ対局の局面が複数splitへ混ざりません。testは最良epochの選択には使いません。

オンライン推論ではNNと軽量な戦術評価を併用します。戦術評価も本人に見える公開情報だけを使い、ブラインド札の表面は参照しません。

## 教師ログ生成

リポジトリルートで次を実行します。

```powershell
pnpm --filter @daifugo/web exec vitest run src/test/qaBotEvidence.test.ts
```

既定はCI向けの24局です。ローカルでv3相当の120局を生成する場合:

```powershell
$env:CPU_SELFPLAY_MATCHES="120"
pnpm ai:selfplay
```

生成物は`artifacts/qa/bot-match-evidence.json`です。大きいためgit管理外ですが、生成コードとseed規則はリポジトリに入っています。

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
  --epochs 60 `
  --batch-size 256 `
  --learning-rate 0.0002 `
  --hidden-dim 128 `
  --validation-fraction 0.2 `
  --test-fraction 0.2 `
  --run-name rtx5060-selfplay-v3
```

`--device cuda`指定時にCUDAが使えない、検証tensorやmodelがCUDA上にない場合は失敗します。外部モデルやデータのダウンロードはありません。

## Google Colab

`tools/ai/DAIFUGO_SELFPLAY_COLAB.ipynb`をColabへアップロードすれば、リポジトリ取得、依存関係導入、自己対局、CUDA学習、Web用JSON書き出しまで実行できます。ColabのGPU種類・利用上限・最大実行時間は固定ではないため、再現性と今回の所要時間ではローカルRTX 5060を標準とします。Colabのローカルランタイムへ接続してこのPCのGPUを使うこともできますが、信頼できるノートブックだけを接続してください。

runディレクトリには以下を保存します。

- `metrics.json`: GPU名、PyTorch/CUDA版、CUDA検証結果、学習時間、dataset SHA-256、match/seed分割、baseline、epoch別指標
- `policy.pt`: 最良validation accuracy時点の`state_dict`と特徴量・モデルmetadata

metricsにはcheckpointのSHA-256、順位重み付き指標、ブラインド局面、多候補局面の指標を記録します。v3の結果は`docs/AI_EXPERIMENT_V3.md`にまとめています。

`policy.pt`はローカルで生成したものだけを読み込んでください。PyTorch checkpointは信頼できない第三者ファイルを読み込む用途には使いません。

## Web用モデルを書き出す

```powershell
python tools/ai/export_web.py `
  artifacts/ai/runs/rtx5060-selfplay-v3/policy.pt `
  apps/web/src/ai/cpu-policy-v3.json `
  --sha256 2dba4efb677c6664ca543b31ce08882dafb7127a6969dd0852dc9486724910f8
```

書き出し時は`weights_only=True`の安全ローダー、特徴schema、tensor形状、全値の有限性、checkpoint SHA-256を検証します。ブラウザ側は同じLinear・LayerNorm・SiLUをTypeScriptで再現し、起動時にmetadataと全tensor長を再検査します。Web推論はGPUを必須にしない軽量CPU推論で、GPUは学習に使います。

## テスト

```powershell
python -m unittest discover -s tools/ai/tests -v
python -m compileall -q tools/ai
```

Web側の`cpuPlayer.test.ts`はPyTorchの参照logitとの数値一致、合法候補だけからのNN選択、CPU対局の終局、ブラインド失格率、rules invariantを検査します。

入力特徴は固定長の観測特徴と候補特徴です。候補数は局面ごとに異なるため、batch内でpaddingし、mask後のgrouped cross entropyで各decisionの候補集合内だけを比較します。
