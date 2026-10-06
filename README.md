# ニュース動画メーカー 〜世界の今を、日本で暮らす目で〜

世界各地の報道を **多言語で集めてフラットにまとめ**、その上で「日本で暮らす人がどう受け止め、どう動くか」を添えたニュース番組動画を作り、YouTube に投稿するローカルツール。

- 調査・台本・背景イラストは **codex CLI（ChatGPT サブスク）**。Web 検索も codex の `--search`。有料 API（OpenAI / Gemini 等）は一切使わない
- 音声合成（VOICEPEAK）と動画化（Remotion）は同じアシュラ奥義の **Short Movie** に任せる（自動で起動する）
- YouTube 投稿は手元の Chrome のログインを使う（API キー不要）
- データはすべて `~/NewsMovie-data/` に保存

## 編集方針

1. **日本の報道に寄せない。** 各地域の現地メディア・国際通信社・公的機関を英語以外の言語も含めて検索し、世界中の出来事を同じ重さで並べる。特定の立場の見方を事実のように書かない。対立がある出来事は各側の主張を併記する
2. **実行した時点でいちばん新しいニュース**（原則 24 時間以内）だけを扱い、報道日時と出典 URL を必ず付ける
3. **ジャンルはニュース番組のように幅広く**: 国際・政治 / 経済・市場 / 社会 / テクノロジー・科学 / 環境・災害 / 医療 / 文化 / スポーツ
4. **日本で暮らす視点**: 各ニュースに「日本に住む人への影響と動き方」、番組の締めに「日本で過ごす上での構え」

方針の本文は `lib/news/prompts.js`。ここを直せば次の番組から変わる。

## 解説キャスター

画面には解説キャスター（キャラクター）が立ち、シーンごとに表情（normal / present / think / serious）を変えて吹き出しで一言添える。さらにニュースごとに **コメンテーター（ちびキャラ、別の声）** が一言で解説を挟む（表情は normal / nod / think / surprised。出さない設定も可）。同梱の `public/characters/caster_*.png`・`commentator_*.png` が既定。自分のキャラにしたいときは設定の「キャラクター画像のフォルダ」に `名前_表情.png`（透過 PNG）を置いたフォルダを指定する（Short Movie の `public/characters` もそのまま使える）。出さない設定もできる。

## 流れ

| ステージ | 何をするか | 使うもの |
|---|---|---|
| research | 世界のニュースを多言語で検索し、出典付き JSON に | codex `--search` |
| script | ナレーション台本（opening → news × N → japan → closing） | codex |
| images | シーンごとの背景イラスト（1024x1536 / 1536x1024） | codex image_gen |
| render | 音声合成 → 字幕・見出し付きで mp4 化 | Short Movie `/api/render` |
| upload | タイトル・説明文（出典 URL 付き）を付けて投稿 | Playwright + Chrome |
| report | 記録ページ `report.html` | — |

失敗した案件は画面の「ステージを指定してやり直す」で続きから作れる（投稿だけやり直す等）。

## 起動

```bash
npm install          # 初回のみ（YouTube 投稿に使う playwright）
node bin/cli.js
```

既定ポート 4593（使用中なら自動で次の空きポート）。ブラウザが自動で開く。
スラッシュコマンド: `/newsmovie`。会員向け起動スクリプト: `bash ashura-start.sh`

## 事前準備（macOS）

```bash
brew install codex && codex login    # 0.150 以上
# Short Movie を導入して一度起動しておく（ビルドされる）。VOICEPEAK が必要
node bin/cli.js login-youtube        # 投稿する場合のみ。Chrome でログインして Cmd+Q
```

## コマンドライン（自動化・AI モード）

```bash
node bin/cli.js run                            # 設定どおりに 1 本作る
node bin/cli.js run examples/sample-daily.json # 依頼ファイルで上書き
node bin/cli.js schedule 07:30                 # 毎日 7:30 に自動制作（macOS launchd）
node bin/cli.js schedule off                   # 解除
```

成果物は `~/NewsMovie-data/<案件ID>/` に `movie.mp4`・`report.html`・`news.json`・`script.json`・`description.txt`・`scenes/`。

## 注意

- 調査は配信時点の報道に基づく。数字や固有名詞は出典ページのとおりに書かせているが、投稿前に `report.html` で一度確認することを勧める
- 1 本あたり 30〜50 分（調査 5〜15 分、台本と背景 10〜20 分、動画化 5〜15 分）
- フリー版は 60 秒・3 本まで＋クレジット表示。アシュラ会員は画面のメール認証でフル版

## ライセンス

`LICENSE.md` 参照。
