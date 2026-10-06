// 番組制作パイプライン:
//   research（codex --search で世界のニュースを収集）→ script（codex で台本）→ images（codex image_gen で背景）
//   → render（Short Movie の /api/render で音声合成＋動画化）→ upload（YouTube Studio に Playwright で投稿）→ report
// 生成 AI は codex CLI（サブスク）のみ。有料 API は使わない。
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const store = require('./store.js');
const render = require('./render.js');
const prompts = require('./prompts.js');
const sm = require('./shortmovie.js');
const { which, runCodex, cleanCodexOutput, extractJSON } = require('./codex.js');

const ROOT = path.resolve(__dirname, '..', '..');
const YT_PROFILE_DIR = path.join(os.homedir(), '.ytupload-data', 'profile');
const FREE_MAX_SEC = 60;
const FREE_MAX_ITEMS = 3;

const STAGES = ['research', 'script', 'images', 'render', 'upload', 'report'];
const STAGE_LABEL = {
  research: '世界のニュースを多言語で検索・確認中（codex）',
  script: '台本を作成中（codex）',
  images: '背景イラストを生成中（codex image_gen）',
  render: '音声合成と動画レンダリング中（Short Movie）',
  upload: 'YouTube に投稿中',
  report: '記録を書き出し中',
};
const STAGE_PROGRESS = { research: 10, script: 35, images: 45, render: 65, upload: 88, report: 97 };

// --- ジョブ管理（メモリ内。画面は /api/jobs でポーリング） ---
const jobs = [];
let seq = 0;
function newJob(label, projectId) {
  const j = { id: ++seq, label, projectId, stage: 'queued', stageLabel: '待機中', progress: 0, detail: '', error: '', createdAt: Date.now(), updatedAt: Date.now() };
  jobs.unshift(j);
  while (jobs.length > 50) jobs.pop();
  return j;
}
function setStage(j, stage, label, progress, detail) {
  j.stage = stage; j.stageLabel = label;
  if (progress !== undefined && progress !== null) j.progress = progress;
  if (detail !== undefined) j.detail = detail;
  j.updatedAt = Date.now();
}
function listJobs() { return jobs; }

// 直列実行（codex と Short Movie を同時に走らせない）
let chain = Promise.resolve();
function enqueue(fn) {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}
function waitIdle() { return chain; }

function nowStr() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  const tz = -d.getTimezoneOffset();
  const sign = tz >= 0 ? '+' : '-';
  const tzs = `${sign}${z(Math.floor(Math.abs(tz) / 60))}:${z(Math.abs(tz) % 60)}`;
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())} (${tzs})`;
}

function setProjectStatus(cfg, project, status, label, error) {
  project.status = status; project.statusLabel = label; project.error = error || '';
  store.saveProject(cfg.dataDir, project);
}

async function ensureCodex() {
  if (!(await which('codex'))) throw new Error('codex CLI が見つかりません。brew install codex（または npm i -g @openai/codex）のあと codex login してください。');
}

/** codex に JSON を書かせて読み戻す（通信切れ対策で 1 回だけやり直す） */
async function codexJSON(cfg, prompt, outPath, cwd, job, search) {
  await ensureCodex();
  try { fs.rmSync(outPath, { force: true }); } catch {}
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  let cx, gen;
  for (let attempt = 1; attempt <= 2; attempt++) {
    cx = await runCodex(prompt, {
      cwd, search: !!search, model: cfg.codexModel || undefined,
      onLine: (l) => { if (job && l.trim()) job.detail = l.trim().slice(0, 140); },
    });
    gen = store.readJSON(outPath, null);
    if (!gen) gen = extractJSON(cleanCodexOutput(cx.out)) || extractJSON(cleanCodexOutput(cx.err));
    if (gen && typeof gen === 'object') return gen;
    if (attempt === 1 && job) setStage(job, job.stage, job.stageLabel, job.progress, '通信が切れたため、もう一度やり直しています');
  }
  const noise = cleanCodexOutput(cx.err).slice(-400) || cleanCodexOutput(cx.out).slice(-400);
  throw new Error(`codex から JSON を取得できませんでした（通信状態、codex login、codex が 0.150 以上かを確認してください）。code=${cx.code} ${noise}`);
}

// ---- 各ステージ ----

async function stageResearch(cfg, project, job) {
  setStage(job, 'research', STAGE_LABEL.research, STAGE_PROGRESS.research, '世界各地の報道を検索するため 5〜15 分ほどかかります');
  const outPath = path.join(project.dir, 'work', 'news.json');
  const news = await codexJSON(cfg, prompts.researchPrompt(project.brief, outPath, nowStr()), outPath, project.dir, job, true);
  if (!Array.isArray(news.items) || news.items.length < 3) throw new Error('ニュースが 3 本未満しか集まりませんでした。時間をおいて再実行してください。');
  news.items = news.items.map((it, i) => Object.assign({}, it, { no: i + 1, sources: Array.isArray(it.sources) ? it.sources : [] }));
  if (!Array.isArray(news.sources)) news.sources = [];
  if (!Array.isArray(news.unverified)) news.unverified = [];
  project.news = news;
  if (news.headline) project.title = `${news.date ? news.date.slice(0, 10) + ' ' : ''}${news.headline}`.trim();
  fs.writeFileSync(path.join(project.dir, 'news.json'), JSON.stringify(news, null, 2));
  project.outputs.news = 'news.json';
  store.saveProject(cfg.dataDir, project);
}

async function stageScript(cfg, project, job) {
  if (!project.news) throw new Error('調査結果（news.json）がありません');
  setStage(job, 'script', STAGE_LABEL.script, STAGE_PROGRESS.script, '');
  const outPath = path.join(project.dir, 'work', 'script.json');
  const script = await codexJSON(cfg, prompts.scriptPrompt(project.brief, project.news, outPath), outPath, project.dir, job, false);
  if (!Array.isArray(script.scenes) || script.scenes.length < 2) throw new Error('台本のシーンが作れませんでした');
  script.scenes = script.scenes.map((s, i) => ({
    no: i + 1,
    kind: s.kind || 'news',
    genre: s.genre || '',
    hookText: String(s.hookText || '').trim(),
    narration: String(s.narration || '').trim(),
    subtitle: String(s.subtitle || '').trim().slice(0, 40),
    imagePrompt: String(s.imagePrompt || 'Editorial illustration, calm news studio background, muted palette, no text').trim(),
    speech: String(s.speech || '').trim(),
    expression: String(s.expression || '').trim().toLowerCase(),
    speaker: s.kind === 'comment' || String(s.speaker || '').toLowerCase() === 'commentator' ? 'commentator' : 'caster',
  })).filter((s) => s.narration);
  if (project.brief.useCommentator === false) script.scenes = script.scenes.filter((s) => s.kind !== 'comment');
  script.scenes.forEach((s, i) => { s.no = i + 1; });
  // 台本を作り直すとシーン番号が変わるので、前の背景画像は退避して作り直す
  if (project.script) {
    const scenesDir = path.join(project.dir, 'scenes');
    const bak = path.join(project.dir, 'work', `scenes-${Date.now()}`);
    try { if (fs.existsSync(scenesDir) && fs.readdirSync(scenesDir).length) { fs.renameSync(scenesDir, bak); } } catch { /* 退避できなければそのまま */ }
    fs.mkdirSync(scenesDir, { recursive: true });
  }
  project.script = script;
  fs.writeFileSync(path.join(project.dir, 'script.json'), JSON.stringify(script, null, 2));
  project.outputs.script = 'script.json';
  store.saveProject(cfg.dataDir, project);
}

function scenePng(project, no) { return path.join(project.dir, 'scenes', `scene_${String(no).padStart(2, '0')}_bg.png`); }
/** シーンの背景パス。comment シーンは直前の（画像を持つ）シーンの背景を使う */
function sceneBg(project, scene) {
  const scenes = project.script.scenes;
  let i = scenes.findIndex((x) => x.no === scene.no);
  while (i >= 0 && scenes[i].kind === 'comment') i--;
  return scenePng(project, i >= 0 ? scenes[i].no : scene.no);
}
function imageScenes(project) { return project.script.scenes.filter((s) => s.kind !== 'comment'); }
function missingScenes(project) { return imageScenes(project).filter((s) => !fs.existsSync(scenePng(project, s.no))); }

/** ffmpeg があれば無地の背景を作る（画像生成が失敗したシーンの保険） */
function fallbackPng(project, s) {
  const portrait = project.brief.aspect === '9:16';
  const size = portrait ? '1080x1920' : '1920x1080';
  try {
    execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', `color=c=0x1b2a4a:s=${size}`, '-frames:v', '1', scenePng(project, s.no)], { stdio: 'ignore', timeout: 30000 });
    return fs.existsSync(scenePng(project, s.no));
  } catch { return false; }
}

async function stageImages(cfg, project, job) {
  if (!project.script) throw new Error('台本（script.json）がありません');
  await ensureCodex();
  const scenesDir = path.join(project.dir, 'scenes');
  fs.mkdirSync(scenesDir, { recursive: true });
  for (let attempt = 1; attempt <= 2; attempt++) {
    const miss = missingScenes(project);
    if (!miss.length) break;
    setStage(job, 'images', STAGE_LABEL.images, STAGE_PROGRESS.images, `${miss.length} 枚を生成します（1 枚 1〜2 分）${attempt > 1 ? '・やり直し' : ''}`);
    const timer = setInterval(() => { job.detail = `${imageScenes(project).length - missingScenes(project).length}/${imageScenes(project).length} 枚 完了`; }, 5000);
    try {
      await runCodex(prompts.imagesPrompt(project.brief, miss, scenesDir), { cwd: project.dir, model: cfg.codexModel || undefined, timeout: 40 * 60 * 1000 });
    } finally { clearInterval(timer); }
  }
  const still = missingScenes(project);
  for (const s of still) {
    if (!fallbackPng(project, s)) throw new Error(`背景画像を作れなかったシーンがあります: scene_${s.no}（${s.hookText.replace(/\n/g, ' ')}）。「このステージからやり直す」で再試行してください`);
  }
  if (still.length) job.detail = `${still.length} 枚は無地の背景で代用しました`;
  project.outputs.scenes = 'scenes';
  store.saveProject(cfg.dataDir, project);
}

const CASTER_EXPR = ['normal', 'present', 'think', 'serious'];
const COMMENTATOR_EXPR = ['normal', 'nod', 'think', 'surprised'];

/** フォルダ内の「<名前>_<表情>.png」を名前ごとにまとめる { name: { expr: path } } */
function scanCharacters(dir) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /\.(png|webp)$/i.test(f)).sort(); } catch { return {}; }
  const out = {};
  for (const f of files) {
    const m = f.match(/^([^_]+)_([^.]+)\./);
    if (!m) continue;
    const name = m[1].toLowerCase();
    (out[name] = out[name] || {})[m[2].toLowerCase()] = path.join(dir, f);
  }
  return out;
}
function fillExpr(map, exprs) {
  if (!map) return null;
  const any = map.normal || Object.values(map)[0];
  if (!any) return null;
  const out = Object.assign({}, map);
  for (const e of exprs) if (!out[e]) out[e] = any;
  return out;
}

/** 解説キャラの画像を探す。{ caster: {expr: path}, commentator: {expr: path} }。無ければ null */
function resolveCharacters(brief) {
  const bundled = scanCharacters(path.join(ROOT, 'public', 'characters'));
  let caster = bundled.caster || null;
  let commentator = bundled.commentator || null;
  if (brief.charactersDir) {
    const custom = scanCharacters(brief.charactersDir);
    const names = Object.keys(custom);
    if (names.length) {
      // 自前フォルダ: caster / commentator という名前があればそれ、無ければ 1 人目をキャスター、2 人目をコメンテーターに
      caster = custom.caster || custom[names[0]] || caster;
      commentator = custom.commentator || (names.length > 1 ? custom[names[1]] : null) || commentator;
    }
  }
  caster = fillExpr(caster, CASTER_EXPR);
  commentator = fillExpr(commentator, COMMENTATOR_EXPR);
  if (!caster && !commentator) return null;
  return { caster: caster || commentator, commentator: commentator || caster };
}

function buildPayload(project, lic) {
  const brief = project.brief;
  const portrait = brief.aspect === '9:16';
  const styleOf = { opening: 'navy', news: 'yellow', japan: 'red', closing: 'white' };
  const chars = brief.useCharacter === false ? null : resolveCharacters(brief);
  let side = 'right';
  const scenes = project.script.scenes.map((s) => {
    const isComment = s.kind === 'comment';
    const scene = {
      no: s.no,
      durationSec: Math.max(3, Math.round(s.narration.length / 6.5) + 1),
      bgPath: sceneBg(project, s),
      narration: s.narration,
      speaker: isComment ? 'commentator' : 'caster',
      speech: '',
      subtitle: s.subtitle,
      hookText: s.hookText || undefined,
      hookStyle: styleOf[isComment ? 'news' : s.kind] || 'navy',
      characterScale: 'none',
    };
    if (chars) {
      const who = isComment ? chars.commentator : chars.caster;
      const exprs = isComment ? COMMENTATOR_EXPR : CASTER_EXPR;
      const e = String(s.expression || '').toLowerCase();
      const expr = exprs.includes(e) ? e : (s.kind === 'news' ? 'present' : 'normal');
      scene.characterPath = who[expr];
      // キャスターとコメンテーターは反対側に立つ（news の右にコメンテーターが左から口を挟む）。news ごとに左右を入れ替える
      if (!isComment) side = side === 'right' ? 'left' : 'right';
      scene.characterSide = isComment ? (side === 'right' ? 'left' : 'right') : side;
      // 縦長は本文イラストが見えるよう news は小さめ。ちびキャラ（正方形）は常に小さめ
      scene.characterScale = isComment || (portrait && s.kind === 'news') ? 'small' : 'normal';
      scene.speech = String(s.speech || '').trim().slice(0, 28);
    }
    return scene;
  });
  const payload = {
    scenes,
    width: portrait ? 1080 : 1920,
    height: portrait ? 1920 : 1080,
    fps: 30,
    subtitlePreset: 'standard',
  };
  if (lic.mode === 'free') payload.creditText = lic.freeCredit;
  return payload;
}

async function stageRender(cfg, lic, project, job) {
  if (!project.script) throw new Error('台本（script.json）がありません');
  const miss = missingScenes(project);
  if (miss.length) throw new Error(`背景画像が無いシーンがあります（${miss.map((s) => s.no).join(', ')}）。「背景イラスト」からやり直してください`);
  setStage(job, 'render', STAGE_LABEL.render, STAGE_PROGRESS.render, 'Short Movie を確認しています');
  const port = await sm.ensureShortMovie(cfg, (m) => { job.detail = m; });
  const brief = project.brief;
  const smBrief = {
    theme: project.title,
    durationSec: brief.durationSec,
    aspect: brief.aspect,
    vibe: 'ニュース番組',
    characterRefPaths: [],
    useVoice: true,
    voiceEngine: 'voicepeak',
    voicevoxSpeakerId: 3,
    voicepeakNarrator: brief.narrator,
    speakerSpeed: brief.speakerSpeed,
    subtitlePreset: 'standard',
    characterVoices: {
      caster: { engine: 'voicepeak', voicepeakNarrator: brief.narrator, speakerSpeed: brief.speakerSpeed },
      commentator: { engine: 'voicepeak', voicepeakNarrator: brief.commentatorNarrator || 'Japanese Male 2', speakerSpeed: Math.min(2, brief.speakerSpeed + 0.05) },
    },
  };
  const payload = buildPayload(project, lic);
  fs.writeFileSync(path.join(project.dir, 'work', 'payload.json'), JSON.stringify(payload, null, 2));
  const outPath = path.join(project.dir, 'movie.mp4');
  try { fs.rmSync(outPath, { force: true }); } catch {}
  const done = await sm.renderViaShortMovie(port, { brief: smBrief, payload, outPath }, (t) => { job.detail = String(t).slice(0, 140); });
  if (!fs.existsSync(outPath)) {
    if (done && done.mp4Path && fs.existsSync(done.mp4Path)) fs.copyFileSync(done.mp4Path, outPath);
    else throw new Error('movie.mp4 を受け取れませんでした');
  }
  project.outputs.mp4 = 'movie.mp4';
  project.video = { durationSec: done.durationSec, sizeMB: done.sizeMB, shortMovieId: done.id, renderedAt: Date.now() };
  store.saveProject(cfg.dataDir, project);
}

function youtubeLoggedIn() { return fs.existsSync(YT_PROFILE_DIR); }

function runUploadScript(args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'youtube-upload.mjs'), ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve({ error: 'アップロードがタイムアウトしました（20 分）' }); }, timeoutMs || 20 * 60 * 1000);
    child.on('close', () => {
      clearTimeout(timer);
      const m = out.match(/RESULT (\{.*\})/);
      if (!m) { resolve({ error: 'アップロード結果が取得できませんでした: ' + (err.trim().split('\n').pop() || out.trim().split('\n').pop() || '').slice(0, 300) }); return; }
      try { resolve(JSON.parse(m[1])); } catch { resolve({ error: 'アップロード結果のパースに失敗' }); }
    });
    child.on('error', (e) => { clearTimeout(timer); resolve({ error: String(e) }); });
  });
}

async function stageUpload(cfg, project, job) {
  const mp4 = path.join(project.dir, 'movie.mp4');
  if (!fs.existsSync(mp4)) throw new Error('movie.mp4 がありません');
  if (!youtubeLoggedIn()) throw new Error('YouTube にログインしていません。設定タブの「YouTube にログイン」を一度実行してください（動画はローカルにあります: ' + mp4 + '）');
  setStage(job, 'upload', STAGE_LABEL.upload, STAGE_PROGRESS.upload, 'YouTube Studio を開いています（5〜10 分）');
  const title = render.youtubeTitle(project);
  const description = render.youtubeDescription(project);
  fs.writeFileSync(path.join(project.dir, 'description.txt'), `${title}\n\n${description}`);
  project.outputs.description = 'description.txt';
  const r = await runUploadScript([`--file=${mp4}`, `--title=${title}`, `--description=${description}`, `--privacy=${project.brief.privacy}`]);
  if (r.error) throw new Error(`YouTube 投稿に失敗: ${r.error}（動画はローカルにあります: ${mp4}）`);
  project.youtube = { url: r.url, videoId: r.videoId, privacy: project.brief.privacy, uploadedAt: Date.now() };
  store.saveProject(cfg.dataDir, project);
}

function stageReport(cfg, lic, project, job) {
  setStage(job, 'report', STAGE_LABEL.report, STAGE_PROGRESS.report, '');
  if (!project.outputs.description && project.news) {
    fs.writeFileSync(path.join(project.dir, 'description.txt'), `${render.youtubeTitle(project)}\n\n${render.youtubeDescription(project)}`);
    project.outputs.description = 'description.txt';
  }
  fs.writeFileSync(path.join(project.dir, 'report.html'), render.renderHtml(project, { credit: lic.mode === 'free' ? lic.freeCredit : '' }));
  project.outputs.html = 'report.html';
  store.saveProject(cfg.dataDir, project);
}

async function runFrom(cfg, lic, project, job, fromStage) {
  const start = Math.max(0, STAGES.indexOf(fromStage || 'research'));
  for (const stage of STAGES.slice(start)) {
    project.stage = stage;
    store.saveProject(cfg.dataDir, project);
    if (stage === 'research') await stageResearch(cfg, project, job);
    else if (stage === 'script') await stageScript(cfg, project, job);
    else if (stage === 'images') await stageImages(cfg, project, job);
    else if (stage === 'render') await stageRender(cfg, lic, project, job);
    else if (stage === 'upload') { if (project.brief.upload) await stageUpload(cfg, project, job); }
    else if (stage === 'report') stageReport(cfg, lic, project, job);
  }
}

function runJob(cfg, lic, project, job, fromStage) {
  enqueue(async () => {
    try {
      setProjectStatus(cfg, project, 'running', '制作中');
      await runFrom(cfg, lic, project, job, fromStage);
      project.stage = 'done';
      setProjectStatus(cfg, project, 'done', '完了');
      setStage(job, 'done', '完了', 100, project.youtube ? project.youtube.url : '');
    } catch (e) {
      // 失敗時は report だけ書いておく（途中成果を画面で見られるように）
      try { if (project.news) stageReport(cfg, lic, project, job); } catch {}
      setProjectStatus(cfg, project, 'error', '失敗', e.message);
      job.error = e.message;
      setStage(job, 'error', '失敗', job.progress, '');
    }
  });
}

// ---- 公開 API ----
function submit(cfg, lic, brief) {
  if (lic.mode === 'free') {
    brief.durationSec = Math.min(brief.durationSec, FREE_MAX_SEC);
    brief.itemCount = Math.min(brief.itemCount, FREE_MAX_ITEMS);
  }
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  const project = store.createProject(cfg.dataDir, brief);
  project.dir = path.join(cfg.dataDir, project.id);
  const job = newJob(`番組制作: ${project.title}`, project.id);
  runJob(cfg, lic, project, job, 'research');
  return { project, job };
}

/** 失敗した案件を指定ステージからやり直す（upload だけ再実行、など） */
function resume(cfg, lic, project, fromStage) {
  if (!STAGES.includes(fromStage)) throw new Error('ステージが不正です');
  if (fromStage === 'upload') project.brief.upload = true;
  const job = newJob(`${STAGE_LABEL[fromStage].replace(/（.*$/, '')} からやり直し: ${project.title}`, project.id);
  runJob(cfg, lic, project, job, fromStage);
  return job;
}

async function environment(cfg) {
  const st = sm.shortMovieState(cfg);
  let ffmpeg = false; try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); ffmpeg = true; } catch {}
  const voicepeak = fs.existsSync('/Applications/voicepeak.app/Contents/MacOS/voicepeak') || fs.existsSync('C:\\Program Files\\VOICEPEAK\\voicepeak.exe');
  let playwright = false; try { require.resolve('playwright', { paths: [ROOT] }); playwright = true; } catch {}
  return {
    codex: await which('codex'),
    shortMovieDir: st.dir, shortMovieBuilt: st.built, shortMovieRenderApi: st.hasRenderApi,
    shortMovieRunning: await sm.ping(parseInt(cfg.shortMoviePort, 10) || 4560, '/api/voice-info', 1500),
    voicepeak, ffmpeg, playwright,
    youtubeLogin: youtubeLoggedIn(),
    characters: !!resolveCharacters({ charactersDir: cfg.charactersDir }),
    commentator: !!(resolveCharacters({ charactersDir: cfg.charactersDir }) || {}).commentator,
  };
}

module.exports = { STAGES, STAGE_LABEL, submit, resume, listJobs, waitIdle, environment, youtubeLoggedIn, FREE_MAX_SEC, FREE_MAX_ITEMS };
