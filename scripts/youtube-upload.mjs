// === YouTube アップロード（Playwright / ログイン済み Chrome プロファイル使用） ===
//
// 「実ブラウザのログインセッションを使い回す」方式で YouTube Studio に直接アップロードする。
// API キー・OAuth 設定は不要。プロファイルは ~/.ytupload-data/profile（他のアシュラ奥義と共有）。
//
// 使い方:
//   初回ログイン:  node scripts/youtube-upload.mjs --login
//   アップロード:  node scripts/youtube-upload.mjs --file=/path/movie.mp4 --title="..." --description="..." [--privacy=PUBLIC|UNLISTED|PRIVATE]
//   動作確認:      node scripts/youtube-upload.mjs --dry
//   ログイン情報の持ち出し: node scripts/youtube-upload.mjs --export-cookies
//     → ~/.ytupload-data/cookies.json を書く。別の Mac（mini 等）の同じ場所に置くと、
//       そちらで Chrome にログインしなくても投稿できる（Keychain 暗号化の都合でプロファイル丸ごとのコピーは効かない）
//
// 実行はまずヘッドレスで試し、ログイン拒否や起動失敗のときだけウィンドウ表示にフォールバックする。
// 動画ファイル選択後の失敗は二重アップロード防止のためリトライしない。
// 結果は stdout に `RESULT {"url":"...","videoId":"..."}` または `RESULT {"error":"..."}` の 1 行で出す。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PROFILE_DIR = join(homedir(), '.ytupload-data', 'profile');
const DEBUG_DIR = join(homedir(), '.ytupload-data');
const COOKIES_FILE = join(homedir(), '.ytupload-data', 'cookies.json');

function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.slice(name.length + 3) : undefined;
}
function result(obj) { console.log(`RESULT ${JSON.stringify(obj)}`); }

// playwright は自分の node_modules → 近くのアシュラ奥義（NotePost 等）の順で探す
function loadPlaywright() {
  const cands = [
    ROOT,
    resolve(ROOT, '..', 'NotePost'),
    join(homedir(), 'Desktop', 'NotePost'),
    join(homedir(), 'Desktop', 'ifJukuManager', 'CodexAppServer', 'NotePost'),
  ];
  for (const base of cands) {
    try {
      const req = createRequire(join(base, 'package.json'));
      return req('playwright');
    } catch { /* 次の候補 */ }
  }
  return null;
}

async function launch(chromium, headless) {
  mkdirSync(PROFILE_DIR, { recursive: true });
  const opts = {
    headless,
    viewport: { width: 1400, height: 900 },
    locale: 'ja-JP',
    ...(headless ? { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36' } : {}),
    ignoreDefaultArgs: ['--enable-automation', '--no-sandbox', '--use-mock-keychain'],
    args: ['--disable-blink-features=AutomationControlled', '--no-default-browser-check'],
  };
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(PROFILE_DIR, { ...opts, channel: 'chrome' });
  } catch {
    ctx = await chromium.launchPersistentContext(PROFILE_DIR, opts);
  }
  // 別 Mac から持ち込んだログイン情報（cookies.json）があれば読み込む
  if (existsSync(COOKIES_FILE)) {
    try {
      const cookies = JSON.parse(readFileSync(COOKIES_FILE, 'utf8'));
      if (Array.isArray(cookies) && cookies.length) await ctx.addCookies(cookies);
    } catch (e) { console.log(`cookies.json を読めませんでした: ${e}`); }
  }
  return ctx;
}

// 今ログインしているプロファイルの Google / YouTube の Cookie を cookies.json に書き出す
async function exportCookiesFlow() {
  const pw = loadPlaywright();
  if (!pw) { result({ error: 'playwright が見つかりません' }); process.exit(1); }
  const ctx = await launch(pw.chromium, true);
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto('https://studio.youtube.com', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    if (page.url().includes('accounts.google.com')) { result({ error: 'このプロファイルはログインしていません（--login で先にログイン）' }); process.exit(1); }
    const cookies = (await ctx.cookies()).filter((c) => /google|youtube/.test(c.domain));
    writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
    result({ ok: true, file: COOKIES_FILE, count: cookies.length });
  } finally { await ctx.close(); }
}

// ログインは Playwright を使わず「素の Chrome」を専用プロファイルで起動して行う
// （Playwright 経由だと Google が「このブラウザは安全でない可能性」と拒否するため）
function loginFlow() {
  mkdirSync(PROFILE_DIR, { recursive: true });
  const url = 'https://accounts.google.com/ServiceLogin?continue=https://studio.youtube.com';
  let r;
  if (process.platform === 'darwin') {
    r = spawnSync('open', ['-na', 'Google Chrome', '--args', `--user-data-dir=${PROFILE_DIR}`, '--no-first-run', url], { stdio: 'inherit' });
  } else if (process.platform === 'win32') {
    r = spawnSync('cmd', ['/c', 'start', '', 'chrome', `--user-data-dir=${PROFILE_DIR}`, '--no-first-run', url], { stdio: 'inherit' });
  } else {
    r = spawnSync('google-chrome', [`--user-data-dir=${PROFILE_DIR}`, '--no-first-run', url], { stdio: 'inherit' });
  }
  console.log('');
  console.log('==========================================================');
  console.log('  開いた Chrome ウィンドウで Google アカウントにログインし、');
  console.log('  YouTube Studio が表示されるのを確認してください。');
  console.log('  終わったらそのウィンドウを完全終了（Mac: Cmd+Q）してください。');
  console.log('  （ログイン情報はプロファイルに保存され、以後自動で使われます）');
  console.log('==========================================================');
  console.log('');
  if (!r || r.status !== 0) console.error('Chrome の起動に失敗しました。Google Chrome がインストールされているか確認してください。');
}

async function screenshotSafe(page, name) {
  try { await page.screenshot({ path: join(DEBUG_DIR, `debug-${name}.png`), fullPage: false }); } catch {}
}

async function tryUpload(chromium, headless, { file, title, description, privacy, dry }) {
  console.log(`ブラウザ起動 (headless=${headless})`);
  let ctx;
  try {
    ctx = await launch(chromium, headless);
  } catch (e) {
    return { retriable: true, error: `ブラウザ起動失敗: ${e}`.slice(0, 300) };
  }
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.setDefaultTimeout(30000);
  let fileChosen = false;

  try {
    await page.goto('https://studio.youtube.com', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);

    if (page.url().includes('accounts.google.com')) {
      await ctx.close();
      return { retriable: true, error: 'login-redirect' };
    }

    const proceed = page.getByText(/YOUTUBE STUDIO に進む/i).first();
    if (await proceed.count()) {
      try { await proceed.click(); await page.waitForTimeout(4000); } catch {}
    }

    const m = page.url().match(/channel\/(UC[\w-]+)/);
    if (m) {
      await page.goto(`https://studio.youtube.com/channel/${m[1]}/videos/upload?d=ud`, { waitUntil: 'domcontentloaded' });
    } else {
      await page.locator('#create-icon').click();
      await page.locator('tp-yt-paper-item#text-item-0, ytcp-text-menu-item#text-item-0').first().click();
    }

    const fileInput = page.locator('input[type="file"]');
    await fileInput.waitFor({ state: 'attached', timeout: 30000 });
    if (dry) {
      await ctx.close();
      return { ok: true, dry: true };
    }
    await fileInput.setInputFiles(file);
    fileChosen = true;
    console.log('ファイル選択完了、ダイアログ待機中...');

    const titleBox = page.locator('#title-textarea #textbox, ytcp-social-suggestions-textbox[label="タイトル"] #textbox').first();
    await titleBox.waitFor({ state: 'visible', timeout: 60000 });
    await page.waitForTimeout(2000);
    await titleBox.click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.insertText(title);

    if (description) {
      const descBox = page.locator('#description-textarea #textbox').first();
      if (await descBox.count()) {
        await descBox.click();
        await page.keyboard.insertText(description);
      }
    }

    const notForKids = page.locator('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]');
    await notForKids.waitFor({ state: 'visible', timeout: 30000 });
    await notForKids.click();

    let videoUrl = null;
    for (let i = 0; i < 30 && !videoUrl; i++) {
      const link = page.locator('a.ytcp-video-info, ytcp-video-info a, .video-url-fadeable a').first();
      if (await link.count()) {
        const href = (await link.textContent())?.trim();
        if (href && href.includes('youtu')) videoUrl = href;
      }
      if (!videoUrl) await page.waitForTimeout(2000);
    }

    for (let i = 0; i < 3; i++) {
      await page.locator('#next-button').click();
      await page.waitForTimeout(1500);
    }

    const privacyRadio = page.locator(`tp-yt-paper-radio-button[name="${privacy}"]`);
    await privacyRadio.waitFor({ state: 'visible', timeout: 30000 });
    await privacyRadio.click();
    await page.waitForTimeout(1000);
    await page.locator('#done-button').click();
    console.log('公開ボタンを押しました。処理完了待ち...');

    for (let i = 0; i < 60; i++) {
      const confirmBtn = page.getByRole('button', { name: /^公開する$/ });
      if (await confirmBtn.count()) {
        try { await confirmBtn.first().click(); console.log('確認ダイアログで「公開する」を押しました'); } catch {}
      }
      const dialogGone = (await page.locator('ytcp-uploads-dialog').count()) === 0;
      const doneDialog = await page.locator('ytcp-uploads-still-processing-dialog').count();
      if (dialogGone || doneDialog > 0) break;
      await page.waitForTimeout(3000);
    }
    const closeBtn = page.locator('ytcp-uploads-still-processing-dialog #close-button, ytcp-uploads-still-processing-dialog ytcp-button');
    if (await closeBtn.count()) { try { await closeBtn.first().click(); } catch {} }

    if (!videoUrl) {
      await screenshotSafe(page, 'no-url');
      await ctx.close();
      return { retriable: false, error: '動画URLが取得できませんでした（アップロード自体は完了している可能性あり。YouTube Studio を確認）' };
    }

    const idMatch = videoUrl.match(/youtu\.be\/([\w-]+)/) || videoUrl.match(/[?&]v=([\w-]+)/);
    const videoId = idMatch ? idMatch[1] : undefined;
    await ctx.close();
    return { ok: true, url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : videoUrl, videoId };
  } catch (err) {
    await screenshotSafe(page, `error-${headless ? 'headless' : 'headed'}`);
    try { await ctx.close(); } catch {}
    return { retriable: !fileChosen, error: `${err}`.slice(0, 500) };
  }
}

async function uploadFlow() {
  const pw = loadPlaywright();
  if (!pw) {
    result({ error: 'playwright が見つかりません。このフォルダで npm install を実行してください' });
    process.exit(1);
  }
  const { chromium } = pw;
  const file = arg('file');
  const title = arg('title') || 'ニュース動画';
  const description = arg('description') || '';
  const privacy = (arg('privacy') || 'PUBLIC').toUpperCase();
  const dry = process.argv.includes('--dry');
  if (!dry && (!file || !existsSync(file))) {
    result({ error: `動画ファイルが見つかりません: ${file}` });
    process.exit(1);
  }
  if (!existsSync(PROFILE_DIR)) {
    result({ error: 'session-required: 先に --login でログインしてください' });
    process.exit(1);
  }
  const params = { file, title, description, privacy, dry };
  const forceHeaded = process.argv.includes('--headed');
  let r = await tryUpload(chromium, forceHeaded ? false : true, params);
  if (!r.ok && r.retriable && !forceHeaded) {
    console.log(`ヘッドレスで失敗 (${r.error})。ウィンドウ表示でリトライします...`);
    r = await tryUpload(chromium, false, params);
  }
  if (r.ok) {
    result(r.dry ? { dry: true, ok: true } : { url: r.url, videoId: r.videoId });
  } else {
    const msg = r.error === 'login-redirect' ? 'session-required: ログインが切れています。--login で再ログインしてください' : r.error;
    result({ error: msg });
    process.exit(1);
  }
}

if (process.argv.includes('--login')) loginFlow();
else if (process.argv.includes('--export-cookies')) exportCookiesFlow();
else uploadFlow();
