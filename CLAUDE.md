@AGENTS.md

## ターミナルで直接指示されたときの動作（重要・追加運用）

このフォルダで Claude Code を開き、ユーザーが「ニュースを作って」「今日の世界ニュース動画を作って」「投稿して」と言ったら、Web UI への入力を待たず、**このツール（世界ニュースの収集→台本→背景→動画→投稿）として成果物を一気に作り切る**。

1. **仕様を把握する**: `lib/news/prompts.js`（編集方針・情報源）と `lib/news/config.js`（brief のキー）を読む
2. **依頼 JSON を作る**: `examples/sample-daily.json` と同じ形で一時ファイルに書く（投稿は明示されたときだけ `upload: true`）
3. **実行する**: `node bin/cli.js run <JSON>`（完了まで 30〜50 分。進行は標準出力に出る）
4. **報告する**: `~/NewsMovie-data/<案件ID>/` の `news.json` から見出しと「日本で暮らす視点」を数行、`movie.mp4` と `report.html` のパス、投稿していれば YouTube URL

ニュースの中身を自分の知識で書かない。必ず codex `--search` の結果（出典 URL 付き）を使う。有料 API は使わない。
