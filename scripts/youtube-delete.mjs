// === YouTube 動画の削除（Playwright / ログイン済み Chrome プロファイル使用） ===
//
//   node scripts/youtube-delete.mjs --id=<videoId>
//
// YouTube Studio の動画の「編集」画面を開き、オプションメニューから「完全に削除」する。
// 結果は stdout に `RESULT {"ok":true}` または `RESULT {"error":"..."}` の 1 行で出す。
// 失敗時は ~/.ytupload-data/debug-delete-*.png にスクリーンショットを残す。

import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PROFILE_DIR = join(homedir(), '.ytupload-data', 'profile');
const DEBUG_DIR = join(homedir(), '.ytupload-data');

function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.slice(name.length + 3) : undefined;
}
function result(obj) { console.log(`RESULT ${JSON.stringify(obj)}`); }

function loadPlaywright() {
  for (const base of [ROOT, resolve(ROOT, '..', 'NotePost'), join(homedir(), 'Desktop', 'NotePost')]) {
    try { return createRequire(join(base, 'package.json'))('playwright'); } catch { /* next */ }
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
  try { return await chromium.launchPersistentContext(PROFILE_DIR, { ...opts, channel: 'chrome' }); }
  catch { return await chromium.launchPersistentContext(PROFILE_DIR, opts); }
}

async function shot(page, name) { try { await page.screenshot({ path: join(DEBUG_DIR, `debug-delete-${name}.png`) }); } catch {} }

async function tryDelete(chromium, headless, videoId) {
  let ctx;
  try { ctx = await launch(chromium, headless); } catch (e) { return { retriable: true, error: `ブラウザ起動失敗: ${e}`.slice(0, 300) }; }
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.setDefaultTimeout(30000);
  try {
    await page.goto(`https://studio.youtube.com/video/${videoId}/edit`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    if (page.url().includes('accounts.google.com')) { await ctx.close(); return { retriable: true, error: 'login-redirect' }; }
    const proceed = page.getByText(/YOUTUBE STUDIO に進む/i).first();
    if (await proceed.count()) { try { await proceed.click(); await page.waitForTimeout(4000); } catch {} }

    // 右上の「オプション」（縦三点）メニュー
    const menuBtn = page.locator('ytcp-video-metadata-editor-sidepanel #overflow-menu-button, #overflow-menu-button, ytcp-icon-button[aria-label="オプション"], ytcp-button[aria-label="オプション"]').first();
    await menuBtn.waitFor({ state: 'visible', timeout: 30000 });
    await menuBtn.click();
    await page.waitForTimeout(1200);
    const delItem = page.locator('tp-yt-paper-item, ytcp-text-menu-item, [role="menuitem"]').filter({ hasText: /^\s*(完全に)?削除\s*$/ }).first();
    await delItem.waitFor({ state: 'visible', timeout: 15000 });
    await delItem.click();
    await page.waitForTimeout(1500);

    // 確認ダイアログ: チェックボックス → 「動画を削除」
    const dialog = page.locator('ytcp-confirmation-dialog, tp-yt-paper-dialog').last();
    const check = dialog.locator('ytcp-checkbox-lit, #confirm-checkbox, tp-yt-paper-checkbox').first();
    if (await check.count()) { try { await check.click(); } catch {} }
    await page.waitForTimeout(600);
    const confirmBtn = dialog.getByRole('button', { name: /動画を削除|削除/ }).last();
    await confirmBtn.waitFor({ state: 'visible', timeout: 15000 });
    await confirmBtn.click();
    await page.waitForTimeout(5000);

    // 削除後は動画一覧へ戻る（または「この動画は削除されました」）
    const gone = page.url().includes('/videos') || (await page.getByText(/削除され|見つかりません|存在しません/).count()) > 0;
    if (!gone) {
      await page.goto(`https://studio.youtube.com/video/${videoId}/edit`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
    }
    const stillThere = (await page.locator('#title-textarea').count()) > 0 && !page.url().includes('/videos');
    if (stillThere) { await shot(page, 'still-there'); await ctx.close(); return { retriable: false, error: '削除を確認できませんでした（YouTube Studio で確認してください）' }; }
    await ctx.close();
    return { ok: true };
  } catch (err) {
    await shot(page, headless ? 'headless' : 'headed');
    try { await ctx.close(); } catch {}
    return { retriable: headless, error: `${err}`.slice(0, 400) };
  }
}

(async () => {
  const id = arg('id');
  if (!id) { result({ error: '--id=<videoId> を指定してください' }); process.exit(1); }
  const pw = loadPlaywright();
  if (!pw) { result({ error: 'playwright が見つかりません' }); process.exit(1); }
  if (!existsSync(PROFILE_DIR)) { result({ error: 'session-required' }); process.exit(1); }
  let r = await tryDelete(pw.chromium, true, id);
  if (!r.ok && r.retriable) { console.log(`ヘッドレスで失敗 (${r.error})。ウィンドウ表示でリトライします...`); r = await tryDelete(pw.chromium, false, id); }
  if (r.ok) result({ ok: true, videoId: id });
  else { result({ error: r.error === 'login-redirect' ? 'session-required' : r.error }); process.exit(1); }
})();
