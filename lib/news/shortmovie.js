// Short Movie（同じアシュラ奥義）を音声合成＋レンダリングのエンジンとして使う。
// Short Movie を固定ポートで常駐させ、POST /api/render（SSE）に台本と背景画像を渡して movie.mp4 を受け取る。
// Node 標準のみ。
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');

/** Short Movie のフォルダを探す（設定 → 隣のフォルダ → Desktop → 開発リポジトリ） */
function findShortMovieDir(cfg) {
  const cands = [
    cfg && cfg.shortMovieDir,
    path.resolve(ROOT, '..', 'ShortMovie'),
    path.join(os.homedir(), 'Desktop', 'ShortMovie'),
    path.join(os.homedir(), 'Desktop', 'ifJukuManager', 'CodexAppServer', 'ShortMovie'),
  ].filter(Boolean);
  for (const d of cands) {
    if (fs.existsSync(path.join(d, 'bin', 'cli.js'))) return d;
  }
  return null;
}

function shortMovieState(cfg) {
  const dir = findShortMovieDir(cfg);
  const built = !!(dir && fs.existsSync(path.join(dir, '.next', 'standalone', 'server.js')));
  const hasRenderApi = !!(dir && fs.existsSync(path.join(dir, 'app', 'api', 'render', 'route.ts')));
  return { dir, built, hasRenderApi };
}

function ping(port, pathname, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: pathname, timeout: timeoutMs || 3000 }, (res) => {
      res.resume();
      resolve(res.statusCode && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** POST /api/render に空ボディを投げ、404 以外（400 等）が返れば render API がある */
function hasRenderApi(port) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/api/render', method: 'POST', timeout: 5000, headers: { 'Content-Type': 'application/json' } }, (res) => {
      res.resume();
      resolve(res.statusCode !== 404);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end('{}');
  });
}

/** そのポートで LISTEN しているプロセスだけを止める（launchd の PATH に lsof が無いのでフルパス） */
function killPort(port) {
  try {
    const { execSync } = require('node:child_process');
    if (process.platform === 'win32') return;
    execSync(`/usr/sbin/lsof -nP -t -iTCP:${port} -sTCP:LISTEN | grep -v '^${process.pid}$' | xargs kill -9`, { stdio: 'ignore', shell: '/bin/zsh' });
  } catch { /* 誰も居なければそれで良い */ }
}

function codexPath() {
  return `${process.env.PATH || '/usr/bin:/bin'}:${os.homedir()}/.npm-global/bin:/usr/local/bin:/opt/homebrew/bin`;
}

/** Short Movie が応答するまで起動を待つ。居なければ bin/cli.js を切り離して起動 */
async function ensureShortMovie(cfg, log) {
  const port = parseInt(cfg.shortMoviePort, 10) || 4561;
  const st = shortMovieState(cfg);
  if (!st.dir) throw new Error('Short Movie が見つかりません。アシュラの「Short Movie」を導入するか、設定で Short Movie のフォルダを指定してください。');
  if (!st.built) throw new Error(`Short Movie がまだビルドされていません（${st.dir}）。Short Movie を一度起動（bash ashura-start.sh）してから、もう一度お試しください。`);
  if (!st.hasRenderApi) throw new Error('この Short Movie は古く、レンダリング API（/api/render）がありません。Short Movie を最新版に更新してください。');
  if (await ping(port, '/api/voice-info')) {
    // 2026-10-07: 古い Short Movie（/api/render が無い版）が居座っていて 404 になった事故の対策。
    // render API が無ければその場で止めて、ビルド済みの新しい版を起動し直す
    if (await hasRenderApi(port)) return port;
    if (log) log('古い Short Movie が動いているため、起動し直します');
    killPort(port);
    await sleep(2000);
  }

  if (log) log(`Short Movie を起動しています（port ${port}）`);
  const logDir = path.join(cfg.dataDir, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const fd = fs.openSync(path.join(logDir, 'shortmovie-server.log'), 'a');
  const child = spawn(process.execPath, ['bin/cli.js'], {
    cwd: st.dir,
    env: Object.assign({}, process.env, { PATH: codexPath(), PORT: String(port), HOSTNAME: '127.0.0.1' }),
    detached: true,
    stdio: ['ignore', fd, fd],
  });
  child.unref();
  for (let i = 0; i < 90; i++) {
    await sleep(2000);
    if (await ping(port, '/api/voice-info', 5000)) return port;
  }
  throw new Error(`Short Movie が port ${port} で起動しませんでした（${path.join(logDir, 'shortmovie-server.log')} を確認）`);
}

/**
 * POST /api/render（SSE）を呼び、done イベントを返す。
 * onStep(text) で進行を受け取る。
 */
function renderViaShortMovie(port, body, onStep, timeoutMs) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, path: '/api/render', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      if (res.statusCode !== 200) {
        let buf = '';
        res.on('data', (c) => { buf += c; });
        res.on('end', () => {
          let msg = buf;
          try { const j = JSON.parse(buf); msg = j.error + (j.hint ? `（${j.hint}）` : ''); } catch {}
          reject(new Error(`Short Movie render API エラー (${res.statusCode}): ${String(msg).slice(0, 300)}`));
        });
        return;
      }
      let buf = '';
      let done = null;
      let error = null;
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
          let event = 'message', payload = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) payload += line.slice(5).trim();
          }
          let d = null; try { d = JSON.parse(payload); } catch {}
          if (event === 'step' && d && onStep) onStep(d.text || '');
          else if (event === 'error' && d) error = d.message || 'render error';
          else if (event === 'done' && d) done = d;
        }
      });
      res.on('end', () => {
        clearTimeout(timer);
        if (error) reject(new Error(error));
        else if (done) resolve(done);
        else reject(new Error('Short Movie から完了通知が届きませんでした'));
      });
      res.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
    const timer = setTimeout(() => { try { req.destroy(new Error('レンダリングがタイムアウトしました')); } catch {} }, timeoutMs || 40 * 60 * 1000);
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.write(data);
    req.end();
  });
}

module.exports = { findShortMovieDir, shortMovieState, ensureShortMovie, renderViaShortMovie, ping };
