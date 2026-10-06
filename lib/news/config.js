// 設定（~/NewsMovie-data/config.json）。Node 標準のみ。
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_DATA_DIR = path.join(os.homedir(), 'NewsMovie-data');
const CONFIG_PATH = path.join(DEFAULT_DATA_DIR, 'config.json');

// ニュース番組のように幅広く拾うジャンル（既定は全部オン）
const GENRES = [
  { key: 'world', label: '国際・政治・紛争' },
  { key: 'economy', label: '経済・金融・市場' },
  { key: 'society', label: '社会・事件・暮らし' },
  { key: 'tech', label: 'テクノロジー・AI・科学' },
  { key: 'environment', label: '環境・災害・気象' },
  { key: 'health', label: '医療・健康' },
  { key: 'culture', label: '文化・教育（芸能・ゴシップは扱わない）', defaultOff: true },
  { key: 'sports', label: 'スポーツ（経済・情勢に関わるものだけ）' },
];

// 朝＝世界のニュース / 夜＝日本のニュース
const EDITIONS = {
  world: { label: '世界のニュース', sub: '朝の世界ニュース' },
  japan: { label: '日本のニュース', sub: '夜の日本ニュース' },
};

const DEFAULTS = {
  dataDir: DEFAULT_DATA_DIR,
  codexModel: '',                 // 空なら codex の既定モデル
  shortMovieDir: '',              // 空なら自動探索（隣の ShortMovie / ~/Desktop/ShortMovie）
  shortMoviePort: '4560',
  // 番組づくり
  genres: GENRES.filter((g) => !g.defaultOff).map((g) => g.key).join(','),
  edition: 'world',               // world（世界）/ japan（日本）
  programName: 'フラットな視点で世界を眺めるニュース',
  // 番組の最後の宣伝（固定シーン）。空なら出さない
  usePromo: 'true',
  promoNarration: 'この番組は、AIが世界のニュースを集めて台本と絵を作り、声をつけて投稿するところまで自動で作っています。こんなふうにAIで仕事を自動化したり、ものを作ったりしたい方は、AI学習コミュニティ「アシュラ」へ。AIが学べる本も出しています。リンクは概要欄に置いてあります。',
  promoHook: 'AIで自動化したいなら\nアシュラ',
  promoSpeech: 'リンクは概要欄に',
  promoSubtitle: 'アシュラと本のリンクは概要欄にあります。',
  ashuraUrl: 'https://service.if-juku.net/Ashura',
  siteUrl: 'https://if-juku.net',
  bookUrl: 'https://www.amazon.co.jp/dp/B0H72W6BN8',
  bookLpUrl: 'https://getabako.github.io/ai-native-kyoiku-no-aiueo/',
  bookTitle: 'AIネイティブ教育のあいうえお',
  itemCount: '7',                 // 取り上げるニュース本数
  durationSec: '150',             // 目標尺（秒）
  aspect: '9:16',                 // 9:16（ショート）/ 16:9（通常動画）
  focus: '',                      // 追加の着眼点（任意。例: 秋田で暮らす人向け）
  // 音声
  narrator: 'Japanese Female 1',
  speakerSpeed: '1.5',             // 読み上げ速度。ニュースはテンポよく（2026-10-06 本人要望で 1.15→1.5）
  // 解説キャラ（画面に立つキャスター）。true で出す。charactersDir が空なら同梱の public/characters（caster_*.png）
  useCharacter: 'true',
  charactersDir: '',
  // コメンテーター（ちびキャラ）。キャスターが読んだニュースに一言コメントする
  useCommentator: 'true',
  commentatorNarrator: 'Japanese Male 2',
  // 投稿
  upload: 'false',                // true なら完成後に YouTube へ投稿
  privacy: 'PUBLIC',              // PUBLIC / UNLISTED / PRIVATE
  channelTag: '',                 // 説明欄の末尾に足す文（任意。URL など）
  titlePrefix: '',                // 空なら programName を使う
};

function loadConfig() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) || {}; } catch {}
  const cfg = Object.assign({}, DEFAULTS, saved);
  cfg.dataDir = String(cfg.dataDir || DEFAULT_DATA_DIR).replace(/^~(?=$|\/)/, os.homedir());
  if (cfg.shortMovieDir) cfg.shortMovieDir = String(cfg.shortMovieDir).replace(/^~(?=$|\/)/, os.homedir());
  if (cfg.charactersDir) cfg.charactersDir = String(cfg.charactersDir).replace(/^~(?=$|\/)/, os.homedir());
  return cfg;
}

function saveConfig(patch) {
  const cur = loadConfig();
  const next = Object.assign({}, cur);
  for (const k of Object.keys(DEFAULTS)) {
    if (patch[k] !== undefined && patch[k] !== null) next[k] = String(patch[k]).trim();
  }
  if (!next.dataDir) next.dataDir = DEFAULT_DATA_DIR;
  next.dataDir = next.dataDir.replace(/^~(?=$|\/)/, os.homedir());
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
  return next;
}

/** 設定値と依頼の上書きから、1 回分の番組設定（brief）を作る */
function briefFrom(cfg, over) {
  over = over || {};
  const pick = (k) => (over[k] !== undefined && over[k] !== null && String(over[k]).trim() !== '' ? over[k] : cfg[k]);
  const genres = String(pick('genres') || '').split(',').map((s) => s.trim()).filter((g) => GENRES.some((x) => x.key === g));
  return {
    title: String(over.title || '').trim(),
    genres: genres.length ? genres : GENRES.filter((g) => !g.defaultOff).map((g) => g.key),
    edition: EDITIONS[pick('edition')] ? String(pick('edition')) : 'world',
    programName: String(pick('programName') || DEFAULTS.programName),
    usePromo: String(pick('usePromo')) !== 'false',
    promoNarration: String(pick('promoNarration') || ''),
    promoHook: String(pick('promoHook') || ''),
    promoSpeech: String(pick('promoSpeech') || ''),
    promoSubtitle: String(pick('promoSubtitle') || ''),
    links: { ashura: String(pick('ashuraUrl') || ''), site: String(pick('siteUrl') || ''), book: String(pick('bookUrl') || ''), bookLp: String(pick('bookLpUrl') || ''), bookTitle: String(pick('bookTitle') || '') },
    itemCount: Math.min(12, Math.max(3, parseInt(pick('itemCount'), 10) || 7)),
    durationSec: Math.min(600, Math.max(45, parseInt(pick('durationSec'), 10) || 150)),
    aspect: pick('aspect') === '16:9' ? '16:9' : '9:16',
    focus: String(pick('focus') || '').trim(),
    narrator: String(pick('narrator') || 'Japanese Female 1'),
    speakerSpeed: Math.min(2, Math.max(0.5, parseFloat(pick('speakerSpeed')) || 1.5)),
    useCharacter: String(pick('useCharacter')) !== 'false',
    charactersDir: String(pick('charactersDir') || ''),
    useCommentator: String(pick('useCommentator')) !== 'false',
    commentatorNarrator: String(pick('commentatorNarrator') || 'Japanese Male 2'),
    upload: String(pick('upload')) === 'true',
    privacy: ['PUBLIC', 'UNLISTED', 'PRIVATE'].includes(String(pick('privacy')).toUpperCase()) ? String(pick('privacy')).toUpperCase() : 'PUBLIC',
    channelTag: String(pick('channelTag') || ''),
    titlePrefix: String(pick('titlePrefix') || ''),
  };
}

module.exports = { loadConfig, saveConfig, briefFrom, CONFIG_PATH, DEFAULTS, GENRES, EDITIONS };
