// codex に渡すプロンプト（調査 / 台本 / 背景画像）。
//
// 編集方針（2026-10-06 本人指示）
//   1. 日本の報道に寄せない。世界中の情報を、特定の立場のフィルターを通さずフラットに集める
//   2. その上で「日本で暮らす人がどう受け止め、どう動くか」を着眼点にまとめる
//   3. 実行した時点でいちばん新しいニュースを出す（古い話題の焼き直しは禁止）
//   4. ジャンルはニュース番組のように幅広く（国際・政治・経済・社会・科学技術・環境災害・医療・文化・スポーツ）
'use strict';

const { GENRES } = require('./config.js');

// まず当たる情報源。地域と言語を散らし、ひとつの国の視点に偏らないようにする。
// ここに無い媒体も検索で探してよい（現地語の一次情報を優先）。
const SOURCES = [
  { region: '国際通信社', items: ['Reuters', 'AP News', 'AFP', 'Bloomberg'] },
  { region: '北米', items: ['The New York Times', 'The Washington Post', 'CBC News (カナダ)', 'NPR'] },
  { region: '欧州', items: ['BBC', 'The Guardian', 'Financial Times', 'Deutsche Welle', 'Le Monde', 'El Pais', 'ANSA'] },
  { region: '中東・アフリカ', items: ['Al Jazeera', 'Haaretz', 'Daily Maverick (南ア)', 'Al-Ahram'] },
  { region: 'アジア', items: ['South China Morning Post', 'Caixin', 'The Hindu', 'Channel NewsAsia', 'Yonhap', 'Kompas', 'The Straits Times'] },
  { region: '中南米・オセアニア', items: ['Folha de S.Paulo', 'El Universal', 'ABC News (豪)', 'RNZ'] },
  { region: 'ロシア・中央アジア', items: ['Meduza', 'The Moscow Times', 'TASS（公式発表の確認用）'] },
  { region: '日本', items: ['NHK', '共同通信', '日本経済新聞', '気象庁', '首相官邸'] },
  { region: '公的機関', items: ['WHO', 'IMF', '国連', '各国の中央銀行・統計局', '各国気象当局'] },
];

function genreLines(keys) {
  return GENRES.filter((g) => keys.includes(g.key)).map((g) => `- ${g.key}: ${g.label}`).join('\n');
}

function sourcesBlock() {
  return '## まず当たる情報源（地域を散らす）\n' + SOURCES.map((s) => `- ${s.region}: ${s.items.join(' / ')}`).join('\n') +
    '\n- 現地のことは現地語の一次情報（政府発表・現地紙）を優先し、英語・日本語の二次情報で裏取りする。\n';
}

function jsonWriteBlock(outPath) {
  return `\n## 出力\n完成した JSON を **UTF-8 でファイル ${outPath} に書き込む**（ファイル書き込みが最優先。加えて同じ JSON を標準出力にも出す）。JSON 以外の文章は出力しない。\n`;
}

/** 1. 調査: 世界のニュースをフラットに集め、日本で暮らす視点の着眼点を付けて news.json にする */
function researchPrompt(brief, outPath, nowStr) {
  const n = brief.itemCount;
  return `あなたは国際報道のデスクです。ライブ Web 検索が使えます。これから **今日（${nowStr}）時点でいちばん新しい世界のニュース** を集め、ニュース番組 1 本分の素材 JSON を作ります。

## 編集方針（最重要・必ず守る）
1. **日本の報道に寄せない。** 日本の媒体だけを見て「世界」を語らない。各地域の現地メディア・国際通信社・公的機関を **英語以外の言語も含めて** 検索し、世界中の出来事を同じ重さで並べる。特定の国・陣営・政治的立場の見方を事実のように書かない。対立がある出来事は、関係する側の主張をそれぞれ短く併記する。
2. **新しさを最優先。** 原則として過去 24 時間以内（遅くとも 48 時間以内）に報じられた出来事だけを扱う。各ニュースに **報道日時（publishedAt）** を必ず付け、確認できない古い話題は入れない。同じ出来事の続報は最新の状態で書く。
3. **ジャンルはニュース番組のように幅広く。** 下のジャンルから偏りなく拾い、1 ジャンルに 3 本以上集中させない。指定ジャンルは次のとおり:
${genreLines(brief.genres)}
4. **「日本で暮らす上でどう受け止めるか」を着眼点にする。** 各ニュースに japanAngle（日本に住む人への影響・生活や仕事での具体的な動き方・見ておくべき指標や日付）を書く。影響が薄いものは「直接の影響は小さい。ただし……」のように正直に書く。番組の締めとして japanOutlook（世界全体を踏まえて、日本で過ごす上で今週どう構えるか）をまとめる。
5. **事実と出典。** 数字・固有名詞・発言は出典ページに書いてあるとおりに書く。推測は「見方」として分ける。各ニュースに出典 URL を 2 つ以上（できれば異なる国・言語の媒体）。確認できなかった点は unverified に書く。
6. **文章は日本語。** 短文、前置きなし、敬語不要、絵文字なし。固有名詞は日本語表記（必要なら原語を括弧で添える）。
${brief.focus ? `7. 追加の着眼点: ${brief.focus}\n` : ''}
${sourcesBlock()}
## 進め方
1. ジャンルごとに、少なくとも 3 つの地域・2 つ以上の言語で「今日のトップニュース」を検索する（例: "top news today" / "últimas noticias" / "最新新闻" / "أخبار اليوم" / "aktuelle Nachrichten"）。
2. 候補を 15〜20 本集め、新しさ・世界的な重要度・ジャンルの偏りを見て **${n} 本** に絞る。
3. 各本について出典ページを開き、事実・日時・数字を確認する。
4. japanAngle と japanOutlook を書く。
5. JSON を書き出す。

## JSON の形（キー名はこのまま）
{
  "date": "${nowStr}",
  "headline": "番組タイトル（20 字以内。今日の世界を一言で）",
  "lead": "冒頭 2〜3 文。今日の世界の全体像",
  "items": [
    {
      "no": 1,
      "genre": "ジャンル key（上の一覧から）",
      "region": "地域・国",
      "title": "見出し（25 字以内）",
      "summary": "何が起きたか。3〜4 文。事実のみ",
      "perspectives": "対立や複数の見方があれば各側の主張を 1 文ずつ。無ければ空文字",
      "japanAngle": "日本で暮らす人への影響と具体的な動き方。2〜3 文",
      "publishedAt": "報道日時（ISO8601。例 2026-10-06T03:20:00Z）",
      "sources": [ { "title": "記事見出し", "publisher": "媒体名", "lang": "言語コード", "url": "https://..." } ]
    }
  ],
  "japanOutlook": {
    "summary": "世界全体を踏まえ、日本で過ごす上で今週どう構えるか。3〜4 文",
    "actions": ["具体的な行動・確認すること（3〜5 個）"]
  },
  "unverified": ["確認できなかった点"],
  "sources": [ { "title": "...", "publisher": "...", "lang": "...", "url": "https://...", "accessedAt": "ISO8601" } ]
}

- items は新しさと重要度で並べる。no は 1 から。
- sources（全体）は items の出典を重複なくまとめたもの。
${jsonWriteBlock(outPath)}`;
}

/** 2. 台本: news.json を、ナレーション付きシーン構成（script.json）にする */
function scriptPrompt(brief, news, outPath) {
  const target = brief.durationSec;
  const perItem = Math.max(8, Math.round((target - 20) / Math.max(1, news.items.length)));
  // VOICEPEAK の実測: 速度 1.15 で 1 秒あたり約 6.5〜7 文字
  const charsPerItem = Math.round(perItem * 6.5);
  const portrait = brief.aspect === '9:16';
  return `あなたはニュース番組の構成作家です。下の素材 JSON（今日の世界ニュース）から、ナレーション動画の台本 JSON を作ります。読み上げは合成音声、画面には解説キャスター（キャラクター）が立って吹き出しで一言添えます。画面は ${portrait ? '縦長（9:16・スマホ向け）' : '横長（16:9）'}、背景は 1 シーン 1 枚のイラストです。

## 構成
- 目標の長さ: 約 ${target} 秒。
- シーン構成: opening（1 本・番組タイトルと今日の全体像、12 秒前後）→ news（素材の items を no 順に 1 本 1 シーン、各 ${perItem} 秒前後）→ japan（締め: 日本で過ごす上での構え、15 秒前後）→ closing（1 本・ひと言で終わる、5 秒前後）。
- ナレーションは **1 シーン ${charsPerItem} 文字前後**（opening は 80 文字前後、japan は 100 文字前後、closing は 30 文字前後）。読み上げ 1 秒あたり約 6.5 文字で計算している。長すぎると尺が伸びるので守る。
- news シーンの narration は「どこで・何が起きたか（事実）→ 日本で暮らす人にとっての意味（japanAngle）」の順。感情的な形容は入れず、落ち着いたアナウンサー口調（です・ます）。
- 数字・固有名詞は素材のとおり。素材に無いことを足さない。
- 読み上げで誤読しやすい語（英字略語・地名）は、narration ではカタカナや読みやすい表記に直してよい（subtitle は正式表記のまま）。

## 各シーンのキー
{
  "no": 1,
  "kind": "opening | news | japan | closing",
  "genre": "news のときジャンル key。他は空",
  "hookText": "画面上部の大見出し。1 行 9 字以内（漢字が多いときは 8 字）、\\n で最大 2 行。news は『ジャンル名\\n見出し』の形（例『経済\\n米金利 据え置き』）",
  "narration": "読み上げ本文",
  "subtitle": "画面下部の字幕。narration の要約 1 文、28 字以内",
  "speech": "画面に立つ解説キャスターの吹き出しに出す一言（縦書き・20 字以内）。news は『日本で暮らす人への一言アドバイス』、opening は挨拶、japan は構えの要点、closing は締めの一言",
  "expression": "キャスターの表情: normal（落ち着き）/ present（見出しを示す）/ think（考える）/ serious（深刻な話題）のどれか",
  "imagePrompt": "背景イラストの英語プロンプト。写実的すぎない報道イラスト風。文字・ロゴ・実在の人物の顔・国旗の大写しは入れない。例: 'Editorial illustration of a container port at dawn, cranes and cargo ships, muted blue and amber palette, no text'"
}

## 出力 JSON
{ "title": "番組タイトル（素材の headline を元に）", "scenes": [ ...上の形... ] }
${jsonWriteBlock(outPath)}
## 素材 JSON
${JSON.stringify(news, null, 2)}
`;
}

/** 3. 背景画像: 各シーンの imagePrompt から image_gen で PNG を作る */
function imagesPrompt(brief, scenes, scenesDir) {
  const portrait = brief.aspect === '9:16';
  const size = portrait ? '1024x1536（縦長）' : '1536x1024（横長）';
  const list = scenes.map((s) => `- scene_${String(s.no).padStart(2, '0')}_bg.png : ${s.imagePrompt}`).join('\n');
  return `あなたは報道番組の美術担当です。内蔵の image_gen ツールで、下の各シーンの背景イラストを **1 枚ずつ** 生成し、指定のファイル名で ${scenesDir} に保存してください。

## ルール
- サイズは ${size}。全シーン同じ画風（editorial illustration、落ち着いた配色、過度に写実的でない）で統一する。
- 画像に文字・ロゴ・ウォーターマーク・実在の人物の顔を入れない。国旗を主役にしない。
- 1 シーン 1 枚。既にファイルが存在するシーンは飛ばしてよい。
- 生成に失敗したら、そのシーンだけプロンプトを少し簡単にして 1 回やり直す。
- すべて保存したら、保存したファイル名を 1 行ずつ出力して終了する。説明文は不要。

## シーン一覧（ファイル名 : プロンプト）
${list}
`;
}

module.exports = { SOURCES, researchPrompt, scriptPrompt, imagesPrompt };
