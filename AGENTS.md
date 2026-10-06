# ニュース動画メーカー（NewsMovie）— 作業指示

## 二つの使い方（AIモード / UIモード）— 最初の返答で必ず一言案内する

この奥義には 2 つの使い方がある。ユーザーの最初のメッセージへの返答の冒頭に、次の案内を短く添える（長くしない・毎回は不要）:
「この奥義は 2 通りで使えます。**AIモード**: このチャットに『今日のニュース動画を作って』『投稿までやって』とそのまま頼む。**UIモード**: 『起動して』と送ると操作画面がブラウザで開きます。」

- **AIモード**: ユーザーが「ニュースを作って」「今日の世界ニュース動画を作って」「投稿して」と言ったら、UI を起動せずに、このフォルダの仕組みでチャット上から結果を作り切る。手順:
  1. 依頼内容を `examples/sample-daily.json` と同じ形（`{ "brief": {...} }`）の JSON にまとめて一時ファイルに書く。キーは `lib/news/config.js` の `briefFrom` を参照（`genres` はジャンル key をカンマ区切り、`itemCount` 本数、`durationSec` 秒、`aspect` 9:16/16:9、`upload` true/false、`privacy` PUBLIC/UNLISTED/PRIVATE、`focus` 追加の着眼点）。省略した項目は `~/NewsMovie-data/config.json` の既定値
  2. `node bin/cli.js run <その JSON>` を実行する（完了まで待つ。調査 5〜15 分・台本と背景 10〜20 分・動画化 5〜15 分）
  3. 出力先 `~/NewsMovie-data/<案件ID>/` の `news.json` を読んで要点（見出し・日本で暮らす視点）を伝え、`movie.mp4` と `report.html`、投稿していれば YouTube URL を報告する
  - **編集方針は `lib/news/prompts.js` に書いてある**（世界をフラットに・最新優先・幅広いジャンル・日本で暮らす視点）。ニュースの中身を自分で書かない。必ず codex の `--search` で今日の報道を確かめた結果を使う
  - 投稿（`upload: true`）はユーザーが明示したときだけ。投稿前に公開範囲を確認する
  - ツール自体の改造・カスタマイズもこのモードで行う。**有料 API（OpenAI / Gemini / Claude API 等）は使わない。生成はすべて codex CLI（サブスク）。Web 検索も codex の `--search` のみ。**
- **UIモード**: 「起動して」「UIモード」「画面を開いて」「立ち上げて」等と言われたら、**手順を自分で組み立てず**、次のコマンドをそのまま実行する:
  - macOS / Linux: `bash ashura-start.sh`
  - Windows: `powershell -NoProfile -ExecutionPolicy Bypass -File ashura-start.ps1`

  このスクリプトが Node 確認・依存導入・サーバー起動・ブラウザ表示まで全部行う。最後に出力される `ASHURA_URL=...` の URL を「起動しました: URL」と 1 行で報告する。
  スクリプトが失敗した時だけ、その出力と `.ashura/server.log` を読んで原因を直し、もう一度 `bash ashura-start.sh` を実行する。停止は `bash ashura-start.sh stop`。

## 起動の作法（手動フォールバック。通常は上記 ashura-start.sh を実行する）

1. Node.js 20 以上があるか確認する（`node --version`）。無ければ `brew install node`
2. `npm install`（YouTube 投稿に使う playwright だけ。投稿しないなら省略しても動く）
3. リポジトリ直下で `node bin/cli.js` を実行して起動する（ポート 4593 を起点に空きポートを自動選択）。ブラウザが自動で開く
4. 調査・台本・背景は codex CLI（ChatGPT サブスク）。`codex --version` で確認し、無ければ `brew install codex`、初回は `codex login`。0.150 以上
5. 音声合成と動画化は **Short Movie**（同じアシュラ奥義）を使う。隣のフォルダ `../ShortMovie` か `~/Desktop/ShortMovie` を自動で探し、未起動なら固定ポート 4560 で起動する。Short Movie は一度起動してビルド済みであること（`.next/standalone/server.js`）。VOICEPEAK（`/Applications/voicepeak.app`）が必要
6. YouTube 投稿は `node bin/cli.js login-youtube` で一度 Chrome からログインしておく（プロファイル `~/.ytupload-data/profile`。他の奥義と共有）
7. 毎日の自動制作は `node bin/cli.js schedule 07:30`（macOS launchd）。解除は `schedule off`
8. 会員認証について: フリー版は 60 秒・3 本まで＋クレジット表示。画面のメール認証欄でアシュラ会員のメールアドレスを入れるとフル版

## 仕組み（改造するときに読む）

- `bin/cli.js` — サーバー（静的配信 + `/api/*`、mp4 の Range 配信）と CLI（`run` / `login-youtube` / `schedule`）
- `lib/news/pipeline.js` — research → script → images → render → upload → report の直列パイプライン。失敗した案件はステージ指定で `resume` できる
- `lib/news/prompts.js` — codex に渡すプロンプト。**編集方針はここ**（情報源 `SOURCES`、調査 `researchPrompt`、台本 `scriptPrompt`、背景 `imagesPrompt`）
- `lib/news/shortmovie.js` — Short Movie の探索・起動・`POST /api/render`（SSE）呼び出し
- `lib/news/render.js` — 記録ページ `report.html` と YouTube のタイトル・説明文
- `lib/news/codex.js` — codex 呼び出し。`--search` は **exec の前**に置く（後ろだと落ちる）
- `lib/news/config.js` / `store.js` — 設定と案件の保存（`~/NewsMovie-data/`）
- `scripts/youtube-upload.mjs` — Playwright でログイン済み Chrome プロファイルから YouTube Studio に投稿。`RESULT {...}` を 1 行で返す
- Short Movie 側: `app/api/render/route.ts`（台本と背景画像を受け取り、VOICEPEAK で音声合成→Remotion で mp4）。Short Movie を直したら `pnpm build` が必要
- 素の node 実行なのでこのツール自体はビルド不要。ファイルを直したらサーバーを再起動するだけ
