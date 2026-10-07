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
  shortMoviePort: '4561',          // 仕事管理の自動投稿が使う 4560 とは分ける（2026-10-07）
  // 番組づくり
  genres: GENRES.filter((g) => !g.defaultOff).map((g) => g.key).join(','),
  edition: 'world',               // world（世界）/ japan（日本）
  programName: 'フラットな視点で世界を眺めるニュース',
  // 番組の最後の宣伝（固定シーン）。空なら出さない
  usePromo: 'true',
  promoNarration: 'この番組は、AIが集めた情報から台本と絵と声まで自動で作っています。AIで自動化や制作をしたい方はアシュラへ。AIが学べる本も出しています。リンクは概要欄に。',  // 短く（ショートの尺に収める。VOICEPEAK は 140 字まで）
  promoHook: 'AIで自動化したいなら\nアシュラ',
  promoSpeech: 'リンクは概要欄に',
  promoSubtitle: 'アシュラのリンクは概要欄にあります。',
  ashuraUrl: 'https://service.if-juku.net/Ashura',
  // 自分のサイト・本の宣伝リンク（説明欄に載る）。空なら出さない。自分の分は設定（config.json）に入れる
  siteUrl: '',
  siteLabel: '公式サイト',
  bookUrl: '',
  bookLpUrl: '',
  bookTitle: '',
  itemCount: '5',                 // 取り上げるニュース本数（縦ショートは 5 本が目安）
  durationSec: '165',             // 目標尺（秒）。縦ショートは YouTube の上限 3 分に収めるため 165 秒
  aspect: '9:16',                 // 9:16（縦ショート・3 分以内）/ 16:9（横ロング）
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
  commentatorPitch: '100',        // コメンテーターの声の高さ（-300〜300）。低くて聞き取りにくいので少し上げる（2026-10-07 本人要望）
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
    links: { ashura: String(pick('ashuraUrl') || ''), site: String(pick('siteUrl') || ''), book: String(pick('bookUrl') || ''), bookLp: String(pick('bookLpUrl') || ''), bookTitle: String(pick('bookTitle') || ''), siteLabel: String(pick('siteLabel') || '') },
    itemCount: Math.min(12, Math.max(3, parseInt(pick('itemCount'), 10) || 5)),
    durationSec: Math.min(600, Math.max(45, parseInt(pick('durationSec'), 10) || 165)),
    aspect: pick('aspect') === '16:9' ? '16:9' : '9:16',
    // 縦（9:16）は YouTube ショート扱いになるよう 3 分以内に収める（上限は 180 秒。余裕を見て 175）
    shortMaxSec: 175,
    focus: String(pick('focus') || '').trim(),
    narrator: String(pick('narrator') || 'Japanese Female 1'),
    speakerSpeed: Math.min(2, Math.max(0.5, parseFloat(pick('speakerSpeed')) || 1.5)),
    useCharacter: String(pick('useCharacter')) !== 'false',
    charactersDir: String(pick('charactersDir') || ''),
    useCommentator: String(pick('useCommentator')) !== 'false',
    commentatorNarrator: String(pick('commentatorNarrator') || 'Japanese Male 2'),
    commentatorPitch: Number(pick('commentatorPitch') ?? 100) || 0,
    upload: String(pick('upload')) === 'true',
    privacy: ['PUBLIC', 'UNLISTED', 'PRIVATE'].includes(String(pick('privacy')).toUpperCase()) ? String(pick('privacy')).toUpperCase() : 'PUBLIC',
    channelTag: String(pick('channelTag') || ''),
    titlePrefix: String(pick('titlePrefix') || ''),
  };
}

module.exports = { loadConfig, saveConfig, briefFrom, CONFIG_PATH, DEFAULTS, GENRES, EDITIONS };
