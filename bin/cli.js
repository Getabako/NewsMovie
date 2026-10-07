#!/usr/bin/env node
/*
 * ニュース動画メーカー 〜世界の今を、日本で暮らす目で〜 — ローカル起動サーバ / コマンドライン制作
 * Node 標準のみで動く（YouTube 投稿だけ playwright を使う）。静的ファイルを配信し、空きポートで起動してブラウザを自動で開く。
 * 調査・台本・背景は codex CLI（サブスク）、音声合成と動画化は Short Movie、投稿は手元の Chrome。有料 API は使わない。
 * データはすべて ~/NewsMovie-data/ に保存（外部送信は YouTube への投稿のみ）。
 *
 *   node bin/cli.js                        … サーバー起動（UI モード）
 *   node bin/cli.js run [brief.json]       … 画面なしで 1 本制作して完了まで待つ（自動化用。省略時は設定どおり）
 *   node bin/cli.js resume <案件ID> <stage> … 失敗した案件を指定ステージから続ける（research/script/images/render/upload/report）
 *   node bin/cli.js login-youtube          … YouTube にログイン（初回のみ）
 *   node bin/cli.js schedule HH:MM         … 毎日 HH:MM に自動制作（macOS launchd）。schedule off で解除
 *   node bin/cli.js config [key=value ...] … 設定（毎日の自動制作の既定値）を表示・変更。例: config genres=all focus=秋田で暮らす人向け
 */
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec, spawn, execFileSync } = require('child_process');

const { resolveLicense, activateByEmail, FREE_CREDIT } = require('../lib/ashura/license.js');
const configMod = require('../lib/news/config.js');
const store = require('../lib/news/store.js');
const pipeline = require('../lib/news/pipeline.js');
const prompts = require('../lib/news/prompts.js');

const ROOT = path.resolve(__dirname, '..');
const START_PORT = parseInt(process.env.PORT || '4593', 10);

// --- アシュラ会員ライセンス ---
let licensePromise = null;
function getLicense() {
  if (!licensePromise) {
    licensePromise = resolveLicense().then((l) => Object.assign(l, { freeCredit: FREE_CREDIT })).catch(() => ({ mode: 'free', message: 'ライセンス判定に失敗したためフリー版で動作します。', freeCredit: FREE_CREDIT }));
  }
  return licensePromise;
}

// --- 共通ヘルパ ---
function sendJSON(res, obj, status) {
  res.writeHead(status || 200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req, limit) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > (limit || 5e6)) req.destroy(); });
    req.on('end', () => resolve(body));
    req.on('error', () => resolve(body));
  });
}
function parseJSONSafe(s, fallback) { try { return JSON.parse(s || ''); } catch { return fallback; } }
function openPath(p) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  exec(`${opener} "${p}"`, () => {});
}

// --- API ---
async function handleActivate(req, res) {
  const body = await readBody(req, 1e5);
  const email = String((parseJSONSafe(body, {}) || {}).email || '');
  try {
    const r = await activateByEmail(email);
    if (r.activated) { licensePromise = null; await getLicense(); }
    sendJSON(res, { activated: r.activated, message: r.message });
  } catch {
    sendJSON(res, { activated: false, message: '認証処理に失敗しました。時間をおいて再度お試しください。' });
  }
}
function handleLicense(req, res) {
  getLicense().then((lic) => sendJSON(res, { mode: lic.mode, message: lic.message, freeCredit: FREE_CREDIT, freeMaxSec: pipeline.FREE_MAX_SEC, freeMaxItems: pipeline.FREE_MAX_ITEMS }));
}
async function handleConfigGet(req, res) {
  const cfg = configMod.loadConfig();
  const env = await pipeline.environment(cfg);
  sendJSON(res, { config: cfg, env, configPath: configMod.CONFIG_PATH, platform: process.platform, genres: configMod.GENRES, sources: prompts.SOURCES, stages: pipeline.STAGES, stageLabels: pipeline.STAGE_LABEL });
}
async function handleConfigPost(req, res) {
  const body = parseJSONSafe(await readBody(req, 1e5), {}) || {};
  const cfg = configMod.saveConfig(body);
  try { fs.mkdirSync(cfg.dataDir, { recursive: true }); } catch {}
  const env = await pipeline.environment(cfg);
  sendJSON(res, { ok: true, config: cfg, env });
}
async function handleCreate(req, res) {
  const cfg = configMod.loadConfig();
  const lic = await getLicense();
  const body = parseJSONSafe(await readBody(req, 1e6), {}) || {};
  const brief = configMod.briefFrom(cfg, body.brief || body);
  try {
    const { project, job } = pipeline.submit(cfg, lic, brief);
    sendJSON(res, { ok: true, projectId: project.id, job });
  } catch (e) { sendJSON(res, { error: e.message }, 400); }
}
function handleProjects(req, res) {
  const cfg = configMod.loadConfig();
  sendJSON(res, { projects: store.listProjects(cfg.dataDir), dataDir: cfg.dataDir });
}
function loadProject(res, id) {
  const cfg = configMod.loadConfig();
  const p = store.getProject(cfg.dataDir, id);
  if (!p) { sendJSON(res, { error: 'not found' }, 404); return null; }
  return { cfg, p };
}
function handleProjectGet(req, res, id) {
  const r = loadProject(res, id); if (!r) return;
  sendJSON(res, r.p);
}
async function handleResume(req, res, id) {
  const r = loadProject(res, id); if (!r) return;
  const lic = await getLicense();
  const body = parseJSONSafe(await readBody(req, 1e5), {}) || {};
  try {
    const job = pipeline.resume(r.cfg, lic, r.p, String(body.stage || ''));
    sendJSON(res, { ok: true, job });
  } catch (e) { sendJSON(res, { error: e.message }, 400); }
}
function handleOpen(req, res, id) {
  const cfg = configMod.loadConfig();
  const dir = id ? store.projectDir(cfg.dataDir, id) : cfg.dataDir;
  if (!dir) return sendJSON(res, { error: 'not found' }, 404);
  openPath(dir);
  sendJSON(res, { ok: true });
}
function handleDelete(req, res, id) {
  const cfg = configMod.loadConfig();
  sendJSON(res, { ok: store.deleteProject(cfg.dataDir, id) });
}
function handleYoutubeLogin(req, res) {
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'youtube-upload.mjs'), '--login'], { cwd: ROOT, stdio: 'ignore', detached: true });
  child.unref();
  sendJSON(res, { ok: true, message: 'Chrome を開きました。Google アカウントにログインして YouTube Studio が表示されたら、そのウィンドウを完全終了（Mac: Cmd+Q）してください。' });
}

// 生成物の配信 /files/<id>/<相対パス>（mp4 は Range 対応）
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
};
function serveFile(req, res, filePath, extraHeaders) {
  let st;
  try { st = fs.statSync(filePath); } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not Found'); }
  if (!st.isFile()) { res.writeHead(404); return res.end('Not Found'); }
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const range = req.headers.range;
  if (range && ext === '.mp4') {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
    if (start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    end = Math.min(end, st.size - 1);
    res.writeHead(206, Object.assign({ 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 }, extraHeaders || {}));
    return fs.createReadStream(filePath, { start, end }).pipe(res);
  }
  res.writeHead(200, Object.assign({ 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' }, extraHeaders || {}));
  fs.createReadStream(filePath).pipe(res);
}
function serveProjectFile(req, res, id, rel) {
  const cfg = configMod.loadConfig();
  const dir = store.projectDir(cfg.dataDir, id);
  if (!dir) { res.writeHead(404); return res.end('Not Found'); }
  const fp = path.normalize(path.join(dir, rel));
  if (!fp.startsWith(dir)) { res.writeHead(403); return res.end('Forbidden'); }
  serveFile(req, res, fp, { 'Cache-Control': 'no-store' });
}

const server = http.createServer((req, res) => {
  try {
    const url = (req.url || '/').split('?')[0];
    const m = req.method;
    const seg = url.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });

    if (seg[0] === 'api') {
      const a = seg[1];
      if (m === 'GET' && a === 'license') return handleLicense(req, res);
      if (m === 'POST' && a === 'activate') return handleActivate(req, res);
      if (m === 'GET' && a === 'config') return handleConfigGet(req, res);
      if (m === 'POST' && a === 'config') return handleConfigPost(req, res);
      if (m === 'POST' && a === 'create') return handleCreate(req, res);
      if (m === 'GET' && a === 'jobs') return sendJSON(res, { jobs: pipeline.listJobs() });
      if (m === 'POST' && a === 'youtube-login') return handleYoutubeLogin(req, res);
      if (a === 'projects') {
        if (m === 'GET' && !seg[2]) return handleProjects(req, res);
        if (m === 'GET' && seg[2] && !seg[3]) return handleProjectGet(req, res, seg[2]);
        if (m === 'POST' && seg[2] && seg[3] === 'resume') return handleResume(req, res, seg[2]);
        if (m === 'POST' && seg[2] && seg[3] === 'open') return handleOpen(req, res, seg[2]);
        if (m === 'DELETE' && seg[2]) return handleDelete(req, res, seg[2]);
      }
      if (m === 'POST' && a === 'open-data-dir') return handleOpen(req, res, '');
      return sendJSON(res, { error: 'not found' }, 404);
    }
    if (seg[0] === 'files' && seg[1]) return serveProjectFile(req, res, seg[1], seg.slice(2).join('/'));

    let urlPath = decodeURIComponent(url);
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = path.normalize(path.join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
    serveFile(req, res, filePath);
  } catch (e) {
    res.writeHead(500); res.end('Server Error');
  }
});

function listen(port, triesLeft) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && triesLeft > 0) listen(port + 1, triesLeft - 1);
    else { console.error('起動に失敗しました:', e.message); process.exit(1); }
  });
  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log('');
    console.log('  ニュース動画メーカー 〜世界の今を、日本で暮らす目で〜');
    console.log('  ' + url);
    console.log('  データ保存先: ' + configMod.loadConfig().dataDir);
    console.log('  終了するには Ctrl+C を押してください。');
    console.log('');
    try { fs.mkdirSync(configMod.loadConfig().dataDir, { recursive: true }); } catch {}
    getLicense().catch(() => {});
    if (process.env.NEWSMOVIE_NO_OPEN) return;
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
    exec(`${opener} ${url}`, () => {});
  });
}

// --- コマンドライン: run / login-youtube / schedule ---
async function cliRun(briefPath, edition) {
  const cfg = configMod.loadConfig();
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  let over = {};
  if (briefPath && !briefPath.startsWith('--')) {
    const spec = JSON.parse(fs.readFileSync(briefPath, 'utf8'));
    over = spec.brief || spec;
  }
  if (edition) over.edition = edition;
  const brief = configMod.briefFrom(cfg, over);
  const lic = await getLicense();
  const { project, job } = pipeline.submit(cfg, lic, brief);
  console.log(`[newsmovie] 制作を開始します: ${project.id}（${brief.edition} / ${brief.itemCount} 本 / 約 ${brief.durationSec} 秒 / ${brief.aspect} / 投稿: ${brief.upload ? brief.privacy : 'しない'}）`);
  const timer = setInterval(() => { process.stdout.write(`\r[newsmovie] ${job.stageLabel} ${job.progress}% ${job.detail ? '- ' + job.detail.slice(0, 70) : ''}   `); }, 2000);
  await pipeline.waitIdle();
  clearInterval(timer);
  console.log('');
  const p = store.getProject(cfg.dataDir, project.id);
  if (p.status !== 'done') { console.error('[newsmovie] 失敗: ' + p.error); process.exit(1); }
  console.log('[newsmovie] 完成: ' + p.dir);
  for (const [k, v] of Object.entries(p.outputs || {})) console.log(`  ${k}: ${path.join(p.dir, v)}`);
  if (p.youtube && p.youtube.url) console.log('  youtube: ' + p.youtube.url);
  process.exit(0);
}

async function cliResume(id, stage) {
  const cfg = configMod.loadConfig();
  const p = store.getProject(cfg.dataDir, id);
  if (!p) { console.error('[newsmovie] 案件が見つかりません: ' + id); process.exit(1); }
  const lic = await getLicense();
  const job = pipeline.resume(cfg, lic, p, stage || 'render');
  console.log(`[newsmovie] ${job.label}`);
  const timer = setInterval(() => { process.stdout.write(`\r[newsmovie] ${job.stageLabel} ${job.progress}% ${job.detail ? '- ' + job.detail.slice(0, 70) : ''}   `); }, 2000);
  await pipeline.waitIdle();
  clearInterval(timer);
  console.log('');
  const q = store.getProject(cfg.dataDir, id);
  if (q.status !== 'done') { console.error('[newsmovie] 失敗: ' + q.error); process.exit(1); }
  console.log('[newsmovie] 完成: ' + q.dir);
  if (q.youtube && q.youtube.url) console.log('  youtube: ' + q.youtube.url);
  process.exit(0);
}

function cliLoginYoutube() {
  const r = require('child_process').spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'youtube-upload.mjs'), '--login'], { cwd: ROOT, stdio: 'inherit' });
  process.exit(r.status || 0);
}

// macOS の launchd で毎日決まった時刻に `run` を走らせる（投稿 ON/OFF は設定に従う）
function cliSchedule(timeArg, edition) {
  if (process.platform !== 'darwin') { console.error('schedule は macOS（launchd）専用です。Windows はタスクスケジューラで `node bin/cli.js run --edition=world` を登録してください。'); process.exit(1); }
  edition = configMod.EDITIONS[edition] ? edition : 'world';
  const label = `net.if-juku.newsmovie.${edition}`;
  const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
  if (timeArg === 'off') {
    for (const ed of Object.keys(configMod.EDITIONS)) {
      const pl = path.join(os.homedir(), 'Library', 'LaunchAgents', `net.if-juku.newsmovie.${ed}.plist`);
      try { execFileSync('launchctl', ['unload', pl], { stdio: 'ignore' }); } catch {}
      try { fs.rmSync(pl, { force: true }); } catch {}
    }
    try { fs.rmSync(path.join(os.homedir(), 'Library', 'LaunchAgents', 'net.if-juku.newsmovie.daily.plist'), { force: true }); } catch {}
    console.log('[newsmovie] 毎日の自動制作（朝・夜とも）を解除しました');
    return;
  }
  const m = String(timeArg || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) { console.error('時刻を HH:MM で指定してください（例: node bin/cli.js schedule 05:10 world / schedule 19:10 japan）。解除は schedule off'); process.exit(1); }
  const logDir = path.join(configMod.loadConfig().dataDir, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const nodePath = process.execPath;
  const extraPath = `${os.homedir()}/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array><string>${nodePath}</string><string>${path.join(ROOT, 'bin', 'cli.js')}</string><string>run</string><string>--edition=${edition}</string></array>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${extraPath}</string><key>HOME</key><string>${os.homedir()}</string></dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>${parseInt(m[1], 10)}</integer><key>Minute</key><integer>${parseInt(m[2], 10)}</integer></dict>
  <key>StandardOutPath</key><string>${path.join(logDir, `daily-${edition}.log`)}</string>
  <key>StandardErrorPath</key><string>${path.join(logDir, `daily-${edition}.log`)}</string>
</dict></plist>
`;
  fs.mkdirSync(path.dirname(plist), { recursive: true });
  try { execFileSync('launchctl', ['unload', plist], { stdio: 'ignore' }); } catch {}
  fs.writeFileSync(plist, xml);
  execFileSync('launchctl', ['load', plist], { stdio: 'inherit' });
  console.log(`[newsmovie] 毎日 ${m[1]}:${m[2]} に${configMod.EDITIONS[edition].label}を自動制作します（${plist}）。ログ: ${path.join(logDir, `daily-${edition}.log`)}`);
  console.log('  投稿する／しないは設定（~/NewsMovie-data/config.json の upload）に従います。解除: node bin/cli.js schedule off');
}

// 設定の表示・変更（チャットから「毎日のニュースのジャンルを〇〇に」と言われたときもこれで直す）
function cliConfig(pairs) {
  const patch = {};
  for (const p of pairs) {
    const i = p.indexOf('=');
    if (i < 1) { console.error(`key=value の形で指定してください: ${p}`); process.exit(1); }
    const k = p.slice(0, i).trim();
    let v = p.slice(i + 1).trim();
    if (!(k in configMod.DEFAULTS)) { console.error(`設定にないキーです: ${k}（使えるキー: ${Object.keys(configMod.DEFAULTS).join(', ')}）`); process.exit(1); }
    if (k === 'genres') {
      const keys = configMod.GENRES.map((g) => g.key);
      v = v === 'all' ? keys.join(',') : v.split(',').map((x) => x.trim()).filter(Boolean).join(',');
      const bad = v.split(',').filter((g) => !keys.includes(g));
      if (bad.length || !v) { console.error(`ジャンル key が不正です: ${bad.join(',') || '(空)'}（使える key: ${keys.join(', ')} / all）`); process.exit(1); }
    }
    patch[k] = v;
  }
  const cfg = Object.keys(patch).length ? configMod.saveConfig(patch) : configMod.loadConfig();
  if (Object.keys(patch).length) console.log('[newsmovie] 設定を保存しました: ' + configMod.CONFIG_PATH);
  const genres = String(cfg.genres || '').split(',');
  console.log('ジャンル: ' + configMod.GENRES.map((g) => `${genres.includes(g.key) ? '[x]' : '[ ]'} ${g.key}（${g.label}）`).join(' / '));
  for (const k of Object.keys(configMod.DEFAULTS)) if (k !== 'genres') console.log(`${k}: ${cfg[k]}`);
}

const [, , cmd, arg, arg2] = process.argv;
const editionArg = (process.argv.find((a) => a.startsWith('--edition=')) || '').slice(10) || (arg2 && !arg2.startsWith('--') ? arg2 : '');
if (cmd === 'run') cliRun(arg, editionArg).catch((e) => { console.error(e.message); process.exit(1); });
else if (cmd === 'resume') cliResume(arg, arg2).catch((e) => { console.error(e.message); process.exit(1); });
else if (cmd === 'login-youtube') cliLoginYoutube();
else if (cmd === 'schedule') cliSchedule(arg, editionArg);
else if (cmd === 'config') cliConfig(process.argv.slice(3));
else listen(START_PORT, 20);
